// Y.Doc transport + persistence + cold-start.
//
// Wires `@y/websocket-server` (the protocol helpers) onto the existing
// Express HTTP server. Persistence goes through `y-leveldb` so multiple
// concurrent edits don't race the way the REST file writes do. After
// every batch of Y updates settles, we also write a plain JSON snapshot
// of the deck through `storage.saveProject()` — this keeps the REST API
// returning the same shape, lets `local`/`filesystem` modes continue to
// consume the same files, and acts as a backup if leveldb corrupts.
//
// Auth model: none. Project IDs are the only capability (see plan). We
// validate the URL projectId against an alphanumeric whitelist purely
// to keep leveldb directories well-formed.

import wsUtils from 'y-websocket/bin/utils';
const { setupWSConnection, setPersistence, docs } = wsUtils;
import { LeveldbPersistence } from 'y-leveldb';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import path from 'path';
import { jsonToYDoc, yDocToJson } from '../src/collab/ySchema.ts';

// =============================================================================
// Tunables
// =============================================================================

const LEVELDB_DIR = path.resolve('./data/ydocs');
const SNAPSHOT_DEBOUNCE_MS = 5000;
const VALID_PROJECT_ID = /^[A-Za-z0-9_-]{4,64}$/;

// =============================================================================
// Module state
// =============================================================================

const persistence = new LeveldbPersistence(LEVELDB_DIR);

// Preloaded leveldb state per project. We fetch state inside the upgrade
// handler (async, before letting the WS connection through) and then apply it
// synchronously inside bindState. This sidesteps the race in y-websocket
// v1.5.x: getYDoc calls `bindState` without awaiting it, then immediately
// emits sync-step-1 with the doc's current (empty) state vector. If we did
// the leveldb read inside bindState, the client would receive "doc is empty"
// before our async load completes.
const preloadedStates = new Map();

// bindState only runs the synchronous apply + subscribes to future updates.
// Subscribers fan back into LevelDB; writes are async but their order is
// preserved by y-leveldb's internal transaction queue.
const wsPersistence = {
  provider: persistence,
  bindState: (docName, ydoc) => {
    const preloaded = preloadedStates.get(docName);
    if (preloaded) Y.applyUpdate(ydoc, preloaded);
    ydoc.on('update', (update) => {
      persistence.storeUpdate(docName, update);
    });
  },
  writeState: async () => {
    // Updates stream eagerly in the `update` handler; nothing to flush.
  },
};
setPersistence(wsPersistence);

/** projectId → debounced snapshot timer */
const snapshotTimers = new Map();
/** projectId → bool; tracks which docs we've already attached the snapshot
 *  listener to (avoids N listeners per N connections to the same room). */
const snapshotSubscribed = new Set();
/** projectId → Promise; ensures cold-start only runs once even if multiple
 *  clients race to open the same project. */
const coldStarts = new Map();

// =============================================================================
// Cold-start: convert an existing JSON project into a populated leveldb
// entry the first time it's opened in collab mode.
// =============================================================================

async function ensureLeveldbBootstrapped(projectId, storage) {
  if (coldStarts.has(projectId)) return coldStarts.get(projectId);
  const p = (async () => {
    // y-leveldb's `getYDoc` returns a Y.Doc with all stored updates already
    // applied. If `store.clients` is empty, nothing has ever been stored.
    let liveDoc = await persistence.getYDoc(projectId);
    if (liveDoc.store.clients.size === 0) {
      // Cold-start: hydrate from the JSON snapshot, persist as the initial
      // leveldb update, then re-read so liveDoc has the cold-started state.
      const result = await storage.getProject(projectId);
      if (result?.presentation) {
        jsonToYDoc(result.presentation, liveDoc);
        const update = Y.encodeStateAsUpdate(liveDoc);
        await persistence.storeUpdate(projectId, update);
        console.log(`[yws] cold-started ${projectId} from JSON snapshot`);
      } else {
        // Brand-new project with no JSON yet — first WS edits will populate.
        return;
      }
    }
    // Cache the current state so the (synchronous) bindState can apply it
    // before y-websocket runs sync-step-1.
    preloadedStates.set(projectId, Y.encodeStateAsUpdate(liveDoc));
  })();
  coldStarts.set(projectId, p);
  await p;
}

// =============================================================================
// Snapshot debounce — keep JSON backup in sync with the live Y.Doc.
// =============================================================================

function subscribeSnapshot(projectId, storage) {
  if (snapshotSubscribed.has(projectId)) return;
  snapshotSubscribed.add(projectId);

  const doc = docs.get(projectId);
  if (!doc) return;

  doc.on('update', () => {
    clearTimeout(snapshotTimers.get(projectId));
    const t = setTimeout(async () => {
      snapshotTimers.delete(projectId);
      try {
        const presentation = yDocToJson(doc);
        await storage.saveProject(presentation);
      } catch (err) {
        console.error(`[yws] snapshot failed for ${projectId}:`, err);
      }
    }, SNAPSHOT_DEBOUNCE_MS);
    snapshotTimers.set(projectId, t);
  });
}

// =============================================================================
// Public attach point — call from server/index.js after http.createServer.
// =============================================================================

export function attachYWS(httpServer, storage) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (conn, req) => {
    const projectId = req.projectId; // set by upgrade handler
    setupWSConnection(conn, req, { docName: projectId, gc: true });
    subscribeSnapshot(projectId, storage);
  });

  httpServer.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const match = url.pathname.match(/^\/yjs\/(.+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const projectId = match[1];
    if (!VALID_PROJECT_ID.test(projectId)) {
      socket.destroy();
      return;
    }

    // Owner-only auth for now. The share-link commit adds an OR-clause for
    // valid share tokens. Legacy projects without an ownerId stay open.
    const userId = url.searchParams.get('userId');
    if (userId && !(await storage.userOwnsProject(projectId, userId))) {
      console.warn(`[yws] denied: ${userId} is not the owner of ${projectId}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      await ensureLeveldbBootstrapped(projectId, storage);
    } catch (err) {
      console.error(`[yws] cold-start failed for ${projectId}:`, err);
      socket.destroy();
      return;
    }

    req.projectId = projectId;
    wss.handleUpgrade(req, socket, head, (conn) => {
      wss.emit('connection', conn, req);
    });
  });

  console.log(`[yws] leveldb at ${LEVELDB_DIR}; snapshot every ${SNAPSHOT_DEBOUNCE_MS}ms`);
}
