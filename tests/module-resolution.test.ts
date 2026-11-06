import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Every relative import in the repo must resolve to a file on disk.
 *
 * Two blind spots make this worth asserting rather than trusting:
 *
 *  - **`server/` is checked by nothing.** `tsconfig.app.json` includes only
 *    `src`, `tsconfig.node.json` only `vite.config.ts`, and eslint only lints
 *    `**\/*.{ts,tsx}` — so `server/*.js` is outside tsc, vitest and lint alike.
 *    It imports `src/utils` and `src/collab` directly, and a stale specifier
 *    there surfaces only as a backend that fails to boot, which the editor
 *    reports as "Server unavailable" / "Failed to fetch".
 *  - **`vi.mock()` paths fail silently.** They are module specifiers, not
 *    imports, so a stale one does not error — the mock simply stops applying
 *    and the real module loads instead.
 *
 * Both classes are what a `src/utils` reorganisation breaks, and both are
 * invisible to the rest of the suite.
 */

const ROOT = resolve(__dirname, '..');
const SOURCE_ROOTS = ['src', 'tests', 'scripts', 'server'];
const SKIP_DIRS = new Set(['node_modules', 'data', 'dist', 'dist-standalone', 'dist-standalone-viewer']);
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Extensions and index forms a bundler will try for a bare specifier. */
const CANDIDATES = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css',
  '/index.ts', '/index.tsx', '/index.js', '/index.mjs',
];

/** Specifier positions that a path reorganisation has to keep in step. */
const SPEC_RE = new RegExp(
  '(?:' + [
    '\\bfrom\\s*',
    '\\bimport\\s*\\(\\s*',
    '\\brequire\\s*\\(\\s*',
    '\\bimport\\s+',
    '\\bvi\\s*\\.\\s*(?:mock|doMock|unmock|importActual|importMock)\\s*\\(\\s*',
    '\\bimport\\s*\\.\\s*meta\\s*\\.\\s*glob\\s*\\(\\s*',
    '\\bnew\\s+URL\\s*\\(\\s*',
  ].join('|') + ')' + '[\'"](\\.[^\'"]*)[\'"]',
  'g',
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (SOURCE_RE.test(entry.name)) out.push(p);
  }
  return out;
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `./foo.ts`, `./foo?raw`, `./foo` — all resolve to the same module. */
function resolves(fromFile: string, spec: string): boolean {
  const bare = spec.replace(/[?#].*$/, '');
  const base = resolve(dirname(fromFile), bare);
  // A `.ts` specifier is written for the bundler; the file may also be `.tsx`.
  const stripped = base.replace(/\.tsx?$/, '');
  return CANDIDATES.some((ext) => isFile(base + ext) || isFile(stripped + ext));
}

const files = SOURCE_ROOTS.flatMap((d) => walk(join(ROOT, d)));

describe('module resolution', () => {
  it('covers the source roots we expect', () => {
    // A root silently dropped from the list would make this suite vacuous.
    expect(files.length).toBeGreaterThan(300);
    for (const root of SOURCE_ROOTS) {
      expect(files.some((f) => f.startsWith(join(ROOT, root) + '/')), `${root}/ has no sources`)
        .toBe(true);
    }
  });

  it('resolves every relative import, require, vi.mock and new URL specifier', () => {
    const broken: string[] = [];
    let checked = 0;

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(SPEC_RE)) {
        const spec = match[1];
        checked++;
        if (resolves(file, spec)) continue;
        const line = src.slice(0, match.index).split('\n').length;
        broken.push(`${relative(ROOT, file)}:${line} -> ${spec}`);
      }
    }

    expect(checked).toBeGreaterThan(500);
    expect(broken, `unresolvable specifiers:\n${broken.join('\n')}`).toEqual([]);
  });
});
