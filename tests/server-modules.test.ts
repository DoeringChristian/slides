import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * The backend (server/*.js) imports editor modules from src/ directly and
 * runs them in plain Node — no Vite. Everything else in this suite runs
 * through Vite, which loads fonts, CSS and other assets, so a module that
 * (transitively) imports one passes every test and then stops the backend
 * from starting ("Server unavailable"). This loads each src module the
 * server imports exactly as the server does: `node --import tsx`.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(root, 'server');

const serverImports = [...new Set(readdirSync(serverDir).filter(f => f.endsWith('.js')).flatMap(f =>
  [...readFileSync(join(serverDir, f), 'utf8').matchAll(/from\s+['"](\.\.\/src\/[^'"]+)['"]/g)].map(m => m[1])))].sort();

describe('modules the backend imports load in plain Node', () => {
  it('finds the backend\'s src imports', () => {
    expect(serverImports.length).toBeGreaterThan(0);
  });
  it.each(serverImports)('%s', (spec) => {
    const run = () => execFileSync(process.execPath, ['--import', 'tsx', '-e', `await import(${JSON.stringify(spec)})`],
      { cwd: serverDir, stdio: 'pipe', encoding: 'utf8', timeout: 60_000 });
    expect(run).not.toThrow();
  }, 90_000);
});
