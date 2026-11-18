import express from 'express';
import cors from 'cors';
import http from 'http';
import { createStorage } from './storage.js';
import { createShareStore } from './shares.js';
import { attachYWS } from './yws.js';
import { sendJson } from './streamJson.js';
import { HashMismatchError } from './mediaFiles.js';
import { createChatGPT, attachChatGPTRoutes } from './chatgpt.js';

// One failing request or socket must not take every open deck down with it.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection (kept running):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught exception (kept running):', err);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize storage
const storage = createStorage('./data');
const shares = createShareStore('./data');

// Middleware
app.use(cors({ exposedHeaders: ['X-Slides-User'] }));
// Decks reference their media files by hash (see mediaFiles.js), so a deck
// body is small; the media itself goes through /api/projects/:id/media.
app.use(express.json({ limit: '64mb', type: (req) => !/\/media\//.test(req.url) && !!req.headers['content-type']?.includes('json') }));

// Sign in with ChatGPT: plan usage for the editor's assistant. Loopback-only;
// see chatgpt.js for why the server, not the browser, holds these tokens.
attachChatGPTRoutes(app, createChatGPT({ dataDir: './data', port: PORT }));

// Pulls the client's anonymous identity from the X-Slides-User header. Returns
// null if absent (legacy/no-identity clients). This is presence-based, not
// authenticated — for a personal tool with unguessable project IDs it's
// enough; a real deployment would need auth.
function userIdOf(req) {
  const id = req.get('x-slides-user');
  if (!id || typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,32}$/.test(id)) return null;
  return id;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// List projects belonging to the requesting user.
app.get('/api/projects', async (req, res) => {
  try {
    const userId = userIdOf(req);
    const projects = userId ? await storage.listProjects({ ownerId: userId }) : await storage.listProjects();
    res.json(projects);
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// Get a single project. Owner OR valid share token (via X-Share-Token).
app.get('/api/projects/:id', async (req, res) => {
  try {
    const userId = userIdOf(req);
    const token = req.get('x-share-token') || null;
    const allowed =
      (userId && (await storage.userOwnsProject(req.params.id, userId))) ||
      (token && (await shares.isValid(token, req.params.id)));
    if (!allowed) {
      return res.status(403).json({ error: 'Not your project' });
    }
    const project = await storage.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    // Streamed: a deck with large media is longer than any one JS string.
    await sendJson(res, project);
  } catch (error) {
    console.error('Error getting project:', error);
    if (res.headersSent) res.destroy();
    else res.status(500).json({ error: `Failed to get project: ${error?.message ?? error}` });
  }
});

// ----- Media files -------------------------------------------------------------
// The bytes of a deck's images and videos, by SHA-256. A <video> or <img>
// cannot send headers, so the identity / share token may also come as ?u= / ?t=.

const mediaUser = (req) => userIdOf(req) ?? (typeof req.query.u === 'string' && /^[A-Za-z0-9_-]{4,32}$/.test(req.query.u) ? req.query.u : null);
const mediaToken = (req) => req.get('x-share-token') || (typeof req.query.t === 'string' ? req.query.t : null);
async function mayReadProject(req) {
  const userId = mediaUser(req), token = mediaToken(req);
  return !!((userId && (await storage.userOwnsProject(req.params.id, userId))) || (token && (await shares.isValid(token, req.params.id))));
}
// Uploading: the owner, a collaborator with a share link, or anyone creating
// a project that does not exist yet (its first save claims it, as with PUT).
async function mayWriteMedia(req) {
  if (await mayReadProject(req)) return true;
  return !(await storage.getProjectMeta(req.params.id)) && !!mediaUser(req);
}

app.get('/api/projects/:id/media/:sha', async (req, res) => {
  try {
    if (!(await mayReadProject(req))) return res.status(403).json({ error: 'Not your project' });
    const file = await storage.media.file(req.params.id, req.params.sha);
    if (!file) return res.status(404).json({ error: 'Media file not found' });
    // Range requests (seeking, streaming) are handled by sendFile. The bytes
    // behind a hash never change: cache them for good.
    res.sendFile(file.path, { headers: { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  } catch (error) {
    console.error('Error sending media:', error);
    if (!res.headersSent) res.status(500).json({ error: `Failed to send media: ${error?.message ?? error}` });
  }
});

app.put('/api/projects/:id/media/:sha', async (req, res) => {
  try {
    if (!(await mayWriteMedia(req))) return res.status(403).json({ error: 'Not your project' });
    if (await storage.media.file(req.params.id, req.params.sha)) {
      req.resume();
      return res.status(200).json({ ok: true, existed: true });
    }
    const { size } = await storage.media.put(req.params.id, req.params.sha, req.get('content-type'), req);
    res.status(201).json({ ok: true, size });
  } catch (error) {
    if (error instanceof HashMismatchError) return res.status(400).json({ error: error.message });
    console.error('Error storing media:', error);
    if (!res.headersSent) res.status(500).json({ error: `Failed to store media: ${error?.message ?? error}` });
  }
});

// Why a collab connection fails. A browser WebSocket reports only "error",
// never the server's answer, so the editor asks here.
app.get('/api/projects/:id/collab-status', async (req, res) => {
  try {
    const userId = userIdOf(req);
    const token = req.get('x-share-token') || null;
    const allowed =
      (userId && (await storage.userOwnsProject(req.params.id, userId))) ||
      (token && (await shares.isValid(token, req.params.id)));
    if (!allowed) {
      return res.status(403).json({ ok: false, error: 'You do not have access to this deck on this server.' });
    }
    res.json(collab.status(req.params.id));
  } catch (error) {
    res.status(500).json({ ok: false, error: `Status check failed: ${error?.message ?? error}` });
  }
});

// ----- Share-token endpoints (owner-only) ------------------------------------

app.post('/api/projects/:id/shares', async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId || !(await storage.userOwnsProject(req.params.id, userId))) {
      return res.status(403).json({ error: 'Not your project' });
    }
    const entry = await shares.create(req.params.id, userId);
    res.status(201).json(entry);
  } catch (error) {
    console.error('Error minting share:', error);
    res.status(500).json({ error: 'Failed to create share' });
  }
});

app.get('/api/projects/:id/shares', async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId || !(await storage.userOwnsProject(req.params.id, userId))) {
      return res.status(403).json({ error: 'Not your project' });
    }
    const entries = await shares.listForProject(req.params.id);
    res.json(entries);
  } catch (error) {
    console.error('Error listing shares:', error);
    res.status(500).json({ error: 'Failed to list shares' });
  }
});

app.delete('/api/shares/:token', async (req, res) => {
  try {
    const userId = userIdOf(req);
    const entry = await shares.get(req.params.token);
    if (!entry) return res.status(404).json({ error: 'Share not found' });
    if (!userId || entry.ownerId !== userId) {
      return res.status(403).json({ error: 'Not your share' });
    }
    await shares.revoke(req.params.token);
    res.status(204).send();
  } catch (error) {
    console.error('Error revoking share:', error);
    res.status(500).json({ error: 'Failed to revoke share' });
  }
});

// Create a new project. ownerId is set to the requesting user.
app.post('/api/projects', async (req, res) => {
  try {
    const { presentation, thumbnailDataUrl } = req.body;
    if (!presentation || !presentation.id) {
      return res.status(400).json({ error: 'Invalid presentation data' });
    }
    const project = await storage.saveProject(presentation, thumbnailDataUrl, userIdOf(req));
    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Create or update a project. The client uses PUT for both ("save" is
// idempotent on the ID). Allow it when (a) the project doesn't exist yet
// (any identity may claim a fresh ID), or (b) the caller owns it. Reject
// only when there's an existing different owner.
app.put('/api/projects/:id', async (req, res) => {
  try {
    const userId = userIdOf(req);
    const existing = await storage.getProjectMeta(req.params.id);
    if (existing && existing.ownerId && userId && existing.ownerId !== userId) {
      return res.status(403).json({ error: 'Not your project' });
    }
    const { presentation, thumbnailDataUrl } = req.body;
    if (!presentation) {
      return res.status(400).json({ error: 'Invalid presentation data' });
    }
    presentation.id = req.params.id;
    const project = await storage.saveProject(presentation, thumbnailDataUrl, userId);
    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete a project. Owner-only.
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId || !(await storage.userOwnsProject(req.params.id, userId))) {
      return res.status(403).json({ error: 'Not your project' });
    }
    await storage.deleteProject(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Duplicate a project. The duplicating user owns the copy.
app.post('/api/projects/:id/duplicate', async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId || !(await storage.userOwnsProject(req.params.id, userId))) {
      return res.status(403).json({ error: 'Not your project' });
    }
    const project = await storage.duplicateProject(req.params.id, userId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(201).json(project);
  } catch (error) {
    console.error('Error duplicating project:', error);
    res.status(500).json({ error: 'Failed to duplicate project' });
  }
});

// Wrap Express in a bare http.Server so the WebSocket upgrade handler can hook
// it. attachYWS adds the /yjs/:projectId route + LevelDB persistence.
// Body-parser failures (an upload over the limit, malformed JSON) answer in
// JSON the editor can show, not Express's HTML error page.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'This deck is too large to upload in one request.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The uploaded deck is not valid JSON.' });
  }
  console.error('[server] request failed:', err);
  res.status(500).json({ error: `Request failed: ${err?.message ?? err}` });
});

const server = http.createServer(app);
const collab = attachYWS(server, storage, shares);

server.listen(PORT, () => {
  console.log(`Slides server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${storage.dataDir}`);
});
