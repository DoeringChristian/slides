# Slides

A browser-based presentation editor where slides act as **animation keyframes**.
Elements keep the same `id` across slides; during playback the presenter
interpolates every property (position, size, color, control points, text, …)
between one slide and the next, so a deck behaves like a manim-style animation
timeline that you edit as ordinary slides.

## Features

- **Keyframe model** — duplicating a slide copies its elements *as keyframes*;
  move or restyle them on the copy and the transition animates the difference.
  Per-element, per-property-group easings (`position`, `size`, `fill`,
  `visibility`, `content`, `controlPoints`, …) chosen in the properties panel.
- **Animation easings** — besides `linear`/`ease`/`const`: `write` (manim-style
  pen-draw of text), `create` (outline trace + fill of shapes, optional
  tip-riding arrowhead), `typewriter`, `fadebyglyph`, `wipe`, `slidein`,
  `grow`, `iris`, `dissolve`, plus group-level stagger (`lagRatio`).
- **Drawing tools** — rect, ellipse, triangle, star, and a unified `path` shape
  covering lines, arrows, polylines, polygons and quadratic/cubic B-splines,
  with solid/dashed/dotted strokes, arrowheads, and connector bindings that
  re-anchor when the bound element moves. Tools drop back to *select* after
  each committed shape (deliberate UX choice).
- **Text, LaTeX and Markdown as real vector outlines** — text is laid out and
  converted to SVG glyph paths (opentype.js); LaTeX runs through MathJax to
  SVG. Because everything is paths, glyph-level animations (write/typewriter)
  and single-file exports need no fonts at view time.
- **Presenter mode** — presenter view with speaker notes and controls, plus a
  separate audience window; slide transitions are rendered by interpolating the
  keyframes live.
- **Realtime collaboration** — Yjs documents synced over a WebSocket endpoint
  with LevelDB persistence on the server, awareness (peer cursors/selections),
  collaborative undo, and share tokens for read access.
- **Import** — PPTX, ODP, and PDF (each PDF page becomes a slide image).
- **Export** — single-file HTML (viewer-only or full standalone editor), PDF,
  PNG, PPTX, ODP.
- **PWA** — the editor build registers a service worker and is installable;
  single-file exports deliberately do not (they are opened from `file://`).

## Getting started

```sh
npm install        # also patches mathjax and sets core.hooksPath to .githooks
npm run dev
```

`npm run dev` starts the Vite dev server and **auto-spawns the backend**
(Express + WebSocket, port 3001) via a Vite plugin — no second terminal
needed. The backend stores projects, share tokens and Yjs docs under
`server/data/` (gitignored; recreated automatically on boot).

To use the "export standalone HTML" feature in dev, build the templates once:

```sh
npm run build:standalone && npm run build:viewer
```

## Build targets

Three flavours, three Vite configs:

| Target | Config | Output |
|---|---|---|
| Editor (PWA, GitHub Pages) | `vite.config.ts` | `dist/` |
| Single-file viewer template | `vite.config.viewer.ts` | `dist-standalone-viewer/viewer.html` |
| Single-file standalone editor | `vite.config.standalone.ts` | `dist-standalone/index.html` |

`npm run build:all` builds all three and copies the two single-file templates
into `dist/` as `standalone-template.html` / `viewer-template.html`. The
exporter **fetches these prebuilt templates at runtime** and injects the deck
as a payload — so if the templates are stale, exports ship old player code.
The pre-push git hook (`.githooks/pre-push`, enabled by the postinstall step;
re-enable manually with `git config core.hooksPath .githooks`) runs
`build:all` so stale templates can't be pushed. Set `GIT_HOOKS_SKIP=1` to
bypass it for doc-only pushes.

## Testing & linting

```sh
npx vitest run   # unit tests (e.g. Yjs schema round-trips)
npm run lint     # eslint
npx tsc -b       # typecheck
```

## Architecture

```
src/
  types/presentation.ts   Core data model: Presentation → slides → elements,
                          PropertyTransitions (per-group EasingType + options)
  store/                  Zustand stores
    presentationStore.ts  All document mutations. Every action writes BOTH the
                          plain-JSON state and, when a collab Y.Doc is active,
                          the equivalent Yjs transaction (dual-path rule)
    editorStore.ts        UI state (tool, selection, zoom, presenting)
    vaultStore.ts         Project vault: server storage, IndexedDB, or the
                          File System Access API
  collab/                 Yjs schema (ySchema.ts: JSON ⇄ Y.Doc converters),
                          WebSocket connection, awareness, collaborative undo
  components/
    svg/                  The one true renderer: ElementRenderer (RenderShape /
                          RenderImage), SVGTextPaths, canvas overlays/handles
    presenter/            Presenter + audience views; presenterUtils.tsx drives
                          interpolated playback and the animation wrappers
    properties/, toolbar/, sidebar/, dialogs/, …
  utils/
    interpolation.ts      Keyframe interpolation + easing dispatch
    pathShapes.ts         Path sampling, B-splines, arc-length, arrowheads
    shapeToPath.ts        Shape → SVG path (shared by create-animation, export)
    textLayout.ts, glyphPaths.ts, latexUtils.ts   Text/LaTeX → glyph outlines
    import*.ts / export*.ts                        PPTX/ODP/PDF/HTML/PNG
server/                   Express API (projects, shares) + y-websocket endpoint
                          with LevelDB persistence; spawned by the dev server
```

**Shared-renderer principle:** the editor canvas, the presenter, animation
previews, and the exporters all render elements through the same leaf
renderers in `src/components/svg/`. Animated states are produced by handing
those renderers a *modified element* (interpolated properties, `_writeFx`
hints), never by forking the render code — this keeps editing, playback and
exports pixel-identical.
