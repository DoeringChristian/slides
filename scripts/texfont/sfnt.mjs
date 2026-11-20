/**
 * The two pieces of OpenType writing opentype.js does not do: a `kern` table,
 * and adding a table to an already-encoded font.
 *
 * opentype.js writes GSUB but no GPOS and no `kern`, so the kerning TeX lays
 * out with would be lost on save. The legacy `kern` table (format 0, one
 * horizontal subtable) is the simplest container for plain pair kerning, and
 * every consumer here reads it: opentype.js loads it into `kerningPairs` when
 * a font has no GPOS, and browsers' shapers fall back to it likewise.
 */

/** A format-0 `kern` table: `[left glyph, right glyph, value]` pairs. */
export function kernTable(pairs) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = sorted.length;
  const subLength = 14 + 6 * n;
  if (subLength > 0xffff) throw new Error(`too many kerning pairs for one kern subtable: ${n}`);
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const buf = Buffer.alloc(4 + subLength);
  let o = 0;
  const u16 = (v) => { buf.writeUInt16BE(v, o); o += 2; };
  u16(0); u16(1); // table version, one subtable
  u16(0); u16(subLength); u16(0x0001); // subtable version, length, horizontal
  u16(n); u16(pow * 6); u16(log); u16((n - pow) * 6);
  for (const [l, r, v] of sorted) { u16(l); u16(r); buf.writeInt16BE(v, o); o += 2; }
  return new Uint8Array(buf);
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
