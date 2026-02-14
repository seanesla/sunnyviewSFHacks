# AGENTS Instructions

These instructions apply to all work in this repository. Use them as the first source of guidance, then align with file-local conventions when they do not conflict.

## Scope and priority

- Scope: entire repo at `.` (Sunnyview root).
- This file is top-level guidance for code generation, review, and refactoring.
- If later a local rule file appears (`.cursor/rules`, `.cursorrules`, `.github/copilot-instructions.md`), that file must be checked first and supersedes these instructions where conflicting.
- Do not run destructive git commands unless explicitly requested.

## Current repo status

- No `AGENTS.md` existed before this file.
- No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` files are present at this time.
- There is no formal unit/e2e test script currently defined in `package.json`.

## Build and verification commands

- `npm install` / `pnpm install`
  - Install dependencies.
- `npm run dev`
  - Run development server. Uses webpack mode for Cesium (`--webpack`).
- `npm run build`
  - Build production bundle (`next build --webpack`).
- `npm run start`
  - Start production server from `.next` output.
- `npm run lint`
  - Run ESLint across project files.
- `npx tsc --noEmit`
  - Optional explicit TypeScript check matching current `tsconfig` settings.
- Single-file verification command (test-like target)
  - `npx eslint components/PanelPacking.ts`
  - Use this when making focused algorithm or helper changes to validate one file quickly.

If lint/build fails, fix before committing.

## No formal tests yet

- There is no `npm test`, `vitest`, `jest`, `playwright`, or `cypress` setup configured right now.
- Treat `npm run lint` and `npx tsc --noEmit` as the minimum quality gate for now.
- For risky work, run the single-file command first, then full lint/build.

## Project architecture overview

- App Router is used (`app/`).
- Main user flow is orchestrated by `components/SunnyviewExperience.tsx` with three main phases: `landing`, `opening`, and `app`.
- Main visual components:
  - `components/GlobeView.tsx`
  - `components/MapInput.tsx`
  - `components/RoofCanvas.tsx`
- Algorithm files:
  - `components/PanelPacking.ts`
- UI panels and metrics:
  - `components/dashboard.tsx`
  - `components/metrics-panel.tsx`
  - `components/hero-section.tsx`
- Shared utility and API modules:
  - `lib/api.ts`
  - `lib/utils.ts`
  - `hooks/use-toast.ts`, `hooks/use-mobile.ts`

## TypeScript and code style

- Use TypeScript in new/modified code unless there is a strong reason not to.
- Respect `strict: true` typing in `tsconfig.json`.
- Prefer explicit type annotations on exported function parameters and return values.
- Avoid `any`. If unavoidable, add a brief comment explaining why.
- Use discriminated unions or string literal unions for known finite states.
- Keep domain terms consistent (`polygon`, `panel`, `estimate`, `project`, `roof` terminology).

## Imports and formatting

- Prefer path alias imports from `@/*` for local files.
- Suggested order:
  1. React/Next imports
  2. Third-party libs
  3. Internal modules (`@/`)
  4. Types/constants/config
- Keep files small and focused; extract helper functions when component logic gets long.
- Avoid duplicated utility logic across files; centralize in `lib/` where reusable.
- One consistent quote style per file is acceptable; keep it coherent.

## React and client/server boundaries

- If a component uses browser APIs, hooks, event handlers, state, or refs, add `"use client"`.
- Keep server-only logic (fetching env variables, route-level logic) in server components or API routes.
- Keep rendering pure where possible; move heavy calculations into utility functions.
- Do not mix unrelated state changes in one `setState` call block if sequential consistency matters.

## Error handling

- Use `try/catch` around async operations.
- Convert recoverable errors to user-visible UI state instead of silent failures.
- For background/calculation failures, show clear fallback values, especially in estimate panels.
- Avoid throwing generic strings; throw typed `Error` objects with actionable messages.

## Geometry and simulation edits

- Preserve coordinate-space correctness when editing map and canvas logic.
- If editing conversions (pixel/meters, lat/lng, bearings), keep helper functions near usage and add explicit helper names.
- When updating panel packing logic, prioritize deterministic outputs for the same input.
- Keep algorithm inputs immutable where possible to avoid hidden side effects.

## API and data patterns

- API contract changes must stay aligned with route expectations.
- Keep client-side calls in `lib/api.ts` centralized rather than scattering fetch calls.
- Validate external or user-supplied input with schema checks where practical.
- Redact and avoid logging secret values or full tokens.

## Environment and config

- `NEXT_PUBLIC_MAPBOX_TOKEN` is required for map tiles.
- Keep `.env` files local and untracked.
- If adding new environment variables, document them here and in relevant files.

## Testing and review habits

- Before finishing a change, run:
  1) `npm run lint`
  2) `npm run build`
- If change is in algorithmic code, also run single-file lint command first.
- PR description should include what changed, why it changed, and verification commands used.

## PR and task discipline

- Make minimal, targeted changes; avoid broad refactors unless requested.
- Keep file-level scope tight.
- Do not edit unrelated formatting on untouched files.
- Prefer small helper refactors over monolithic rewrites.

## If uncertain

- Ask for the intended behavior for user-facing flows before changing formulas, heuristics, or UX defaults.
- Keep changes backwards compatible where possible.
