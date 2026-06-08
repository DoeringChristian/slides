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

  // Serialize read-modify-write cycles on _index.json. Without this, two
  // concurrent saveProject calls each load the same snapshot, mutate, and
  // race on writeFile — the loser's update is lost. Single-process Promise
  // tail is enough; the server is single-node by design.
  let indexTail = Promise.resolve();
  function withIndexLock(fn) {
    const run = indexTail.then(fn, fn);
    indexTail = run.catch(() => {});
    return run;
  }

  // Get project file path
  function getProjectPath(id) {
    return path.join(resolvedDir, `${id}.json`);
  }

  return {
    dataDir: resolvedDir,

    // List projects. If `filter.ownerId` is set, returns only projects owned
    // by that user. Legacy projects without an ownerId are excluded from the
    // list but stay reachable via direct GET /api/projects/:id — once their
    // owner saves them again, they get stamped and reappear in the list.
    async listProjects(filter = {}) {
      await ensureDir();
      const index = await loadIndex();

      let projects = Object.values(index.projects);
      if (filter.ownerId) {
        projects = projects.filter((p) => p.ownerId === filter.ownerId);
      }
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      return projects;
    },

    // True iff the given user owns the project (or it predates ownership).
    async userOwnsProject(id, userId) {
      const index = await loadIndex();
      const entry = index.projects[id];
      if (!entry) return false;
      return !entry.ownerId || entry.ownerId === userId;
    },

    // Lookup the index entry (or null) — used by REST handlers that need to
    // distinguish "doesn't exist yet" (allow create) from "exists but owned
    // by someone else" (deny).
    async getProjectMeta(id) {
      const index = await loadIndex();
      return index.projects[id] || null;
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

    // Save a project (create or update). ownerId is only set on first save;
    // subsequent saves preserve the existing owner so collaborators can write
    // back without taking ownership. thumbnailDataUrl is preserved when the
    // caller passes undefined — the Y-snapshot path in yws.js only has the
    // presentation, not a freshly-rendered thumbnail, and we don't want to
    // wipe a perfectly good one every 5 seconds.
    async saveProject(presentation, thumbnailDataUrl, ownerId) {
      await ensureDir();
      return withIndexLock(async () => {
        const id = presentation.id;
        const projectPath = getProjectPath(id);
        const index = await loadIndex();
        const existing = index.projects[id];

        const resolvedThumb =
          thumbnailDataUrl !== undefined ? thumbnailDataUrl : existing?.thumbnailDataUrl;

        const projectData = {
          id,
          presentation,
          thumbnailDataUrl: resolvedThumb,
        };
        await fs.writeFile(projectPath, JSON.stringify(projectData, null, 2));

        index.projects[id] = {
          id,
          title: presentation.title,
          createdAt: presentation.createdAt,
          updatedAt: presentation.updatedAt,
          thumbnailDataUrl: resolvedThumb,
          ownerId: existing?.ownerId ?? ownerId,
        };
        await saveIndex(index);

        return index.projects[id];
      });
    },

    // Delete a project
    async deleteProject(id) {
      await ensureDir();
      return withIndexLock(async () => {
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
      });
    },

    // Duplicate a project. The duplicating user becomes the owner of the copy.
    async duplicateProject(id, ownerId) {
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

      return this.saveProject(newPresentation, original.thumbnailDataUrl, ownerId);
    },
  };
}
