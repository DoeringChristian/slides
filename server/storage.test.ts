import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createStorage } from './storage.js';

const sha = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
const bytes = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255));
const dataUrl = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;

function deck(id: string, resources: Record<string, string>, background?: string) {
  return {
    id, title: 'Deck', createdAt: 1, updatedAt: 2,
    resources: Object.fromEntries(Object.entries(resources).map(([rid, src]) => [rid, { id: rid, name: rid, type: 'image', src, originalWidth: 1, originalHeight: 1 }])),
    slides: { s1: { id: 's1', elements: {}, elementOrder: [], background: background ? { type: 'image', src: background } : { type: 'solid', color: '#fff' } } },
    slideOrder: ['s1'],
  };
}

async function tempStorage(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-'));
  return { dir, storage: createStorage(dir, options) };
}

describe('storage keeps media beside the deck JSON', () => {
  it('round-trips media byte for byte while the JSON holds only references', async () => {
    const { dir, storage } = await tempStorage();
    const video = bytes(3_000_000, 1), image = bytes(500_000, 2), bg = bytes(1000, 3);
    const p = deck('deckA', { v: dataUrl('video/mp4', video), i: dataUrl('image/png', image), t: 'data:image/svg+xml,%3Csvg%2F%3E' }, dataUrl('image/jpeg', bg));
    await storage.saveProject(p, undefined, 'u1');

    const file = await fs.readFile(path.join(dir, 'deckA.json'), 'utf8');
    expect(file.length).toBeLessThan(10_000);
    expect(file).not.toContain('base64,');
    expect(file).toContain(`slides-media:video/mp4;base64|${sha(video)}`);
    expect(file).toContain('data:image/svg+xml,%3Csvg%2F%3E'); // not base64: stays inline
    expect((await fs.readFile(path.join(dir, 'media', 'deckA', sha(video)))).equals(video)).toBe(true);

    const back = await storage.getProject('deckA');
    expect(back.presentation).toEqual(p);
  });

  it('does not decode or hash unchanged media again on the next snapshot', async () => {
    const hash = vi.fn((buf: Buffer) => sha(buf));
    const { storage } = await tempStorage({ hash });
    const p = deck('deckB', { v: dataUrl('video/mp4', bytes(200_000, 4)) });
    await storage.saveProject(p, undefined, 'u1');
    await storage.saveProject({ ...p, title: 'Renamed' }, undefined, 'u1');
    expect(hash).toHaveBeenCalledTimes(1);
  });

  it('deletes the file of media the deck no longer uses, keeps the rest', async () => {
    const { dir, storage } = await tempStorage();
    const a = bytes(1000, 5), b = bytes(1000, 6);
    await storage.saveProject(deck('deckC', { a: dataUrl('image/png', a), b: dataUrl('image/png', b) }), undefined, 'u1');
    await storage.saveProject(deck('deckC', { a: dataUrl('image/png', a) }), undefined, 'u1');
    expect((await fs.readdir(path.join(dir, 'media', 'deckC'))).sort()).toEqual([sha(a)]);
  });

  it('loads a deck file that still has its media inline', async () => {
    const { dir, storage } = await tempStorage();
    const p = deck('deckD', { a: dataUrl('image/png', bytes(100, 7)) });
    await fs.writeFile(path.join(dir, 'deckD.json'), JSON.stringify({ id: 'deckD', presentation: p }));
    expect((await storage.getProject('deckD')).presentation).toEqual(p);
  });

  it('keeps the reference of a missing media file so a later save cannot drop it', async () => {
    const { dir, storage } = await tempStorage();
    const a = bytes(100, 8);
    await storage.saveProject(deck('deckE', { a: dataUrl('image/png', a) }), undefined, 'u1');
    await fs.rm(path.join(dir, 'media', 'deckE', sha(a)));
    const back = await storage.getProject('deckE');
    expect(back.presentation.resources.a.src).toBe(`slides-media:image/png;base64|${sha(a)}`);
    await storage.saveProject(back.presentation, undefined, 'u1');
    expect(await fs.readFile(path.join(dir, 'deckE.json'), 'utf8')).toContain(sha(a));
  });

  it('a duplicate gets its own media; deleting a deck removes its media', async () => {
    const { dir, storage } = await tempStorage();
    const a = bytes(100, 9);
    await storage.saveProject(deck('deckF', { a: dataUrl('image/png', a) }), undefined, 'u1');
    const copy = await storage.duplicateProject('deckF', 'u1');
    await storage.deleteProject('deckF');
    await expect(fs.access(path.join(dir, 'media', 'deckF'))).rejects.toThrow();
    expect((await storage.getProject(copy.id)).presentation.resources.a.src).toBe(dataUrl('image/png', a));
  });
});
