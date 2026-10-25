// Explicit Chrome integration regression; not included in the browser suite inventory.
// BROWSER_GATE_EVIDENCE=/absolute/evidence node --test tests/isolated-browser.regression.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import { isolatedBrowser } from './isolated-browser.mjs';
import { matrixRecordCounts } from './browser-matrix-counts.mjs';
const root = process.env.BROWSER_GATE_EVIDENCE;
assert(root?.startsWith('/'), 'Use an absolute durable evidence directory');
async function closedPort(origin) {
  const u = new URL(origin);
  const connected = await new Promise(resolve => {
    const s = net.connect({ host: u.hostname, port: Number(u.port) });
    s.setTimeout(500); s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false)); s.once('timeout', () => { s.destroy(); resolve(false); });
  });
  assert.equal(connected, false, `owned listener still reachable: ${origin}`);
}
async function assertReleased(dir) {
  const manifest = JSON.parse(await readFile(join(dir, 'isolation.json'), 'utf8'));
  const backend = JSON.parse(await readFile(join(dir, 'backend.json'), 'utf8'));
  for (const pid of [manifest.chromePid, backend.pid].filter(Boolean)) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `owned child ${pid} remains`);
  }
  for (const origin of [manifest.origin, manifest.proxy?.origin, manifest.cdp, backend.origin].filter(Boolean)) await closedPort(origin);
  await writeFile(join(dir, 'cleanup-verified.json'), JSON.stringify({ released: true, manifest, backend }, null, 2));
}
for (const fault of ['after-backend', 'before-listen', 'failed-probe', 'cdp-open']) {
  test(`setup fault ${fault} is bounded and releases every owned allocation`, { timeout: 20000 }, async () => {
    const dir = join(root, fault); await mkdir(dir, { recursive: true }); const start = Date.now();
    await assert.rejects(isolatedBrowser(dir, { persistence: true, fault }), fault === 'cdp-open' ? /CDP open timed out/ : new RegExp(fault));
    assert(Date.now() - start < 15000); await assertReleased(dir);
  });
}
test('actual isolated fixture navigation and backend deny probe, then cleanup', { timeout: 30000 }, async () => {
  const dir = join(root, 'smoke'); const browser = await isolatedBrowser(dir, { persistence: true });
  try {
    await browser.navigate('/tests/canvas-fixture.html');
    assert.equal(await browser.evaluate("location.pathname === '/tests/canvas-fixture.html'"), true);
    assert.equal((await fetch(browser.origin + '/api/projects', { signal: AbortSignal.timeout(1000) })).status, 403);
  } finally { await browser.close(); }
  await assertReleased(dir);
});
test('nested matrices preserve relative artifact paths and actual row counts', async () => {
  const dir = join(root, 'counts'); await mkdir(join(dir, 'artifacts/slides-import-export-repair'), { recursive: true });
  await writeFile(join(dir, 'artifacts/slides-import-export-repair/browser-evidence.json'), JSON.stringify({ matrix: Array.from({ length: 10 }, (_, i) => `record ${i}`) }));
  assert.deepEqual(await matrixRecordCounts(dir), { 'artifacts/slides-import-export-repair/browser-evidence.json:matrix': 10 });
});
