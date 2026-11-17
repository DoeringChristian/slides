/**
 * Moves `src/utils`'s flat module list into domain subdirectories and rewrites
 * every relative import in the repo to match.
 *
 *   node scripts/restructure-utils.mjs --dry-run    # print the plan, touch nothing
 *   node scripts/restructure-utils.mjs              # do it
 *
 * Imports are rewritten by *resolving* each relative specifier to a file, then
 * recomputing the specifier from the importer's new location — not by string
 * substitution. So a module that moves alongside its neighbour keeps writing
 * `./neighbour`, and one that moves away gets `../other-domain/neighbour`
 * automatically.
 *
 * This needs exclusive access to the working tree: it touches most files under
 * `src/`. Make sure no other agent or editor is mid-write, and that the tree is
 * committed or snapshotted first — the script refuses to run on a dirty tree
 * unless you pass `--allow-dirty`.
 *
 * `constants.ts` and `idGenerator.ts` deliberately stay at the `utils/` root:
 * they are universal leaves with no domain of their own, and pinning them
 * avoids churning nearly every file in the repo for no gain.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const UTILS = join(ROOT, 'src', 'utils');
const DRY = process.argv.includes('--dry-run');
const ALLOW_DIRTY = process.argv.includes('--allow-dirty');

/** Domain → the modules that belong to it. Every non-test module in
 *  `src/utils` must appear here exactly once, or the script refuses to run. */
const DOMAINS = {
  // Playback: easing catalogues, the interpolation engine, per-effect builders.
  animation: [
    'interpolation', 'easingCatalog', 'stickyEasings', 'transitionProperties',
    'closingBirthCohorts', 'roundedClosingBirth',
    'presenterAdvance', 'morphGeometry', 'pathInterpolation',
  ],
  // Coordinate spaces, sizing and the transforms between them.
  geometry: [
    'geometry', 'vectorGeometry', 'resizeGeometry', 'centeredPathResize',
    'screenSpace', 'shapeVisualBounds', 'cornerRadiusControl',
    'elementTranslation', 'freeTextResize', 'marginLayouts', 'canvasViewport',
  ],
  // Path and shape outline geometry.
  paths: [
    'pathShapes', 'shapeToPath', 'pathEditing', 'bsplineExtension',
    'nativePathSpans', 'nativeStrokePlan', 'autoDraw', 'joinPaths',
    'connectorUtils',
  ],
  // Snap targets and guides.
  snapping: ['pathSnapping', 'dotSnapping', 'snapViewport', 'textFlowSnap'],
  // Text layout, glyph outlines, LaTeX.
  text: [
    'textLayout', 'textAutoFit', 'textHitTest', 'textHoverOwner',
    'textEditorSelection', 'boundTextLayout', 'glyphPaths', 'latexUtils',
    'userTextSizing',
  ],
  // Colour and fill rendering.
  paint: [
    'paintColor', 'quickPaintColors', 'shapeFill', 'shapePaint',
    'canvasStrokeCoverage', 'weightedStrokeCoverage',
  ],
  // Presentation-data operations: factories, cleanup, cross-slide edits.
  model: [
    'cropRegions',
    'slideFactory', 'presentationCleanup', 'currentPresentation', 'multiSlide',
    'mergeObjects', 'objectGroups', 'objectListTree', 'objectSelection',
    'groupCrop', 'groupTransfer', 'mirrorOperation', 'slideGroupEditing',
    'syncDependents', 'legacyPresentation',
  ],
  // Everything that crosses the process boundary: files, exports, storage.
  io: [
    'exportImage', 'exportOdp', 'exportPdf', 'exportPptx',
    'exportStandaloneHtml', 'svgRenderer', 'embedResources',
    'thumbnailGenerator', 'officeShape', 'importOdp', 'importPptx',
    'importPresentation', 'storageClient', 'vaultStorage', 'projectFiles',
    'fileHash', 'standaloneBoot', 'editorLocation', 'importSvg', 'svgPathData',
  ],
  // Interaction plumbing and property-panel metadata.
  editor: [
    'scrub', 'scrubMutation', 'gestureProjection', 'keyboard',
    'selectionProperties', 'propertyFields', 'userShapeCreation',
    'curatedIcons', 'imageUtils', 'commentTarget', 'marqueeSelection',
  ],
};

/** Behaviour tests in `src/utils` with no same-named module — they test a
 *  feature rather than a file, so they need their domain stated explicitly. */
const TEST_DOMAINS = {
  animation: ['closingStrokeBirth', 'interiorPathInterpolation', 'pathExtend'],
  paths: [
    'aimBinding', 'connectorDocking', 'connectorTargetOwnership',
    'pathArrowGeometry', 'pathClosure', 'roundedPathClosure',
  ],
  snapping: ['connectorSnapping', 'shiftCombinedSnapping'],
  paint: ['paintParity', 'shapeStyle', 'terminalStrokeConsumers'],
  io: ['nativeSettingsRoundtrip'],
  editor: ['canvasPolish'],
};

/** Stay at `src/utils/` root. */
const PINNED = new Set(['constants', 'idGenerator']);

const SOURCE_EXT = ['.ts', '.tsx', '.mjs', '.js'];
const isSource = (f) => SOURCE_EXT.some((e) => f.endsWith(e));

// ── build the move plan ─────────────────────────────────────────────────────

/** module base name → domain */
const domainOf = new Map();
for (const [domain, modules] of Object.entries({ ...DOMAINS })) {
  for (const m of modules) {
    if (domainOf.has(m)) throw new Error(`"${m}" is listed in two domains`);
    domainOf.set(m, domain);
  }
}
// Test-only names resolve the same way but are not expected to have a module.
const moduleNames = new Set(domainOf.keys());
for (const [domain, names] of Object.entries(TEST_DOMAINS)) {
  for (const n of names) {
    if (domainOf.has(n)) throw new Error(`"${n}" is both a module and a test-only name`);
    domainOf.set(n, domain);
  }
}

const utilsFiles = readdirSync(UTILS).filter((f) => statSync(join(UTILS, f)).isFile());

/** The module a file belongs to. Handles `foo.ts`, `foo.test.ts` and
 *  qualifier tests like `foo.someAspect.test.ts`, which belong with `foo`. */
function baseOf(f) {
  const stem = f.replace(/\.(test|browser)\.tsx?$/, '').replace(/\.tsx?$/, '');
  if (domainOf.has(stem) || PINNED.has(stem)) return stem;
  const prefix = stem.split('.')[0];
  return domainOf.has(prefix) || PINNED.has(prefix) ? prefix : stem;
}

const unassigned = [...new Set(utilsFiles.filter(isSource).map(baseOf))]
  .filter((b) => !domainOf.has(b) && !PINNED.has(b));
if (unassigned.length) {
  console.error(`These modules in src/utils are not assigned to a domain:\n  ${unassigned.join('\n  ')}`);
  console.error('\nAdd each to DOMAINS (or PINNED) in this script, then re-run.');
  process.exit(1);
}
const stale = [...domainOf.keys()].filter((b) => !utilsFiles.some((f) => baseOf(f) === b));
if (stale.length) {
  console.error(`DOMAINS lists modules that no longer exist:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}

/** old absolute path → new absolute path, for every file that moves. */
const moves = new Map();
for (const f of utilsFiles) {
  const domain = domainOf.get(baseOf(f));
  if (!domain) continue;                       // pinned, or LUCIDE-LICENSE.txt
  moves.set(join(UTILS, f), join(UTILS, domain, f));
}

// ── import rewriting ────────────────────────────────────────────────────────

/** Every source file in the repo that could import from utils. */
const SKIP_DIRS = new Set(['node_modules', 'data', 'dist', 'dist-standalone', 'dist-standalone-viewer']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (isSource(entry.name)) out.push(p);
  }
  return out;
}

// `server/` matters even though it is plain JS outside tsconfig: `server/yws.js`
// imports `src/utils` directly, and nothing in tsc/vitest/lint resolves it, so a
// stale specifier there is invisible until the backend fails to boot.
// SOURCE_ROOTS must cover every directory that can reach utils.
const SOURCE_ROOTS = ['src', 'tests', 'scripts', 'server'];
const allSources = SOURCE_ROOTS.flatMap((d) => walk(join(ROOT, d)));

/** Where a file lives after the move. */
const newPath = (abs) => moves.get(abs) ?? abs;

/** Resolve a relative specifier from `fromDir` to an actual file on disk. */
function resolveSpec(fromDir, spec) {
  const base = resolve(fromDir, spec);
  for (const candidate of [base, ...SOURCE_EXT.map((e) => base + e), ...SOURCE_EXT.map((e) => join(base, `index${e}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Specifier from `fromFile`'s new location to `targetFile`'s new location,
 *  keeping the original's extension convention (TS imports are extensionless,
 *  `.mjs` imports are not). */
function specFor(fromFileNew, targetFileNew, hadExtension) {
  let rel = relative(dirname(fromFileNew), targetFileNew).split('\\').join('/');
  if (!hadExtension) rel = rel.replace(/\.(tsx?|mjs|js)$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Every construct that carries a module specifier. `vi.mock` and friends are
 *  easy to forget and fail silently when missed: a stale mock path simply
 *  stops applying, and the real module loads instead. */
const IMPORT_RE = new RegExp(
  '(' + [
    '\\bfrom\\s*',
    '\\bimport\\s*\\(\\s*',
    '\\brequire\\s*\\(\\s*',
    '\\bimport\\s+',
    '\\bvi\\s*\\.\\s*(?:mock|doMock|unmock|importActual|importMock)\\s*\\(\\s*',
    '\\bimport\\s*\\.\\s*meta\\s*\\.\\s*glob\\s*\\(\\s*',
    '\\bnew\\s+URL\\s*\\(\\s*',
  ].join('|') + ')' + '([\'"])(\\.[^\'"]*)\\2',
  'g',
);

const edits = [];
for (const file of allSources) {
  const before = readFileSync(file, 'utf8');
  const fileNew = newPath(file);
  const after = before.replace(IMPORT_RE, (match, lead, quote, spec) => {
    const target = resolveSpec(dirname(file), spec);
    if (!target) return match;                          // leave anything unresolvable alone
    const targetNew = newPath(target);
    if (targetNew === target && fileNew === file) return match;   // neither end moved
    const hadExtension = /\.(tsx?|mjs|js)$/.test(spec);
    return `${lead}${quote}${specFor(fileNew, targetNew, hadExtension)}${quote}`;
  });
  if (after !== before) edits.push({ file, fileNew, after });
}

// ── report / apply ──────────────────────────────────────────────────────────

const byDomain = Object.fromEntries(Object.keys(DOMAINS).map((d) => [d, 0]));
for (const to of moves.values()) byDomain[relative(UTILS, dirname(to))]++;

console.log(`src/utils: ${utilsFiles.length} files -> ${Object.keys(DOMAINS).length} domains + ${PINNED.size} pinned at root\n`);
for (const [domain, n] of Object.entries(byDomain)) {
  const modules = DOMAINS[domain].length;
  console.log(`  ${domain.padEnd(10)} ${String(modules).padStart(2)} modules  (${n} files incl. tests)`);
}
console.log(`\n${moves.size} files move, ${edits.length} files have imports rewritten.`);

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (dirty && !ALLOW_DIRTY) {
  console.error('\nWorking tree is dirty. Commit or stash first, or pass --allow-dirty if');
  console.error('you have snapshotted it and know no other process is writing to it.');
  process.exit(1);
}

for (const [from, to] of moves) {
  if (!existsSync(dirname(to))) execFileSync('mkdir', ['-p', dirname(to)], { cwd: ROOT });
  // `git mv` keeps rename detection clean so the diff reads as a move.
  try {
    execFileSync('git', ['mv', relative(ROOT, from), relative(ROOT, to)], { cwd: ROOT });
  } catch {
    execFileSync('mv', [relative(ROOT, from), relative(ROOT, to)], { cwd: ROOT }); // untracked file
  }
}
for (const { fileNew, after } of edits) writeFileSync(fileNew, after);

console.log('\nDone. Now run: npx tsc -b && npx vitest run && npm run lint');
