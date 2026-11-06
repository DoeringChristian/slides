import { upgradeNativePresentation } from '../src/utils/model/legacyPresentation.ts';
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

import { createRequire } from 'node:module';
import wsUtils from 'y-websocket/bin/utils';
// This legacy transport constructs CommonJS Y types. Decode its wire bytes
// with that same runtime; never insert ESM Y types into a transport document.
const transportY = createRequire(import.meta.url)('yjs');
const { setupWSConnection, setPersistence, docs } = wsUtils;
import { LeveldbPersistence } from 'y-leveldb';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import path from 'path';
import { jsonToYDoc, yDocToJson, restoreStoredYProject } from '../src/collab/ySchema.ts';

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
const pendingWrites = new Map();
const closingRooms = new Map();
const snapshotStates = new WeakMap();
async function flushSnapshot(doc) {
  const state = snapshotStates.get(doc);
  if (!state) return Promise.resolve();
  clearTimeout(state.timer);
  state.timer = null;
  const presentation = yDocToJson(doc);
  state.pending = state.pending.catch(() => {}).then(() => state.storage.saveProject(presentation));
  return state.pending;
}

// bindState only runs the synchronous apply + subscribes to future updates.
// Subscribers fan back into LevelDB; writes are async but their order is
// preserved by y-leveldb's internal transaction queue.
const wsPersistence = {
  provider: persistence,
  bindState: (docName, ydoc) => {
    const preloaded = preloadedStates.get(docName);
    if (preloaded) transportY.applyUpdate(ydoc, preloaded);
    preloadedStates.delete(docName);
    ydoc.on('update', (update) => {
      const pending = (pendingWrites.get(docName) ?? Promise.resolve()).then(() => persistence.storeUpdate(docName, update));
      pendingWrites.set(docName, pending);
      pending.catch(err => console.error(`[yws] persistence failed for ${docName}:`, err));
    });
  },
  writeState: (docName, doc) => {
    // The transport removes the room immediately after this call. A fresh
    // connection must await its writes before loading a replacement Y.Doc.
    const closing = Promise.all([pendingWrites.get(docName), flushSnapshot(doc)]).then(() => {});
    closingRooms.set(docName, closing);
    closing.catch(err => console.error(`[yws] close flush failed for ${docName}:`, err));
    return closing.catch(() => {});
  },
};
setPersistence(wsPersistence);

/** projectId → Promise; ensures cold-start only runs once even if multiple
 *  clients race to open the same project. */
const coldStarts = new Map();

// =============================================================================
// Cold-start: convert an existing JSON project into a populated leveldb
// entry the first time it's opened in collab mode.
// =============================================================================

async function ensureLeveldbBootstrapped(projectId, storage) {
  await closingRooms.get(projectId);
  if (docs.has(projectId)) return;
  if (coldStarts.has(projectId)) return coldStarts.get(projectId);
  const p = (async () => {
    // y-leveldb's `getYDoc` returns a Y.Doc with all stored updates already
    // applied. If `store.clients` is empty, nothing has ever been stored.
    await pendingWrites.get(projectId);
    const liveDoc = await persistence.getYDoc(projectId);
    try {
    if (liveDoc.store.clients.size === 0) {
      // Cold-start: hydrate from the JSON snapshot, persist as the initial
      // leveldb update, then re-read so liveDoc has the cold-started state.
      const result = await storage.getProject(projectId);
      if (result?.presentation) {
        jsonToYDoc(upgradeNativePresentation(result.presentation), liveDoc);
        const update = Y.encodeStateAsUpdate(liveDoc);
        await persistence.storeUpdate(projectId, update);
        console.log(`[yws] cold-started ${projectId} from JSON snapshot`);
      } else {
        // Brand-new project with no JSON yet — first WS edits will populate.
        return;
      }
    }
    if (restoreStoredYProject(liveDoc)) {
      await persistence.storeUpdate(projectId, Y.encodeStateAsUpdate(liveDoc));
      await storage.saveProject(yDocToJson(liveDoc));
    }
    // Cache the current state so the (synchronous) bindState can apply it
    // before y-websocket runs sync-step-1.
    if (!docs.has(projectId)) preloadedStates.set(projectId, Y.encodeStateAsUpdate(liveDoc));
    } finally { liveDoc.destroy(); }
  })();
  coldStarts.set(projectId, p);
  try { await p; } finally { coldStarts.delete(projectId); }
}

// =============================================================================
// Snapshot debounce — keep JSON backup in sync with the live Y.Doc.
// =============================================================================

function subscribeSnapshot(projectId, storage) {
  const doc = docs.get(projectId);
  if (!doc || snapshotStates.has(doc)) return;
  const state = { storage, timer: null, pending: Promise.resolve() };
  snapshotStates.set(doc, state);
  doc.on('update', () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      flushSnapshot(doc).catch(err => console.error(`[yws] snapshot failed for ${projectId}:`, err));
    }, SNAPSHOT_DEBOUNCE_MS);
  });
}

// =============================================================================
// Public attach point — call from server/index.js after http.createServer.
// =============================================================================

export function attachYWS(httpServer, storage, shares) {
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

    // Auth: owner OR holder of a valid share token. Identity arrives via
    // ?userId=…, share token via ?token=…. Either credential must be valid;
    // an anonymous (no userId, no token) connection is rejected. Legacy
    // ownerless projects are still reachable, because userOwnsProject treats
    // missing ownerId as "any identified user owns it" — but a userId is
    // still required.
    const userId = url.searchParams.get('userId');
    const shareToken = url.searchParams.get('token');
    const isOwner = userId && (await storage.userOwnsProject(projectId, userId));
    const tokenOk = shareToken && shares && (await shares.isValid(shareToken, projectId));
    if (!isOwner && !tokenOk) {
      console.warn(`[yws] denied: userId=${userId ?? '<none>'} on ${projectId}`);
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
