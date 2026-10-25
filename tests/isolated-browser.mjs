// Test-only Vite + owned Chrome. Never loads vite.config.ts (which starts the
// live backend). A mandatory allowlisting proxy denies non-owned network.
// Persistence opt-in starts a new backend in a verified temporary working directory.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedBackend } from './isolated-backend.mjs';
import { browserNetworkProxy } from './browser-network-proxy.mjs';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { bounded, ownedResources, stopOwnedChild, trackServerSockets } from './browser-owned-resources.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function isolatedBrowser(evidence, options = {}) {
  const owned = ownedResources();
  const manifest = { runnerPid: process.pid, configFile: false, blocked: [], errors: [] };
  let ws, send, closing;
  const pending = new Map();
  const fault = phase => { if (options.fault === phase) throw new Error(`Injected setup failure: ${phase}`); };
  function close() { return closing ??= (async () => {
    try { await owned.close(); }
    finally { await bounded(writeFile(join(evidence, 'isolation.json'), JSON.stringify(manifest, null, 2)), 1000, 'isolation manifest'); }
  })(); }
  try {
    return await bounded((async () => {
      await mkdir(evidence, { recursive: true }); owned.check();
      const profile = await mkdtemp(join(tmpdir(), 'slides-isolated-chrome-'));
      const { blocked, errors } = manifest;
      const backend = options.persistence ? await isolatedBackend(evidence, owned.signal) : null;
      if (backend) owned.add('backend', backend.close);
      manifest.backend = backend?.origin ?? 'NONE';
      fault('after-backend'); owned.check();
      const backendWs = backend?.origin.replace('http:', 'ws:');
      const server = await createServer({ configFile: false, root: process.cwd(),
        define: { __SLIDES_STANDALONE_BUILD__: 'false', __SLIDES_EDITOR_ORIGIN__: JSON.stringify('http://invalid.test') },
        plugins: [{ name: 'deny-persistence', configureServer(s) {
          const destroy = trackServerSockets(s.httpServer);
          s.httpServer.on('listening', () => { if (owned.signal.aborted) { destroy(); s.close().catch(() => {}); } });
          owned.add('Vite', async () => { destroy(); await s.close(); }, destroy);
          s.middlewares.use((req, res, next) => {
            if (req.method === 'GET' && /^\/(standalone-template|viewer-template)\.html$/.test(req.url)) {
              readFile(join(process.cwd(), 'dist', req.url.slice(1))).then(b => { res.setHeader('Content-Type', 'text/html'); res.end(b); }).catch(() => { res.statusCode = 404; res.end('Build all templates first'); }); return;
            }
            if (req.method === 'GET' && /^\/__import-export-fixture\/[a-z-]+\.html$/.test(req.url)) {
              readFile(join(evidence, 'artifacts/slides-import-export-repair', req.url.split('/').at(-1))).then(b => { res.setHeader('Content-Type', 'text/html'); res.end(b); }).catch(() => { res.statusCode = 404; res.end(); }); return;
            }
            if (req.method !== 'GET' || /^\/(api|ws|collab)(\/|\?|$)/.test(req.url)) {
              blocked.push({ server: req.url, method: req.method }); res.statusCode = 403; res.end('Isolated fixture: persistence disabled'); return;
            }
            res.setHeader('Content-Security-Policy', `connect-src 'self' blob: ${backend?.origin ?? ''} ${backendWs ?? ''}; worker-src 'none'`); next();
          });
        } }, react()], server: { host: '127.0.0.1', port: 0, hmr: false, proxy: {} } });
      owned.check(); fault('before-listen');
      await bounded(server.listen(), 10000, 'Vite listen'); owned.check();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      manifest.origin = origin;
      // Prove middleware denies persistence before starting any browser.
      assert.equal((await fetch(`${origin}/api/projects`, { method: 'POST', signal: AbortSignal.any([owned.signal, AbortSignal.timeout(3000)]) })).status, 403);
      assert.equal((await fetch(`${origin}/api/projects`, { signal: AbortSignal.any([owned.signal, AbortSignal.timeout(3000)]) })).status, 403);
      fault('failed-probe'); owned.check();
      const allow = (url, method, upgrade = false) => {
        if (upgrade) return !!backend && url.origin === backendWs && /^\/yjs\/[A-Za-z0-9_-]+$/.test(url.pathname);
        if (backend && url.origin === backend.origin) return /^(GET|POST|PUT|DELETE|OPTIONS)$/.test(method) && /^\/api\/(health|projects(?:\/[A-Za-z0-9_-]+(?:\/(duplicate|shares)(?:\/[A-Za-z0-9_-]+)?)?)?)$/.test(url.pathname);
        return url.origin === origin && method === 'GET' && !/^\/(api|ws|collab|yjs)(\/|$)/.test(url.pathname);
      };
      const proxy = await browserNetworkProxy(allow, join(evidence, 'requests.jsonl'), owned.signal);
      owned.add('proxy', proxy.close);
      manifest.proxy = { origin: proxy.origin, policy: 'owned Vite GET; owned backend API and yjs only' }; owned.check();
      const chrome = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ['--headless=new', `--proxy-server=${proxy.origin}`, '--proxy-bypass-list=<-loopback>', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
      owned.add('Chrome', () => stopOwnedChild(chrome), () => chrome.kill('SIGKILL'));
      let chromeError; chrome.on('error', error => { chromeError = error; });
      Object.assign(manifest, { profile, chromePid: chrome.pid, storage: 'fresh temporary Chrome profile; owned temporary backend only when enabled' });
      await writeFile(join(evidence, 'isolation.json'), JSON.stringify(manifest, null, 2));
      let port;
      for (let i = 0; i < 200; i++) { owned.check(); if (chromeError) throw chromeError; try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await wait(50); } }
      assert(port, 'owned Chrome started');
      owned.check();
      manifest.cdp = `http://127.0.0.1:${port}`;
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.any([owned.signal, AbortSignal.timeout(3000)]) })).json();
      const page = pages.find(p => p.type === 'page' && p.url === 'about:blank'); assert(page);
      manifest.targetId = page.id;
      ws = new WebSocket(page.webSocketDebuggerUrl);
      owned.add('CDP socket', async () => {
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP fixture closed')); } pending.clear();
        if (ws.readyState === WebSocket.CLOSED) return;
        const closed = new Promise(resolve => ws.once('close', resolve)); ws.terminate(); await bounded(closed, 1000, 'CDP socket close');
      }, () => ws.terminate());
      ws.on('error', () => {});
      await bounded(options.fault === 'cdp-open' ? new Promise(() => {}) : new Promise((resolve, reject) => {
        ws.once('open', resolve); ws.once('error', reject); ws.once('close', () => reject(new Error('CDP closed before open')));
      }), options.fault === 'cdp-open' ? 100 : 5000, 'CDP open'); owned.check();
      let seq = 0;
      send = (method, params = {}) => new Promise((resolve, reject) => {
        owned.check(); const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out after 30s`)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
      });
      ws.addEventListener('message', e => {
        const msg = JSON.parse(e.data);
        if (msg.id) { const p = pending.get(msg.id); if (!p) return; clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); }
        if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
        if (msg.method === 'Fetch.requestPaused') {
          const { request, requestId } = msg.params, url = new URL(request.url);
          const allowed = allow(url, request.method);
          if (!allowed) blocked.push({ browser: request.url, method: request.method });
          send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }).catch(error => { if (!owned.signal.aborted) errors.push(String(error)); });
        }
      });
      await send('Page.enable'); await send('Runtime.enable');
      if (!options.externalSession) await send('Fetch.enable', { patterns: [{ urlPattern: 'http*' }] });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const Native = window.WebSocket; window.WebSocket = class extends Native { constructor(url, protocols) { const u = new URL(url, location.href); if (u.origin !== ${JSON.stringify(backendWs ?? '')} || !/^\\/yjs\\/[A-Za-z0-9_-]+$/.test(u.pathname)) throw new Error('Non-owned application WebSocket blocked'); super(url, protocols); } }; })();` });
      await writeFile(join(evidence, 'isolation.json'), JSON.stringify(manifest, null, 2));
      const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      return { origin, backend: backend?.origin, cdp: `http://127.0.0.1:${port}`, manifest, evaluate, send, close, navigate: path => bounded((async () => {
        assert(path.startsWith('/tests/'), 'only test fixtures may be navigated');
        await send('Page.navigate', { url: origin + path });
        for (let i = 0; i < 200; i++) { owned.check(); if (await evaluate("document.readyState === 'complete' && location.pathname === " + JSON.stringify(path))) return; await wait(50); }
        throw Error('Fixture navigation timed out');
      })(), 15000, 'fixture navigation') };
    })(), 45000, 'isolated browser setup');
  } catch (e) { await close(); throw e; }
}
