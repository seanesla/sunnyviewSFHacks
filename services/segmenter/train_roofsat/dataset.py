import os
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class RoofSatSample:
    img_path: str
    mask_path: str


def _list_pngs(dir_path: str) -> List[str]:
    out: List[str] = []
    for name in os.listdir(dir_path):
        if name.lower().endswith(".png"):
            out.append(os.path.join(dir_path, name))
    out.sort()
    return out


def build_roofsat_index(data_dir: str) -> List[RoofSatSample]:
    img_dir = os.path.join(data_dir, "img_color")
    mask_dir = os.path.join(data_dir, "building_masks")
    if not os.path.isdir(img_dir):
        raise FileNotFoundError(f"Missing folder: {img_dir}")
    if not os.path.isdir(mask_dir):
        raise FileNotFoundError(f"Missing folder: {mask_dir}")

    imgs = _list_pngs(img_dir)
    if not imgs:
        raise FileNotFoundError(f"No PNGs found in {img_dir}")

    samples: List[RoofSatSample] = []
    for img_path in imgs:
        base = os.path.basename(img_path)
        mask_path = os.path.join(mask_dir, base)
        if not os.path.exists(mask_path):
            raise FileNotFoundError(f"Missing mask for {base}: {mask_path}")
        samples.append(RoofSatSample(img_path=img_path, mask_path=mask_path))
    return samples


def load_img_mask(sample: RoofSatSample) -> Tuple[np.ndarray, np.ndarray]:
    img_bgr = cv2.imread(sample.img_path, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError(f"Failed to read image: {sample.img_path}")
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    mask = cv2.imread(sample.mask_path, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise ValueError(f"Failed to read mask: {sample.mask_path}")
    m = (mask > 127).astype(np.uint8)
    return img_rgb, m


def split_train_val(samples: List[RoofSatSample], val_frac: float, seed: int = 1337) -> Tuple[List[RoofSatSample], List[RoofSatSample]]:
    if not 0.0 < val_frac < 1.0:
        raise ValueError("val_frac must be in (0,1)")
    rng = np.random.default_rng(seed)
    idx = np.arange(len(samples))
    rng.shuffle(idx)
    n_val = int(round(val_frac * len(samples)))
    val_idx = set(idx[:n_val].tolist())
    train = [s for i, s in enumerate(samples) if i not in val_idx]
    val = [s for i, s in enumerate(samples) if i in val_idx]
    return train, val


def make_augmenter(kind: str) -> Optional[Callable[[np.ndarray, np.ndarray], Tuple[np.ndarray, np.ndarray]]]:
    """Small aug wrapper; avoids hard import errors when albumentations isn't installed."""

    kind = (kind or "").strip().lower()
    if kind in ("", "none"):
        return None

    try:
        import albumentations as A  # type: ignore
    except Exception as e:
        raise RuntimeError(f"albumentations is required for aug='{kind}': {e}")

    if kind == "train":
        aug = A.Compose(
            [
                A.HorizontalFlip(p=0.5),
                A.VerticalFlip(p=0.2),
                A.RandomRotate90(p=0.35),
                A.ShiftScaleRotate(shift_limit=0.04, scale_limit=0.1, rotate_limit=20, border_mode=cv2.BORDER_REFLECT_101, p=0.5),
                A.RandomBrightnessContrast(p=0.3),
                A.GaussianBlur(blur_limit=(3, 5), p=0.15),
            ]
        )

        def fn(img: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
            out = aug(image=img, mask=mask)
            return out["image"], out["mask"]

        return fn

    raise ValueError(f"Unknown aug kind: {kind}")
