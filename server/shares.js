// Share-token store. Each share lives as one file under data/shares/<token>.json
// containing { projectId, ownerId, createdAt, revoked }. The token itself is
// the capability — anyone holding it (via the share URL) can read the project
// and join its Y.Doc room until revoked. No expiry yet; can be added later.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export function createShareStore(dataDir) {
  const sharesDir = path.join(dataDir, 'shares');

  async function ensureDir() {
    await fs.mkdir(sharesDir, { recursive: true });
  }

  function shareFile(token) {
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(token)) {
      throw new Error('Invalid token format');
    }
    return path.join(sharesDir, `${token}.json`);
  }

  return {
    /** Mint a new share token for a project. Caller already verified
     *  ownership. */
    async create(projectId, ownerId) {
      await ensureDir();
      const token = crypto.randomBytes(18).toString('base64url');
      const entry = { token, projectId, ownerId, createdAt: Date.now(), revoked: false };
      await fs.writeFile(shareFile(token), JSON.stringify(entry, null, 2));
      return entry;
    },

    async get(token) {
      try {
        const raw = await fs.readFile(shareFile(token), 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    /** Returns active (non-revoked) shares for a project. Used by the owner's
     *  ShareDialog to list current links. */
    async listForProject(projectId) {
      await ensureDir();
      const files = await fs.readdir(sharesDir);
      const entries = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f) => {
            try {
              return JSON.parse(await fs.readFile(path.join(sharesDir, f), 'utf-8'));
            } catch {
              return null;
            }
          }),
      );
      return entries.filter((e) => e && e.projectId === projectId && !e.revoked);
    },

    /** Revoke a token. Returns true if a revoke happened, false if not found. */
    async revoke(token) {
      const entry = await this.get(token);
      if (!entry) return false;
      entry.revoked = true;
      entry.revokedAt = Date.now();
      await fs.writeFile(shareFile(token), JSON.stringify(entry, null, 2));
      return true;
    },

    /** True iff `token` grants access to `projectId` right now. */
    async isValid(token, projectId) {
      const entry = await this.get(token);
      return !!entry && !entry.revoked && entry.projectId === projectId;
    },
  };
}
