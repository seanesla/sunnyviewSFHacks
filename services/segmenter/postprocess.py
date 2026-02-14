import math
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


def extract_geojson_ring(poly: Any) -> Optional[List[Tuple[float, float]]]:
    """Returns the first ring of a GeoJSON Polygon/MultiPolygon as [(x,y),...] in normalized coords."""
    if not poly or not isinstance(poly, dict):
        return None
    if poly.get("type") == "Feature" and isinstance(poly.get("geometry"), dict):
        return extract_geojson_ring(poly.get("geometry"))

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


def ring_norm_to_mask(ring_norm: List[Tuple[float, float]], w: int, h: int) -> np.ndarray:
    pts = np.array([[x * w, y * h] for (x, y) in ring_norm], dtype=np.float32)
    pts_i = np.round(pts).astype(np.int32)
    pts_i[:, 0] = np.clip(pts_i[:, 0], 0, w - 1)
    pts_i[:, 1] = np.clip(pts_i[:, 1], 0, h - 1)
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [pts_i], 1)
    return mask


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = float(np.logical_and(a, b).sum())
    union = float(np.logical_or(a, b).sum())
    return inter / union if union > 0 else 0.0


def keep_component(mask: np.ndarray, cx: int, cy: int) -> np.ndarray:
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


def mask_to_polygon_norm(mask: np.ndarray, w: int, h: int) -> Optional[Dict[str, Any]]:
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


def choose_component_by_footprint(mask: np.ndarray, footprint_mask: np.ndarray) -> np.ndarray:
    """Pick the connected component with best IoU against the footprint.

    If no components exist, returns the input mask.
    """

    m = (mask > 0).astype(np.uint8)
    n, labels = cv2.connectedComponents(m)
    if n <= 1:
        return m

    best_lab = 0
    best_iou = -1.0
    for lab in range(1, n):
        cm = (labels == lab).astype(np.uint8)
        iou = mask_iou(cm, footprint_mask)
        if iou > best_iou:
            best_iou = iou
            best_lab = lab

    return (labels == best_lab).astype(np.uint8) if best_lab != 0 else m


def clamp_angle_90(deg: float) -> float:
    d = float(deg)
    while d > 90.0:
        d -= 180.0
    while d < -90.0:
        d += 180.0
    return d


def azimuth_from_vector(dx: float, dy: float) -> float:
    # dx: east, dy: south (image coords). North-up image.
    az = math.degrees(math.atan2(dx, -dy))
    az = (az + 360.0) % 360.0
    return float(az)
