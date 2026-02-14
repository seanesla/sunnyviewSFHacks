# sunnyview

sunnyview is a fast solar feasibility demo built for SF Hacks 2026.

In about 30 seconds, a user can:
- find a house by address or upload a satellite screenshot
- trace a usable roof polygon
- auto-pack panel rectangles inside the roof area
- see live estimates for panel count, DC kW, annual kWh, and annual CO2 avoided

The goal is speed and clarity for climate action education, not full engineering-grade permitting output.

## SF Hacks 2026 context

- Event: SF Hacks 2026
- Website: https://sfhacks.io
- Theme: Tech for a Greener Tomorrow
- Dates: Feb 13-15, 2026
- Venue: Annex I, 1 N State Dr, San Francisco, CA 94132

## What is in this repo right now

This repository currently includes:
- complete frontend experience (Next.js + React + TypeScript)
- deterministic panel-packing logic
- geocoding proxy endpoint (`/api/geocode`)
- static satellite image proxy endpoint (`/api/static-map`)

Some advanced features are designed to work with an external backend (see "Optional backend integration").

## Feature availability

| Feature | Works out of the box | Notes |
| --- | --- | --- |
| Address search + suggestions | Yes | Uses `/api/geocode` proxy (Esri with Nominatim fallback). |
| Screenshot upload + manual calibration | Yes | Lets user set meters-per-pixel for uploaded images. |
| Roof tracing + panel packing | Yes | Runs locally in-browser for fast interaction. |
| Live fallback energy and CO2 estimates | Yes | Uses local fallback math if server estimate is unavailable. |
| 3D globe visualization | Yes | Uses Cesium and Esri imagery by default. |
| Project save + share QR link | Needs backend | Requires project endpoints and `NEXT_PUBLIC_API_ORIGIN`. |
| AI explain, TTS narration, auto-outline | Needs backend | Requires `/api/explain`, `/api/tts`, `/api/segment`. |
| Server-side solar estimate endpoint | Needs backend | Requires `/api/estimate`. |

## Tech stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS 4
- CesiumJS (3D Earth view)
- Canvas-based geometry + panel packing
- ArcGIS + OpenStreetMap data sources via local API routes

## Quick start (beginner-friendly)

### 1) Install requirements

- Install Node.js 20+ and npm.
- Open a terminal in this project folder.

### 2) Install dependencies

```bash
npm install
```

### 3) Create your env file

```bash
cp .env.local.example .env.local
```

Optional variables you can add to `.env.local`:

```bash
# External backend for share/estimate/AI routes
NEXT_PUBLIC_API_ORIGIN=http://localhost:3001

# Optional higher quality Cesium ion imagery
NEXT_PUBLIC_CESIUM_ION_TOKEN=

# Optional legacy components only (main flow does not require this)
NEXT_PUBLIC_MAPBOX_TOKEN=
```

### 4) Start the app

```bash
npm run dev
```

Open: `http://localhost:3000`

## How to use the app

1. Click the Earth (or "Launch Demo").
2. Choose one input mode:
   - Address: search a full address and pick a suggestion.
   - Screenshot upload: upload a roof image and calibrate scale.
3. Trace the roof polygon on the canvas.
4. Adjust panel and site assumptions on the side panels.
5. Read live results: panel count, DC kW, annual kWh, annual CO2.
6. Optional (if backend is connected): Explain, Talk, and Share.

## NPM scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local development server. |
| `npm run build` | Create production build. |
| `npm run start` | Run production build locally. |
| `npm run lint` | Run ESLint. |

Recommended checks before demo/submission:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

There is currently no `npm test` script configured in this repo.

## Optional backend integration

If you set `NEXT_PUBLIC_API_ORIGIN`, the frontend will call these backend endpoints for full functionality:

- `POST /api/projects`
- `PATCH /api/projects/:id`
- `POST /api/estimate`
- `POST /api/segment`
- `POST /api/explain`
- `POST /api/tts`
- `GET /s/:shareSlug` (JSON share snapshot used by `/app/s/[shareSlug]`)

If these endpoints are missing, the app still runs in demo mode with local fallbacks.

## Architecture docs

For deeper technical planning notes, see:
- `architecture.md`
- `task-distribution.md`

## Project structure

```text
app/
  page.tsx                 # Main entry (SunnyviewExperience)
  api/geocode/route.ts     # Address search proxy
  api/static-map/route.ts  # Static satellite image proxy
  s/[shareSlug]/page.tsx   # Public share page UI
components/
  SunnyviewExperience.tsx  # Main app flow
  MapInput.tsx             # Address upload + screenshot calibration
  RoofCanvas.tsx           # Roof tracing + panel rendering
  GlobeView.tsx            # 3D Earth scene
  PanelPacking.ts          # Deterministic packing algorithm
lib/
  api.ts                   # API origin/url helpers
```

## Hackathon judging alignment

- Idea: fast, understandable climate impact estimate for rooftops.
- Implementation: real-time geometry + panel layout + live metrics.
- Design: interactive trace-to-result workflow with visual feedback.
- Presentation: simple demo flow with clear before/after value.

Target tracks:
- Best Hack for Climate Action
- Best Design Hack
- Best Hack for Sustainability in Education
- MLH: Best Use of Gemini API (when explain endpoint is connected)
- MLH: Best Use of ElevenLabs (when TTS endpoint is connected)

## Notes and limitations

- Estimates are directional, not a permit-ready engineering report.
- Accuracy depends on roof trace quality and scale calibration.
- Without an external backend, sharing and AI endpoints are disabled gracefully.

## Acknowledgements

- SF Hacks and MLH
- CesiumJS
- Esri World Imagery
- OpenStreetMap contributors
- Next.js and React ecosystem
