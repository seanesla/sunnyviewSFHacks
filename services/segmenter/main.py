import base64
import math
import os
import re
import threading
from typing import Any, Dict, List, Literal, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from onnx_roofseg import OnnxRoofSeg
from postprocess import choose_component_by_footprint


app = FastAPI(title="sunnyview-segmenter", version="0.2.0")


class Click(BaseModel):
    x: float
    y: float
    type: Literal["pos", "neg"]


class Roi(BaseModel):
    x: int
    y: int
    w: int
    h: int


class SegmentRequest(BaseModel):
    imageDataUrl: Optional[str] = None
    imageRef: Optional[str] = None
    mode: Optional[str] = "roof"
    clicks: Optional[List[Click]] = None
    roi: Optional[Roi] = None
    meta: Optional[Dict[str, Any]] = None


def _decode_data_url(s: str) -> bytes:
    m = re.match(r"^data:[^;]+;base64,(.*)$", s, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        raise ValueError("invalid data URL")
    return base64.b64decode(m.group(1))


def _decode_image_bgr(img_bytes: bytes) -> np.ndarray:
    buf = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("failed to decode image")
    return img


def _extract_geojson_ring(poly: Any) -> Optional[List[Tuple[float, float]]]:
    """Returns the first ring of a GeoJSON Polygon/MultiPolygon as [(x,y),...] in normalized coords."""
    if not poly or not isinstance(poly, dict):
        return None
    if poly.get("type") == "Feature" and isinstance(poly.get("geometry"), dict):
        return _extract_geojson_ring(poly.get("geometry"))

    typ = poly.get("type")
    coords = poly.get("coordinates")
    if not isinstance(coords, list):
        return None

    ring: Any = None
    if typ == "Polygon" and len(coords) >= 1:
        ring = coords[0]
    elif typ == "MultiPolygon" and len(coords) >= 1 and isinstance(coords[0], list) and len(coords[0]) >= 1:
        ring = coords[0][0]
    elif typ is None and len(coords) >= 3:
        # tolerate {coordinates:[[x,y],...]} without type
        ring = coords
    else:
        return None

    if not isinstance(ring, list):
        return None

    pts: List[Tuple[float, float]] = []
    for item in ring:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            return None
        x = float(item[0])
        y = float(item[1])
        pts.append((x, y))

    if len(pts) >= 2 and abs(pts[0][0] - pts[-1][0]) < 1e-9 and abs(pts[0][1] - pts[-1][1]) < 1e-9:
        pts.pop()
    return pts if len(pts) >= 3 else None


def _ring_norm_to_mask(ring_norm: List[Tuple[float, float]], w: int, h: int) -> np.ndarray:
    pts = np.array([[x * w, y * h] for (x, y) in ring_norm], dtype=np.float32)
    pts_i = np.round(pts).astype(np.int32)
    pts_i[:, 0] = np.clip(pts_i[:, 0], 0, w - 1)
    pts_i[:, 1] = np.clip(pts_i[:, 1], 0, h - 1)
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [pts_i], 1)
    return mask


def _mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = float(np.logical_and(a, b).sum())
    union = float(np.logical_or(a, b).sum())
    return inter / union if union > 0 else 0.0


def _keep_component(mask: np.ndarray, cx: int, cy: int) -> np.ndarray:
    m = (mask > 0).astype(np.uint8)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return m
    cx = int(np.clip(cx, 0, labels.shape[1] - 1))
    cy = int(np.clip(cy, 0, labels.shape[0] - 1))
    lab = int(labels[cy, cx])
    if lab != 0:
        return (labels == lab).astype(np.uint8)

    # Click is outside (or inside a hole). Choose the component whose centroid is closest
    # to the click. This is robust for courtyard-style apartment roofs.
    best_lab = 0
    best_d2 = 1e30
    best_area = -1
    for i in range(1, n):
        ccx, ccy = centroids[i]
        d2 = float(ccx - float(cx)) ** 2 + float(ccy - float(cy)) ** 2
        area = int(stats[i, cv2.CC_STAT_AREA])
        if d2 < best_d2 - 1e-9 or (abs(d2 - best_d2) <= 1e-9 and area > best_area):
            best_lab = i
            best_d2 = d2
            best_area = area

    return (labels == best_lab).astype(np.uint8) if best_lab != 0 else m


def _mask_to_polygon_norm(mask: np.ndarray, w: int, h: int) -> Optional[Dict[str, Any]]:
    m = (mask > 0).astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    if cv2.contourArea(cnt) < 20:
        return None

    peri = cv2.arcLength(cnt, True)
    eps = max(1.0, 0.0025 * peri)
    approx = cv2.approxPolyDP(cnt, eps, True)
    pts = approx.reshape(-1, 2) if approx is not None and len(approx) >= 3 else cnt.reshape(-1, 2)
    if pts is None or len(pts) < 3:
        return None

    pts = pts.astype(np.float32)
    pts[:, 0] = np.clip(pts[:, 0] / float(w), 0.0, 1.0)
    pts[:, 1] = np.clip(pts[:, 1] / float(h), 0.0, 1.0)
    coords = [[float(x), float(y)] for (x, y) in pts]
    return {"type": "Polygon", "coordinates": [coords]}


def _clamp_angle_90(deg: float) -> float:
    d = float(deg)
    while d > 90.0:
        d -= 180.0
    while d < -90.0:
        d += 180.0
    return d


def _edge_lines(img_bgr: np.ndarray, mask: np.ndarray) -> List[Tuple[int, int, int, int, float, float]]:
    """Returns Hough line segments as (x1,y1,x2,y2,length,angleDeg[-90..90])."""
    h, w = img_bgr.shape[:2]
    m = (mask > 0).astype(np.uint8)
    if int(m.sum()) < 50:
        return []

    ys, xs = np.where(m > 0)
    if len(xs) < 50:
        return []
    x0 = int(max(0, xs.min() - 10))
    x1 = int(min(w, xs.max() + 11))
    y0 = int(max(0, ys.min() - 10))
    y1 = int(min(h, ys.max() + 11))

    roi = img_bgr[y0:y1, x0:x1]
    roi_m = m[y0:y1, x0:x1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 60, 150)
    edges = cv2.bitwise_and(edges, edges, mask=roi_m)

    lines = cv2.HoughLinesP(edges, 1, np.pi / 180.0, threshold=45, minLineLength=28, maxLineGap=8)
    if lines is None:
        return []

    out: List[Tuple[int, int, int, int, float, float]] = []
    for l in lines.reshape(-1, 4):
        x1l, y1l, x2l, y2l = [int(v) for v in l]
        dx = float(x2l - x1l)
        dy = float(y2l - y1l)
        length = math.hypot(dx, dy)
        if length < 10:
            continue
        ang = _clamp_angle_90(math.degrees(math.atan2(dy, dx)))
        out.append((x1l + x0, y1l + y0, x2l + x0, y2l + y0, length, ang))
    out.sort(key=lambda t: t[4], reverse=True)
    return out


def _dominant_angle(lines: List[Tuple[int, int, int, int, float, float]]) -> Optional[float]:
    if not lines:
        return None
    bins: Dict[int, float] = {}
    for *_, length, ang in lines:
        b = int(round(ang / 5.0))
        bins[b] = bins.get(b, 0.0) + float(length)
    best_bin = max(bins.items(), key=lambda kv: kv[1])[0]
    # weighted mean within +-1 bin
    num = 0.0
    den = 0.0
    for *_, length, ang in lines:
        b = int(round(ang / 5.0))
        if abs(b - best_bin) <= 1:
            num += float(length) * float(ang)
            den += float(length)
    return _clamp_angle_90(num / den) if den > 0 else None


def _extend_segment_to_bounds(x1: int, y1: int, x2: int, y2: int, w: int, h: int) -> Tuple[Tuple[int, int], Tuple[int, int]]:
    dx = float(x2 - x1)
    dy = float(y2 - y1)
    if abs(dx) + abs(dy) < 1e-6:
        return (x1, y1), (x2, y2)
    # parametric line p = p0 + t*v
    ts = []
    # intersect with x=0 and x=w-1
    if abs(dx) > 1e-9:
        ts.append((0.0 - x1) / dx)
        ts.append(((w - 1) - x1) / dx)
    if abs(dy) > 1e-9:
        ts.append((0.0 - y1) / dy)
        ts.append(((h - 1) - y1) / dy)
    pts = []
    for t in ts:
        x = x1 + t * dx
        y = y1 + t * dy
        if -1e-6 <= x <= w - 1 + 1e-6 and -1e-6 <= y <= h - 1 + 1e-6:
            pts.append((int(round(x)), int(round(y))))
    if len(pts) < 2:
        return (x1, y1), (x2, y2)
    # choose farthest pair
    best = (pts[0], pts[1])
    best_d = -1.0
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2
            if d > best_d:
                best_d = d
                best = (pts[i], pts[j])
    return best


def _mask_centroid(mask: np.ndarray) -> Tuple[float, float]:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return 0.0, 0.0
    return float(xs.mean()), float(ys.mean())


def _azimuth_from_vector(dx: float, dy: float) -> float:
    # dx: east, dy: south (image coords). North-up image.
    az = math.degrees(math.atan2(dx, -dy))
    az = (az + 360.0) % 360.0
    return float(az)


class _SamState:
    def __init__(self) -> None:
        self.ready = False
        self.error: Optional[str] = None
        self.model_type: Optional[str] = None
        self.checkpoint: Optional[str] = None
        self.device: Optional[str] = None
        self._predictor: Any = None
        self._lock = threading.Lock()

    def ensure_loaded(self) -> bool:
        if self.ready:
            return True

        ckpt = os.getenv("SAM_CHECKPOINT")
        model_type = os.getenv("SAM_MODEL_TYPE", "vit_h")
        if not ckpt:
            self.error = "SAM_CHECKPOINT not set"
            return False
        if not os.path.exists(ckpt):
            self.error = f"SAM checkpoint not found: {ckpt}"
            return False

        try:
            import torch  # type: ignore
            from segment_anything import SamPredictor, sam_model_registry  # type: ignore

            sam = sam_model_registry[model_type](checkpoint=ckpt)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            sam.to(device=device)
            predictor = SamPredictor(sam)

            self._predictor = predictor
            self.ready = True
            self.error = None
            self.model_type = model_type
            self.checkpoint = ckpt
            self.device = device
            return True
        except Exception as e:
            self.error = f"SAM load failed: {e}"
            return False

    def predict(
        self,
        image_rgb: np.ndarray,
        point_coords: Optional[np.ndarray],
        point_labels: Optional[np.ndarray],
        box: Optional[np.ndarray],
    ) -> Tuple[np.ndarray, np.ndarray]:
        if not self.ensure_loaded() or self._predictor is None:
            raise RuntimeError(self.error or "SAM unavailable")

        with self._lock:
            self._predictor.set_image(image_rgb)
            masks, scores, _ = self._predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=True,
            )
            return masks, scores


SAM = _SamState()
ONNX = OnnxRoofSeg()


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    sam_ready = SAM.ensure_loaded()
    onnx_ready = ONNX.ensure_loaded()
    return {
        "ok": True,
        "onnx": {
            "ready": onnx_ready,
            "error": ONNX.error,
            "path": ONNX.path,
            "inputSize": ONNX.size if onnx_ready else None,
        },
        "sam": {
            "ready": sam_ready,
            "error": SAM.error,
            "modelType": SAM.model_type,
            "device": SAM.device,
        },
    }


@app.post("/segment")
def segment(req: SegmentRequest) -> Dict[str, Any]:
    data_url = (req.imageDataUrl or req.imageRef or "").strip()
    if not data_url:
        raise HTTPException(status_code=400, detail="Provide imageDataUrl or imageRef")

    try:
        img_bytes = _decode_data_url(data_url)
        img_bgr = _decode_image_bgr(img_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    h, w = img_bgr.shape[:2]
    clicks = req.clicks or []
    pos = next((c for c in clicks if c.type == "pos"), None)
    cx = int(round(pos.x)) if pos else w // 2
    cy = int(round(pos.y)) if pos else h // 2

    meta = req.meta or {}
    footprint_ring = _extract_geojson_ring(meta.get("osmFootprint"))
    footprint_mask = _ring_norm_to_mask(footprint_ring, w, h) if footprint_ring else None

    box: Optional[np.ndarray] = None
    roi_bounds: Optional[Tuple[int, int, int, int]] = None
    if req.roi:
        x0 = int(np.clip(req.roi.x, 0, w - 1))
        y0 = int(np.clip(req.roi.y, 0, h - 1))
        x1 = int(np.clip(req.roi.x + req.roi.w, 1, w))
        y1 = int(np.clip(req.roi.y + req.roi.h, 1, h))
        if x1 > x0 and y1 > y0:
            box = np.array([x0, y0, x1, y1], dtype=np.float32)
            roi_bounds = (x0, y0, x1, y1)

    mode = (req.mode or "roof").strip().lower()

    # White-roof prior (helps on bright apartment/commercial roofs, pools/courtyards in the middle).
    white_prob: Optional[np.ndarray] = None
    try:
        hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
        sat = hsv[:, :, 1] / 255.0
        val = hsv[:, :, 2] / 255.0
        wp = np.clip((val - 0.55) / 0.45, 0.0, 1.0) * np.clip((0.35 - sat) / 0.35, 0.0, 1.0)
        wp = cv2.GaussianBlur(wp, (0, 0), 1.2).astype(np.float32)
        if roi_bounds is not None:
            x0, y0, x1, y1 = roi_bounds
            keep = np.zeros((h, w), dtype=np.float32)
            keep[y0:y1, x0:x1] = 1.0
            wp = wp * keep
        white_prob = wp
    except Exception:
        white_prob = None

    onnx_error: Optional[str] = None
    if mode in ("roof", "building") and ONNX.ensure_loaded():
        try:
            if roi_bounds is not None:
                prob, _ = ONNX.predict_prob_roi(img_bgr, roi_bounds)
            else:
                prob = ONNX.predict_prob(img_bgr)

            prob_raw = prob
            boost_raw = os.getenv("ROOFSEG_WHITE_BOOST", "0.18").strip()
            try:
                boost = float(boost_raw)
            except Exception:
                boost = 0.18
            boost = float(np.clip(boost, 0.0, 0.5))
            if white_prob is not None and boost > 0:
                prob = np.clip(prob + boost * white_prob, 0.0, 1.0).astype(np.float32)

            thr_raw = os.getenv("ROOFSEG_THRESHOLD", "0.5").strip()
            try:
                thr = float(thr_raw)
            except Exception:
                thr = 0.5
            thr = float(np.clip(thr, 0.05, 0.95))

            sweep_raw = os.getenv("ROOFSEG_THRESHOLD_SWEEP", "1").strip().lower()
            sweep = sweep_raw not in ("0", "false", "off", "no")
            # Sweep a few thresholds to be robust to very bright (white) roofs.
            thr_list = [thr]
            if sweep:
                thr_list.extend([thr - 0.08, thr - 0.16, thr + 0.08])
                thr_list.extend([0.35, 0.45])
            thr_list = [float(np.clip(t, 0.05, 0.95)) for t in thr_list]
            thr_list = sorted({round(t, 4) for t in thr_list})

            def click_dist_to_mask(m_u8: np.ndarray) -> float:
                if pos is None:
                    return 0.0
                if not (0 <= cy < m_u8.shape[0] and 0 <= cx < m_u8.shape[1]):
                    return 1e9
                if bool(m_u8[cy, cx]):
                    return 0.0
                inv = (m_u8 == 0).astype(np.uint8)
                dist = cv2.distanceTransform(inv, cv2.DIST_L2, 3)
                return float(dist[cy, cx])

            best = None
            best_debug: Dict[str, Any] = {}
            best_thr = thr
            best_iou = -1.0
            best_mean_p = 0.0
            best_mask = None
            best_full_mask = None

            for t in thr_list:
                full_mask = (prob >= float(t)).astype(np.uint8)

                # Apply ROI early so candidate components stay within it.
                if roi_bounds is not None:
                    x0, y0, x1, y1 = roi_bounds
                    roi_mask = np.zeros((h, w), dtype=np.uint8)
                    roi_mask[y0:y1, x0:x1] = 1
                    full_mask = (np.logical_and(full_mask > 0, roi_mask > 0)).astype(np.uint8)

                chosen = full_mask
                iou = -1.0

                if footprint_mask is not None:
                    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
                    footprint_pad = cv2.dilate(footprint_mask.astype(np.uint8), k, iterations=1)
                    chosen = choose_component_by_footprint(chosen, footprint_pad)
                    iou = _mask_iou(chosen, footprint_mask)
                    chosen = (np.logical_and(chosen > 0, footprint_pad > 0)).astype(np.uint8)

                # Keep a copy for candidate polygons (before the single-component selection).
                cand_mask = chosen

                chosen = _keep_component(chosen, cx, cy)
                area = int(chosen.sum())
                if area < 30:
                    continue

                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                chosen = cv2.morphologyEx(chosen, cv2.MORPH_CLOSE, kernel, iterations=2)
                chosen = cv2.morphologyEx(chosen, cv2.MORPH_OPEN, kernel, iterations=1)

                poly = _mask_to_polygon_norm(chosen, w, h)
                if poly is None:
                    continue

                mean_p = float(prob[chosen > 0].mean()) if area > 0 else 0.0
                click_d = click_dist_to_mask(chosen)
                score = 1.25 * mean_p + 0.55 * float(max(iou, 0.0)) - 0.006 * float(min(click_d, 120.0))
                if best is None or score > best:
                    best = score
                    best_thr = float(t)
                    best_iou = float(iou)
                    best_mean_p = float(mean_p)
                    best_mask = chosen
                    best_full_mask = cand_mask
                    best_debug = {
                        "threshold": float(t),
                        "meanProb": float(mean_p),
                        "iou": float(max(iou, 0.0)),
                        "clickDist": float(click_d),
                        "area": int(area),
                    }

            if best_mask is not None:
                # Build a few candidate polygons from the selected threshold mask.
                onnx_candidates: List[Dict[str, Any]] = []
                try:
                    cmask = (best_full_mask if best_full_mask is not None else best_mask).astype(np.uint8)
                    ncc, labels, stats, _ = cv2.connectedComponentsWithStats(cmask)
                    comps = []
                    for lab in range(1, ncc):
                        area = int(stats[lab, cv2.CC_STAT_AREA])
                        if area < 260:
                            continue
                        comps.append((area, lab))
                    comps.sort(reverse=True)
                    for idx, (area, lab) in enumerate(comps[:5]):
                        cm = (labels == lab).astype(np.uint8)
                        poly_i = _mask_to_polygon_norm(cm, w, h)
                        if poly_i is None:
                            continue
                        mean_p = float(prob[cm > 0].mean()) if area > 0 else 0.0
                        onnx_candidates.append({"id": f"cv_{idx+1}", "polygon": poly_i, "score": float(mean_p)})
                except Exception:
                    onnx_candidates = []

                poly = _mask_to_polygon_norm(best_mask, w, h)
                if poly is not None:
                    conf = float(np.clip(0.15 + 0.75 * best_mean_p + 0.10 * float(max(best_iou, 0.0)), 0.0, 1.0))
                    return {
                        "roofPolygon": poly,
                        "confidence": conf,
                        "source": "roofsat_onnx",
                        "candidates": onnx_candidates if onnx_candidates else None,
                        "debug": {
                            "onnx": True,
                            "threshold": float(best_thr),
                            "thresholdBase": float(thr),
                            "thresholdSweep": bool(sweep),
                            "whiteBoost": float(boost) if (white_prob is not None and boost > 0) else 0.0,
                            "meanProb": float(best_mean_p),
                            "iou": float(max(best_iou, 0.0)),
                            **best_debug,
                        },
                    }
        except Exception as e:
            onnx_error = str(e)

    # If SAM isn't ready, still return the server-selected address footprint.
    if not SAM.ensure_loaded():
        # Heuristic fallback: bright/white roofs (useful when ONNX isn't configured).
        if mode in ("roof", "building") and white_prob is not None:
            try:
                thr_raw = os.getenv("ROOFSEG_WHITE_THRESHOLD", "0.42").strip()
                try:
                    thr_w = float(thr_raw)
                except Exception:
                    thr_w = 0.42
                thr_w = float(np.clip(thr_w, 0.15, 0.9))

                m = (white_prob >= thr_w).astype(np.uint8)

                if roi_bounds is not None:
                    x0, y0, x1, y1 = roi_bounds
                    roi_mask = np.zeros((h, w), dtype=np.uint8)
                    roi_mask[y0:y1, x0:x1] = 1
                    m = (np.logical_and(m > 0, roi_mask > 0)).astype(np.uint8)

                # If we have a footprint and it overlaps, use it to disambiguate.
                if footprint_mask is not None:
                    iou0 = _mask_iou(m, footprint_mask)
                    if iou0 >= 0.08:
                        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
                        footprint_pad = cv2.dilate(footprint_mask.astype(np.uint8), k, iterations=1)
                        m = choose_component_by_footprint(m, footprint_pad)
                        m = (np.logical_and(m > 0, footprint_pad > 0)).astype(np.uint8)

                m = _keep_component(m, cx, cy)

                if int(m.sum()) >= 60:
                    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k2, iterations=2)
                    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k2, iterations=1)
                    poly = _mask_to_polygon_norm(m, w, h)
                    if poly is not None:
                        mean_w = float(white_prob[m > 0].mean()) if int(m.sum()) > 0 else 0.0
                        conf = float(np.clip(0.15 + 0.85 * mean_w, 0.0, 1.0))
                        return {
                            "roofPolygon": poly,
                            "confidence": conf,
                            "source": "white_roof_heuristic",
                            "debug": {
                                "sam": False,
                                "samError": SAM.error,
                                "onnx": False,
                                "onnxError": onnx_error or ONNX.error,
                                "whiteThr": float(thr_w),
                                "meanWhite": float(mean_w),
                            },
                        }
            except Exception:
                pass

        if meta.get("osmFootprint") is not None:
            return {
                "roofPolygon": meta.get("osmFootprint"),
                "confidence": 0.55,
                "source": "osm_footprint_passthrough",
                "debug": {"sam": False, "samError": SAM.error, "onnx": False, "onnxError": onnx_error or ONNX.error},
            }

        # Last resort: centered rectangle.
        rx0 = max(0.0, (cx - 0.18 * w) / float(w))
        ry0 = max(0.0, (cy - 0.14 * h) / float(h))
        rx1 = min(1.0, (cx + 0.18 * w) / float(w))
        ry1 = min(1.0, (cy + 0.14 * h) / float(h))
        rect = {"type": "Polygon", "coordinates": [[[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]]]}  # normalized
        return {
            "roofPolygon": rect,
            "confidence": 0.2,
            "source": "fallback_rect",
            "debug": {"sam": False, "samError": SAM.error, "onnx": False, "onnxError": onnx_error or ONNX.error},
        }

    # SAM path
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    point_coords: Optional[np.ndarray] = None
    point_labels: Optional[np.ndarray] = None
    if clicks:
        pts = []
        labs = []
        for c in clicks:
            pts.append([float(c.x), float(c.y)])
            labs.append(1 if c.type == "pos" else 0)
        point_coords = np.array(pts, dtype=np.float32)
        point_labels = np.array(labs, dtype=np.int32)

    try:
        masks, scores = SAM.predict(img_rgb, point_coords=point_coords, point_labels=point_labels, box=box)
    except Exception as e:
        # Keep the app unblocked.
        if meta.get("osmFootprint") is not None:
            return {
                "roofPolygon": meta.get("osmFootprint"),
                "confidence": 0.5,
                "source": "osm_footprint_after_sam_error",
                "debug": {"sam": True, "error": str(e)},
            }
        raise HTTPException(status_code=502, detail=f"SAM inference failed: {e}")

    if masks is None or len(masks) == 0:
        if meta.get("osmFootprint") is not None:
            return {
                "roofPolygon": meta.get("osmFootprint"),
                "confidence": 0.45,
                "source": "osm_footprint_after_empty_sam",
                "debug": {"sam": True},
            }
        raise HTTPException(status_code=502, detail="SAM returned no masks")

    # Choose the mask that best matches the address footprint when available.
    # First pass: require click containment (when provided). Second pass: relax.
    mask_items = []

    def click_distance_to_mask(m_u8: np.ndarray) -> float:
        if pos is None:
            return 0.0
        if not (0 <= cy < m_u8.shape[0] and 0 <= cx < m_u8.shape[1]):
            return 1e9
        if bool(m_u8[cy, cx]):
            return 0.0
        inv = (m_u8 == 0).astype(np.uint8)
        dist = cv2.distanceTransform(inv, cv2.DIST_L2, 3)
        return float(dist[cy, cx])

    for i in range(len(masks)):
        m = masks[i]
        if m is None:
            continue
        m_u8 = (m > 0).astype(np.uint8)
        contains_click = False
        if 0 <= cy < m_u8.shape[0] and 0 <= cx < m_u8.shape[1]:
            contains_click = bool(m_u8[cy, cx])
        s = float(scores[i]) if i < len(scores) else 0.0
        d = click_distance_to_mask(m_u8)
        area = int(m_u8.sum())
        mean_white = float(white_prob[m_u8 > 0].mean()) if (white_prob is not None and area > 0) else 0.0
        mask_items.append((i, m_u8, contains_click, s, d, area, mean_white))

    if not mask_items:
        if meta.get("osmFootprint") is not None:
            return {
                "roofPolygon": meta.get("osmFootprint"),
                "confidence": 0.45,
                "source": "osm_footprint_after_empty_sam",
                "debug": {"sam": True},
            }
        raise HTTPException(status_code=502, detail="SAM returned no usable masks")

    def pick_best(items):
        best = items[0]
        best_iou_local = _mask_iou(best[1], footprint_mask) if footprint_mask is not None else -1.0
        best_rank = -1e18

        def rank(it) -> float:
            # it = (idx, mask, contains_click, sam_score, click_dist, area, mean_white)
            sam_s = float(it[3])
            click_d = float(it[4])
            area = float(it[5])
            mean_white = float(it[6])

            # If we don't have a click, do not penalize click distance.
            if pos is None:
                click_d = 0.0

            # Pool/water masks tend to be low "white"; roofs tend to be higher.
            return 1.05 * sam_s + 0.85 * mean_white + 0.00022 * area - 0.004 * float(min(click_d, 120.0))

        best_rank = rank(best)
        for it in items[1:]:
            if footprint_mask is not None:
                iou = _mask_iou(it[1], footprint_mask)
                if iou > best_iou_local + 1e-9 or (abs(iou - best_iou_local) <= 1e-9 and it[4] < best[4]):
                    best = it
                    best_iou_local = iou
                continue

            r = rank(it)
            if r > best_rank + 1e-9:
                best = it
                best_rank = r
        return best, best_iou_local

    filtered = [it for it in mask_items if (pos is None or it[2] or it[4] <= 60.0)]
    chosen_item, best_iou = pick_best(filtered if filtered else mask_items)
    best_idx = int(chosen_item[0])
    best_score = float(chosen_item[3])

    chosen = chosen_item[1]
    chosen = _keep_component(chosen, cx, cy)

    # Hard constraints: keep the mask on the address-matched footprint and inside ROI.
    if footprint_mask is not None:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        footprint_pad = cv2.dilate(footprint_mask.astype(np.uint8), k, iterations=1)
        chosen = (np.logical_and(chosen > 0, footprint_pad > 0)).astype(np.uint8)

    if roi_bounds is not None:
        x0, y0, x1, y1 = roi_bounds
        roi_mask = np.zeros((h, w), dtype=np.uint8)
        roi_mask[y0:y1, x0:x1] = 1
        chosen = (np.logical_and(chosen > 0, roi_mask > 0)).astype(np.uint8)

    if int(chosen.sum()) < 30 and meta.get("osmFootprint") is not None:
        return {
            "roofPolygon": meta.get("osmFootprint"),
            "confidence": 0.5,
            "source": "osm_footprint_after_clip_empty",
            "debug": {"sam": True, "iou": max(best_iou, 0.0), "score": best_score},
        }

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    chosen = cv2.morphologyEx(chosen, cv2.MORPH_CLOSE, kernel, iterations=2)
    chosen = cv2.morphologyEx(chosen, cv2.MORPH_OPEN, kernel, iterations=1)

    suggested_orientation: Optional[float] = None
    suggested_azimuth: Optional[float] = None

    # Candidate roof polygons (alternate SAM masks).
    sam_candidates: List[Dict[str, Any]] = []
    try:
        roi_mask_full: Optional[np.ndarray] = None
        if roi_bounds is not None:
            x0, y0, x1, y1 = roi_bounds
            roi_mask_full = np.zeros((h, w), dtype=np.uint8)
            roi_mask_full[y0:y1, x0:x1] = 1

        footprint_pad2: Optional[np.ndarray] = None
        if footprint_mask is not None:
            k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
            footprint_pad2 = cv2.dilate(footprint_mask.astype(np.uint8), k2, iterations=1)

        k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        for idx, it in enumerate(mask_items[:5]):
            cm = it[1].astype(np.uint8)
            if footprint_pad2 is not None:
                cm = (np.logical_and(cm > 0, footprint_pad2 > 0)).astype(np.uint8)
            if roi_mask_full is not None:
                cm = (np.logical_and(cm > 0, roi_mask_full > 0)).astype(np.uint8)
            if int(cm.sum()) < 30:
                continue
            cm = cv2.morphologyEx(cm, cv2.MORPH_CLOSE, k3, iterations=2)
            cm = cv2.morphologyEx(cm, cv2.MORPH_OPEN, k3, iterations=1)
            poly_i = _mask_to_polygon_norm(cm, w, h)
            if poly_i is None:
                continue
            sam_candidates.append({"id": f"sam_{idx+1}", "polygon": poly_i, "score": float(it[3])})
    except Exception:
        sam_candidates = []

    candidates_out: List[Dict[str, Any]] = sam_candidates
    source = "sam"

    # Orientation hint from dominant roof edges.
    lines = _edge_lines(img_bgr, chosen)
    dom = _dominant_angle(lines)
    if dom is not None:
        suggested_orientation = float(dom)

    # Optional: split a gable-style roof into a single plane.
    # Default mode="roof" returns the full roof mask.
    if mode in ("plane", "roof_plane") and dom is not None:
        mx, my = _mask_centroid(chosen)
        best_line = None
        best_score = -1e18
        for (x1l, y1l, x2l, y2l, length, ang) in lines[:40]:
            if abs(float(ang) - float(dom)) > 7.0:
                continue
            midx = 0.5 * (x1l + x2l)
            midy = 0.5 * (y1l + y2l)
            dist_c = math.hypot(midx - mx, midy - my)
            score = float(length) - 0.25 * float(dist_c)
            if score > best_score:
                best_score = score
                best_line = (x1l, y1l, x2l, y2l, float(length), float(ang))

        if best_line is not None:
            (x1l, y1l, x2l, y2l, _, _) = best_line
            pA, pB = _extend_segment_to_bounds(int(x1l), int(y1l), int(x2l), int(y2l), w, h)

            cut = chosen.copy()
            cv2.line(cut, pA, pB, 0, thickness=10)
            ncc, labels = cv2.connectedComponents((cut > 0).astype(np.uint8))
            if ncc >= 3:
                # Collect large components.
                areas = []
                for lab in range(1, ncc):
                    area = int((labels == lab).sum())
                    areas.append((area, lab))
                areas.sort(reverse=True)

                # Keep only meaningful chunks.
                total = int((chosen > 0).sum())
                keep = [(a, lab) for (a, lab) in areas if a >= max(260, int(0.18 * total))]
                if len(keep) >= 2:
                    focus_lab = int(labels[int(np.clip(cy, 0, h - 1)), int(np.clip(cx, 0, w - 1))])
                    if focus_lab == 0:
                        # Choose the component whose centroid is closest to the focus point.
                        best_lab = keep[0][1]
                        best_d = 1e18
                        for (_, lab) in keep[:3]:
                            cm = (labels == lab).astype(np.uint8)
                            ccx, ccy = _mask_centroid(cm)
                            d = (ccx - cx) ** 2 + (ccy - cy) ** 2
                            if d < best_d:
                                best_d = d
                                best_lab = lab
                        focus_lab = best_lab

                    # Build polygons for the top 2 components.
                    kept = keep[:2]
                    for idx, (_, lab) in enumerate(kept):
                        cm = (labels == lab).astype(np.uint8)
                        poly_i = _mask_to_polygon_norm(cm, w, h)
                        if poly_i is None:
                            continue
                        candidates_out.append({"id": f"plane_{idx+1}", "polygon": poly_i, "score": None})

                    if candidates_out:
                        # Select focus component.
                        focus_mask = (labels == focus_lab).astype(np.uint8)
                        chosen = focus_mask
                        source = "sam_plane_split"

                        # Recompute orientation on the chosen plane.
                        lines2 = _edge_lines(img_bgr, chosen)
                        dom2 = _dominant_angle(lines2)
                        if dom2 is not None:
                            suggested_orientation = float(dom2)

                        # Estimate azimuth: plane direction is normal to ridge line pointing to chosen centroid.
                        vx = float(pB[0] - pA[0])
                        vy = float(pB[1] - pA[1])
                        nx = -vy
                        ny = vx
                        ccx, ccy = _mask_centroid(chosen)
                        sign = (ccx - float(pA[0])) * nx + (ccy - float(pA[1])) * ny
                        if sign < 0:
                            nx = -nx
                            ny = -ny
                        if abs(nx) + abs(ny) > 1e-6:
                            suggested_azimuth = _azimuth_from_vector(nx, ny)

    poly = _mask_to_polygon_norm(chosen, w, h)
    if poly is None and meta.get("osmFootprint") is not None:
        return {
            "roofPolygon": meta.get("osmFootprint"),
            "confidence": 0.45,
            "source": "osm_footprint_after_polygonize_fail",
            "debug": {"sam": True, "iou": max(best_iou, 0.0), "score": best_score},
        }
    if poly is None:
        raise HTTPException(status_code=502, detail="Failed to polygonize mask")

    conf = 0.55 * float(best_score) + 0.45 * float(max(best_iou, 0.0))
    conf = float(np.clip(conf, 0.0, 1.0))
    return {
        "roofPolygon": poly,
        "confidence": conf,
        "source": source,
        "suggestedOrientationDeg": suggested_orientation,
        "suggestedAzimuthDeg": suggested_azimuth,
        "candidates": candidates_out if candidates_out else None,
        "debug": {
            "sam": True,
            "modelType": SAM.model_type,
            "device": SAM.device,
            "score": best_score,
            "iou": max(best_iou, 0.0),
            "dominantAngle": dom,
        },
    }
