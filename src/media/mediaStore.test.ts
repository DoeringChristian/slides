import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMedia, ensureMedia, flushUploads, getMediaBlob, hashBlob, mediaDataUrl, mediaSource, publishDeckMedia,
  resetMediaStoreForTests, setMediaBackend, type MediaBackend,
} from './mediaStore';
import { importEmbeddedMedia } from './importMedia';
import { importDeckFileMedia } from './deckFile';
import type { Resource } from '../types/presentation';

/** A backend kept in memory, recording what it was asked. */
function memoryBackend(id = 'test') {
  const files = new Map<string, Blob>();
  const calls = { upload: [] as string[], download: [] as string[] };
  const backend: MediaBackend = {
    id,
    async has(hash) { return files.has(hash); },
    async download(hash) { calls.download.push(hash); return files.get(hash) ?? null; },
    async upload(hash, blob, onProgress) { calls.upload.push(hash); files.set(hash, blob); onProgress?.(blob.size, blob.size); },
  };
  return { backend, files, calls };
}
const resource = (hash: string, id = 'r'): Resource => ({ id, name: id, type: 'image', hash, mime: 'image/png', size: 3, originalWidth: 1, originalHeight: 1 });

beforeEach(() => resetMediaStoreForTests());

describe('media store', () => {
  it('a new file is shown at once and uploaded to the open deck’s backend', async () => {
    const { backend, files } = memoryBackend();
    setMediaBackend(backend);
    const info = await addMedia(new Blob(['abc'], { type: 'image/png' }));
    expect(info).toEqual({ hash: await hashBlob(new Blob(['abc'])), mime: 'image/png', size: 3 });
    await flushUploads();
    expect(files.has(info.hash)).toBe(true);
    // Shown from this machine's copy, not the server.
    expect(mediaSource(info.hash)).toMatchObject({ url: expect.stringMatching(/^blob:/), status: 'ready' });
  });

  it('an imported file stays here until its deck is opened, then is published', async () => {
    const { backend, files, calls } = memoryBackend();
    setMediaBackend(backend); // another deck is open
    const info = await addMedia(new Blob(['xyz']), 'image/png', { upload: false });
    await flushUploads();
    expect(calls.upload).toEqual([]);
    const target = memoryBackend('deck-b');
    setMediaBackend(target.backend);
    await publishDeckMedia({ resources: { r: resource(info.hash) } });
    await flushUploads();
    expect(target.files.has(info.hash)).toBe(true);
    expect(files.has(info.hash)).toBe(false);
  });

  it('a file not found anywhere is not asked for again in a loop', async () => {
    const { backend, calls } = memoryBackend();
    setMediaBackend(backend);
    const hash = 'f'.repeat(64);
    expect(await getMediaBlob(hash)).toBeNull();
    expect(await getMediaBlob(hash)).toBeNull();
    expect(mediaSource(hash)).toEqual({ url: null, status: 'missing' });
    expect(calls.download).toEqual([hash]);
    // An explicit request (presenting, exporting) asks again.
    expect(await getMediaBlob(hash, { force: true })).toBeNull();
    expect(calls.download).toEqual([hash, hash]);
  });

  it('ensureMedia copies every file here and names what is missing', async () => {
    const { backend, files } = memoryBackend();
    const blob = new Blob(['present']);
    const hash = await hashBlob(blob);
    files.set(hash, blob);
    setMediaBackend(backend);
    const missing = resource('0'.repeat(64), 'gone');
    const progress = vi.fn();
    const r = await ensureMedia({ resources: { a: resource(hash, 'a'), gone: missing } }, progress);
    expect(r).toMatchObject({ ready: 1, total: 2, missing: [missing] });
    expect(progress).toHaveBeenCalled();
    // Now local: available without the backend.
    setMediaBackend(null);
    expect(await getMediaBlob(hash)).not.toBeNull();
  });

  it('gives a data URL only on request, from the bytes', async () => {
    const info = await addMedia(new Blob([new Uint8Array([1, 2, 3])]), 'image/png');
    expect(await mediaDataUrl({ hash: info.hash, mime: 'image/png' })).toBe('data:image/png;base64,AQID');
  });
});

describe('importing decks that carry their media', () => {
  it('moves embedded data URLs into the store; the deck keeps references', async () => {
    const raw = {
      resources: { a: { id: 'a', name: 'a', type: 'image', src: 'data:image/png;base64,AQID', originalWidth: 1, originalHeight: 1 } },
      slides: { s: { background: { type: 'image', src: 'data:image/png;base64,BAUG' } } },
    };
    const out = await importEmbeddedMedia(raw) as typeof raw & { resources: Record<string, Resource> };
    const a = out.resources.a as unknown as Resource;
    expect(a).not.toHaveProperty('src');
    expect(a).toMatchObject({ mime: 'image/png', size: 3, hash: await hashBlob(new Blob([new Uint8Array([1, 2, 3])])) });
    const bg = out.slides.s.background as unknown as { resourceId: string };
    expect(out.resources[bg.resourceId]).toMatchObject({ type: 'image', size: 3 });
    expect(await getMediaBlob(a.hash)).not.toBeNull();
  });

  it('a deck file’s media section goes into the store, not into the deck', async () => {
    const hash = await hashBlob(new Blob([new Uint8Array([7, 8])]));
    const out = await importDeckFileMedia({ id: 'd', media: { [hash]: { mime: 'image/png', data: 'Bwg=' } } });
    expect(out).toEqual({ id: 'd' });
    expect((await getMediaBlob(hash))?.size).toBe(2);
  });
});
