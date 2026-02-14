# Sunnyview

Sunnyview is a fast rooftop solar feasibility demo built for SF Hacks 2026.
In about 30 seconds, a user can trace a roof and get quick panel, energy, and CO2 estimates.

## What is in this repo

- Next.js frontend demo app (App Router)
- Deterministic panel-packing logic
- Local API routes implemented here:
  - `/api/geocode`
  - `/api/static-map`

## External dependencies (not implemented in this repo)

These routes require a separate backend service and are optional integrations:

- `POST /api/projects`
- `PATCH /api/projects/:id`
- `POST /api/estimate`
- `POST /api/segment`
- `POST /api/explain`
- `POST /api/tts`
- `GET /s/:shareSlug`

If those endpoints are missing, the app still runs in local demo mode with fallbacks.

## Quick start

Requirements: Node.js 20+ and npm.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Optional `.env.local` values:

```bash
# External backend for share/estimate/AI routes
NEXT_PUBLIC_API_ORIGIN=http://localhost:3001

# Optional Cesium ion imagery
NEXT_PUBLIC_CESIUM_ION_TOKEN=

# Optional legacy components only
NEXT_PUBLIC_MAPBOX_TOKEN=

# Optional local Gemini route (`POST /api/panel-recommend`)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

## How to use

1. Launch the demo.
2. Search for the house address.
3. Trace the roof polygon.
4. Adjust assumptions.
5. Review panel count, DC kW, annual kWh, and annual CO2.
6. Use Share/Explain/TTS only when external backend routes are connected.

## Scripts

- `npm run dev` - start development server
- `npm run build` - build production bundle
- `npm run start` - run production server
- `npm run lint` - run ESLint

Recommended verification:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Notes

- Estimates are directional, not permit-ready engineering output.
- Accuracy depends on roof tracing quality and scale calibration.
