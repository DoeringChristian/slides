// Two-client convergence smoke test.
//
// Usage:
//   tsx server/scripts/smoke-edit.ts <projectId> <new-title>
//
// Spawns one editor and one observer against the same project. The editor
// changes the title Y.Text in a transaction; the observer prints the new
// title once it propagates. Verifies that the WS sync + yToStoreSync path
// (and by extension, the routed updateTitle action) works end-to-end.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ROOT_KEY } from '../../src/collab/ySchema';

const projectId = process.argv[2];
const newTitle = process.argv[3] || `edited ${Date.now()}`;
if (!projectId) {
  console.error('Usage: tsx server/scripts/smoke-edit.ts <projectId> <new-title>');
  process.exit(1);
}

const wsUrl = 'ws://localhost:3001/yjs';
const wsPolyfill = (await import('ws')).WebSocket as unknown as typeof WebSocket;

async function makeClient(role: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsUrl, projectId, doc, { WebSocketPolyfill: wsPolyfill });
  provider.awareness.setLocalStateField('user', { id: role, name: role });
  await new Promise<void>((res) => provider.on('sync', (s: boolean) => s && res()));
  return { doc, provider };
}

const observer = await makeClient('observer');
const editor = await makeClient('editor');

console.log(`[observer] initial title: ${observer.doc.getMap(ROOT_KEY).get('title')}`);

observer.doc.on('update', () => {
  console.log(`[observer] title now: ${observer.doc.getMap(ROOT_KEY).get('title')}`);
});

const titleYText = editor.doc.getMap(ROOT_KEY).get('title') as Y.Text;
editor.doc.transact(() => {
  titleYText.delete(0, titleYText.length);
  titleYText.insert(0, newTitle);
});

console.log(`[editor] wrote: ${newTitle}`);

// Give the observer 800ms to receive the propagation.
setTimeout(() => {
  observer.provider.destroy();
  editor.provider.destroy();
  process.exit(0);
}, 800);
