import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { writeFileAtomic } from './atomicWrite.js';

/**
 * A deck's media kept beside its JSON instead of inside it.
 *
 * Decks embed images and videos as base64 data URLs, and a deck file used to
 * be one JSON.stringify of everything. V8 cannot build a string longer than
 * ~537 M characters, so a deck with ~500 MB of media could no longer be
 * saved — every snapshot failed. On disk each base64 data URL now lives as its
 * own binary file, `media/<projectId>/<sha256>`, and the JSON holds a
 * reference `slides-media:<header>|<sha256>` in its place. Reading restores
 * the data URL, so everything above storage sees the deck as before.
 *
 * Only canonical base64 is moved (decoding and re-encoding must give back
 * the exact string); anything else stays inline.
 */

const REF_PREFIX = 'slides-media:';
const DATA_URL = /^data:([^,]*;base64),/;
const SHA = /^[0-9a-f]{64}$/;

export function isMediaRef(src) {
  return typeof src === 'string' && src.startsWith(REF_PREFIX);
}

function parseRef(src) {
  const body = src.slice(REF_PREFIX.length);
  const bar = body.lastIndexOf('|');
  const header = body.slice(0, bar), sha = body.slice(bar + 1);
  return bar > 0 && SHA.test(sha) ? { header, sha } : null;
}

/** Every src slot of a presentation: resources and image backgrounds. */
function srcSlots(presentation) {
  const slots = [];
  for (const resource of Object.values(presentation?.resources ?? {})) {
    if (resource && typeof resource.src === 'string') slots.push(resource);
  }
  for (const slide of Object.values(presentation?.slides ?? {})) {
    const bg = slide?.background;
    if (bg && bg.type === 'image' && typeof bg.src === 'string') slots.push(bg);
  }
  return slots;
}

export function createMediaFiles(dataDir, { hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex') } = {}) {
  const root = path.join(dataDir, 'media');
  const dirOf = (projectId) => path.join(root, projectId);
  // projectId → (data URL string → ref). Y.Map hands back the same string
  // instance on every snapshot, so a lookup is a pointer compare: an
  // unchanged 100 MB video is neither decoded nor hashed again.
  const refCache = new Map();

  async function exists(file) {
    try { await fs.access(file); return true; } catch { return false; }
  }

  return {
    root,

    /**
     * A copy of `presentation` with base64 media replaced by references, and
     * its media files written. Returns the copy and the referenced hashes.
     */
    async externalize(projectId, presentation) {
      const cache = refCache.get(projectId) ?? new Map();
      const nextCache = new Map();
      const referenced = new Set();
      const copy = structuredCloneShallow(presentation);
      for (const slot of srcSlots(copy)) {
        const src = slot.src;
        if (isMediaRef(src)) {
          const ref = parseRef(src);
          if (ref) referenced.add(ref.sha);
          continue;
        }
        const m = DATA_URL.exec(src);
        if (!m) continue;
        let ref = cache.get(src);
        if (!ref) {
          const base64 = src.slice(m[0].length);
          const buf = Buffer.from(base64, 'base64');
          // Non-canonical base64 (whitespace, odd padding) would not come
          // back byte-identical: keep it inline.
          if (buf.length === 0 || buf.toString('base64') !== base64) continue;
          const sha = hash(buf);
          const file = path.join(dirOf(projectId), sha);
          if (!(await exists(file))) {
            await fs.mkdir(dirOf(projectId), { recursive: true });
            await writeFileAtomic(file, buf);
          }
          ref = `${REF_PREFIX}${m[1]}|${sha}`;
        } else {
          // Cached, but the file may have been removed by hand.
          const sha = parseRef(ref).sha;
          const file = path.join(dirOf(projectId), sha);
          if (!(await exists(file))) {
            await fs.mkdir(dirOf(projectId), { recursive: true });
            await writeFileAtomic(file, Buffer.from(src.slice(m[0].length), 'base64'));
          }
        }
        nextCache.set(src, ref);
        referenced.add(parseRef(ref).sha);
        slot.src = ref;
      }
      refCache.set(projectId, nextCache);
      return { presentation: copy, referenced };
    },

    /** Restore data URLs in place. A missing file keeps its reference (and
     *  so stays referenced) rather than dropping the media for good. */
    async internalize(projectId, presentation) {
      for (const slot of srcSlots(presentation)) {
        if (!isMediaRef(slot.src)) continue;
        const ref = parseRef(slot.src);
        if (!ref) continue;
        try {
          const buf = await fs.readFile(path.join(dirOf(projectId), ref.sha));
          slot.src = `data:${ref.header},${buf.toString('base64')}`;
        } catch (err) {
          console.error(`[storage] media ${ref.sha} of ${projectId} is missing:`, err?.message ?? err);
        }
      }
      return presentation;
    },

    /** Delete the project's media files nothing references any more. */
    async prune(projectId, referenced) {
      let names;
      try { names = await fs.readdir(dirOf(projectId)); } catch { return; }
      await Promise.all(names.filter(n => SHA.test(n) && !referenced.has(n))
        .map(n => fs.rm(path.join(dirOf(projectId), n), { force: true })));
    },

    async remove(projectId) {
      refCache.delete(projectId);
      await fs.rm(dirOf(projectId), { recursive: true, force: true });
    },
  };
}

/** Copy only what externalize rewrites: the resources and the slides'
 *  backgrounds. Everything else is shared with the caller's object. */
function structuredCloneShallow(presentation) {
  const resources = {};
  for (const [id, r] of Object.entries(presentation?.resources ?? {})) resources[id] = r && typeof r === 'object' ? { ...r } : r;
  const slides = {};
  for (const [id, s] of Object.entries(presentation?.slides ?? {})) {
    slides[id] = s && typeof s === 'object' && s.background && typeof s.background === 'object' ? { ...s, background: { ...s.background } } : s;
  }
  return { ...presentation, ...(presentation?.resources ? { resources } : {}), ...(presentation?.slides ? { slides } : {}) };
}
