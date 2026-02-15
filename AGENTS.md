# AGENTS.md

Guidelines for agentic coding tools working in this repository.
Use this file by default unless a higher-priority local rule file exists.

## Scope and Rule Priority

- Scope: everything under repository root (`.`).
- Priority order:
  1) direct user instruction
  2) local rule files (`.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`)
  3) this `AGENTS.md`
  4) existing file-level conventions
- Never run destructive git commands unless explicitly requested.

## Local Rule Files (checked)

As of 2026-02-14, these are **not present**:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

If they appear later, they override this file where conflicting.

## Repository Snapshot

- Stack: Next.js 16 (App Router), TypeScript, React 19.
- Lint: ESLint with `eslint-config-next`.
- Unit tests: Vitest (`vitest.config.ts`, `lib/**/*.test.ts`).
- Optional Python service: `services/segmenter/`.
- Import alias: `@/*` maps to project root.

### Implemented local Next.js API routes

- `GET /api/geocode`
- `GET /api/static-map`
- `GET /api/reverse-geocode`
- `POST /api/estimate`
- `POST /api/segment`
- `POST /api/explain`
- `POST /api/tts`
- `GET /api/forecast`
- `POST /api/panel-recommend`
- `POST /api/gemini-validate`

### External backend dependencies (still missing here)

Always label these as external dependencies in docs/PR notes:

- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `GET /s/:shareSlug` JSON endpoint

## Build, Lint, and Test Commands (root)

- Install deps: `npm install` (or `pnpm install`)
- Start dev: `npm run dev`
- Build prod: `npm run build`
- Start prod server: `npm run start`
- Lint all: `npm run lint`
- Type check: `npx tsc --noEmit`
- Run all unit tests: `npm test`
- Test watch mode: `npm run test:watch`

### Single-test commands (important)

- Single Vitest file: `npx vitest run lib/roof-plane.test.ts`
- Single test name: `npx vitest run lib/roof-plane.test.ts -t "splits a footprint into two planes and reduces packing count"`
- Quick file lint: `npx eslint components/PanelPacking.ts`

For `services/segmenter/*` changes (Python), use:
- `python -m unittest discover -s services/segmenter/tests`
- `python -m unittest services.segmenter.tests.test_postprocess.TestPostprocess.test_ring_to_mask`

## Code Style Guidelines

### TypeScript and Types

- Keep `strict` TypeScript compatibility.
- Prefer explicit types for exported params/returns.
- Avoid `any`; use `unknown` plus narrowing.
- Prefer `type` aliases for payloads and API outputs.
- Use literal unions for finite states (example: `"landing" | "opening" | "app"`).
- Keep algorithm inputs immutable unless mutation is required.

### Imports and Modules

- Import order:
  1) React/Next
  2) third-party packages
  3) internal modules from `@/`
  4) type-only imports
- Prefer `@/` for cross-folder imports.
- Use relative imports for same-folder modules when clearer.
- Keep client-only and server-only code clearly separated.

### Formatting and File Hygiene

- Follow the style already used in the file you edit.
- Keep quote style and semicolon style consistent per file.
- Do not reformat unrelated lines.
- Keep functions/helpers focused and readable.
- Prefer clear names over abbreviations.

### Naming Conventions

- React components: PascalCase (`SunnyviewExperience`).
- Hooks: `useXxx` (`useToast`, `useIsMobile`).
- Functions/variables: camelCase.
- Constants: UPPER_SNAKE_CASE.
- Types/interfaces: PascalCase (`EstimateOut`, `PackPanelsParams`).
- Zod schema names: `<Feature>Schema`.

### React and Next.js

- Add `"use client"` when using hooks, refs, event handlers, or browser APIs.
- Keep secrets/API keys in server code only.
- For routes using Node APIs (for example `Buffer`), keep `runtime = "nodejs"`.
- Keep heavy geometry/math logic in `lib/` or pure helper modules.

### API Validation, Errors, and Resilience

- Validate public route input with Zod.
- Use `safeParse`; return `400` with `issues` for invalid input.
- Wrap external calls in `try/catch` with user-safe fallback responses.
- Throw `Error` objects (not strings).
- Use `AbortController` timeouts for upstream calls.
- Preserve existing rate limiting (`requestClientKey` + `takeRateLimitToken`).
- Preserve bounded in-memory cache patterns (`globalThis` maps).
- Keep logs concise; never log secrets/tokens.
- Keep deterministic behavior for panel packing and geometry calculations.

## Environment Variables

Document any new variable in `.env.local.example` and related docs.

- `NEXT_PUBLIC_API_ORIGIN` (optional external backend origin)
- `NEXT_PUBLIC_CESIUM_ION_TOKEN` (optional Cesium token)
- `NEXT_PUBLIC_MAPBOX_TOKEN` (optional legacy/static-map fallback provider)
- `SEGMENT_SERVICE_URL` (optional CV segmenter)
- `SEGMENT_IMAGE_FETCH_ALLOWLIST` (optional fetch hostname allowlist)
- `PVWATTS_API_KEY` (required for live PVWatts; fallback used if missing)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (optional Redis cache)
- `CO2_KG_PER_KWH` (optional CO2 factor override)
- `GEMINI_API_KEY` (optional Gemini routes)
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (optional TTS)

## PR and Change Discipline

- Keep diffs minimal and task-focused.
- Avoid broad refactors unless requested.
- Do not modify unrelated files for formatting only.
- In PR notes include: what changed, why, and exact verification commands.
- If work touches missing backend routes, explicitly mark them as external dependencies.
