// Quick CLI: connect to the WS with a given userId and report status.
//   tsx server/scripts/ws-auth-test.ts <role> <userId> <projectId>
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket as NodeWS } from 'ws';

const [, , role, userId, projectId] = process.argv;
if (!role || !userId || !projectId) {
  console.error('Usage: tsx ws-auth-test.ts <role> <userId> <projectId>');
  process.exit(1);
}

const doc = new Y.Doc();
const p = new WebsocketProvider('ws://localhost:3001/yjs', projectId, doc, {
  params: { userId },
  WebSocketPolyfill: NodeWS as unknown as typeof WebSocket,
});
p.on('status', (e: { status: string }) => console.log(`[${role}] status: ${e.status}`));
p.on('connection-error', () => console.log(`[${role}] connection-error`));
p.on('sync', (s: boolean) => {
  if (!s) return;
  console.log(`[${role}] synced; title:`, doc.getMap('presentation').get('title'));
});
setTimeout(() => { p.destroy(); process.exit(0); }, 2500);
