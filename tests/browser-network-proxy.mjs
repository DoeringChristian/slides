// Mandatory Chrome proxy: independent of each suite's CDP Fetch interception.
import http from 'node:http';
import { bounded } from './browser-owned-resources.mjs';
import { appendFileSync } from 'node:fs';
export async function browserNetworkProxy(allow, ledger, signal) {
  const sockets = new Set(), requests = new Set();
  const trackSocket = socket => {
    if (sockets.has(socket)) return;
    sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => sockets.delete(socket));
  };
  const trackRequest = request => {
    requests.add(request); request.on('close', () => requests.delete(request));
    request.on('socket', trackSocket); request.setTimeout(10000, () => request.destroy()); return request;
  };
  const record = (req, allowed) => appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, allowed }) + '\n');
  const proxy = http.createServer((req, res) => {
    let url; try { url = new URL(req.url, req.socket.tunnelOrigin); } catch { res.writeHead(403).end(); return; }
    const allowed = url.protocol === 'http:' && allow(url, req.method, false); record(req, allowed);
    if (!allowed) { res.writeHead(403).end('Isolated browser network denied'); return; }
    const upstream = trackRequest(http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    }));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.on('connect', (req, socket, head) => {
    // Chrome tunnels even plaintext ws through HTTP CONNECT. Reparse the
    // tunnel as HTTP instead of opening an unrestricted TCP relay.
    let target; try { target = new URL(`http://${req.url}`); } catch { socket.destroy(); return; }
    const allowed = allow(new URL('/api/health', target), 'GET', false); record(req, allowed);
    if (!allowed) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    socket.tunnelOrigin = target.origin; socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) socket.unshift(head); proxy.emit('connection', socket);
  });
  proxy.on('upgrade', (req, socket, head) => {
    let url; try { url = new URL(req.url, req.socket.tunnelOrigin?.replace('http:', 'ws:')); } catch { socket.destroy(); return; }
    const allowed = url.protocol === 'ws:' && allow(url, req.method, true); record(req, allowed);
    if (!allowed) { socket.destroy(); return; }
    url.protocol = 'http:';
    const upstream = trackRequest(http.request(url, { headers: { ...req.headers, host: url.host } }));
    upstream.on('upgrade', (response, peer, data) => {
      trackSocket(peer);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (data.length) socket.write(data); if (head.length) peer.write(head);
      peer.pipe(socket); socket.pipe(peer);
    });
    upstream.on('error', () => socket.destroy()); upstream.end();
  });
  proxy.on('connection', trackSocket);
  let closing;
  const destroy = () => { for (const r of requests) r.destroy(); for (const socket of sockets) socket.destroy(); };
  function close() { return closing ??= (async () => {
    signal?.removeEventListener('abort', abort); destroy();
    await bounded(new Promise(resolve => proxy.close(resolve)), 2000, 'proxy close');
  })(); }
  const abort = () => { close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  proxy.on('listening', () => { if (signal?.aborted) { destroy(); proxy.close(); } });
  try {
    signal?.throwIfAborted();
    await bounded(new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); }), 3000, 'proxy listen');
    signal?.throwIfAborted();
    return { origin: `http://127.0.0.1:${proxy.address().port}`, close };
  } catch (e) { await close(); throw e; }
}
