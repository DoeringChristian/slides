/**
 * The two pieces of OpenType writing opentype.js does not do: pair kerning,
 * and adding a table to an already-encoded font.
 *
 * opentype.js writes GSUB but no GPOS, so the kerning TeX lays out with would
 * be lost on save. It goes in a `GPOS` table — one `kern` feature, one
 * pair-adjustment lookup — because that is the container both consumers
 * read: opentype.js's `getKerningValue`, and Chrome's shaper. Chrome ignores
 * a legacy `kern` table in these fonts entirely (measured: the edit overlay
 * set text 19 px wider than the renderer on a 40 px line).
 */

/**
 * A `GPOS` table with one `kern` feature (under the DFLT and latn scripts)
 * whose one lookup is a PairPosFormat1 subtable: for each first glyph, its
 * second glyphs and the x-advance adjustment of the first.
 */
export function gposKernTable(pairs) {
  const byFirst = new Map();
  for (const [l, r, v] of [...pairs].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (!byFirst.has(l)) byFirst.set(l, []);
    byFirst.get(l).push([r, v]);
  }
  const firsts = [...byFirst.keys()];

  // PairPosFormat1: format, coverage offset, valueFormat1 (XAdvance),
  // valueFormat2 (none), pairSetCount, pairSet offsets; then the coverage,
  // then the pair sets. Every offset is from the subtable's start.
  const headerLen = 10 + 2 * firsts.length;
  const coverageLen = 4 + 2 * firsts.length;
  const pairSetsLen = firsts.reduce((n, f) => n + 2 + 4 * byFirst.get(f).length, 0);
  const sub = Buffer.alloc(headerLen + coverageLen + pairSetsLen);
  if (sub.length > 0xffff) throw new Error(`kerning subtable too large for 16-bit offsets: ${sub.length} bytes`);
  sub.writeUInt16BE(1, 0);
  sub.writeUInt16BE(headerLen, 2);
  sub.writeUInt16BE(0x0004, 4);
  sub.writeUInt16BE(0, 6);
  sub.writeUInt16BE(firsts.length, 8);
  let cov = headerLen;
  sub.writeUInt16BE(1, cov); sub.writeUInt16BE(firsts.length, cov + 2);
  firsts.forEach((g, i) => sub.writeUInt16BE(g, cov + 4 + 2 * i));
  let at = headerLen + coverageLen;
  firsts.forEach((g, i) => {
    sub.writeUInt16BE(at, 10 + 2 * i);
    const seconds = byFirst.get(g);
    sub.writeUInt16BE(seconds.length, at);
    seconds.forEach(([r, v], k) => { sub.writeUInt16BE(r, at + 2 + 4 * k); sub.writeInt16BE(v, at + 4 + 4 * k); });
    at += 2 + 4 * seconds.length;
  });

  // Lookup: type 2, flag 0, one subtable at offset 8.
  const lookup = Buffer.concat([Buffer.from([0, 2, 0, 0, 0, 1, 0, 8]), sub]);
  // LookupList: one lookup at offset 4.
  const lookupList = Buffer.concat([Buffer.from([0, 1, 0, 4]), lookup]);
  // FeatureList: one 'kern' feature (record at 2, table at 8) → lookup 0.
  const featureList = Buffer.concat([
    Buffer.from([0, 1]), Buffer.from('kern', 'latin1'), Buffer.from([0, 8]),
    Buffer.from([0, 0, 0, 1, 0, 0]), // featureParams 0, lookupCount 1, index 0
  ]);
  // ScriptList: DFLT and latn, each a Script table with a default LangSys
  // (offset 4 from the Script table) requiring no feature and using feature 0.
  const script = Buffer.from([0, 4, 0, 0, /* LangSys: */ 0, 0, 0xff, 0xff, 0, 1, 0, 0]);
  const scriptList = Buffer.concat([
    Buffer.from([0, 2]),
    Buffer.from('DFLT', 'latin1'), Buffer.from([0, 14]),
    Buffer.from('latn', 'latin1'), Buffer.from([0, 14 + script.length]),
    script, script,
  ]);
  const header = Buffer.alloc(10);
  header.writeUInt16BE(1, 0); header.writeUInt16BE(0, 2);
  header.writeUInt16BE(10, 4);
  header.writeUInt16BE(10 + scriptList.length, 6);
  header.writeUInt16BE(10 + scriptList.length + featureList.length, 8);
  return new Uint8Array(Buffer.concat([header, scriptList, featureList, lookupList]));
}

function checksum(bytes) {
  const padded = Buffer.alloc((bytes.length + 3) & ~3);
  Buffer.from(bytes).copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** Re-encode an sfnt with one table added (or replaced), checksums redone. */
export function addSfntTable(font, tag, data) {
  const src = Buffer.from(font);
  const sfntVersion = src.readUInt32BE(0);
  const count = src.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const r = 12 + i * 16;
    const t = src.toString('latin1', r, r + 4);
    const offset = src.readUInt32BE(r + 8), length = src.readUInt32BE(r + 12);
    tables.set(t, Buffer.from(src.subarray(offset, offset + length)));
  }
  tables.set(tag, Buffer.from(data));
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }

  const header = Buffer.alloc(12 + 16 * n);
  header.writeUInt32BE(sfntVersion, 0);
  header.writeUInt16BE(n, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(log, 8);
  header.writeUInt16BE(n * 16 - pow * 16, 10);

  const head = tables.get('head');
  if (head) head.writeUInt32BE(0, 8); // checkSumAdjustment, recomputed below
  let offset = header.length;
  const bodies = [];
  tags.forEach((t, i) => {
    const body = tables.get(t);
    const r = 12 + i * 16;
    header.write(t, r, 'latin1');
    header.writeUInt32BE(checksum(body), r + 4);
    header.writeUInt32BE(offset, r + 8);
    header.writeUInt32BE(body.length, r + 12);
    const padded = Buffer.alloc((body.length + 3) & ~3);
    body.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  const out = Buffer.concat([header, ...bodies]);
  if (head) {
    const headOffset = header.readUInt32BE(12 + tags.indexOf('head') * 16 + 8);
    out.writeUInt32BE((0xB1B0AFBA - checksum(out)) >>> 0, headOffset + 8);
  }
  return new Uint8Array(out);
}
