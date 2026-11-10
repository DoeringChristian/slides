# Backlog

Queue of future work. Newest requests go at the top of **Queued**; move items to
**In progress** when started and delete them when done (git history is the record).

Verified-with-evidence items cite the file and line where the defect lives, so a
later session can confirm the item is still real before acting on it.

## Queued

### LLM integration, with rich embedded displays
Bring back LLM integration, and widen what it can author: beyond text and
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

### Fonts, including math text
Implement selectable fonts that apply to **math text as well as body text** —
today the LaTeX pipeline renders math in its own fixed face regardless of the
element's font. Include the font used by SIGGRAPH papers (Linux Libertine /
Libertinus, the TeX `newtx`/`libertine` family) as one of the options.

Scope notes for whoever picks this up:
- Text style lives in `TextElement.style` (`src/types/presentation.ts`); layout
  and glyph outlines come from `src/utils/text/textLayout.ts` and
  `src/utils/text/glyphPaths.ts`, math from `src/utils/text/latexUtils.ts`. The
  font has to reach all three or math and prose drift.
- Fonts are embedded for export (`src/assets/fonts`), so each added face costs
  bundle size in the standalone/viewer builds — subset if possible.
- Shared-renderer rule applies: one font resolution path for canvas, presenter,
  previews and exports.

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

### Opacity transitions are never offered
`transitionPropertiesDiffer` rounds every numeric before comparing, so opacity
0.2 → 0.4 compares as `0 !== 0` and the transition row stays hidden. Also
affects `lineHeight` and `cropX/Y/W/H`. Needs per-group epsilon comparison
instead of a blanket `Math.round`.
`src/utils/animation/transitionProperties.ts:104`

### Bound-label mask ignores element opacity
The `_labelMask` `<rect>` is emitted with `fill` but no `opacity`, as a sibling
of the `opacity={opacity}` group — so a fading arrow's label mask stays fully
opaque and punches a solid hole through whatever is behind it.
`src/components/svg/ElementRenderer.tsx:226-232`

### `resetPresentation` has no Yjs branch
Violates the dual-path store rule: it is `set({ presentation: createPresentation() })`
with no `getActiveDoc()` path, and neither caller clears the active doc. In a
collab session "New" leaves the old Y.Doc attached, so the UI shows a blank deck
while mutations keep landing in the previous one.
`src/store/presentationStore.ts:2256`; callers `src/components/layout/Header.tsx:124`,
`src/components/layout/AppLayoutMobile.tsx:242`

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

### Dual-path tests missing for six mutating actions
`updateAcrossSlides`, `syncElementsToSlides`, `joinPaths`, `setGroupCrop`,
`moveElements`, `resetPresentation` have no entry in any `*.dualpath.test.ts`
table. `updateAcrossSlides` is the central write funnel (8 call sites) and
syncs `elementOrder` to Yjs only when its *length* changed
(`src/store/presentationStore.ts:1233`), so a same-length reorder through that
path would not reach collaborators.

### `src/utils` is a flat 93-module directory
No domain boundaries, so call graphs cross freely and nothing stops a new
feature from reaching into geometry internals. A scripted move into domain
subdirectories is prepared — see `scripts/restructure-utils.mjs`. Needs
exclusive access to the working tree (no other agent mid-edit) because it
rewrites every import in `src/`.

### `extend` easing is offered for shapes it cannot animate
`SHAPE_VISIBILITY_TYPES` includes `'extend'` for every shape type, but
`buildExtendFx` returns null unless `shapeType === 'path'` with ≥4 points, so
on a rect or ellipse the picker offers an effect that silently degrades to a
plain opacity ramp. Either gate the picker on `shapeType` or implement extend
for primitives.
`src/utils/animation/easingCatalog.ts:24`, `src/utils/animation/interpolation.ts:839`

### Text vertical alignment still uses the legacy strut
`const baseline = fontSize * 0.8` with `advance = baseline + fontSize * 0.4 * lineHeight`
predates real font metrics being available; it should use the loaded face's
ascent/descent so vertical centring matches what the glyphs actually occupy.
`src/utils/text/textLayout.ts:114`

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
