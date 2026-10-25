import { setTimeout as delay } from 'node:timers/promises';

export async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

// Register immediately after allocation, including allocations completing after
// a setup deadline. Closing starts every destructor even if another one fails.
export function ownedResources() {
  const resources = [], controller = new AbortController();
  let closing;
  const onExit = () => { for (const r of resources) r.force?.(); };
  const onSignal = () => { close().finally(() => process.exit(130)); };
  process.once('exit', onExit);
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  function add(name, dispose, force) {
    const resource = { name, dispose, force };
    if (controller.signal.aborted) { force?.(); Promise.resolve().then(dispose).catch(() => {}); throw new Error(`Late owned allocation: ${name}`); }
    resources.push(resource);
  }
  function close() {
    if (closing) return closing;
    controller.abort();
    closing = (async () => {
      const results = await Promise.allSettled(resources.reverse().map(async r => {
        try { await bounded(Promise.resolve().then(r.dispose), 5000, `close ${r.name}`); }
        catch (e) { r.force?.(); throw e; }
      }));
      process.removeListener('exit', onExit);
      process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
      const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
      if (errors.length) throw new AggregateError(errors, 'Owned cleanup failed');
    })();
    return closing;
  }
  return { add, close, signal: controller.signal, check() { controller.signal.throwIfAborted(); } };
}

export async function stopOwnedChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(1500).then(() => false)])) return;
  child.kill('SIGKILL');
  await bounded(exited, 1500, `owned child ${child.pid} exit`);
}

export function trackServerSockets(server) {
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); });
  return () => { for (const socket of sockets) socket.destroy(); };
}
