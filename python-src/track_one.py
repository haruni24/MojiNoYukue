import argparse
import time
from collections import deque, defaultdict

import cv2
from ultralytics import YOLO


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=str, default="0",
                        help='webcam index ("0","1",...) or path/URL (video.mp4, rtsp://...)')
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
    args = parser.parse_args()

    source = parse_source(args.source)
    print(f"Opening source: {source}")
    model = YOLO(args.model)

    # IDごとの軌跡
    trails = defaultdict(lambda: deque(maxlen=args.trail))
    last_seen = {}  # id -> frame_index

    # ターゲット（任意で強調）
    target_id = None

    # 保存用（必要なら）
    writer = None
    out_fps = 30.0  # 後で最初のフレームで上書きする
    out_size = None

    # ここが重要：stream=True のイテレータは1回だけ作る（毎回作り直さない）
    results_iter = model.track(
        source=source,
        stream=True,
        tracker=args.tracker,
        classes=[0],            # person only (COCO)
        conf=args.conf,
        imgsz=args.imgsz,
        persist=True,           # tracker state 유지
        verbose=False
    )

    prev_t = time.time()
    frame_i = 0

    for r in results_iter:
        frame_i += 1
        frame = r.orig_img
        if frame is None:
            # 動画終了など
            break

        # FPS
        now = time.time()
        fps = 1.0 / max(1e-6, now - prev_t)
        prev_t = now

        # writer 初期化（最初のフレームでサイズ確定）
        if args.save and writer is None:
            h, w = frame.shape[:2]
            out_size = (w, h)
            # ざっくりfps推定（動画なら正確に取れないこともあるので30に近い値）
            out_fps = max(1.0, min(120.0, fps if fps > 1 else 30.0))
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(args.out, fourcc, out_fps, out_size)

        # 検出/追跡結果
        if r.boxes is None or r.boxes.id is None:
            boxes = None
            ids = None
            confs = None
        else:
            boxes = r.boxes.xyxy.cpu().numpy()
            confs = r.boxes.conf.cpu().numpy()
            ids = r.boxes.id.cpu().numpy().astype(int)

        # そのフレームで見えたID集合
        seen_this_frame = set()

        if ids is not None and len(ids) > 0:
            # ターゲット選択（必要なら）
            idx_target = pick_target(boxes, confs, ids, target_id)
            if idx_target is None:
                target_id = None
            else:
                target_id = int(ids[idx_target])

            # 全員描画
            for i in range(len(ids)):
                tid = int(ids[i])
                x1, y1, x2, y2 = boxes[i].astype(int)
                c = float(confs[i])

                seen_this_frame.add(tid)
                last_seen[tid] = frame_i

                # 中心点を軌跡に追加
                cx = int((x1 + x2) / 2)
                cy = int((y1 + y2) / 2)
                trails[tid].append((cx, cy))

                # bbox色：ターゲット強調するなら色を変える
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
            # 検出なし：ターゲットは一旦保持してもいいが、ここでは見失い扱い
            target_id = None

        # TTL経過したIDの軌跡を掃除
        dead_ids = []
        for tid, last in last_seen.items():
            if frame_i - last > args.trail_ttl:
                dead_ids.append(tid)
        for tid in dead_ids:
            last_seen.pop(tid, None)
            trails.pop(tid, None)

        # 軌跡描画（全員分）
        if args.draw_trails:
            for tid, dq in trails.items():
                if len(dq) < 2:
                    continue
                # ターゲットだけ強調するなら線も変える
                is_target = (args.highlight_target and target_id is not None and tid == target_id)
                color = (255, 255, 0) if is_target else (200, 200, 200)
                thick = 3 if is_target else 2
                for k in range(1, len(dq)):
                    cv2.line(frame, dq[k - 1], dq[k], color, thick)

        # HUD
        cv2.putText(frame, f"FPS: {fps:.1f}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
        cv2.putText(frame, f"FPS: {fps:.1f}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

        cv2.putText(frame, f"Tracked IDs: {len(trails)}", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
        cv2.putText(frame, f"Tracked IDs: {len(trails)}", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

        cv2.putText(frame, f"TargetID: {target_id}", (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
        cv2.putText(frame, f"TargetID: {target_id}", (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

        # 保存
        if writer is not None:
            if out_size is not None and (frame.shape[1], frame.shape[0]) != out_size:
                frame = cv2.resize(frame, out_size)
            writer.write(frame)

        # 表示
        if args.show:
            cv2.imshow("multi-person tracking", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == 27:  # ESC
                break

    if writer is not None:
        writer.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
