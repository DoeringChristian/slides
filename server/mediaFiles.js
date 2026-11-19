import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import crypto from 'crypto';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

/**
 * A project's media files: `media/<projectId>/<sha256>` holds the bytes as
 * uploaded (no base64, no JSON), `<sha256>.type` its MIME type. A deck
 * references each file by that hash (`Resource.hash`), so the deck itself
 * stays small however large its videos are, and the editor streams them
 * with HTTP Range requests.
 */

const SHA = /^[0-9a-f]{64}$/;
/** Unreferenced files are kept this long: undoing the deletion of a video,
 *  or a collaborator's upload that lands before its resource, still works. */
export const PRUNE_GRACE_MS = 7 * 24 * 3600 * 1000;

export class HashMismatchError extends Error {}

export function createMediaFiles(dataDir) {
  const root = path.join(dataDir, 'media');
  const dirOf = (projectId) => path.join(root, projectId);

  async function stat(file) {
    try { return await fs.stat(file); } catch { return null; }
  }

  return {
    root,

    /** The file of one hash, or null. */
    async file(projectId, sha) {
      if (!SHA.test(sha)) return null;
      const file = path.join(dirOf(projectId), sha);
      const st = await stat(file);
      if (!st?.isFile()) return null;
      const mime = (await fs.readFile(`${file}.type`, 'utf8').catch(() => '')).trim() || 'application/octet-stream';
      return { path: file, mime, size: st.size };
    },

    /**
     * Store an upload. The body streams to a temporary file while it is
     * hashed; only bytes whose SHA-256 is `sha` are kept (renamed into place,
     * so a reader never sees half a file). Idempotent.
     */
    async put(projectId, sha, mime, body) {
      if (!SHA.test(sha)) throw new HashMismatchError('not a SHA-256 hash');
      const dir = dirOf(projectId);
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, sha);
      const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
      const hash = crypto.createHash('sha256');
      let size = 0;
      try {
        await pipeline(body, new Transform({
          transform(chunk, _enc, done) { hash.update(chunk); size += chunk.length; done(null, chunk); },
        }), createWriteStream(tmp));
        const got = hash.digest('hex');
        if (got !== sha) throw new HashMismatchError(`the uploaded bytes hash to ${got}, not ${sha}`);
        await fs.writeFile(`${target}.type`, String(mime || 'application/octet-stream').slice(0, 200));
        await fs.rename(tmp, target);
        return { size };
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    },

    /** Delete files no deck references any more, once they are older than
     *  the grace period. */
    async prune(projectId, referenced, graceMs = PRUNE_GRACE_MS) {
      let names;
      try { names = await fs.readdir(dirOf(projectId)); } catch { return; }
      const now = Date.now();
      for (const name of names) {
        if (!SHA.test(name) || referenced.has(name)) continue;
        const file = path.join(dirOf(projectId), name);
        const st = await stat(file);
        // (A zero grace prunes at once: a file's timestamp can be a fraction
        // of a millisecond ahead of the clock.)
        if (st && (graceMs <= 0 || now - st.mtimeMs >= graceMs)) {
          await fs.rm(file, { force: true });
          await fs.rm(`${file}.type`, { force: true });
        }
      }
    },

    /** Give a copy of a project its own media (hard links where possible). */
    async copy(fromId, toId) {
      let names;
      try { names = await fs.readdir(dirOf(fromId)); } catch { return; }
      await fs.mkdir(dirOf(toId), { recursive: true });
      for (const name of names) {
        if (name.endsWith('.part')) continue;
        const from = path.join(dirOf(fromId), name), to = path.join(dirOf(toId), name);
        try { await fs.link(from, to); } catch { await pipeline(createReadStream(from), createWriteStream(to)); }
      }
    },

    async remove(projectId) {
      await fs.rm(dirOf(projectId), { recursive: true, force: true });
    },
  };
}

/** The media hashes a deck references. */
export function referencedMedia(presentation) {
  const out = new Set();
  for (const r of Object.values(presentation?.resources ?? {})) if (r && typeof r.hash === 'string') out.add(r.hash);
  return out;
}
