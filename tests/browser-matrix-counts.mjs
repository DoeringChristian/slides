import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Counts of recorded matrix rows, not successful assertions. Keep artifact
// relative paths: two nested artifacts may legitimately share a basename.
export async function matrixRecordCounts(root) {
  const counts = {};
  async function walk(relative = '') {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith('.json')) {
        let data; try { data = JSON.parse(await readFile(join(root, path), 'utf8')); } catch { continue; }
        if (Array.isArray(data)) counts[path] = data.length;
        else if (data) for (const key of ['matrix', 'results', 'records']) {
          if (Array.isArray(data[key])) counts[`${path}:${key}`] = data[key].length;
        }
      }
    }
  }
  await walk(); return counts;
}
