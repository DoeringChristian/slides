# CLAUDE.md — working notes for AI-assisted sessions

## Data model in three sentences

A `Presentation` holds `slides` (each with `elements: Record<id, SlideElement>`
and an `elementOrder`), and slides act as **animation keyframes**: an element
keeps the same `id` across slides, and playback interpolates its properties
from the previous slide to the current one. Each element carries optional
`transitions: PropertyTransitions` — an `EasingType` per property group
(position, size, fill, visibility, content, controlPoints, …) plus per-easing
options — evaluated in `src/utils/interpolation.ts` and rendered by
`src/components/presenter/presenterUtils.tsx`. Everything is defined in
`src/types/presentation.ts`; read it first.

## Rules

- **Dual-path store rule.** Every mutating action in
  `src/store/presentationStore.ts` writes to Yjs (via `getActiveDoc()` /
  `runInTxn`) when a collab doc is active, and to plain JSON state otherwise.
  Any new action MUST implement both paths and keep them semantically
  equivalent, using the builders/helpers in `src/collab/ySchema.ts`
  (`elementToYMap`, `slideToYMap`, `getYSlide`, `applyChangesToYElement`,
  `yArrayReplaceAll`, …). A JSON-only action silently breaks collab sessions.
- **Shared-renderer rule.** The editor canvas, presenter, animation previews,
  and exports all draw through the same leaf renderers — `RenderShape` /
  `RenderImage` in `src/components/svg/ElementRenderer.tsx`, `SVGTextPaths`,
  `RenderPaths`. Never fork or reimplement them for a new context; instead
  pass a **modified element** (interpolated values, `_writeFx` hints) into the
  shared renderer. Export code must consume the shared helpers
  (`strokeDashFor`, `shapeToPath`/`shapeToSvgPaths`, `pathD`, …), not
  re-derive geometry.
- **Standalone-template rule.** HTML export fetches prebuilt templates
  (`standalone-template.html`, `viewer-template.html`) produced by
  `npm run build:all`, which copies them into `dist/`. If templates go stale,
  exports ship an old player. The pre-push hook (`.githooks/pre-push`) runs
  `build:all` to enforce freshness — don't work around it; rebuild instead.
- **Drawing tools reset to select** after committing a shape. This is a
  deliberate UX decision (previously reversed by the user) — do not make
  tools sticky.

## Commands

- `npm run dev` — Vite dev server; auto-spawns the backend on :3001.
- `npm run build` — editor build (tsc -b + vite).
- `npm run build:all` — all three targets + template copy into `dist/`.
- `npm run lint` — eslint.
- `npx vitest run` — unit tests.

## Where to read first (largest / most central files)

- `src/store/presentationStore.ts` (~2000 lines) — all mutations, both paths.
- `src/components/presenter/presenterUtils.tsx` (~830) — playback rendering.
- `src/utils/interpolation.ts` (~760) — easing/interpolation engine.
- `src/utils/textLayout.ts`, `src/utils/pathShapes.ts` — text/path geometry.
- `src/collab/ySchema.ts` — JSON ⇄ Y.Doc schema (tests in `ySchema.test.ts`).
- `src/types/presentation.ts` — the whole data model.
