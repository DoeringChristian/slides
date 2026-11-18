import { describe, expect, it } from 'vitest';
import { PassThrough } from 'stream';
import { writeJson } from './streamJson.js';

async function streamed(value: unknown): Promise<string> {
  const out = new PassThrough({ highWaterMark: 16 });
  const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));
  await writeJson(out, value);
  out.end();
  await new Promise(r => out.on('end', r));
  return Buffer.concat(chunks).toString('utf8');
}

describe('writeJson', () => {
  it('writes exactly what JSON.stringify writes', async () => {
    const values: unknown[] = [
      null, 0, -1.5, 'a"b\\c\n é😀', true, [], {}, [1, [2, [3]], {}],
      { a: undefined, b: () => 1, c: NaN, d: Infinity, e: [undefined, () => 1], f: new Date(0), 'k"ey': { n: null } },
      { big: 'x'.repeat(3_000_000), list: Array.from({ length: 2000 }, (_, i) => ({ i, s: String(i) })) },
    ];
    for (const v of values) expect(await streamed(v)).toBe(JSON.stringify(v));
  });
});
