# Backlog

Queue of future work. Newest requests go at the top of **Queued**; move items to
**In progress** when started and delete them when done (git history is the record).

Verified-with-evidence items cite the file and line where the defect lives, so a
later session can confirm the item is still real before acting on it.

## Queued

### 20 browser suites fail on the released code
The canvas fixture loaded `src/utils` modules by pre-restructure paths, so every
canvas browser suite failed on import and nothing noticed they had drifted. With
the paths fixed (and `tests/module-resolution.test.ts` now checking them), 20 of
56 suites still fail — identically on v0.4.0, so they predate it: aim-binding,
arrow-junction, arrow-pinning-corrections, arrow-pinning-regression, canvas,
canvas-modifiers, color-swatches, gesture-action-bar, icon-click-placement,
icons-creation, import-export, path-closure, path-move-marker, radius-finite-leg,
radius-guide-corrections, rounded-path-closure, shape-style, stabilization,
terminal-stroke-consumers, ui-reference. Most fail on a missing DOM element (a UI
the test expected has changed); a few on geometry/pixel tolerances. Triage each:
fix the test where the UI legitimately changed, the code where it regressed.
Run: `BROWSER_GATE_EVIDENCE=/abs/dir node tests/browser-gate.mjs <suite>`.

### Underline alone does not redraw text
`SVGTextPaths` re-lays out when `style.textDecoration` changes (it is in the
layout `useMemo` deps), but its `memo` comparator never compares it, so the
component does not re-render for a decoration-only change.
`src/components/svg/SVGTextPaths.tsx:87` (deps) vs the comparator below it.

### LLM integration, with rich embedded displays
The in-browser assistant (bring-your-own key, deck tools, one-step undo) is
built — see `docs/agent-editing.md` for it and its next phases (annotations,
OpenAI-compatible adapter, `write_slide`). What remains here is widening what it can author: beyond text and
shapes, an element type that hosts a **rich display** — raw HTML, a Three.js /
WebGL scene, a canvas sketch — so a generated slide can carry an interactive or
3D figure rather than a picture of one.

Open questions for whoever picks this up:
- **Element model.** A new `SlideElement` variant (`html` / `scene`) in
  `src/types/presentation.ts`, with its own `ySchema` field set and a
  `presenterUtils` dispatch branch. Keyframe interpolation needs a story: these
  have no outline to morph, so position/size/opacity lerp and the payload
  snaps — decide where the snap happens (t=0.5, like `shapeType`).
- **The shared-renderer rule cuts hard here.** The editor canvas, presenter,
  previews and exports all draw through the same leaf renderers, and an
  `<iframe>` or a WebGL canvas does not live inside an `<svg>` the way a path
  does. Either it renders as a foreignObject the exporters can rasterise, or
  exports get a baked still — that choice decides whether PDF/PPTX export stays
  honest.
- **Untrusted code.** LLM-authored HTML and JS is untrusted by construction, so
  it needs a sandbox (sandboxed iframe, no same-origin, no network) in the
  editor, the presenter AND the standalone export, where there is no server to
  mediate. Decide this before any of it ships.
- **Export size.** A Three.js scene means shipping a renderer into the
  standalone template; the editable export is already ~42 MB.

### `GET /api/projects` ignores ownership when unidentified
Every other project route derives the caller from `X-Slides-User` and refuses
what it does not own (`/api/projects/:id` answers 403). The list route instead
falls back to *all* projects when the header is absent or malformed:
`userId ? listProjects({ ownerId: userId }) : listProjects()`. So an
unidentified request gets every owner's id, title and thumbnail. Since project
ids are the only capability in this design, handing them out is equivalent to
granting read access to every deck on the server.

Verified with `curl http://localhost:3001/api/projects` (no header): 33
projects including other owners' entries, where the editor's identified request
sees 26. Local-only server with no auth model, so not urgent — but the
inconsistency with the 403 on `:id` looks unintended. Options: return `[]` when
unidentified, or require the header on the list route.
`server/index.js:23` (`userIdOf`), `server/index.js:35-44`

### Non-atomic index write can lose every deck at once
`saveIndex` is a bare `fs.writeFile` over `_index.json`, which is ~800 KB
because it embeds a base64 PNG thumbnail per project. One interrupted write
truncates the whole project list. Needs write-to-temp + `rename`, and the
thumbnails probably belong in their own files rather than the hot index.
`server/storage.js:37` (same pattern in `server/shares.js`)

### Browser tests can be aimed at the real deck store
`tests/isolated-backend.mjs:25` asserts its data dir is never `server/data`.
`tests/html-style-roundtrip.browser.mjs:10` takes `process.env.IMPORT_TEST_SERVER`
with no such guard, and `tests/import-export.browser.mjs` hits `/api/` without
`isolatedBackend` at all — so pointing either at the dev server writes into
real decks. Add the same assertion to every backend-touching test.

### No automated gate in CI
`.github/workflows/deploy.yml` runs `npm ci` → `build:all` → deploy and nothing
else. `tsc -b`, `vitest run` (1614 tests, under 2 s) and `eslint` are all green
and all absent. The 38-case browser gate (`tests/BROWSER_GATE.md`) is
self-contained but nothing invokes it either.

### Dual-path tests missing for five mutating actions
`updateAcrossSlides`, `syncElementsToSlides`, `joinPaths`, `setGroupCrop`,
`moveElements` have no entry in any `*.dualpath.test.ts` table. `updateAcrossSlides` is the central write funnel (8 call sites) and
syncs `elementOrder` to Yjs only when its *length* changed
(`src/store/presentationStore.ts:1233`), so a same-length reorder through that
path would not reach collaborators.

## Never started (design only)

- **Adjustable shape system** — chamfered rects, rings, cylinders, pie/arc, with
  typed persisted parameters and a shared preview picker.
- **Elbow arrows** — 90° orthogonal routing that re-routes when either end moves.
- **Infinite-canvas camera** — pan/zoom beyond the slide bounds.

## Known-imperfect, deliberately shipped

- Rounded closing-stroke birth pops a seam corner on closed rounded polygons;
  filled closed polygons sweep as a wedge under `create`.
- B-spline interior control points drift (~77 units) through a morph; there is
  no persisted vertex lineage to anchor them.
- Closed ↔ open topology changes are not animated.
- Weighted stroke coverage is live but unvalidated against a reference raster.
