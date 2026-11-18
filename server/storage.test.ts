import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { createStorage } from './storage.js';
import { createMediaFiles, HashMismatchError } from './mediaFiles.js';

const sha = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
const bytes = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255));
const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'storage-'));
/** A body arriving in chunks, as an HTTP upload does. */
const body = (buf: Buffer) => Readable.from((function* () { for (let i = 0; i < buf.length; i += 65536) yield buf.subarray(i, i + 65536); })());

function deck(id: string, hashes: string[]) {
  return {
    id, title: 'Deck', createdAt: 1, updatedAt: 2,
    resources: Object.fromEntries(hashes.map((hash, i) => [`r${i}`, { id: `r${i}`, name: `r${i}`, type: 'video', hash, mime: 'video/mp4', size: 1, originalWidth: 1, originalHeight: 1 }])),
    slides: {}, slideOrder: [],
  };
}

describe('media files', () => {
  it('keeps an upload byte for byte, with its type, under its hash', async () => {
    const media = createMediaFiles(await tempDir());
    const video = bytes(3_000_000, 1);
    expect(await media.put('p1', sha(video), 'video/mp4', body(video))).toEqual({ size: video.length });
    const file = await media.file('p1', sha(video));
    expect(file).toMatchObject({ mime: 'video/mp4', size: video.length });
    expect((await fs.readFile(file!.path)).equals(video)).toBe(true);
  });

  it('refuses bytes that do not match the hash, and leaves nothing behind', async () => {
    const dir = await tempDir();
    const media = createMediaFiles(dir);
    const claimed = sha(bytes(10, 2));
    await expect(media.put('p1', claimed, 'image/png', body(bytes(10, 3)))).rejects.toBeInstanceOf(HashMismatchError);
    expect(await media.file('p1', claimed)).toBeNull();
    expect(await fs.readdir(path.join(dir, 'media', 'p1'))).toEqual([]);
  });

  it('never serves a path outside its folder', async () => {
    const media = createMediaFiles(await tempDir());
    expect(await media.file('p1', '../../_index.json')).toBeNull();
    await expect(media.put('p1', '../x', 'a/b', body(Buffer.from('x')))).rejects.toBeInstanceOf(HashMismatchError);
  });

  it('prunes unreferenced files only after the grace period', async () => {
    const media = createMediaFiles(await tempDir());
    const kept = bytes(10, 4), dropped = bytes(10, 5);
    await media.put('p1', sha(kept), 'image/png', body(kept));
    await media.put('p1', sha(dropped), 'image/png', body(dropped));
    await media.prune('p1', new Set([sha(kept)]));
    expect(await media.file('p1', sha(dropped))).not.toBeNull(); // still within the grace period: undo works
    await media.prune('p1', new Set([sha(kept)]), 0);
    expect(await media.file('p1', sha(dropped))).toBeNull();
    expect(await media.file('p1', sha(kept))).not.toBeNull();
  });
});

describe('storage', () => {
  it('a deck file holds references only, however large its media', async () => {
    const dir = await tempDir();
    const storage = createStorage(dir);
    const video = bytes(2_000_000, 6);
    await storage.media.put('deckA', sha(video), 'video/mp4', body(video));
    await storage.saveProject(deck('deckA', [sha(video)]), undefined, 'u1');
    expect((await fs.stat(path.join(dir, 'deckA.json'))).size).toBeLessThan(5_000);
    expect((await storage.getProject('deckA')).presentation.resources.r0.hash).toBe(sha(video));
  });

  it('a duplicate gets its own media; deleting a deck removes its media', async () => {
    const dir = await tempDir();
    const storage = createStorage(dir);
    const a = bytes(100, 7);
    await storage.media.put('deckB', sha(a), 'image/png', body(a));
    await storage.saveProject(deck('deckB', [sha(a)]), undefined, 'u1');
    const copy = await storage.duplicateProject('deckB', 'u1');
    await storage.deleteProject('deckB');
    await expect(fs.access(path.join(dir, 'media', 'deckB'))).rejects.toThrow();
    const file = await storage.media.file(copy.id, sha(a));
    expect((await fs.readFile(file!.path)).equals(a)).toBe(true);
  });
});
