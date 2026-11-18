import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { attachYWS } from './yws.js';
import { createPresentation } from '../src/utils/model/slideFactory';

// The server's own ws (resolved from server/node_modules).
const WebSocket = createRequire(path.join(import.meta.dirname, 'index.js'))('ws');

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yws-'));
const storage = {
  dataDir: dir,
  userOwnsProject: async () => true,
  getProject: async (id: string) => {
    if (id.startsWith('boom')) throw new Error('disk on fire');
    return { id, presentation: { ...createPresentation(), id } };
  },
  // Every JSON backup copy fails, as it did for a deck past the string limit.
  saveProject: async () => { throw new RangeError('Invalid string length'); },
};
const server = http.createServer();
const collab = attachYWS(server, storage, null);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
const port = (server.address() as { port: number }).port;

afterAll(async () => {
  await collab.close();
  await new Promise(resolve => server.close(resolve));
});

function connect(projectId: string): Promise<{ open: boolean; status?: number; ws?: InstanceType<typeof WebSocket> }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/yjs/${projectId}?userId=user1`);
    ws.on('open', () => resolve({ open: true, ws }));
    ws.on('unexpected-response', (_req: unknown, res: { statusCode: number }) => resolve({ open: false, status: res.statusCode }));
    ws.on('error', () => resolve({ open: false }));
  });
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('collab connections survive a failing backup copy', () => {
  it('a deck whose snapshot failed when it closed opens again', async () => {
    const first = await connect('deck1');
    expect(first.open).toBe(true);
    first.ws!.close();
    await wait(300); // the room closes and its final flush fails
    const second = await connect('deck1');
    expect(second.open).toBe(true);
    second.ws!.close();
    await wait(100);
  });

  it('a deck that cannot be opened is refused with 500 and the reason is reported', async () => {
    const result = await connect('boom1');
    expect(result).toMatchObject({ open: false, status: 500 });
    expect(collab.status('boom1')).toMatchObject({ ok: false, error: expect.stringContaining('disk on fire') });
    expect(collab.status('deck1')).toMatchObject({ ok: true, lastSnapshotError: expect.stringContaining('Invalid string length') });
  });
});
