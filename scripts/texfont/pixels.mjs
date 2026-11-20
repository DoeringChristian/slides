/**
 * Compare two grey PNGs of the same size, pixel by pixel.
 *
 * The rasteriser writes PGM (`mutool draw -o x.pgm`), which is trivial to
 * read, so the harness needs no image library. The diff is written as PNG
 * via ImageMagick for viewing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function readPgm(pgm) {
  const b = readFileSync(pgm);
  // Header: P5 <w> <h> <max>, whitespace separated, then one byte per pixel.
  let p = 0;
  const token = () => {
    while (/\s/.test(String.fromCharCode(b[p]))) p++;
    if (b[p] === 0x23) { while (b[p] !== 0x0a) p++; return token(); }
    let s = '';
    while (!/\s/.test(String.fromCharCode(b[p]))) s += String.fromCharCode(b[p++]);
    return s;
  };
  if (token() !== 'P5') throw new Error(`${pgm}: not a binary PGM`);
  const width = Number(token()), height = Number(token());
  token();
  p++;
  return { width, height, data: b.subarray(p, p + width * height) };
}

/** `{ width, height, differing, maxDelta }`; writes a diff image (black = differs). */
export function comparePngs(a, b, diffPng) {
  const A = readPgm(a), B = readPgm(b);
  if (Math.abs(A.width - B.width) > 1 || Math.abs(A.height - B.height) > 1) {
    throw new Error(`size mismatch: ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  }
  // Compare the common area (rasters may differ by one edge row/column).
  const width = Math.min(A.width, B.width), height = Math.min(A.height, B.height);
  let differing = 0, maxDelta = 0;
  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.abs(A.data[y * A.width + x] - B.data[y * B.width + x]);
      if (d) differing++;
      if (d > maxDelta) maxDelta = d;
      out[y * width + x] = 255 - Math.min(255, d * 4);
    }
  }
  if (diffPng) {
    const pgm = diffPng.replace(/\.png$/, '.pgm');
    writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), out]));
    execFileSync('magick', [pgm, diffPng]);
  }
  return { width, height, differing, maxDelta };
}
