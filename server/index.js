import express from 'express';
import cors from 'cors';
import http from 'http';
import { createStorage } from './storage.js';
import { attachYWS } from './yws.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize storage
const storage = createStorage('./data');

// Middleware
app.use(cors({ exposedHeaders: ['X-Slides-User'] }));
app.use(express.json({ limit: '50mb' })); // Large limit for presentations with embedded images

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

// Get a single project. Owner-only for now; share-token access added in the
// share-link commit.
app.get('/api/projects/:id', async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (userId && !(await storage.userOwnsProject(req.params.id, userId))) {
      return res.status(403).json({ error: 'Not your project' });
    }
    const project = await storage.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (error) {
    console.error('Error getting project:', error);
    res.status(500).json({ error: 'Failed to get project' });
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

// Update a project. Owner-only; collaborators write via the WS path.
app.put('/api/projects/:id', async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (userId && !(await storage.userOwnsProject(req.params.id, userId))) {
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
    if (userId && !(await storage.userOwnsProject(req.params.id, userId))) {
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
    if (userId && !(await storage.userOwnsProject(req.params.id, userId))) {
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
const server = http.createServer(app);
attachYWS(server, storage);

server.listen(PORT, () => {
  console.log(`Slides server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${storage.dataDir}`);
});
