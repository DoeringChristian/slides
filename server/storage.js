import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';

/**
 * File-based NoSQL storage for presentations
 * Each presentation is stored as a separate JSON file
 * Metadata index is stored in _index.json for fast listing
 */
export function createStorage(dataDir) {
  const resolvedDir = path.resolve(dataDir);
  const indexPath = path.join(resolvedDir, '_index.json');

  // Ensure data directory exists
  async function ensureDir() {
    try {
      await fs.mkdir(resolvedDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  // Load the index file
  async function loadIndex() {
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { projects: {} };
      }
      throw error;
    }
  }

  // Save the index file
  async function saveIndex(index) {
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  }

  // Get project file path
  function getProjectPath(id) {
    return path.join(resolvedDir, `${id}.json`);
  }

  return {
    dataDir: resolvedDir,

    // List all projects (returns metadata only)
    async listProjects() {
      await ensureDir();
      const index = await loadIndex();

      // Convert to array and sort by updatedAt
      const projects = Object.values(index.projects);
      projects.sort((a, b) => b.updatedAt - a.updatedAt);

      return projects;
    },

    // Get a single project with full presentation data
    async getProject(id) {
      await ensureDir();
      const projectPath = getProjectPath(id);

      try {
        const data = await fs.readFile(projectPath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },

    // Save a project (create or update)
    async saveProject(presentation, thumbnailDataUrl) {
      await ensureDir();

      const id = presentation.id;
      const projectPath = getProjectPath(id);

      // Save full presentation to file
      const projectData = {
        id,
        presentation,
        thumbnailDataUrl,
      };
      await fs.writeFile(projectPath, JSON.stringify(projectData, null, 2));

      // Update index with metadata
      const index = await loadIndex();
      index.projects[id] = {
        id,
        title: presentation.title,
        createdAt: presentation.createdAt,
        updatedAt: presentation.updatedAt,
        thumbnailDataUrl,
      };
      await saveIndex(index);

      return index.projects[id];
    },

    // Delete a project
    async deleteProject(id) {
      await ensureDir();

      const projectPath = getProjectPath(id);

      // Delete file
      try {
        await fs.unlink(projectPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      // Update index
      const index = await loadIndex();
      delete index.projects[id];
      await saveIndex(index);
    },

    // Duplicate a project
    async duplicateProject(id) {
      await ensureDir();

      const original = await this.getProject(id);
      if (!original) return null;

      const newId = nanoid();
      const newPresentation = {
        ...original.presentation,
        id: newId,
        title: `${original.presentation.title} (Copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      return this.saveProject(newPresentation, original.thumbnailDataUrl);
    },
  };
}
