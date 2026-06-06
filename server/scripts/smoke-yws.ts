// Quick smoke test for the Yjs WS endpoint. Connects to a known project, waits
// for sync, prints what came back. Used during phase 3 to verify cold-start and
// will probably stay around as a CLI debug helper.
//
// Usage: tsx server/scripts/smoke-yws.ts <projectId> [serverUrl]

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ROOT_KEY } from '../../src/collab/ySchema';

const projectId = process.argv[2];
const serverUrl = process.argv[3] || 'ws://localhost:3001';

if (!projectId) {
  console.error('Usage: tsx server/scripts/smoke-yws.ts <projectId> [serverUrl]');
  process.exit(1);
}

// y-websocket appends `/projectId` to the server URL; our server reads it as the docName.
const wsUrl = `${serverUrl}/yjs`;

const doc = new Y.Doc();
const provider = new WebsocketProvider(wsUrl, projectId, doc, { WebSocketPolyfill: (await import('ws')).WebSocket as any });

provider.on('status', (e: { status: string }) => {
  console.log(`[smoke] status: ${e.status}`);
});

provider.on('sync', (isSynced: boolean) => {
  if (!isSynced) return;
  const root = doc.getMap(ROOT_KEY);
  console.log(`[smoke] synced. Root keys: ${[...root.keys()].join(', ')}`);
  console.log(`[smoke]   id: ${root.get('id')}`);
  console.log(`[smoke]   title: ${root.get('title')}`);
  const slides = root.get('slides') as Y.Map<unknown>;
  console.log(`[smoke]   slide count: ${slides?.size ?? '(missing)'}`);
  const slideOrder = root.get('slideOrder') as Y.Array<string>;
  console.log(`[smoke]   slideOrder: [${slideOrder?.toArray().join(', ') ?? '(missing)'}]`);
  setTimeout(() => {
    provider.destroy();
    process.exit(0);
  }, 200);
});
