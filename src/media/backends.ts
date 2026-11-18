import type { MediaBackend } from './mediaStore';

/**
 * The server's media: `PUT`/`GET /api/projects/:id/media/:hash`. Uploads are
 * raw bytes (no base64, no JSON) and the server checks the hash. Reads are
 * plain HTTP with Range support, so a <video> streams and seeks. The
 * credential rides in the query: a <video> or <img> cannot send headers.
 */
export function serverMediaBackend(serverUrl: string, projectId: string, auth: { userId: string; shareToken?: string | null }): MediaBackend {
  const base = `${serverUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/media`;
  const query = () => {
    const q = new URLSearchParams({ u: auth.userId });
    if (auth.shareToken) q.set('t', auth.shareToken);
    return q.toString();
  };
  const url = (hash: string) => `${base}/${hash}?${query()}`;
  return {
    id: `server:${base}`,
    streamUrl: url,
    async has(hash) {
      const res = await fetch(url(hash), { method: 'HEAD' });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`media ${hash.slice(0, 12)}: HTTP ${res.status}`);
      return true;
    },
    async download(hash) {
      const res = await fetch(url(hash));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`media ${hash.slice(0, 12)}: HTTP ${res.status}`);
      return await res.blob();
    },
    upload(hash, blob, onProgress) {
      // XHR, not fetch: fetch reports no upload progress.
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url(hash));
        xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : blob.size);
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload: HTTP ${xhr.status} ${xhr.responseText.slice(0, 200)}`)));
        xhr.onerror = () => reject(new Error('upload: network error'));
        xhr.send(blob);
      });
    },
  };
}

/** A filesystem vault keeps media in `media/<hash>` next to the decks. */
export function vaultMediaBackend(vault: FileSystemDirectoryHandle): MediaBackend {
  const dir = () => vault.getDirectoryHandle('media', { create: true });
  return {
    id: `vault:${vault.name}`,
    async has(hash) {
      try { await (await dir()).getFileHandle(hash); return true; } catch { return false; }
    },
    async download(hash) {
      try {
        return await (await (await dir()).getFileHandle(hash)).getFile();
      } catch (err) {
        if ((err as DOMException)?.name === 'NotFoundError') return null;
        throw err;
      }
    },
    async upload(hash, blob, onProgress) {
      const d = await dir();
      try { await d.getFileHandle(hash); onProgress?.(blob.size, blob.size); return; } catch { /* not there yet */ }
      const handle = await d.getFileHandle(`${hash}.part`, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      // Rename into place, so a half-written file never has the final name.
      const moved = handle as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
      if (moved.move) await moved.move(hash);
      else {
        const final = await (await d.getFileHandle(hash, { create: true })).createWritable();
        await final.write(blob);
        await final.close();
        await d.removeEntry(`${hash}.part`);
      }
      onProgress?.(blob.size, blob.size);
    },
  };
}
