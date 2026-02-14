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


app = FastAPI(title="sunnyview-segmenter", version="0.1.0")


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
    n, labels = cv2.connectedComponents(m)
    if n <= 1:
        return m
    cx = int(np.clip(cx, 0, labels.shape[1] - 1))
    cy = int(np.clip(cy, 0, labels.shape[0] - 1))
    lab = int(labels[cy, cx])
    if lab != 0:
        return (labels == lab).astype(np.uint8)

    # Click is outside; keep the largest component.
    areas = []
    for i in range(1, n):
        areas.append((int((labels == i).sum()), i))
    areas.sort(reverse=True)
    if not areas:
        return m
    return (labels == areas[0][1]).astype(np.uint8)


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


@app.get("/healthz")
def healthz() -> Dict[str, Any]:
    sam_ready = SAM.ensure_loaded()
    return {
        "ok": True,
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

    # If SAM isn't ready, still return the server-selected address footprint.
    if not SAM.ensure_loaded():
        if meta.get("osmFootprint") is not None:
            return {
                "roofPolygon": meta.get("osmFootprint"),
                "confidence": 0.55,
                "source": "osm_footprint_passthrough",
                "debug": {"sam": False, "samError": SAM.error},
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
            "debug": {"sam": False, "samError": SAM.error},
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
    for i in range(len(masks)):
        m = masks[i]
        if m is None:
            continue
        m_u8 = (m > 0).astype(np.uint8)
        contains_click = False
        if 0 <= cy < m_u8.shape[0] and 0 <= cx < m_u8.shape[1]:
            contains_click = bool(m_u8[cy, cx])
        s = float(scores[i]) if i < len(scores) else 0.0
        mask_items.append((i, m_u8, contains_click, s))

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
        for it in items[1:]:
            if footprint_mask is not None:
                iou = _mask_iou(it[1], footprint_mask)
                if iou > best_iou_local:
                    best = it
                    best_iou_local = iou
                continue
            # no footprint: pick by SAM score
            if it[3] > best[3]:
                best = it
        return best, best_iou_local

    filtered = [it for it in mask_items if (pos is None or it[2])]
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
    candidates_out: List[Dict[str, Any]] = []
    source = "sam"

    # Try to split a gable-style roof into a single plane using strong roof lines.
    lines = _edge_lines(img_bgr, chosen)
    dom = _dominant_angle(lines)
    if dom is not None:
        suggested_orientation = float(dom)

        # Pick a long, central line near the dominant angle.
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
