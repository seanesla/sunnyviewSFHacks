import argparse
import json
import os
from dataclasses import asdict, dataclass
from typing import List, Optional, Tuple

import numpy as np

from dataset import RoofSatSample, build_roofsat_index, load_img_mask, make_augmenter, split_train_val


def _require_torch():
    try:
        import torch  # type: ignore
        import torch.nn as nn  # type: ignore
        import torch.utils.data as tud  # type: ignore

        return torch, nn, tud
    except Exception as e:
        raise RuntimeError(f"PyTorch is required for training: {e}")


@dataclass(frozen=True)
class TrainConfig:
    data_dir: str
    out_dir: str
    encoder: str
    input_size: int
    batch_size: int
    lr: float
    epochs: int
    val_frac: float
    seed: int
    amp: bool


def _seed_all(seed: int) -> None:
    np.random.seed(seed)
    try:
        import random

        random.seed(seed)
    except Exception:
        pass
    try:
        import torch  # type: ignore

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    except Exception:
        pass


def _to_tensor(img_rgb: np.ndarray, mask: np.ndarray, size: int) -> Tuple[np.ndarray, np.ndarray]:
    import cv2

    img = cv2.resize(img_rgb, (size, size), interpolation=cv2.INTER_LINEAR)
    m = cv2.resize(mask, (size, size), interpolation=cv2.INTER_NEAREST)

    x = img.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    x = (x - mean) / std
    x = np.transpose(x, (2, 0, 1))  # 3xSxS

    y = (m > 0).astype(np.float32)[None, ...]  # 1xSxS
    return x, y


def _iou_from_logits(logits, y_true, eps: float = 1e-6) -> float:
    import torch  # type: ignore

    probs = torch.sigmoid(logits)
    pred = (probs >= 0.5).float()
    inter = (pred * y_true).sum(dim=(1, 2, 3))
    union = (pred + y_true - pred * y_true).sum(dim=(1, 2, 3))
    iou = (inter + eps) / (union + eps)
    return float(iou.mean().detach().cpu().item())


class _RoofSatTorchDataset:
    def __init__(self, samples: List[RoofSatSample], input_size: int, aug_kind: str):
        self.samples = samples
        self.input_size = input_size
        self.augment = make_augmenter(aug_kind)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        img, mask = load_img_mask(self.samples[idx])
        if self.augment is not None:
            img, mask = self.augment(img, mask)
        x, y = _to_tensor(img, mask, self.input_size)
        return x, y


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", required=True, help="Path to extracted Roofsat folder")
    p.add_argument("--out-dir", required=True, help="Output run directory")
    p.add_argument("--encoder", default="resnet34", help="SMP encoder name")
    p.add_argument("--input-size", type=int, default=512, help="Training crop size")
    p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--epochs", type=int, default=25)
    p.add_argument("--val-frac", type=float, default=0.15)
    p.add_argument("--seed", type=int, default=1337)
    p.add_argument("--amp", action="store_true", help="Use mixed precision")
    args = p.parse_args()

    cfg = TrainConfig(
        data_dir=args.data_dir,
        out_dir=args.out_dir,
        encoder=args.encoder,
        input_size=args.input_size,
        batch_size=args.batch_size,
        lr=args.lr,
        epochs=args.epochs,
        val_frac=args.val_frac,
        seed=args.seed,
        amp=bool(args.amp),
    )

    os.makedirs(cfg.out_dir, exist_ok=True)
    with open(os.path.join(cfg.out_dir, "config.json"), "w", encoding="utf-8") as f:
        json.dump(asdict(cfg), f, indent=2, sort_keys=True)

    _seed_all(cfg.seed)
    torch, nn, tud = _require_torch()

    try:
        import segmentation_models_pytorch as smp  # type: ignore
    except Exception as e:
        raise RuntimeError(f"segmentation-models-pytorch is required: {e}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    samples = build_roofsat_index(cfg.data_dir)
    train_s, val_s = split_train_val(samples, cfg.val_frac, seed=cfg.seed)

    train_ds = _RoofSatTorchDataset(train_s, cfg.input_size, aug_kind="train")
    val_ds = _RoofSatTorchDataset(val_s, cfg.input_size, aug_kind="none")

    train_loader = tud.DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True, num_workers=2, pin_memory=True)
    val_loader = tud.DataLoader(val_ds, batch_size=max(1, cfg.batch_size // 2), shuffle=False, num_workers=2, pin_memory=True)

    model = smp.Unet(
        encoder_name=cfg.encoder,
        encoder_weights="imagenet",
        in_channels=3,
        classes=1,
        activation=None,
    )
    model = model.to(device)

    bce = nn.BCEWithLogitsLoss()
    dice = smp.losses.DiceLoss(mode="binary", from_logits=True)

    def loss_fn(logits, y_true):
        return 0.55 * bce(logits, y_true) + 0.45 * dice(logits, y_true)

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=1e-4)
    scaler = torch.cuda.amp.GradScaler(enabled=cfg.amp and device.type == "cuda")

    best_iou: float = -1.0
    best_path = os.path.join(cfg.out_dir, "best.pt")
    last_path = os.path.join(cfg.out_dir, "last.pt")

    for epoch in range(1, cfg.epochs + 1):
        model.train()
        train_loss = 0.0
        for xb, yb in train_loader:
            xb_t = xb.to(device) if torch.is_tensor(xb) else torch.from_numpy(xb).to(device)
            yb_t = yb.to(device) if torch.is_tensor(yb) else torch.from_numpy(yb).to(device)

            opt.zero_grad(set_to_none=True)
            with torch.cuda.amp.autocast(enabled=scaler.is_enabled()):
                logits = model(xb_t)
                loss = loss_fn(logits, yb_t)

            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()

            train_loss += float(loss.detach().cpu().item())

        train_loss /= max(1, len(train_loader))

        model.eval()
        val_loss = 0.0
        val_iou = 0.0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb_t = xb.to(device) if torch.is_tensor(xb) else torch.from_numpy(xb).to(device)
                yb_t = yb.to(device) if torch.is_tensor(yb) else torch.from_numpy(yb).to(device)
                logits = model(xb_t)
                loss = loss_fn(logits, yb_t)
                val_loss += float(loss.detach().cpu().item())
                val_iou += _iou_from_logits(logits, yb_t)

        val_loss /= max(1, len(val_loader))
        val_iou /= max(1, len(val_loader))

        # Save last.
        torch.save(
            {
                "epoch": epoch,
                "model_state": model.state_dict(),
                "encoder": cfg.encoder,
                "input_size": cfg.input_size,
                "val_iou": val_iou,
            },
            last_path,
        )

        # Save best.
        if val_iou > best_iou:
            best_iou = val_iou
            torch.save(
                {
                    "epoch": epoch,
                    "model_state": model.state_dict(),
                    "encoder": cfg.encoder,
                    "input_size": cfg.input_size,
                    "val_iou": val_iou,
                },
                best_path,
            )

        msg = {
            "epoch": epoch,
            "device": str(device),
            "train_loss": round(train_loss, 5),
            "val_loss": round(val_loss, 5),
            "val_iou": round(val_iou, 5),
            "best_iou": round(best_iou, 5),
        }
        print(json.dumps(msg))


if __name__ == "__main__":
    main()
