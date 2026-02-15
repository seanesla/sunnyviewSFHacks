import os
import threading
from typing import Any, Optional, Tuple

import cv2
import numpy as np


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _as_hwc_rgb(img_bgr: np.ndarray) -> np.ndarray:
    if img_bgr.ndim != 3 or img_bgr.shape[2] != 3:
        raise ValueError("expected BGR image HxWx3")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def _env_flag(name: str, default: str = "0") -> bool:
    v = os.getenv(name, default)
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _env_tiled_mode() -> str:
    v = os.getenv("ROOFSEG_TILED", "0")
    v = str(v).strip().lower()
    if v in ("auto", "a"):
        return "auto"
    return "on" if v in ("1", "true", "yes", "on") else "off"


class OnnxRoofSeg:
    """Lazy-loaded ONNX binary roof/building segmentation.

    This is intended to be trained on RoofSat building_masks and used for fast CPU inference.
    """

    def __init__(self) -> None:
        self.ready = False
        self.error: Optional[str] = None
        self.path: Optional[str] = None
        self.input_name: Optional[str] = None
        self.output_name: Optional[str] = None
        self.size: int = 512
        self._sess: Any = None
        self._lock = threading.Lock()

    def ensure_loaded(self) -> bool:
        if self.ready:
            return True

        path = os.getenv("ROOFSEG_ONNX_PATH")
        if not path:
            self.error = None
            return False
        path = os.path.abspath(path)
        if not os.path.exists(path):
            self.error = f"ROOFSEG_ONNX_PATH not found: {path}"
            return False

        size_raw = os.getenv("ROOFSEG_INPUT_SIZE", "512").strip()
        try:
            size = int(size_raw)
        except Exception:
            self.error = f"Invalid ROOFSEG_INPUT_SIZE: {size_raw}"
            return False
        if size < 128 or size > 2048:
            self.error = f"ROOFSEG_INPUT_SIZE out of range: {size}"
            return False

        try:
            import onnxruntime as ort  # type: ignore

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = int(os.getenv("ROOFSEG_ORT_THREADS", "1") or "1")
            providers = ["CPUExecutionProvider"]
            sess = ort.InferenceSession(path, sess_options=opts, providers=providers)
            inps = sess.get_inputs()
            outs = sess.get_outputs()
            if not inps:
                self.error = "ONNX model has no inputs"
                return False
            if not outs:
                self.error = "ONNX model has no outputs"
                return False
            self._sess = sess
            self.input_name = inps[0].name
            self.output_name = outs[0].name
            self.size = size
            self.path = path
            self.ready = True
            self.error = None
            return True
        except Exception as e:
            self.error = f"ONNX load failed: {e}"
            return False

    def predict_prob(self, img_bgr: np.ndarray) -> np.ndarray:
        """Returns probability mask (H,W) in original image resolution."""
        if not self.ensure_loaded() or self._sess is None or not self.input_name:
            raise RuntimeError(self.error or "ONNX model unavailable")

        h, w = img_bgr.shape[:2]

        tiled_mode = _env_tiled_mode()
        tiled = tiled_mode == "on" or (tiled_mode == "auto" and (h > self.size or w > self.size))
        if tiled and h >= self.size and w >= self.size and (h > self.size or w > self.size):
            return self._predict_prob_tiled(img_bgr)

        img_rgb = _as_hwc_rgb(img_bgr)
        y_f = self._predict_prob_fixed(img_rgb)
        prob = cv2.resize(y_f, (w, h), interpolation=cv2.INTER_LINEAR)
        return prob.astype(np.float32)

    def _predict_prob_fixed(self, img_rgb: np.ndarray) -> np.ndarray:
        """Runs the model on a single image and returns (S,S) probs."""
        inp = (
            cv2.resize(img_rgb, (self.size, self.size), interpolation=cv2.INTER_LINEAR)
            if img_rgb.shape[0] != self.size or img_rgb.shape[1] != self.size
            else img_rgb
        )
        x = inp.astype(np.float32) / 255.0

        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        x = (x - mean) / std
        x = np.transpose(x, (2, 0, 1))[None, ...]  # 1x3xSxS

        with self._lock:
            out = self._sess.run([self.output_name], {self.input_name: x})[0]

        y = np.asarray(out)
        if y.ndim == 4:
            y = y[0]
        if y.ndim == 3 and y.shape[0] in (1, 2):
            y = y[0]
        if y.ndim != 2:
            raise RuntimeError(f"Unexpected ONNX output shape: {tuple(np.asarray(out).shape)}")

        y_f = y.astype(np.float32)
        y_min = float(np.min(y_f))
        y_max = float(np.max(y_f))
        if y_min < 0.0 or y_max > 1.0:
            y_f = _sigmoid(y_f)
        return np.clip(y_f, 0.0, 1.0)

    def _predict_prob_tiled(self, img_bgr: np.ndarray) -> np.ndarray:
        """Sliding-window inference to preserve resolution on large tiles."""
        h, w = img_bgr.shape[:2]
        if h < self.size or w < self.size:
            # Fallback to single-pass resize.
            img_rgb = _as_hwc_rgb(img_bgr)
            y_f = self._predict_prob_fixed(img_rgb)
            return cv2.resize(y_f, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)

        overlap_raw = os.getenv("ROOFSEG_TILE_OVERLAP", "0.25").strip()
        try:
            overlap = float(overlap_raw)
        except Exception:
            overlap = 0.25
        overlap = float(np.clip(overlap, 0.0, 0.75))
        stride = int(round(self.size * (1.0 - overlap)))
        stride = max(64, min(self.size, stride))

        xs = list(range(0, max(1, w - self.size + 1), stride))
        ys = list(range(0, max(1, h - self.size + 1), stride))
        last_x = w - self.size
        last_y = h - self.size
        if xs[-1] != last_x:
            xs.append(last_x)
        if ys[-1] != last_y:
            ys.append(last_y)

        prob_sum = np.zeros((h, w), dtype=np.float32)
        w_sum = np.zeros((h, w), dtype=np.float32)

        for y0 in ys:
            for x0 in xs:
                tile_bgr = img_bgr[y0 : y0 + self.size, x0 : x0 + self.size]
                tile_rgb = _as_hwc_rgb(tile_bgr)
                p = self._predict_prob_fixed(tile_rgb)
                prob_sum[y0 : y0 + self.size, x0 : x0 + self.size] += p
                w_sum[y0 : y0 + self.size, x0 : x0 + self.size] += 1.0

        prob = prob_sum / np.maximum(w_sum, 1e-6)
        return prob.astype(np.float32)

    def predict_prob_roi(self, img_bgr: np.ndarray, roi_bounds: Tuple[int, int, int, int]) -> Tuple[np.ndarray, Tuple[int, int, int, int]]:
        """Runs inference on ROI crop and returns (prob_full, roi_bounds)."""
        x0, y0, x1, y1 = roi_bounds
        h, w = img_bgr.shape[:2]
        x0 = int(np.clip(x0, 0, w - 1))
        y0 = int(np.clip(y0, 0, h - 1))
        x1 = int(np.clip(x1, x0 + 1, w))
        y1 = int(np.clip(y1, y0 + 1, h))
        crop = img_bgr[y0:y1, x0:x1]
        prob_crop = self.predict_prob(crop)
        # prob_crop is in crop resolution; paste to full.
        prob_full = np.zeros((h, w), dtype=np.float32)
        prob_full[y0:y1, x0:x1] = prob_crop
        return prob_full, (x0, y0, x1, y1)
