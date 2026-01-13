import argparse
import gc
import json
import threading
import time
from collections import deque, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Empty, Full, Queue
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO


def _sse_encode(event_name: str, data_obj: dict[str, Any]) -> bytes:
    payload = json.dumps(data_obj, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_name}\ndata: {payload}\n\n".encode("utf-8")


class SseHub:
    def __init__(self, cameras: list[dict[str, Any]], queue_size: int = 32):
        self.cameras = cameras
        self._queue_size = queue_size
        self._clients: set[Queue[bytes]] = set()
        self._lock = threading.Lock()

    def add_client(self) -> Queue[bytes]:
        q: Queue[bytes] = Queue(maxsize=self._queue_size)
        with self._lock:
            self._clients.add(q)
        return q

    def remove_client(self, q: Queue[bytes]) -> None:
        with self._lock:
            self._clients.discard(q)

    def publish(self, event_name: str, data_obj: dict[str, Any]) -> None:
        msg = _sse_encode(event_name, data_obj)
        with self._lock:
            clients = list(self._clients)
        for q in clients:
            try:
                q.put_nowait(msg)
            except Full:
                try:
                    q.get_nowait()
                except Empty:
                    pass
                try:
                    q.put_nowait(msg)
                except Full:
                    pass

    def status(self) -> dict[str, Any]:
        with self._lock:
            clients = len(self._clients)
        return {"ok": True, "clients": clients, "cameras": self.cameras}


class _TrackingSseHandler(BaseHTTPRequestHandler):
    hub: SseHub

    def log_message(self, fmt: str, *args: object) -> None:
        # 標準のアクセスログは静かにする（推論中のSTDOUTを汚さない）
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]

        if path == "/status":
            body = json.dumps(self.hub.status(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path != "/stream":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = self.hub.add_client()
        try:
            self.wfile.write(_sse_encode("hello", {"type": "hello", "version": 1, "cameras": self.hub.cameras, "ts": time.time()}))
            self.wfile.flush()

            last_ping = time.time()
            while True:
                try:
                    msg = q.get(timeout=1.0)
                except Empty:
                    msg = None

                if msg is not None:
                    self.wfile.write(msg)
                    self.wfile.flush()
                    continue

                if time.time() - last_ping >= 5.0:
                    self.wfile.write(_sse_encode("ping", {"type": "ping", "ts": time.time()}))
                    self.wfile.flush()
                    last_ping = time.time()
        except (BrokenPipeError, ConnectionError, OSError):
            pass
        finally:
            self.hub.remove_client(q)


def start_sse_server(host: str, port: int, hub: SseHub) -> ThreadingHTTPServer:
    _TrackingSseHandler.hub = hub
    httpd = ThreadingHTTPServer((host, port), _TrackingSseHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    print(f"[sse] listening: http://{host}:{port}/stream  (status: http://{host}:{port}/status)")
    return httpd


def pick_target(boxes_xyxy, confs, track_ids, prev_id):
    """
    1人だけ追うターゲット選択:
    - 以前のIDがまだいるならそれ
    - いないなら bbox面積最大を選ぶ（近い/主役っぽい仮定）
    """
    n = len(track_ids)
    if n == 0:
        return None

    if prev_id is not None:
        for i in range(n):
            if int(track_ids[i]) == int(prev_id):
                return i

    areas = []
    for i in range(n):
        x1, y1, x2, y2 = boxes_xyxy[i]
        areas.append((x2 - x1) * (y2 - y1))
    best_i = max(range(n), key=lambda i: areas[i])
    return best_i


def parse_source(src: str):
    # "0" -> webcam index 0 / "1" -> webcam index 1 / else path/URL
    if src.isdigit():
        return int(src)
    return src


def _try_open_camera(index: int) -> bool:
    cap = cv2.VideoCapture(index)
    try:
        if not cap.isOpened():
            return False
        ok, _ = cap.read()
        return bool(ok)
    finally:
        cap.release()


def scan_available_cameras(max_index: int) -> list[int]:
    available = []
    for i in range(max_index + 1):
        try:
            if _try_open_camera(i):
                available.append(i)
        except Exception:
            continue
    return available


def ui_select_two_cameras(max_index: int, default_a: int, default_b: int, available: set[int]) -> tuple[int, int]:
    win = "Select Cameras (ESC=quit, Enter/Space=start)"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    default_a = int(np.clip(default_a, 0, max_index))
    default_b = int(np.clip(default_b, 0, max_index))
    cv2.createTrackbar("cam A", win, default_a, max_index, lambda _: None)
    cv2.createTrackbar("cam B", win, default_b, max_index, lambda _: None)

    canvas = np.zeros((260, 900, 3), dtype=np.uint8)
    while True:
        cam_a = cv2.getTrackbarPos("cam A", win)
        cam_b = cv2.getTrackbarPos("cam B", win)
        ok_a = cam_a in available
        ok_b = cam_b in available

        img = canvas.copy()
        cv2.putText(img, f"available: {sorted(available)}", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)
        cv2.putText(img, f"cam A = {cam_a}  [{'OK' if ok_a else 'NG'}]", (20, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        cv2.putText(img, f"cam B = {cam_b}  [{'OK' if ok_b else 'NG'}]", (20, 110),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        if cam_a == cam_b:
            cv2.putText(img, "cam A と cam B は別にしてください", (20, 160),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
        cv2.putText(img, "Enter/Space: start   ESC: quit", (20, 220),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 200, 200), 2)
        cv2.imshow(win, img)

        key = cv2.waitKey(50) & 0xFF
        if key == 27:  # ESC
            raise SystemExit(0)
        if key in (10, 13, 32):  # Enter/Return/Space
            if cam_a != cam_b and ok_a and ok_b:
                cv2.destroyWindow(win)
                return cam_a, cam_b


def _resize_to_height(img: np.ndarray, height: int) -> np.ndarray:
    h, w = img.shape[:2]
    if h == height:
        return img
    new_w = max(1, int(round(w * (height / h))))
    return cv2.resize(img, (new_w, height), interpolation=cv2.INTER_AREA)


def annotate_tracking_frame(frame, result, state, args):
    state["frame_i"] += 1
    frame_i = state["frame_i"]
    trails = state["trails"]
    last_seen = state["last_seen"]
    target_id = state["target_id"]
    h, w = frame.shape[:2]
    tracks_payload: list[dict[str, Any]] = []

    # 検出/追跡結果
    if result.boxes is None or result.boxes.id is None:
        boxes = None
        ids = None
        confs = None
    else:
        boxes = result.boxes.xyxy.cpu().numpy()
        confs = result.boxes.conf.cpu().numpy()
        ids = result.boxes.id.cpu().numpy().astype(int)

    if ids is not None and len(ids) > 0:
        idx_target = pick_target(boxes, confs, ids, target_id)
        if idx_target is None:
            target_id = None
        else:
            target_id = int(ids[idx_target])

        for i in range(len(ids)):
            tid = int(ids[i])
            x1f, y1f, x2f, y2f = boxes[i].astype(float)
            x1 = int(np.clip(x1f, 0, w))
            y1 = int(np.clip(y1f, 0, h))
            x2 = int(np.clip(x2f, 0, w))
            y2 = int(np.clip(y2f, 0, h))
            c = float(confs[i])

            last_seen[tid] = frame_i

            cx = int((x1 + x2) / 2)
            cy = int((y1 + y2) / 2)
            trails[tid].append((cx, cy))

            bw = max(0, x2 - x1)
            bh = max(0, y2 - y1)
            area_n = (bw * bh) / float(max(1, w * h))
            tracks_payload.append({
                "id": tid,
                "conf": c,
                "bbox": [x1, y1, x2, y2],
                "center": [cx, cy],
                "bboxN": [x1 / w, y1 / h, x2 / w, y2 / h],
                "centerN": [cx / w, cy / h],
                "areaN": area_n,
            })

            is_target = (args.highlight_target and target_id is not None and tid == target_id)
            color = (0, 255, 0) if is_target else (255, 255, 255)
            thick = 3 if is_target else 2

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, thick)
            cv2.putText(
                frame, f"id={tid} conf={c:.2f}",
                (x1, max(0, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2
            )
    else:
        target_id = None

    dead_ids = [tid for tid, last in last_seen.items() if frame_i - last > args.trail_ttl]
    for tid in dead_ids:
        last_seen.pop(tid, None)
        trails.pop(tid, None)

    if args.draw_trails:
        for tid, dq in trails.items():
            if len(dq) < 2:
                continue
            is_target = (args.highlight_target and target_id is not None and tid == target_id)
            color = (255, 255, 0) if is_target else (200, 200, 200)
            thick = 3 if is_target else 2
            for k in range(1, len(dq)):
                cv2.line(frame, dq[k - 1], dq[k], color, thick)

    state["target_id"] = target_id
    return frame, tracks_payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cam1", type=str, default=None, help='camera A source (e.g. "0")')
    parser.add_argument("--cam2", type=str, default=None, help='camera B source (e.g. "1")')
    parser.add_argument("--max_cam_index", type=int, default=10, help="UIでスキャンする最大カメラindex")
    parser.add_argument("--no_ui", action="store_true", help="UI選択を使わずに --cam1/--cam2 を必須にする")
    parser.add_argument("--model", type=str, default="yolov8n.pt",
                        help="YOLO model path (e.g. yolov8n.pt, yolov8s.pt)")
    parser.add_argument("--conf", type=float, default=0.25, help="confidence threshold")
    parser.add_argument("--imgsz", type=int, default=640, help="inference size")
    parser.add_argument("--tracker", type=str, default="bytetrack.yaml", help="tracker config yaml")
    parser.add_argument("--show", action="store_true", default=True, help="show window")
    parser.add_argument("--save", action="store_true", help="save output video (only for file/rtsp; webcam also可)")
    parser.add_argument("--out", type=str, default="out.mp4", help="output path if --save")
    parser.add_argument("--trail", type=int, default=60, help="trail length per ID")
    parser.add_argument("--trail_ttl", type=int, default=45, help="frames to keep trail after ID disappears")
    parser.add_argument("--draw_trails", action="store_true", help="draw trails for each ID")
    parser.add_argument("--highlight_target", action="store_true", help="highlight selected target person")
    parser.add_argument("--stream_buffer", action="store_true", help="入力ストリームをバッファする（遅延↑ / カクつき↓の場合あり）")
    parser.add_argument("--stutter_ms", type=float, default=200.0, help="このmsを超えたらSTDOUTに警告を出す")
    parser.add_argument("--gc_disable", action="store_true", help="GCを無効化（周期的な停止の切り分け用）")
    parser.add_argument("--sse", action="store_true", help="追跡結果をSSEで配信する（TS側はEventSourceで受信）")
    parser.add_argument("--sse_host", type=str, default="127.0.0.1", help="SSEサーバのbind host")
    parser.add_argument("--sse_port", type=int, default=8765, help="SSEサーバのport")
    args = parser.parse_args()

    if args.gc_disable:
        gc.disable()

    if args.cam1 is None or args.cam2 is None:
        if args.no_ui:
            raise SystemExit("--no_ui の場合は --cam1 と --cam2 が必要です")
        available = scan_available_cameras(args.max_cam_index)
        if len(available) < 2:
            raise SystemExit(f"利用可能なカメラが2台見つかりませんでした: {available}")
        default_a = available[0]
        default_b = available[1]
        cam_a, cam_b = ui_select_two_cameras(args.max_cam_index, default_a, default_b, set(available))
        src_a, src_b = str(cam_a), str(cam_b)
    else:
        src_a, src_b = args.cam1, args.cam2

    streams_path = Path(__file__).with_name("selected_2cams.streams")
    streams_path.write_text(f"{src_a}\n{src_b}\n", encoding="utf-8")
    print(f"Opening sources: A={src_a}, B={src_b} (streams file: {streams_path})")

    camera_index_map = {str(src_a): 0, str(src_b): 1}

    sse_hub = None
    sse_server = None
    if args.sse:
        cameras = [{"index": 0, "source": str(src_a)}, {"index": 1, "source": str(src_b)}]
        sse_hub = SseHub(cameras=cameras, queue_size=32)
        sse_server = start_sse_server(args.sse_host, args.sse_port, sse_hub)

    model = YOLO(args.model)

    # カメラごとの状態
    states = {}

    # 表示順（.streamsの行順で固定）
    ordered_keys = [str(src_a), str(src_b)]

    # 保存用（必要なら）
    writer = None
    out_fps = 30.0  # 後で最初のフレームで上書きする
    out_size = None

    results_iter = model.track(
        source=str(streams_path),
        stream=True,
        tracker=args.tracker,
        classes=[0],            # person only (COCO)
        conf=args.conf,
        imgsz=args.imgsz,
        persist=True,           # tracker state 유지
        verbose=False,
        stream_buffer=args.stream_buffer,
    )

    prev_show_t = time.time()
    batch_frames = {}
    batch_speed = None
    sse_seq = 0

    try:
        for r in results_iter:
            if r.orig_img is None:
                break

            key = str(r.path)
            state = states.get(key)
            if state is None:
                state = {
                    "frame_i": 0,
                    "trails": defaultdict(lambda: deque(maxlen=args.trail)),
                    "last_seen": {},
                    "target_id": None,
                }
                states[key] = state

            frame = r.orig_img
            frame, tracks_payload = annotate_tracking_frame(frame, r, state, args)

            if sse_hub is not None:
                cam_index = int(camera_index_map.get(key, -1))
                sse_hub.publish("tracks", {
                    "type": "tracks",
                    "ts": time.time(),
                    "seq": sse_seq,
                    "cameraIndex": cam_index,
                    "source": key,
                    "frame": int(state["frame_i"]),
                    "size": {"w": int(frame.shape[1]), "h": int(frame.shape[0])},
                    "tracks": tracks_payload,
                    "targetId": state.get("target_id"),
                })
                sse_seq += 1

            cv2.putText(frame, f"CAM: {key}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4)
            cv2.putText(frame, f"CAM: {key}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)

            batch_frames[key] = frame
            batch_speed = getattr(r, "speed", None)

            if len(batch_frames) < 2:
                continue

            # 表示順に取り出す（取れない場合はキー順）
            k0, k1 = ordered_keys
            if k0 not in batch_frames or k1 not in batch_frames:
                keys = sorted(batch_frames.keys())
                k0, k1 = keys[0], keys[1]

            f0, f1 = batch_frames[k0], batch_frames[k1]
            target_h = min(f0.shape[0], f1.shape[0])
            f0r = _resize_to_height(f0, target_h)
            f1r = _resize_to_height(f1, target_h)
            composite = cv2.hconcat([f0r, f1r])

            now = time.time()
            loop_ms = (now - prev_show_t) * 1000.0
            prev_show_t = now

            fps = 1000.0 / max(1e-6, loop_ms)
            sp = batch_speed or {}
            pre_ms = float(sp.get("preprocess", 0.0))
            inf_ms = float(sp.get("inference", 0.0))
            post_ms = float(sp.get("postprocess", 0.0))
            other_ms = max(0.0, loop_ms - (pre_ms + inf_ms + post_ms))

            cv2.putText(composite, f"FPS: {fps:.1f}  loop={loop_ms:.0f}ms  infer={inf_ms:.0f}ms  other={other_ms:.0f}ms",
                        (10, composite.shape[0] - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
            cv2.putText(composite, f"FPS: {fps:.1f}  loop={loop_ms:.0f}ms  infer={inf_ms:.0f}ms  other={other_ms:.0f}ms",
                        (10, composite.shape[0] - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            if loop_ms >= args.stutter_ms:
                print(f"[stutter] loop={loop_ms:.0f}ms (pre={pre_ms:.0f} inf={inf_ms:.0f} post={post_ms:.0f} other={other_ms:.0f})")

            # writer 初期化（最初の合成フレームでサイズ確定）
            if args.save and writer is None:
                h, w = composite.shape[:2]
                out_size = (w, h)
                out_fps = max(1.0, min(120.0, fps if fps > 1 else 30.0))
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(args.out, fourcc, out_fps, out_size)

            if writer is not None:
                if out_size is not None and (composite.shape[1], composite.shape[0]) != out_size:
                    composite = cv2.resize(composite, out_size)
                writer.write(composite)

            if args.show:
                cv2.imshow("2-camera tracking", composite)
                key = cv2.waitKey(1) & 0xFF
                if key == 27:  # ESC
                    break

            batch_frames = {}
            batch_speed = None
    finally:
        if writer is not None:
            writer.release()
        cv2.destroyAllWindows()
        if sse_server is not None:
            try:
                sse_server.shutdown()
                sse_server.server_close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
