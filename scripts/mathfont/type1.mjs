/**
 * Type 1 (`.pfb` / `.pfa`) outline extraction.
 *
 * Why this exists: a MathJax SVG font package is a table of
 * `[height, depth, width, {p: <path>}]` where the path is in 1000-unit em
 * space. Type 1 charstrings are cubic Béziers already expressed in that space
 * (these fonts carry `/FontMatrix [0.001 0 0 0.001 0 0]`), so the conversion
 * is a transcription, not an approximation — which is the whole point: the
 * outlines must be the ones the paper was set with, bit for bit.
 *
 * Verified against a real acmart render: every glyph extracted here matches
 * the outline the PDF draws to under 0.6/1000 em, which is the rounding in the
 * PDF's own decimal coordinates. See `scripts/mathfont/verify.mjs`.
 *
 * Scope is deliberately "what TeX's math fonts use": full charstring
 * interpreter including flex and hint replacement (othersubrs 0–3) and `seac`
 * accented composites, no Multiple Master support.
 */

const PFB_MARKER = 0x80;

/** Split a `.pfb`'s segment framing, or pass a `.pfa` through unchanged. */
function unwrapPfb(buf) {
  if (buf[0] !== PFB_MARKER) return buf;
  const parts = [];
  let p = 0;
  while (p < buf.length && buf[p] === PFB_MARKER) {
    const type = buf[p + 1];
    if (type === 3) break; // EOF segment
    const len = buf.readUInt32LE(p + 2);
    parts.push(buf.subarray(p + 6, p + 6 + len));
    p += 6 + len;
  }
  return Buffer.concat(parts);
}

/** eexec / charstring decryption (Type 1 spec §7). */
function decrypt(data, r, skip) {
  const c1 = 52845, c2 = 22719;
  const out = Buffer.allocUnsafe(data.length);
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    out[i] = c ^ (r >> 8);
    r = ((c + r) * c1 + c2) & 0xffff;
  }
  return out.subarray(skip);
}

/**
 * Pull the `RD`-delimited binary entries out of a decrypted private section.
 *
 * Both `/Subrs` and `/CharStrings` use the same shape — a length, a procedure
 * name that the font itself defines (`RD`, `-|`, anything), a space, then that
 * many raw bytes — so one scanner serves both. The entries are found by
 * walking the text rather than by regex over the whole buffer, because the
 * binary payloads routinely contain bytes that look like the delimiters.
 */
function readBinaryEntries(buf) {
  const text = buf.toString('latin1');
  const subrs = [];
  const chars = new Map();

  // /Subrs N array-building ... dup <i> <len> RD <bytes> NP
  const subrsAt = text.indexOf('/Subrs');
  if (subrsAt >= 0) {
    let p = subrsAt;
    const dup = /dup\s+(\d+)\s+(\d+)\s+(RD|-\|)[ ]/g;
    dup.lastIndex = p;
    let m;
    while ((m = dup.exec(text))) {
      const idx = Number(m[1]);
      const len = Number(m[2]);
      const start = m.index + m[0].length;
      subrs[idx] = buf.subarray(start, start + len);
      dup.lastIndex = start + len;
      // Stop once CharStrings begins; Subrs always precedes it.
      const cs = text.indexOf('/CharStrings');
      if (cs >= 0 && dup.lastIndex > cs) break;
    }
  }

  const csAt = text.indexOf('/CharStrings');
  if (csAt >= 0) {
    const re = /\/([^\s/{(\[\]<>]+)\s+(\d+)\s+(RD|-\|)[ ]/g;
    re.lastIndex = csAt;
    let m;
    while ((m = re.exec(text))) {
      const len = Number(m[2]);
      const start = m.index + m[0].length;
      chars.set(m[1], buf.subarray(start, start + len));
      re.lastIndex = start + len;
    }
  }
  return { subrs, chars };
}

/** The 4 bytes of `/lenIV`, or the spec default. */
function readLenIV(buf) {
  const m = /\/lenIV\s+(\d+)/.exec(buf.toString('latin1', 0, 4096));
  return m ? Number(m[1]) : 4;
}

/** StandardEncoding, needed when a font says `/Encoding StandardEncoding def`. */
const STANDARD_ENCODING = (() => {
  const e = new Array(256).fill(null);
  const names = 'space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde'.split(' ');
  names.forEach((n, i) => { e[32 + i] = n; });
  return e;
})();

/** `/Encoding` — either the standard one or the font's own `dup` list. */
function readEncoding(clearText) {
  if (/\/Encoding\s+StandardEncoding\s+def/.test(clearText)) return STANDARD_ENCODING.slice();
  const enc = new Array(256).fill(null);
  const re = /dup\s+(\d+)\s*\/([^\s/]+)\s+put/g;
  let m;
  while ((m = re.exec(clearText))) {
    const code = Number(m[1]);
    if (code >= 0 && code < 256) enc[code] = m[2];
  }
  return enc;
}

/**
 * Interpret one charstring into a path.
 *
 * Returns commands as `{op, args}` in font units with y pointing up, plus the
 * advance width and left side bearing the charstring declares (`hsbw`/`sbw`).
 */
function runCharstring(code, ctx) {
  const path = [];
  let x = 0, y = 0;
  let width = 0, sbx = 0, sby = 0;
  const stack = [];
  const ps = [];            // the PostScript operand stack othersubrs talk to
  let flexPts = null;       // collecting rmovetos between othersubr 1 and 0
  let open = false;
  let sbwSeen = false;

  const moveTo = (nx, ny) => {
    if (flexPts) { flexPts.push([nx, ny]); x = nx; y = ny; return; }
    if (open) path.push({ op: 'Z', args: [] });
    path.push({ op: 'M', args: [nx, ny] });
    open = true;
    x = nx; y = ny;
  };
  const lineTo = (nx, ny) => { path.push({ op: 'L', args: [nx, ny] }); x = nx; y = ny; };
  const curveTo = (x1, y1, x2, y2, nx, ny) => {
    path.push({ op: 'C', args: [x1, y1, x2, y2, nx, ny] });
    x = nx; y = ny;
  };

  const exec = (cs, depth) => {
    if (depth > 10) throw new Error('charstring recursion too deep');
    let i = 0;
    while (i < cs.length) {
      let v = cs[i++];
      if (v >= 32) {
        if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + cs[i++] + 108);
        else if (v <= 254) stack.push(-((v - 251) * 256) - cs[i++] - 108);
        else {
          stack.push((cs[i] << 24 | cs[i + 1] << 16 | cs[i + 2] << 8 | cs[i + 3]) | 0);
          i += 4;
        }
        continue;
      }
      switch (v) {
        case 13: // hsbw: sbx wx
          sbx = stack[0] || 0; width = stack[1] || 0;
          x = sbx; y = 0; sbwSeen = true; stack.length = 0; break;
        case 9: // closepath
          if (open) { path.push({ op: 'Z', args: [] }); open = false; }
          stack.length = 0; break;
        case 1: case 3: stack.length = 0; break; // hstem / vstem
        case 21: moveTo(x + (stack[0] || 0), y + (stack[1] || 0)); stack.length = 0; break;
        case 22: moveTo(x + (stack[0] || 0), y); stack.length = 0; break;
        case 4:  moveTo(x, y + (stack[0] || 0)); stack.length = 0; break;
        case 5:  lineTo(x + (stack[0] || 0), y + (stack[1] || 0)); stack.length = 0; break;
        case 6:  lineTo(x + (stack[0] || 0), y); stack.length = 0; break;
        case 7:  lineTo(x, y + (stack[0] || 0)); stack.length = 0; break;
        case 8: { // rrcurveto
          const [a, b, c, d, e, f] = stack;
          curveTo(x + a, y + b, x + a + c, y + b + d, x + a + c + e, y + b + d + f);
          stack.length = 0; break;
        }
        case 30: { // vhcurveto
          const [a, b, c, d] = stack;
          curveTo(x, y + a, x + b, y + a + c, x + b + d, y + a + c);
          stack.length = 0; break;
        }
        case 31: { // hvcurveto
          const [a, b, c, d] = stack;
          curveTo(x + a, y, x + a + b, y + c, x + a + b, y + c + d);
          stack.length = 0; break;
        }
        case 10: { // callsubr
          const n = stack.pop();
          const sub = ctx.subrs[n];
          if (!sub) { stack.length = 0; break; }
          const r = exec(sub, depth + 1);
          if (r === 'return') break;
          if (r === 'endchar') return 'endchar';
          break;
        }
        case 11: return 'return';
        case 14: // endchar
          if (open) { path.push({ op: 'Z', args: [] }); open = false; }
          return 'endchar';
        case 12: {
          const v2 = cs[i++];
          switch (v2) {
            case 12: { // div
              const b2 = stack.pop(), a2 = stack.pop();
              stack.push(a2 / b2); break;
            }
            case 16: { // callothersubr
              const n = stack.pop();
              const count = stack.pop();
              const args = count ? stack.splice(stack.length - count, count) : [];
              if (n === 1) {          // start flex
                flexPts = [];
              } else if (n === 0) {   // end flex: 7 collected points -> 2 curves
                const p = flexPts || [];
                flexPts = null;
                if (p.length >= 7) {
                  curveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]);
                  curveTo(p[4][0], p[4][1], p[5][0], p[5][1], p[6][0], p[6][1]);
                }
                // The interpreter leaves the final point for the following
                // `pop pop setcurrentpoint`.
                ps.length = 0; ps.push(y, x);
              } else if (n === 3) {   // hint replacement
                ps.length = 0; ps.push(3);
              } else {
                // Unknown othersubr: the spec says push the arguments back for
                // the `pop`s that follow.
                ps.length = 0;
                for (let k = args.length - 1; k >= 0; k--) ps.push(args[k]);
              }
              break;
            }
            case 17: stack.push(ps.length ? ps.pop() : 0); break; // pop
            case 6: { // seac: asb adx ady bchar achar
              const [asb, adx, ady, bchar, achar] = stack;
              stack.length = 0;
              const bname = STANDARD_ENCODING[bchar];
              const aname = STANDARD_ENCODING[achar];
              const base = bname && ctx.chars.get(bname);
              const acc = aname && ctx.chars.get(aname);
              if (base) {
                const r = runCharstring(ctx.decryptCs(base), ctx);
                path.push(...r.path);
              }
              if (acc) {
                const r = runCharstring(ctx.decryptCs(acc), ctx);
                const dx = sbx - asb + adx, dy = ady;
                for (const c of r.path) {
                  path.push({
                    op: c.op,
                    args: c.args.map((n2, k) => (k % 2 === 0 ? n2 + dx : n2 + dy)),
                  });
                }
              }
              return 'endchar';
            }
            case 7: // sbw: sbx sby wx wy
              sbx = stack[0] || 0; sby = stack[1] || 0; width = stack[2] || 0;
              x = sbx; y = sby; sbwSeen = true; stack.length = 0; break;
            case 33: // setcurrentpoint
              x = stack[0] ?? x; y = stack[1] ?? y; stack.length = 0; break;
            case 0: stack.length = 0; break; // dotsection
            case 1: case 2: stack.length = 0; break; // vstem3 / hstem3
            default: stack.length = 0; break;
          }
          break;
        }
        default: stack.length = 0; break;
      }
    }
    return null;
  };

  exec(code, 0);
  if (open) path.push({ op: 'Z', args: [] });
  return { path, width, sbx, sby, hasMetrics: sbwSeen };
}

/**
 * Parse a Type 1 font into glyphs keyed by name.
 *
 * Each glyph is `{ path, width }` with `path` as `{op, args}` commands in font
 * units, y up. Call `pathToSvg` to get MathJax's string form.
 */
export function parseType1(buffer) {
  const buf = unwrapPfb(Buffer.from(buffer));
  const text = buf.toString('latin1');
  const eexecAt = text.indexOf('eexec');
  if (eexecAt < 0) throw new Error('not a Type 1 font: no eexec');

  const clearText = text.slice(0, eexecAt);
  const encoding = readEncoding(clearText);
  const fmMatch = /\/FontMatrix\s*\[\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/.exec(clearText);
  const fontMatrix = fmMatch ? fmMatch.slice(1, 5).map(Number) : [0.001, 0, 0, 0.001];

  // The encrypted section starts after `eexec` plus its whitespace.
  let p = eexecAt + 5;
  while (p < buf.length && (buf[p] === 0x0d || buf[p] === 0x0a || buf[p] === 0x20 || buf[p] === 0x09)) p++;
  const priv = decrypt(buf.subarray(p), 55665, 4);

  const lenIV = readLenIV(priv);
  const { subrs, chars } = readBinaryEntries(priv);
  const decryptCs = (raw) => decrypt(raw, 4330, lenIV);

  const ctx = {
    subrs: subrs.map((s) => (s ? decryptCs(s) : s)),
    chars,
    decryptCs,
  };

  const glyphs = new Map();
  for (const [name, raw] of chars) {
    try {
      const { path, width } = runCharstring(decryptCs(raw), ctx);
      glyphs.set(name, { path, width });
    } catch {
      // A glyph we cannot interpret is a glyph we must not silently draw
      // wrong; leave it out so the builder reports it as missing.
    }
  }
  return { glyphs, encoding, fontMatrix };
}

/** Bounding box of a parsed path, or null when it has no points. */
export function pathBounds(path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of path) {
    for (let i = 0; i < c.args.length; i += 2) {
      const x = c.args[i], y = c.args[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

/**
 * MathJax's path form, which is not quite SVG's.
 *
 * Three conventions, all checked against the 1182 paths in the published
 * Termes package rather than assumed:
 *
 *  - **No leading `moveto`.** MathJax prepends the `M` when it builds the
 *    `d` attribute, so the data starts with a bare coordinate pair. Emitting
 *    our own `M` produced `d="MM1020 …"`, which is not valid path data: the
 *    browser stops at the error and the glyph silently does not draw. Not one
 *    of Termes' paths begins with a command letter.
 *  - **No `Z`.** Only `M`, `L` and `C` appear. Glyphs are filled, and fill
 *    closes every subpath on its own, so the closepath is redundant.
 *  - **Minus signs pack tight** against the preceding digit (`152-9`), which
 *    is legal because the sign is its own separator, and smaller.
 *
 * `dx`/`dy` shift the outline, which is how a virtual font's `MOVERIGHT`
 * side-bearing correction is baked in — MathJax has no per-glyph offset of its
 * own, so the shift has to live in the coordinates.
 */
export function pathToSvg(path, dx = 0, dy = 0) {
  const n = (v) => {
    const r = Math.round(v * 10) / 10;
    return (Number.isInteger(r) ? r : r.toFixed(1)).toString();
  };
  let out = '';
  let first = true;
  for (const c of path) {
    if (c.op === 'Z') continue;
    const a = c.args.map((v, i) => n(i % 2 === 0 ? v + dx : v + dy)).join(' ');
    // The first subpath's moveto is implicit; later ones keep their M.
    out += (first && c.op === 'M' ? '' : c.op) + a;
    first = false;
  }
  return out.replace(/ -/g, '-');
}
