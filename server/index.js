import express from 'express';
import cors from 'cors';
import { createStorage } from './storage.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize storage
const storage = createStorage('./data');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for presentations with embedded images

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// List all projects (metadata only)
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await storage.listProjects();
    res.json(projects);
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// Get a single project
app.get('/api/projects/:id', async (req, res) => {
  try {
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

// Create a new project
app.post('/api/projects', async (req, res) => {
  try {
    const { presentation, thumbnailDataUrl } = req.body;
    if (!presentation || !presentation.id) {
      return res.status(400).json({ error: 'Invalid presentation data' });
    }
    const project = await storage.saveProject(presentation, thumbnailDataUrl);
    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update a project
app.put('/api/projects/:id', async (req, res) => {
  try {
    const { presentation, thumbnailDataUrl } = req.body;
    if (!presentation) {
      return res.status(400).json({ error: 'Invalid presentation data' });
    }
    // Ensure ID matches
    presentation.id = req.params.id;
    const project = await storage.saveProject(presentation, thumbnailDataUrl);
    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete a project
app.delete('/api/projects/:id', async (req, res) => {
  try {
    await storage.deleteProject(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Duplicate a project
app.post('/api/projects/:id/duplicate', async (req, res) => {
  try {
    const project = await storage.duplicateProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(201).json(project);
  } catch (error) {
    console.error('Error duplicating project:', error);
    res.status(500).json({ error: 'Failed to duplicate project' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Slides server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${storage.dataDir}`);
});
