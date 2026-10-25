import { bounded, stopOwnedChild } from './browser-owned-resources.mjs';
import { matrixRecordCounts } from './browser-matrix-counts.mjs';
import { isolatedBrowser } from './isolated-browser.mjs';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
assert(process.env.BROWSER_GATE_EVIDENCE, 'Set BROWSER_GATE_EVIDENCE to an absolute durable evidence directory');
const evidence = resolve(process.env.BROWSER_GATE_EVIDENCE);
assert(evidence === process.env.BROWSER_GATE_EVIDENCE, 'Evidence directory must be absolute');
await mkdir(evidence, { recursive: true });
const inventory = (await readdir('tests')).filter(f => f.endsWith('.browser.mjs')).sort();
if (args.includes('--list')) { console.log(inventory.join('\n')); process.exit(0); }
const selected = args.length ? args : inventory;
for (const f of selected) assert(inventory.includes(f), `Unknown suite ${f}`);
async function manifest() {
  const files = {};
  async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path);
    else files[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  } }
  for (const dir of ['src', 'tests', 'server', 'dist', 'dist-standalone', 'dist-standalone-viewer']) {
    if (dir === 'server') { for (const f of (await readdir(dir)).filter(f => /\.(js|json)$/.test(f))) files[join(dir,f)] = createHash('sha256').update(await readFile(join(dir,f))).digest('hex'); }
    else await walk(dir);
  }
  for (const f of (await readdir('.')).filter(f => /^(package.*\.json|.*config.*|index\.html|viewer\.html)$/.test(f))) { try { files[f] = createHash('sha256').update(await readFile(f)).digest('hex'); } catch {} }
  return { files };
}
const before = await manifest(); await writeFile(join(evidence, 'manifest.before.json'), JSON.stringify(before, null, 2));
const results = []; let active, child;
process.once('exit', () => child?.kill('SIGKILL'));
async function cleanup() {
  const browser = active, running = child; active = null; child = null;
  const results = await Promise.allSettled([running && stopOwnedChild(running), browser?.close()]);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
  if (errors.length) throw new AggregateError(errors, 'Gate cleanup failed');
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await cleanup(); process.exit(130); });
try {
  for (const file of selected) {
    const dir = join(evidence, file.replace('.browser.mjs', '')); await mkdir(dir, { recursive: true });
    const source = await readFile(join('tests', file), 'utf8');
    const start = Date.now(); let row = { file, status: 'running', passMarkers: 0, timeout: false };
    results.push(row); await writeFile(join(evidence, 'progress.json'), JSON.stringify(results, null, 2));
    try {
      active = await isolatedBrowser(dir, { externalSession: true, persistence: ['import-export.browser.mjs', 'html-style-roundtrip.browser.mjs'].includes(file) });
      await active.navigate('/tests/canvas-fixture.html');
      const env = { ...process.env, BROWSER_GATE_OWNED: '1', BROWSER_GATE_EVIDENCE: dir, VITE_TEST_URL: active.origin, CDP_URL: active.cdp, IMPORT_TEST_SERVER: active.backend, EXPECT_FIXED: '1' };
      for (const key of ['ONLY', 'REPRO_ONLY', 'BASELINE', 'FREE_TEXT_BASELINE_ONLY', 'SKIP_RADIUS', 'COARSE_ONLY']) delete env[key];
      for (const match of source.matchAll(/process\.env\.([A-Z_]*EVIDENCE[A-Z_]*)/g)) env[match[1]] = dir;
      const log = createWriteStream(join(dir, 'output.log')); let output = '';
      child = spawn(process.execPath, ['--import', resolve('tests/browser-case-progress.mjs'), join('tests', file)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      row.childPid = child.pid;
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; log.write(data); process.stdout.write(data); });
      const timeoutMs = file === 'free-text-resize.browser.mjs' ? 300000 : 600000;
      const timer = setTimeout(() => { row.timeout = true; child.kill('SIGTERM'); }, timeoutMs);
      const hard = setTimeout(() => child?.kill('SIGKILL'), timeoutMs + 3000);
      const [code, signal] = await new Promise(resolve => { child.once('exit', (...args) => resolve(args)); child.once('error', error => resolve([null, String(error)])); });
      clearTimeout(timer); clearTimeout(hard); child = null; await bounded(new Promise(resolve => log.end(resolve)), 2000, 'suite log close');
      Object.assign(row, { code, signal, status: code === 0 && !row.timeout ? 'passed' : 'failed', passMarkers: (output.match(/^PASS\b/gm) ?? []).length });
    } catch (error) { Object.assign(row, { status: 'failed', error: error.stack }); await writeFile(join(dir, 'failure.txt'), error.stack); }
    finally { try { await cleanup(); } catch (error) { row.status = 'failed'; row.cleanupError = String(error); }
      row.matrixCounts = await matrixRecordCounts(dir);
      row.elapsedMs = Date.now() - start; await writeFile(join(evidence, 'progress.json'), JSON.stringify(results, null, 2)); }
  }
} finally {
  await cleanup(); const after = await manifest(); await writeFile(join(evidence, 'manifest.after.json'), JSON.stringify(after, null, 2));
  const unchanged = JSON.stringify(before.files) === JSON.stringify(after.files);
  await writeFile(join(evidence, 'summary.json'), JSON.stringify({ results, unchanged, inventory }, null, 2));
  assert(unchanged, 'Source/build manifest.files changed during gate');
}
if (results.some(r => r.status !== 'passed')) process.exitCode = 1;
