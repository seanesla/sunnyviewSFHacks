# Sunnyview segmenter (Python)

This is an optional external Computer Vision service used by the Next.js route `POST /api/segment`.

The frontend calls `/api/segment` automatically after an address search. If you set `SEGMENT_SERVICE_URL`, the Next.js route forwards the request here; otherwise it falls back to an OpenStreetMap building-footprint outline.

## Quick start (no GPU / fallback mode)

This mode returns the server-selected OSM footprint polygon (highly reliable for "only this address") and keeps the app unblocked.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then set in your Next app (root `.env.local`):

```bash
SEGMENT_SERVICE_URL=http://localhost:8000
```

## Enable SAM (high precision)

This service can optionally use Meta's Segment Anything Model (SAM) when the deps + checkpoint are present.

1) Install extra deps (Torch + segment-anything)

```bash
pip install torch
pip install "git+https://github.com/facebookresearch/segment-anything.git"
```

2) Download a SAM checkpoint and point the service at it:

```bash
export SAM_MODEL_TYPE=vit_h
export SAM_CHECKPOINT=/absolute/path/to/sam_vit_h_4b8939.pth
```

3) Restart `uvicorn`.

Health check:

```bash
curl -sS http://localhost:8000/healthz | jq
```

## API

`POST /segment`

Request (JSON):
- `imageDataUrl` or `imageRef`: data URL (`data:image/png;base64,...`)
- `clicks[]`: optional prompts
- `roi`: optional `{x,y,w,h}`
- `meta`: forwarded from Next.js. When available it includes:
  - `osmFootprint`: normalized GeoJSON Polygon for the address-matched building footprint

Response (JSON):
- `roofPolygon`: GeoJSON Polygon (normalized coords 0..1)
- `confidence`: 0..1
- `source`: string
