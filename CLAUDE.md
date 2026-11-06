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

- **Pre-release compatibility policy.** Backward compatibility is not required.
  Prefer one coherent current schema/API; remove obsolete compatibility code
  rather than adding old-format adapters or migration frameworks. Preserve
  current save/load/export, JSON/Yjs parity, undo/cancel and collaboration.
  Never delete/reset user files or uncommitted work; report breaking changes
  explicitly and keep cleanup within the assigned scope.
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

- `src/store/presentationStore.ts` (~2200 lines) — all mutations, both paths.
- `src/components/presenter/presenterUtils.tsx` (~830) — playback rendering.
- `src/utils/animation/interpolation.ts` — easing/interpolation engine.
- `src/utils/text/textLayout.ts`, `src/utils/paths/pathShapes.ts` — text/path geometry.
- `src/collab/ySchema.ts` — JSON ⇄ Y.Doc schema (tests in `ySchema.test.ts`).
- `src/types/presentation.ts` — the whole data model.

## Layout of `src/utils`

Grouped by domain; a module lives with the things it shares a vocabulary with.
Tests sit next to the module they cover.

| directory | what belongs there |
| --- | --- |
| `animation/` | easing catalogues, the interpolation engine, per-effect builders |
| `geometry/` | coordinate spaces, sizing, the transforms between them |
| `paths/` | path and shape outline geometry, connectors |
| `snapping/` | snap targets and alignment guides |
| `text/` | text layout, glyph outlines, LaTeX |
| `paint/` | colour, fill styles, stroke coverage |
| `model/` | presentation-data operations: factories, cleanup, cross-slide edits |
| `io/` | import, export, storage — anything crossing the process boundary |
| `editor/` | interaction plumbing and property-panel metadata |

`constants.ts` and `idGenerator.ts` stay at the root: universal leaves with no
domain. To move modules between domains, edit the map in
`scripts/restructure-utils.mjs` and re-run it — it rewrites every importer,
including `vi.mock()` paths, and refuses to run on a dirty tree. It also fails
if a module is unassigned, so the map cannot silently fall behind.

**`src/utils` has importers that no type-checker sees.** `tsconfig.app.json`
includes only `src`, `tsconfig.node.json` only `vite.config.ts`, and eslint
lints only `**/*.{ts,tsx}` — so `server/*.js` is outside tsc, vitest and lint
alike while importing `src/utils` and `src/collab` directly. A stale specifier
there shows up only as a backend that will not boot, which the editor reports as
"Server unavailable" / "Failed to fetch". `scripts/normalize-curated-icons.mjs`
is a second such importer: it *writes* a file into `src/utils`, so its output
path and the import depth inside the text it emits both have to track the
layout. `tests/module-resolution.test.ts` is the guard — it resolves every
relative specifier under `src`, `tests`, `scripts` and `server`, which also
catches stale `vi.mock()` paths (those fail silently: the mock stops applying
and the real module loads).

## Example decks and the regression deck

- `examples/*.json` — the feature highlight reel, generated by
  `npm run build:examples` from `scripts/build-examples.ts`. Never hand-edit
  them; change the generator and re-run. `tests/examples.test.ts` enforces that
  the committed files match the generator, **and** that between them the decks
  demonstrate every `EasingType`, `TransitionGroup`, `ShapeType`,
  `ArrowheadType`, `PathCurve`, `StrokeStyle` and `FillStyle`. Adding a value to
  one of those unions fails `tsc -b` until it is listed and fails the suite
  until a deck actually uses it.
- `tests/fixtures/gpis-53-slides.json` — a real 53-slide talk (1330 elements,
  134 objects) with image pixels replaced by 1×1 placeholders and every
  coordinate intact. `tests/gpis-deck.test.ts` checks it against the current
  schema, verifies referential integrity, and walks every keyframe pair through
  the interpolator looking for NaN. If the schema changes, this fails first —
  re-export the deck and rebuild the fixture rather than loosening assertions.

## Backlog

`BACKLOG.md` is the work queue. New requests go at the top of **Queued**;
verified defects cite file and line so a later session can confirm they are
still real before acting.
