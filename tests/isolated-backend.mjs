import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { bounded, ownedResources, stopOwnedChild } from './browser-owned-resources.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
export async function isolatedBackend(evidence, parentSignal) {
  const owned = ownedResources();
  const abort = () => { owned.close().catch(() => {}); };
  parentSignal?.addEventListener('abort', abort, { once: true });
  let log = '';
  async function close() {
    try { await owned.close(); }
    finally { parentSignal?.removeEventListener('abort', abort); await bounded(writeFile(join(evidence, 'backend.log'), log), 1000, 'backend log'); }
  }
  try {
    return await bounded((async () => {
      if (parentSignal?.aborted) throw new Error('Backend setup aborted');
      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'slides-owned-backend-'))); owned.check();
      const data = resolve(cwd, 'data');
      assert(data.startsWith(cwd + '/') && data !== resolve('server/data'));
      const reservation = net.createServer();
      owned.add('port reservation', () => new Promise(r => reservation.close(r)), () => reservation.close());
      await bounded(new Promise((r, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', r); }), 2000, 'port reservation listen'); owned.check();
      const port = reservation.address().port; assert(![3001, 3198].includes(port));
      await bounded(new Promise(r => reservation.close(r)), 2000, 'port reservation close'); owned.check();
      // Both index.js and yws.js resolve ./data from this unique temporary cwd.
      const child = spawn(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('server/index.js')], {
        cwd, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      owned.add('backend child', () => stopOwnedChild(child), () => child.kill('SIGKILL'));
      let spawnError; child.on('error', error => { spawnError = error; });
      for (const s of [child.stdout, child.stderr]) s.on('data', b => { log += b; });
      const origin = `http://127.0.0.1:${port}`;
      const manifest = { pid: child.pid, cwd, data, origin, verifiedAbsoluteDataPath: false };
      await writeFile(join(evidence, 'backend.json'), JSON.stringify(manifest, null, 2));
      for (let n = 0; n < 200 && !log.includes(`Data directory: ${data}`); n++) {
        owned.check(); if (spawnError) throw spawnError; assert(child.exitCode === null, log); await wait(50);
      }
      assert(log.includes(`Data directory: ${data}`), `Backend absolute data path not verified: ${log}`);
      assert.equal((await fetch(origin + '/api/health', { signal: AbortSignal.any([owned.signal, AbortSignal.timeout(3000)]) })).status, 200);
      manifest.verifiedAbsoluteDataPath = true;
      await writeFile(join(evidence, 'backend.json'), JSON.stringify(manifest, null, 2)); owned.check();
      return { origin, close };
    })(), 15000, 'backend setup');
  } catch (e) { await close(); throw e; }
}
