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
const provider = new WebsocketProvider(wsUrl, projectId, doc, { WebSocketPolyfill: (await import('ws')).WebSocket as unknown as typeof WebSocket });

provider.on('status', (e: { status: string }) => {
  console.log(`[smoke] status: ${e.status}`);
});

// Publish a fake identity so we can see ourselves + peers via awareness.
const myName = `smoke-${Math.random().toString(36).slice(2, 6)}`;
provider.awareness.setLocalStateField('user', { id: myName, name: myName });

provider.awareness.on('change', () => {
  const peers = [...provider.awareness.getStates().entries()]
    .map(([clientId, state]) => `${state?.user?.name ?? 'anon'}#${clientId}`)
    .join(', ');
  console.log(`[smoke:${myName}] peers (incl. self): ${peers}`);
});

provider.on('sync', (isSynced: boolean) => {
  if (!isSynced) return;
  const root = doc.getMap(ROOT_KEY);
  console.log(`[smoke:${myName}] synced. Root keys: ${[...root.keys()].join(', ')}`);
  console.log(`[smoke:${myName}]   id: ${root.get('id')}`);
  console.log(`[smoke:${myName}]   title: ${root.get('title')}`);
  const slides = root.get('slides') as Y.Map<unknown>;
  console.log(`[smoke:${myName}]   slide count: ${slides?.size ?? '(missing)'}`);
});

// Keep alive briefly to observe a peer.
setTimeout(() => {
  provider.destroy();
  process.exit(0);
}, parseInt(process.env.SMOKE_LIFETIME_MS || '2500', 10));
