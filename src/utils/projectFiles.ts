import type { Presentation } from '../types/presentation';
import type { ProjectMeta } from '../types/vault';

// Generate a safe filename from a title
export function generateFilename(title: string): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${sanitized || 'untitled'}.json`;
}

// List all presentations in the vault folder
export async function listProjects(vault: FileSystemDirectoryHandle): Promise<ProjectMeta[]> {
  const projects: ProjectMeta[] = [];

  for await (const entry of vault.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.json')) {
      try {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const text = await file.text();
        const data = JSON.parse(text) as Presentation;

        // Only include valid presentation files
        if (data.id && data.slideOrder && Array.isArray(data.slideOrder)) {
          projects.push({
            id: data.id,
            title: data.title || 'Untitled',
            filename: entry.name,
            createdAt: data.createdAt || file.lastModified,
            updatedAt: data.updatedAt || file.lastModified,
            thumbnailDataUrl: undefined, // Will be generated separately
          });
        }
      } catch {
        // Skip invalid JSON files
        console.warn(`Skipping invalid file: ${entry.name}`);
      }
    }
  }

  // Sort by most recently updated
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Load a specific presentation from the vault
export async function loadProject(
  vault: FileSystemDirectoryHandle,
  filename: string
): Promise<Presentation> {
  const fileHandle = await vault.getFileHandle(filename);
  const file = await fileHandle.getFile();
  const text = await file.text();
  return JSON.parse(text) as Presentation;
}

// Save a presentation to the vault
export async function saveProject(
  vault: FileSystemDirectoryHandle,
  presentation: Presentation,
  existingFilename?: string
): Promise<string> {
  // Use existing filename or generate new one
  const filename = existingFilename || generateFilename(presentation.title);

  // If title changed and we had an old file, delete it
  if (existingFilename && existingFilename !== filename) {
    try {
      await vault.removeEntry(existingFilename);
    } catch {
      // Old file might not exist, ignore
    }
  }

  const fileHandle = await vault.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(presentation, null, 2));
  await writable.close();

  return filename;
}

// Delete a presentation from the vault
export async function deleteProject(
  vault: FileSystemDirectoryHandle,
  filename: string
): Promise<void> {
  await vault.removeEntry(filename);
}

// Duplicate a presentation
export async function duplicateProject(
  vault: FileSystemDirectoryHandle,
  filename: string
): Promise<ProjectMeta> {
  const original = await loadProject(vault, filename);

  // Create a copy with new ID and modified title
  const copy: Presentation = {
    ...original,
    id: crypto.randomUUID(),
    title: `${original.title} (Copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const newFilename = await saveProject(vault, copy);

  return {
    id: copy.id,
    title: copy.title,
    filename: newFilename,
    createdAt: copy.createdAt,
    updatedAt: copy.updatedAt,
  };
}

// Check if a filename already exists in the vault
export async function filenameExists(
  vault: FileSystemDirectoryHandle,
  filename: string
): Promise<boolean> {
  try {
    await vault.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}
