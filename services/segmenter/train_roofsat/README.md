# RoofSat training (roof/building mask)

RoofSat provides per-image `building_masks/` suitable for training a binary segmentation model.

Important: RoofSat is **research-only** (Airbus imagery). Confirm license fit before using in production.

## 1) Download + unzip

From `services/segmenter/train_roofsat/`:

```bash
curl -L -o Roofsat.zip "http://www-sop.inria.fr/members/Florent.Lafarge/benchmark/Roofsat.zip"
unzip -q Roofsat.zip -d .
```

You should now have `Roofsat/img_color/` and `Roofsat/building_masks/`.

## 2) Install training deps

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r ../requirements-train.txt
```

## 3) Train

```bash
python train.py --data-dir ./Roofsat --out-dir ./runs/roofsat_unet
```

Train until a target IoU (early stop):

```bash
python train.py --data-dir ./Roofsat --out-dir ./runs/roofsat_unet --target-iou 0.95
```

More "white roof" robustness (synthetic augmentation):

```bash
python train.py --data-dir ./Roofsat --out-dir ./runs/roofsat_unet --white-roof-p 0.35
```

Mix datasets (repeat `--data-dir`):

```bash
python train.py \
  --data-dir ./Roofsat \
  --data-dir /path/to/another_building_dataset \
  --out-dir ./runs/mixed_unet \
  --target-iou 0.95
```

This writes:
- `runs/roofsat_unet/best.pt` (PyTorch)

## 4) Export ONNX for the FastAPI segmenter

```bash
python export_onnx.py --checkpoint ./runs/roofsat_unet/best.pt --out ../models/roofsat_unet.onnx
```

## 5) Run the segmenter using ONNX

From `services/segmenter/`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-onnx.txt

export ROOFSEG_ONNX_PATH="$PWD/models/roofsat_unet.onnx"
uvicorn main:app --host 0.0.0.0 --port 8000
```

In the Next.js app `.env.local`:

```bash
SEGMENT_SERVICE_URL=http://localhost:8000
```

## Notes

- The model predicts *building/roof pixels* for the whole tile. The app chooses the *correct* roof using the address-matched `osmFootprint` it sends in `meta`.
- If `ROOFSEG_ONNX_PATH` is set, the segmenter tries ONNX first and falls back to SAM (if configured) or the OSM footprint.

## Improving apartments / multifamily coverage

- Add denser urban building-mask data (apartments/condos) to reduce failures on large/complex roofs.
- This training code will read any images in `img_color/` with matching binary masks in `building_masks/` (supports `.png`, `.jpg`, `.tif`).
- For very large aerial tiles, training now takes random `--input-size` crops to preserve native resolution (instead of shrinking the entire tile).
- Candidate public datasets to augment RoofSat (review licenses/terms before use):
  - Inria Aerial Image Labeling: https://project.inria.fr/aerialimagelabeling/
  - SpaceNet building datasets: https://spacenet.ai/datasets/
  - Google Open Buildings: https://sites.research.google/open-buildings/
