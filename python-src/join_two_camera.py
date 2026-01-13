import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


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
    consecutive_failures = 0
    for i in range(max_index + 1):
        try:
            if _try_open_camera(i):
                available.append(i)
                consecutive_failures = 0
            else:
                consecutive_failures += 1
        except Exception:
            consecutive_failures += 1

        # 多くの環境でカメラindexは連番になりやすいので、見つかった後に失敗が続く場合は打ち切る
        if available and consecutive_failures >= 4:
            break
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
        cv2.putText(img, f"cam A = {cam_a}  [{'OK' if ok_a else 'NG'}]", (20, 70),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        cv2.putText(img, f"cam B = {cam_b}  [{'OK' if ok_b else 'NG'}]", (20, 125),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        if cam_a == cam_b:
            cv2.putText(img, "cam A と cam B は別にしてください", (20, 175),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
        cv2.putText(img, "Enter/Space: start   ESC: quit", (20, 230),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 200, 200), 2)
        cv2.imshow(win, img)

        key = cv2.waitKey(50) & 0xFF
        if key == 27:  # ESC
            raise SystemExit(0)
        if key in (10, 13, 32):  # Enter/Return/Space
            if cam_a != cam_b and ok_a and ok_b:
                cv2.destroyWindow(win)
                return cam_a, cam_b


def _set_capture_size(cap: cv2.VideoCapture, width: int | None, height: int | None):
    if width is not None:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, int(width))
    if height is not None:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(height))


def _read_frame(cap: cv2.VideoCapture) -> np.ndarray:
    ok, frame = cap.read()
    if not ok or frame is None:
        raise RuntimeError("カメラからフレームを取得できませんでした")
    return frame


def _resize_by_width(img: np.ndarray, width: int | None) -> np.ndarray:
    if width is None:
        return img
    h, w = img.shape[:2]
    if w == width:
        return img
    scale = width / w
    new_h = max(1, int(round(h * scale)))
    return cv2.resize(img, (width, new_h), interpolation=cv2.INTER_AREA)


def _to_gray_u8(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        g = img
    else:
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return g


def _clahe(gray_u8: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    return clahe.apply(gray_u8)


def _detect_and_match(gray_a: np.ndarray, gray_b: np.ndarray, feature: str, max_kp: int):
    feature = feature.lower()
    if feature == "sift" and hasattr(cv2, "SIFT_create"):
        detector = cv2.SIFT_create(nfeatures=max_kp)
        norm = cv2.NORM_L2
    else:
        detector = cv2.ORB_create(nfeatures=max_kp)
        norm = cv2.NORM_HAMMING

    kp_a, des_a = detector.detectAndCompute(gray_a, None)
    kp_b, des_b = detector.detectAndCompute(gray_b, None)
    if des_a is None or des_b is None or len(kp_a) < 8 or len(kp_b) < 8:
        raise RuntimeError("特徴点が十分に検出できませんでした（模様が少ない/ブレている可能性）")

    matcher = cv2.BFMatcher(norm)
    knn = matcher.knnMatch(des_b, des_a, k=2)  # B -> A

    good = []
    for pair in knn:
        if len(pair) < 2:
            continue
        m, n = pair[0], pair[1]
        if m.distance < 0.75 * n.distance:
            good.append(m)
    if len(good) < 12:
        raise RuntimeError(f"良いマッチが少なすぎます: {len(good)}")

    pts_b = np.float32([kp_b[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    pts_a = np.float32([kp_a[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    return pts_a, pts_b, len(good)


def _estimate_translation_ransac(gray_left: np.ndarray, gray_right: np.ndarray, feature: str, max_kp: int):
    pts_left, pts_right, n_good = _detect_and_match(gray_left, gray_right, feature=feature, max_kp=max_kp)
    # モデル: p_left = p_right + t (t = [tx, ty])
    diffs = (pts_left - pts_right).reshape(-1, 2).astype(np.float32)
    if diffs.shape[0] < 12:
        raise RuntimeError("平行移動の推定に十分なマッチ数がありません")

    rng = np.random.default_rng(0)
    best_inliers = None
    best_count = -1
    thresh = 3.0  # px
    iters = 5000

    for _ in range(iters):
        t = diffs[int(rng.integers(0, diffs.shape[0]))]
        err = np.linalg.norm(diffs - t[None, :], axis=1)
        inliers = err < thresh
        c = int(inliers.sum())
        if c > best_count:
            best_count = c
            best_inliers = inliers
            if c > 0.8 * diffs.shape[0]:
                break

    if best_inliers is None or best_count < 8:
        raise RuntimeError(f"平行移動のRANSACが不安定です: inlier={best_count}")

    t_med = np.median(diffs[best_inliers], axis=0)
    tx, ty = float(t_med[0]), float(t_med[1])
    M = np.array([[1.0, 0.0, tx], [0.0, 1.0, ty]], dtype=np.float32)
    return M, n_good, best_count


def _prep_for_match(img_bgr: np.ndarray, resize_width: int | None, use_edges: bool) -> np.ndarray:
    img = _resize_by_width(img_bgr, resize_width)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (0, 0), 1.2)
    if not use_edges:
        return gray
    gx = cv2.Sobel(gray, cv2.CV_16S, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_16S, 0, 1, ksize=3)
    abs_gx = cv2.convertScaleAbs(gx)
    abs_gy = cv2.convertScaleAbs(gy)
    return cv2.add(abs_gx, abs_gy)


def _estimate_dx_bruteforce(
    left_match: np.ndarray,
    right_match: np.ndarray,
    min_overlap_ratio: float,
    max_overlap_ratio: float,
    dx_min: int,
    dx_max: int,
    dx_step: int,
) -> tuple[int, float]:
    if left_match.shape != right_match.shape:
        raise RuntimeError(f"推定用画像のshapeが一致しません: left={left_match.shape} right={right_match.shape}")
    h, w = left_match.shape[:2]
    min_overlap_w = int(np.ceil(min_overlap_ratio * w))
    max_overlap_w = int(np.floor(max_overlap_ratio * w))
    if min_overlap_w < 1:
        min_overlap_w = 1
    max_overlap_w = int(np.clip(max_overlap_w, min_overlap_w, w))

    # dxは「右画像を右へdxだけずらす」(overlap_w = w - dx)
    dx_min = int(np.clip(dx_min, 0, w - 1))
    dx_max = int(np.clip(dx_max, 0, w - 1))
    if dx_step < 1:
        dx_step = 1
    if dx_max < dx_min:
        dx_max = dx_min

    # overlap範囲制約: min <= overlap <= max
    dx_min = max(dx_min, int(np.clip(w - max_overlap_w, 0, w - 1)))
    dx_max = min(dx_max, int(np.clip(w - min_overlap_w, 0, w - 1)))
    if dx_max < dx_min:
        raise RuntimeError("overlap制約の結果、探索範囲が空です（min/max overlapやdx範囲を見直してください）")

    ref_overlap_w = w - dx_min  # (= max_overlap_w相当)
    best_dx = None
    best_score = None

    # dxを増やすほどoverlapは減るので、min_overlapを下回ったら打ち切り
    for dx in range(dx_min, dx_max + 1, dx_step):
        overlap_w = w - dx
        if overlap_w < min_overlap_w:
            break
        if overlap_w > max_overlap_w:
            continue

        # ROI: left[:, dx:] と right[:, :overlap_w]
        L = left_match[:, dx:]
        R = right_match[:, :overlap_w]

        diff = cv2.absdiff(L, R)
        sum_abs = float(diff.sum())
        mean_abs = sum_abs / max(1.0, float(h * overlap_w))

        # overlapが小さい候補は比較しづらいので、最大overlap基準にスケール（ユーザー要望）
        score = mean_abs * (ref_overlap_w / max(1.0, overlap_w))

        if best_score is None or score < best_score:
            best_score = score
            best_dx = dx

    if best_dx is None or best_score is None:
        raise RuntimeError("dx推定に失敗しました（探索範囲/overlap条件を見直してください）")
    return int(best_dx), float(best_score)


def _compute_overlap_mask_for_ecc(left_gray: np.ndarray, right_gray: np.ndarray, warp: np.ndarray, motion: str):
    h, w = left_gray.shape[:2]
    ones = np.ones((h, w), dtype=np.uint8) * 255
    if motion != "translation":
        raise ValueError("このスクリプトは平行移動（translation）のみ対応です")
    right_valid = cv2.warpAffine(ones, warp, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    mask = (right_valid > 0).astype(np.uint8) * 255
    kernel = np.ones((11, 11), np.uint8)
    mask = cv2.erode(mask, kernel, iterations=1)
    return mask


def _refine_ecc(gray_left: np.ndarray, gray_right: np.ndarray, init_warp: np.ndarray, motion: str, iters: int, eps: float):
    if motion != "translation":
        raise ValueError("このスクリプトは平行移動（translation）のみ対応です")
    warp = init_warp.astype(np.float32)
    motion_type = cv2.MOTION_TRANSLATION

    template = cv2.GaussianBlur(gray_left, (0, 0), 1.2).astype(np.float32) / 255.0
    inp = cv2.GaussianBlur(gray_right, (0, 0), 1.2).astype(np.float32) / 255.0

    mask = _compute_overlap_mask_for_ecc(gray_left, gray_right, warp, motion=motion)
    overlap_px = int(mask.sum() // 255)
    min_overlap_px = max(5000, int(0.01 * gray_left.shape[0] * gray_left.shape[1]))
    if overlap_px < min_overlap_px:
        raise RuntimeError(f"ECCの重なり領域が小さすぎます: {overlap_px}px (min={min_overlap_px}px)")
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, int(iters), float(eps))
    try:
        cc, warp = cv2.findTransformECC(
            templateImage=template,
            inputImage=inp,
            warpMatrix=warp,
            motionType=motion_type,
            criteria=criteria,
            inputMask=mask,
            gaussFiltSize=7,
        )
        return float(cc), warp
    except cv2.error as e:
        raise RuntimeError(f"ECCの最適化に失敗しました: {e}") from e


def _affine_2x3_to_3x3(M: np.ndarray) -> np.ndarray:
    H = np.eye(3, dtype=np.float32)
    H[:2, :] = M
    return H


def _apply_homography_pts(H: np.ndarray, pts_xy: np.ndarray) -> np.ndarray:
    pts = np.concatenate([pts_xy, np.ones((pts_xy.shape[0], 1), dtype=np.float32)], axis=1)
    q = (H @ pts.T).T
    q = q[:, :2] / q[:, 2:3]
    return q


def _compute_canvas_and_warps(left_shape_hw: tuple[int, int], right_shape_hw: tuple[int, int], H_right_to_left: np.ndarray):
    hL, wL = left_shape_hw
    hR, wR = right_shape_hw

    left_corners = np.float32([[0, 0], [wL, 0], [wL, hL], [0, hL]])
    right_corners = np.float32([[0, 0], [wR, 0], [wR, hR], [0, hR]])
    right_warped = _apply_homography_pts(H_right_to_left, right_corners)

    all_pts = np.vstack([left_corners, right_warped])
    min_xy = np.floor(all_pts.min(axis=0)).astype(int)
    max_xy = np.ceil(all_pts.max(axis=0)).astype(int)

    min_x, min_y = int(min_xy[0]), int(min_xy[1])
    max_x, max_y = int(max_xy[0]), int(max_xy[1])

    out_w = max(1, max_x - min_x)
    out_h = max(1, max_y - min_y)

    T = np.array([[1, 0, -min_x],
                  [0, 1, -min_y],
                  [0, 0, 1]], dtype=np.float32)
    H_right_to_canvas = T @ H_right_to_left
    H_left_to_canvas = T  # 左は単に平行移動
    return (out_w, out_h), H_left_to_canvas, H_right_to_canvas


def _distance_feather_blend(left_canvas: np.ndarray, right_canvas: np.ndarray, mask_left: np.ndarray, mask_right: np.ndarray) -> np.ndarray:
    mL = (mask_left > 0).astype(np.uint8)
    mR = (mask_right > 0).astype(np.uint8)
    both = (mL & mR).astype(bool)
    onlyL = (mL & (1 - mR)).astype(bool)
    onlyR = (mR & (1 - mL)).astype(bool)

    out = np.zeros_like(left_canvas, dtype=np.float32)

    if both.any():
        dtL = cv2.distanceTransform(mL * 255, cv2.DIST_L2, 5).astype(np.float32)
        dtR = cv2.distanceTransform(mR * 255, cv2.DIST_L2, 5).astype(np.float32)
        wL = dtL / np.maximum(1e-6, dtL + dtR)
        wR = 1.0 - wL
        wL3 = np.repeat(wL[:, :, None], 3, axis=2)
        wR3 = np.repeat(wR[:, :, None], 3, axis=2)
        out[both] = left_canvas[both] * wL3[both] + right_canvas[both] * wR3[both]

    if onlyL.any():
        out[onlyL] = left_canvas[onlyL]
    if onlyR.any():
        out[onlyR] = right_canvas[onlyR]

    return np.clip(out, 0, 255).astype(np.uint8)


def _exposure_match_in_overlap(left_canvas: np.ndarray, right_canvas: np.ndarray, mask_left: np.ndarray, mask_right: np.ndarray):
    both = (mask_left > 0) & (mask_right > 0)
    if not both.any():
        return right_canvas
    L = left_canvas[both].astype(np.float32)
    R = right_canvas[both].astype(np.float32)
    mean_L = L.mean(axis=0)
    mean_R = R.mean(axis=0)
    gain = mean_L / np.maximum(1e-6, mean_R)
    out = right_canvas.astype(np.float32) * gain[None, None, :]
    return np.clip(out, 0, 255).astype(np.uint8)


@dataclass
class BlendContext:
    out_size_wh: tuple[int, int]
    mask_left: np.ndarray  # uint8
    mask_right: np.ndarray  # uint8
    wL3: np.ndarray  # float32, HxWx3
    wR3: np.ndarray  # float32, HxWx3
    both: np.ndarray  # bool HxW
    onlyL: np.ndarray  # bool HxW
    onlyR: np.ndarray  # bool HxW


def build_blend_context(frame_left_shape_hw: tuple[int, int], frame_right_shape_hw: tuple[int, int], calib: "Calibration") -> BlendContext:
    out_w, out_h = calib.out_size_wh
    ones_left = np.ones(frame_left_shape_hw, dtype=np.uint8) * 255
    ones_right = np.ones(frame_right_shape_hw, dtype=np.uint8) * 255
    mask_left = cv2.warpPerspective(ones_left, calib.H_left_to_canvas, (out_w, out_h),
                                    flags=cv2.INTER_NEAREST, borderValue=0)
    mask_right = cv2.warpPerspective(ones_right, calib.H_right_to_canvas, (out_w, out_h),
                                     flags=cv2.INTER_NEAREST, borderValue=0)

    mL = (mask_left > 0).astype(np.uint8)
    mR = (mask_right > 0).astype(np.uint8)
    both = (mL & mR).astype(bool)
    onlyL = (mL & (1 - mR)).astype(bool)
    onlyR = (mR & (1 - mL)).astype(bool)

    if both.any():
        dtL = cv2.distanceTransform(mL * 255, cv2.DIST_L2, 5).astype(np.float32)
        dtR = cv2.distanceTransform(mR * 255, cv2.DIST_L2, 5).astype(np.float32)
        wL = dtL / np.maximum(1e-6, dtL + dtR)
        wR = 1.0 - wL
    else:
        wL = np.ones((out_h, out_w), dtype=np.float32)
        wR = np.zeros((out_h, out_w), dtype=np.float32)

    wL3 = np.repeat(wL[:, :, None], 3, axis=2)
    wR3 = np.repeat(wR[:, :, None], 3, axis=2)

    return BlendContext(
        out_size_wh=(out_w, out_h),
        mask_left=mask_left,
        mask_right=mask_right,
        wL3=wL3,
        wR3=wR3,
        both=both,
        onlyL=onlyL,
        onlyR=onlyR,
    )

@dataclass
class Calibration:
    H_right_to_left: np.ndarray  # 3x3
    out_size_wh: tuple[int, int]
    H_left_to_canvas: np.ndarray  # 3x3
    H_right_to_canvas: np.ndarray  # 3x3
    feature: str
    ecc_motion: str
    ecc_cc: float | None

    def to_json_dict(self):
        return {
            "H_right_to_left": self.H_right_to_left.tolist(),
            "out_size_wh": list(self.out_size_wh),
            "H_left_to_canvas": self.H_left_to_canvas.tolist(),
            "H_right_to_canvas": self.H_right_to_canvas.tolist(),
            "feature": self.feature,
            "ecc_motion": self.ecc_motion,
            "ecc_cc": self.ecc_cc,
        }

    @staticmethod
    def from_json_dict(d: dict):
        return Calibration(
            H_right_to_left=np.array(d["H_right_to_left"], dtype=np.float32),
            out_size_wh=(int(d["out_size_wh"][0]), int(d["out_size_wh"][1])),
            H_left_to_canvas=np.array(d["H_left_to_canvas"], dtype=np.float32),
            H_right_to_canvas=np.array(d["H_right_to_canvas"], dtype=np.float32),
            feature=str(d.get("feature", "sift")),
            ecc_motion=str(d.get("ecc_motion", "translation")),
            ecc_cc=d.get("ecc_cc", None),
        )


def _capture_aggregate(cap: cv2.VideoCapture, n: int, delay_ms: int, resize_width: int | None, aggregate: str) -> np.ndarray:
    frames_small = []
    first = _read_frame(cap)
    full_h, full_w = first.shape[:2]
    target_w = resize_width
    if target_w is None or target_w <= 0 or target_w >= full_w:
        target_w = full_w
    frames_small.append(_resize_by_width(first, target_w))
    for _ in range(n - 1):
        frame = _read_frame(cap)
        frames_small.append(_resize_by_width(frame, target_w))
        if delay_ms > 0:
            cv2.waitKey(delay_ms)

    stack = np.stack(frames_small, axis=0).astype(np.float32)
    if aggregate == "mean":
        agg = stack.mean(axis=0)
    else:
        agg = np.median(stack, axis=0)
    return np.clip(agg, 0, 255).astype(np.uint8)


def calibrate_two_cameras(
    cap_left: cv2.VideoCapture,
    cap_right: cv2.VideoCapture,
    calib_seconds: float,
    calib_max_frames: int,
    calib_resize_width: int | None,
    aggregate: str,
    min_overlap_ratio: float,
    max_overlap_ratio: float,
    dx_min_ratio: float,
    dx_max_ratio: float,
    dx_step: int,
    use_edges: bool,
) -> Calibration:
    # 最初のN秒で、動く人を含む複数フレームを集めてmedian/mean合成（背景を残す）→横シフトを総当り
    start = time.time()
    matchL_list: list[np.ndarray] = []
    matchR_list: list[np.ndarray] = []
    last_full_L = None
    last_full_R = None

    while True:
        frameL = _read_frame(cap_left)
        frameR = _read_frame(cap_right)
        last_full_L = frameL
        last_full_R = frameR

        matchL_list.append(_prep_for_match(frameL, resize_width=calib_resize_width, use_edges=use_edges))
        matchR_list.append(_prep_for_match(frameR, resize_width=calib_resize_width, use_edges=use_edges))

        if len(matchL_list) >= calib_max_frames:
            break
        if (time.time() - start) >= calib_seconds:
            break

    if len(matchL_list) < 3 or last_full_L is None or last_full_R is None:
        raise RuntimeError("キャリブレーション用フレームが少なすぎます")

    stackL = np.stack(matchL_list, axis=0)
    stackR = np.stack(matchR_list, axis=0)
    if aggregate == "mean":
        left_match = np.clip(stackL.astype(np.float32).mean(axis=0), 0, 255).astype(np.uint8)
        right_match = np.clip(stackR.astype(np.float32).mean(axis=0), 0, 255).astype(np.uint8)
    else:
        left_match = np.clip(np.median(stackL, axis=0), 0, 255).astype(np.uint8)
        right_match = np.clip(np.median(stackR, axis=0), 0, 255).astype(np.uint8)

    hS, wS = left_match.shape[:2]
    dx_min = int(round(dx_min_ratio * wS))
    dx_max = int(round(dx_max_ratio * wS))
    dx_small, best_score = _estimate_dx_bruteforce(
        left_match=left_match,
        right_match=right_match,
        min_overlap_ratio=min_overlap_ratio,
        max_overlap_ratio=max_overlap_ratio,
        dx_min=dx_min,
        dx_max=dx_max,
        dx_step=dx_step,
    )

    # フル解像度へスケール復元
    left_full = last_full_L
    right_full = last_full_R
    hL_full, wL_full = left_full.shape[:2]
    hR_full, wR_full = right_full.shape[:2]
    if (hL_full, wL_full) != (hR_full, wR_full):
        raise RuntimeError(f"左右の解像度が一致しません: left={wL_full}x{hL_full} right={wR_full}x{hR_full}")

    scale = float(wL_full) / float(wS)
    dx_full = int(round(dx_small * scale))

    # 右画像を右へdxだけずらして貼る
    min_x = min(0, dx_full)
    max_x = max(wL_full, dx_full + wR_full)
    out_w = max_x - min_x
    out_h = hL_full
    H_left_to_canvas = np.array([[1, 0, -min_x],
                                 [0, 1, 0],
                                 [0, 0, 1]], dtype=np.float32)
    H_right_to_canvas = np.array([[1, 0, dx_full - min_x],
                                  [0, 1, 0],
                                  [0, 0, 1]], dtype=np.float32)
    H_right_to_left = np.array([[1, 0, dx_full],
                                [0, 1, 0],
                                [0, 0, 1]], dtype=np.float32)

    overlap_w = wL_full - dx_full
    overlap_ratio = (overlap_w / wL_full) if wL_full > 0 else 0.0
    print(f"[calib] dx_small={dx_small}px (w={wS}) -> dx_full={dx_full}px (w={wL_full})")
    print(f"[calib] overlap ~ {max(0, overlap_w)}px ({max(0.0, overlap_ratio) * 100:.1f}%) score={best_score:.6f}")
    print(f"[calib] out_size={out_w}x{out_h}")

    return Calibration(
        H_right_to_left=H_right_to_left,
        out_size_wh=(int(out_w), int(out_h)),
        H_left_to_canvas=H_left_to_canvas,
        H_right_to_canvas=H_right_to_canvas,
        feature="bruteforce_dx",
        ecc_motion="translation",
        ecc_cc=None,
    )


def render_joined_frame(frame_left: np.ndarray, frame_right: np.ndarray, calib: Calibration, exposure_match: bool) -> np.ndarray:
    out_w, out_h = calib.out_size_wh
    left_canvas = cv2.warpPerspective(frame_left, calib.H_left_to_canvas, (out_w, out_h),
                                      flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    right_canvas = cv2.warpPerspective(frame_right, calib.H_right_to_canvas, (out_w, out_h),
                                       flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))

    ones_left = np.ones(frame_left.shape[:2], dtype=np.uint8) * 255
    ones_right = np.ones(frame_right.shape[:2], dtype=np.uint8) * 255
    mask_left = cv2.warpPerspective(ones_left, calib.H_left_to_canvas, (out_w, out_h),
                                    flags=cv2.INTER_NEAREST, borderValue=0)
    mask_right = cv2.warpPerspective(ones_right, calib.H_right_to_canvas, (out_w, out_h),
                                     flags=cv2.INTER_NEAREST, borderValue=0)

    if exposure_match:
        right_canvas = _exposure_match_in_overlap(left_canvas, right_canvas, mask_left, mask_right)

    joined = _distance_feather_blend(
        left_canvas=left_canvas.astype(np.float32),
        right_canvas=right_canvas.astype(np.float32),
        mask_left=mask_left,
        mask_right=mask_right,
    )
    return joined


def render_joined_frame_with_context(
    frame_left: np.ndarray,
    frame_right: np.ndarray,
    calib: Calibration,
    blend_ctx: BlendContext,
    exposure_match: bool,
) -> np.ndarray:
    out_w, out_h = blend_ctx.out_size_wh
    left_canvas = cv2.warpPerspective(frame_left, calib.H_left_to_canvas, (out_w, out_h),
                                      flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    right_canvas = cv2.warpPerspective(frame_right, calib.H_right_to_canvas, (out_w, out_h),
                                       flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))

    if exposure_match:
        right_canvas = _exposure_match_in_overlap(left_canvas, right_canvas, blend_ctx.mask_left, blend_ctx.mask_right)

    out = np.zeros_like(left_canvas, dtype=np.float32)
    out[blend_ctx.both] = (
        left_canvas.astype(np.float32)[blend_ctx.both] * blend_ctx.wL3[blend_ctx.both]
        + right_canvas.astype(np.float32)[blend_ctx.both] * blend_ctx.wR3[blend_ctx.both]
    )
    out[blend_ctx.onlyL] = left_canvas.astype(np.float32)[blend_ctx.onlyL]
    out[blend_ctx.onlyR] = right_canvas.astype(np.float32)[blend_ctx.onlyR]
    return np.clip(out, 0, 255).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cam1", type=int, default=None, help="camera A index (left)")
    parser.add_argument("--cam2", type=int, default=None, help="camera B index (right)")
    parser.add_argument("--max_cam_index", type=int, default=3, help="UIでスキャンする最大カメラindex")
    parser.add_argument("--no_ui", action="store_true", help="UI選択を使わずに --cam1/--cam2 を必須にする")
    parser.add_argument("--width", type=int, default=None, help="キャプチャ幅（未指定ならデフォルト）")
    parser.add_argument("--height", type=int, default=None, help="キャプチャ高さ（未指定ならデフォルト）")

    parser.add_argument("--load_calib", type=str, default=None, help="既存キャリブレーションJSONを読み込む")
    parser.add_argument("--save_calib", type=str, default="join_two_camera_calib.json", help="キャリブレーションJSON出力先")

    parser.add_argument("--calib_wait", type=float, default=0.0, help="開始前に待つ秒数（デフォルト0）")
    parser.add_argument("--calib_seconds", type=float, default=2.0, help="キャリブレーションに使う時間（人が動く想定）")
    parser.add_argument("--calib_max_frames", type=int, default=60, help="キャリブレーションで保存する最大フレーム数")
    parser.add_argument("--calib_resize_width", type=int, default=960, help="キャリブレーション推定用の横幅（処理軽量化）")
    parser.add_argument("--aggregate", type=str, default="median", choices=["median", "mean"], help="複数フレームの合成方法")
    parser.add_argument("--use_edges", action=argparse.BooleanOptionalAction, default=True,
                        help="推定にエッジ強調（Sobel）を使う")

    parser.add_argument("--min_overlap_ratio", type=float, default=0.08, help="重なり最小割合（例: 0.08=8パーセント）")
    parser.add_argument("--max_overlap_ratio", type=float, default=0.4, help="重なり最大割合（例: 0.4=40パーセント）")
    parser.add_argument("--dx_min_ratio", type=float, default=0.6, help="探索dx最小（幅に対する割合）")
    parser.add_argument("--dx_max_ratio", type=float, default=0.92, help="探索dx最大（幅に対する割合）")
    parser.add_argument("--dx_step", type=int, default=1, help="探索ステップ（px）")

    parser.add_argument("--exposure_match", action=argparse.BooleanOptionalAction, default=True,
                        help="重なり領域で露出差を補正する")

    parser.add_argument("--show", action=argparse.BooleanOptionalAction, default=True, help="ウィンドウ表示する")
    parser.add_argument("--save", action="store_true", help="結合結果を動画保存する")
    parser.add_argument("--out", type=str, default="joined.mp4", help="保存先")
    args = parser.parse_args()

    exposure_match = bool(args.exposure_match)

    if args.cam1 is None or args.cam2 is None:
        if args.no_ui:
            raise SystemExit("--no_ui の場合は --cam1 と --cam2 が必要です")
        available = scan_available_cameras(args.max_cam_index)
        if len(available) < 2:
            raise SystemExit(f"利用可能なカメラが2台見つかりませんでした: {available}")
        cam1, cam2 = ui_select_two_cameras(args.max_cam_index, available[0], available[1], set(available))
    else:
        cam1, cam2 = int(args.cam1), int(args.cam2)

    capL = cv2.VideoCapture(cam1)
    capR = cv2.VideoCapture(cam2)
    if not capL.isOpened() or not capR.isOpened():
        raise SystemExit("カメラをオープンできませんでした")

    _set_capture_size(capL, args.width, args.height)
    _set_capture_size(capR, args.width, args.height)

    try:
        frameL0 = _read_frame(capL)
        frameR0 = _read_frame(capR)
        hL, wL = frameL0.shape[:2]
        hR, wR = frameR0.shape[:2]
        if (hL, wL) != (hR, wR):
            print(f"[warn] 解像度が一致していません: left={wL}x{hL} right={wR}x{hR}")

        calib = None
        if args.load_calib is not None:
            p = Path(args.load_calib)
            calib = Calibration.from_json_dict(json.loads(p.read_text(encoding="utf-8")))
            print(f"[info] calib loaded: {p}")
        else:
            if args.calib_wait > 0:
                print(f"[info] {args.calib_wait:.1f}秒 待機します")
                time.sleep(args.calib_wait)
            print(f"[info] {args.calib_seconds:.1f}秒 その場で動いてください（キャリブレーション収集）")
            calib = calibrate_two_cameras(
                cap_left=capL,
                cap_right=capR,
                calib_seconds=args.calib_seconds,
                calib_max_frames=args.calib_max_frames,
                calib_resize_width=args.calib_resize_width if args.calib_resize_width > 0 else None,
                aggregate=args.aggregate,
                min_overlap_ratio=args.min_overlap_ratio,
                max_overlap_ratio=args.max_overlap_ratio,
                dx_min_ratio=args.dx_min_ratio,
                dx_max_ratio=args.dx_max_ratio,
                dx_step=args.dx_step,
                use_edges=bool(args.use_edges),
            )
            out_path = Path(args.save_calib)
            out_path.write_text(json.dumps(calib.to_json_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[info] calib saved: {out_path}")
            calib = Calibration.from_json_dict(json.loads(out_path.read_text(encoding="utf-8")))
            print("[info] calib re-loaded from saved file (runtime will use the saved data)")

        writer = None
        prev_t = time.time()
        blend_ctx = build_blend_context(frameL0.shape[:2], frameR0.shape[:2], calib=calib)

        while True:
            frameL = _read_frame(capL)
            frameR = _read_frame(capR)
            joined = render_joined_frame_with_context(
                frame_left=frameL,
                frame_right=frameR,
                calib=calib,
                blend_ctx=blend_ctx,
                exposure_match=exposure_match,
            )

            now = time.time()
            fps = 1.0 / max(1e-6, now - prev_t)
            prev_t = now
            cv2.putText(joined, f"FPS: {fps:.1f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4)
            cv2.putText(joined, f"FPS: {fps:.1f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)

            if args.save and writer is None:
                h, w = joined.shape[:2]
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                writer = cv2.VideoWriter(args.out, fourcc, 30.0, (w, h))

            if writer is not None:
                writer.write(joined)

            if args.show:
                cv2.imshow("joined two cameras", joined)
                key = cv2.waitKey(1) & 0xFF
                if key == 27:  # ESC
                    break
    finally:
        capL.release()
        capR.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
