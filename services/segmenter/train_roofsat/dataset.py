import os
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class RoofSatSample:
    img_path: str
    mask_path: str


_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")


def _list_images(dir_path: str) -> List[str]:
    out: List[str] = []
    for name in os.listdir(dir_path):
        if name.lower().endswith(_IMAGE_EXTS):
            out.append(os.path.join(dir_path, name))
    out.sort()
    return out


def build_roofsat_index(data_dir: str) -> List[RoofSatSample]:
    return build_dataset_index(data_dir)


def _find_mask_for_image(img_path: str, mask_dir: str) -> str | None:
    base = os.path.basename(img_path)
    direct = os.path.join(mask_dir, base)
    if os.path.exists(direct):
        return direct

    stem = os.path.splitext(base)[0]
    # Try common mask extensions.
    for ext in (".png", ".tif", ".tiff", ".jpg", ".jpeg"):
        cand = os.path.join(mask_dir, stem + ext)
        if os.path.exists(cand):
            return cand
    return None


def build_paired_index(img_dir: str, mask_dir: str) -> List[RoofSatSample]:
    if not os.path.isdir(img_dir):
        raise FileNotFoundError(f"Missing folder: {img_dir}")
    if not os.path.isdir(mask_dir):
        raise FileNotFoundError(f"Missing folder: {mask_dir}")

    imgs = _list_images(img_dir)
    if not imgs:
        raise FileNotFoundError(f"No images found in {img_dir}")

    samples: List[RoofSatSample] = []
    for img_path in imgs:
        mask_path = _find_mask_for_image(img_path, mask_dir)
        if not mask_path:
            base = os.path.basename(img_path)
            raise FileNotFoundError(f"Missing mask for {base} in {mask_dir}")
        samples.append(RoofSatSample(img_path=img_path, mask_path=mask_path))
    return samples


def build_dataset_index(data_dir: str) -> List[RoofSatSample]:
    """Builds an image/mask sample list from common building-mask dataset layouts.

    Supported layouts:
    - RoofSat-style: <root>/img_color + <root>/building_masks
    - Generic: <root>/images + <root>/masks
    - Inria-style: <root>/train/images + <root>/train/gt
    """

    root = os.path.abspath(data_dir)

    # RoofSat.
    roof_img = os.path.join(root, "img_color")
    roof_mask = os.path.join(root, "building_masks")
    if os.path.isdir(roof_img) and os.path.isdir(roof_mask):
        return build_paired_index(roof_img, roof_mask)

    # Generic.
    gen_img = os.path.join(root, "images")
    gen_mask = os.path.join(root, "masks")
    if os.path.isdir(gen_img) and os.path.isdir(gen_mask):
        return build_paired_index(gen_img, gen_mask)

    # Inria (common extraction layout).
    inria_img = os.path.join(root, "train", "images")
    inria_gt = os.path.join(root, "train", "gt")
    if os.path.isdir(inria_img) and os.path.isdir(inria_gt):
        return build_paired_index(inria_img, inria_gt)

    # Tolerate train/images + train/masks.
    inria_mask = os.path.join(root, "train", "masks")
    if os.path.isdir(inria_img) and os.path.isdir(inria_mask):
        return build_paired_index(inria_img, inria_mask)

    raise FileNotFoundError(
        "Unsupported dataset layout. Expected one of: img_color/building_masks, images/masks, train/images/train/gt"
    )


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
