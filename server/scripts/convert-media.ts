/**
 * Convert a server data folder to media files.
 *
 *   npx tsx server/scripts/convert-media.ts --from server/data --to server/data-converted
 *
 * Reads `--from` and NEVER writes to it. Writes a complete new data folder at
 * `--to` (which must not exist):
 *   - every deck with its media moved out of the deck into
 *     `media/<projectId>/<sha256>` (+ `.type`), resources referencing it by
 *     hash; image backgrounds become resources;
 *   - a fresh LevelDB (`ydocs/`) holding each converted deck — without the
 *     old history, which kept every media file as base64 text;
 *   - everything else (`_index.json`, shares, sign-ins) copied unchanged.
 * Then it reopens the new folder and checks every deck: it validates, its
 * slide and element counts match the source, and every media hash resolves.
 *
 * The live deck is the LevelDB doc where there is one (the JSON is only a
 * backup copy of it), else the JSON file. Stop the server first: LevelDB
 * allows one process at a time.
 */
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as Y from 'yjs';
import { LeveldbPersistence } from 'y-leveldb';
import { jsonToYDoc, yDocToJson } from '../../src/collab/ySchema';
import { upgradeNativePresentation } from '../../src/utils/model/legacyPresentation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- decks of any age, untyped by design
type Raw = Record<string, any>;
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const from = path.resolve(arg('--from') ?? '');
const to = path.resolve(arg('--to') ?? '');
if (!arg('--from') || !arg('--to')) { console.error('usage: convert-media.ts --from <data dir> --to <new data dir>'); process.exit(2); }
if (existsSync(to)) { console.error(`${to} exists: choose a new folder.`); process.exit(2); }
if (!existsSync(path.join(from, '_index.json'))) { console.error(`${from} has no _index.json: not a data folder.`); process.exit(2); }

const SHA = /^[0-9a-f]{64}$/;
const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

async function writeMedia(projectId: string, buf: Buffer, mime: string): Promise<string> {
  const sha = sha256(buf);
  const dir = path.join(to, 'media', projectId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, sha);
  if (!existsSync(file)) await fs.writeFile(file, buf);
  await fs.writeFile(`${file}.type`, mime);
  return sha;
}

/** The bytes and type of an embedded src: a data URL, or the `slides-media:`
 *  reference the size fix wrote into backup copies. */
async function bytesOf(projectId: string, src: string): Promise<{ buf: Buffer; mime: string }> {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    const header = src.slice(5, comma);
    const mime = header.split(';')[0] || 'application/octet-stream';
    const body = src.slice(comma + 1);
    return { buf: header.endsWith(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body)), mime };
  }
  if (src.startsWith('slides-media:')) {
    const body = src.slice('slides-media:'.length);
    const bar = body.lastIndexOf('|');
    const sha = body.slice(bar + 1);
    const mime = body.slice(0, bar).split(';')[0] || 'application/octet-stream';
    return { buf: await fs.readFile(path.join(from, 'media', projectId, sha)), mime };
  }
  throw new Error(`unsupported media source ${src.slice(0, 60)}`);
}

async function convertDeck(projectId: string, deck: Raw): Promise<{ deck: Raw; files: number; bytes: number }> {
  let files = 0, bytes = 0;
  const resources: Raw = deck.resources ?? (deck.resources = {});
  for (const r of Object.values<Raw>(resources)) {
    if (typeof r.src === 'string') {
      const { buf, mime } = await bytesOf(projectId, r.src);
      r.hash = await writeMedia(projectId, buf, mime);
      r.mime = mime; r.size = buf.length;
      delete r.src;
      files++; bytes += buf.length;
    } else if (typeof r.hash === 'string' && SHA.test(r.hash)) {
      // Already a reference: carry its file over.
      const src = path.join(from, 'media', projectId, r.hash);
      const buf = await fs.readFile(src);
      await writeMedia(projectId, buf, r.mime ?? 'application/octet-stream');
      files++; bytes += buf.length;
    }
  }
  const byHash = new Map(Object.values<Raw>(resources).map(r => [r.hash, r.id]));
  for (const collection of [deck.slides, deck.templates]) {
    for (const slide of Object.values<Raw>(collection ?? {})) {
      const bg = slide?.background;
      if (!bg || bg.type !== 'image' || typeof bg.src !== 'string') continue;
      const { buf, mime } = await bytesOf(projectId, bg.src);
      const hash = await writeMedia(projectId, buf, mime);
      let id = byHash.get(hash);
      if (!id) {
        id = `bg-${hash.slice(0, 12)}`;
        resources[id] = { id, name: 'Background', type: 'image', hash, mime, size: buf.length, originalWidth: deck.width ?? 1920, originalHeight: deck.height ?? 1080 };
        byHash.set(hash, id);
        files++; bytes += buf.length;
      }
      bg.resourceId = id;
      delete bg.src;
    }
  }
  return { deck: upgradeNativePresentation(deck) as unknown as Raw, files, bytes };
}

// What a deck holds, independent of the repairs opening it applies (a slide
// missing from the slide order is re-attached, an element missing from its
// slide's order is appended): every slide and every element counts.
const counts = (deck: Raw) => ({
  slides: Object.keys(deck.slides ?? {}).length,
  elements: Object.values<Raw>(deck.slides ?? {}).reduce((n, s) => n + Object.keys(s.elements ?? {}).length, 0),
  resources: Object.keys(deck.resources ?? {}).length,
});

async function copyTree(src: string, dst: string) {
  await fs.cp(src, dst, { recursive: true, errorOnExist: true, force: false });
}

const source = new LeveldbPersistence(path.join(from, 'ydocs'));
const index = JSON.parse(await fs.readFile(path.join(from, '_index.json'), 'utf8'));
const liveNames = new Set(await source.getAllDocNames());
await fs.mkdir(to, { recursive: true });

// Everything that is not a deck or its media/LevelDB, unchanged.
for (const entry of await fs.readdir(from, { withFileTypes: true })) {
  if (['ydocs', 'media'].includes(entry.name) || entry.name.endsWith('.json') || entry.name.includes('.bak')) continue;
  await copyTree(path.join(from, entry.name), path.join(to, entry.name));
}
await fs.copyFile(path.join(from, '_index.json'), path.join(to, '_index.json'));

const target = new LeveldbPersistence(path.join(to, 'ydocs'));
const report: Raw[] = [];
let failures = 0;
const jsonFiles = (await fs.readdir(from)).filter(n => n.endsWith('.json') && n !== '_index.json');
for (const name of jsonFiles) {
  const projectId = name.slice(0, -'.json'.length);
  try {
    const file = JSON.parse(await fs.readFile(path.join(from, name), 'utf8'));
    let deck: Raw = file.presentation;
    let origin = 'json';
    if (liveNames.has(projectId)) {
      const live = await source.getYDoc(projectId);
      if (live.store.clients.size > 0 && live.getMap('presentation').size > 0) { deck = yDocToJson(live) as unknown as Raw; origin = 'leveldb'; }
      live.destroy();
    }
    const before = counts(deck);
    let result;
    try {
      result = await convertDeck(projectId, structuredClone(deck));
    } catch (err) {
      // Not a current deck at all (the editor refuses to open it today):
      // carry it over exactly as it is, media and all.
      await fs.writeFile(path.join(to, name), JSON.stringify(file, null, 2));
      if (liveNames.has(projectId)) {
        const live = await source.getYDoc(projectId);
        if (live.store.clients.size > 0) await target.storeUpdate(projectId, Y.encodeStateAsUpdate(live));
        live.destroy();
      }
      const media = path.join(from, 'media', projectId);
      if (existsSync(media)) await copyTree(media, path.join(to, 'media', projectId));
      report.push({ projectId, title: deck?.title, origin, ...before, kept: `kept as it was — not openable before either (${(err as Error).message.slice(0, 80)})` });
      continue;
    }
    const { deck: converted, files, bytes } = result;
    await fs.writeFile(path.join(to, name), JSON.stringify({ ...file, presentation: converted }, null, 2));
    if (liveNames.has(projectId)) {
      const doc = new Y.Doc();
      jsonToYDoc(converted as never, doc);
      await target.storeUpdate(projectId, Y.encodeStateAsUpdate(doc));
      doc.destroy();
    }
    report.push({ projectId, title: converted.title, origin, ...before, files, mb: +(bytes / 1e6).toFixed(1) });
  } catch (err) {
    // The source itself is not a current deck (the editor refuses to open
    // it today): carry it over exactly as it is.
    try {
      await fs.copyFile(path.join(from, name), path.join(to, name));
      if (liveNames.has(projectId)) {
        const live = await source.getYDoc(projectId);
        if (live.store.clients.size > 0) await target.storeUpdate(projectId, Y.encodeStateAsUpdate(live));
        live.destroy();
      }
      const media = path.join(from, 'media', projectId);
      if (existsSync(media) && !existsSync(path.join(to, 'media', projectId))) await copyTree(media, path.join(to, 'media', projectId));
      report.push({ projectId, kept: `kept as it was: ${(err as Error).message.slice(0, 90)}` });
    } catch (copyErr) {
      failures++;
      report.push({ projectId, error: `${(err as Error).message}; and could not be copied: ${(copyErr as Error).message}` });
    }
  }
}
await source.destroy();
await target.destroy();

// Check the new folder from scratch.
const check = new LeveldbPersistence(path.join(to, 'ydocs'));
for (const row of report) {
  if (row.error || row.kept) continue;
  const file = JSON.parse(await fs.readFile(path.join(to, `${row.projectId}.json`), 'utf8'));
  let deck: Raw = file.presentation;
  if (liveNames.has(row.projectId)) {
    const doc = await check.getYDoc(row.projectId);
    deck = yDocToJson(doc) as unknown as Raw;
    doc.destroy();
  }
  const problems: string[] = [];
  try { upgradeNativePresentation(deck); } catch (err) { problems.push(`invalid: ${(err as Error).message}`); }
  const after = counts(deck);
  for (const k of ['slides', 'elements'] as const) if (after[k] !== row[k]) problems.push(`${k} ${row[k]} → ${after[k]}`);
  for (const r of Object.values<Raw>(deck.resources ?? {})) {
    if ('src' in r) problems.push(`resource ${r.id} still embeds media`);
    const f = path.join(to, 'media', row.projectId, r.hash ?? '');
    if (!existsSync(f) || sha256(await fs.readFile(f)) !== r.hash) problems.push(`media of ${r.id} missing or corrupt`);
  }
  if (problems.length) { failures++; row.error = problems.join('; '); }
  if (!index.projects?.[row.projectId]) row.note = 'not in _index.json';
}
await check.destroy();

console.table(report.map(r => ({ id: r.projectId, title: r.title ?? '', from: r.origin ?? '', slides: r.slides ?? '', resources: r.resources ?? '', files: r.files ?? '', MB: r.mb ?? '', status: r.error ? `FAILED: ${r.error}` : r.kept ?? r.note ?? 'ok' })));
console.log(failures ? `${failures} deck(s) FAILED — do not switch to ${to}.` : `All ${report.length} decks converted and verified in ${to}.`);
process.exit(failures ? 1 : 0);
