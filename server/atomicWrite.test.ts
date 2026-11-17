import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeFileAtomic } from './atomicWrite.js';

describe('writeFileAtomic', () => {
  it('readers see the old or the new file whole, never a partial one; no temp file is left', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'));
    const file = path.join(dir, 'deck.json');
    const big = (n: number) => JSON.stringify({ n, data: 'x'.repeat(8_000_000) });
    await writeFileAtomic(file, big(0));
    let reading = true;
    const reader = (async () => {
      let reads = 0;
      while (reading) { JSON.parse(await fs.readFile(file, 'utf8')); reads++; }
      return reads;
    })();
    for (let i = 1; i <= 5; i++) await writeFileAtomic(file, big(i));
    reading = false;
    expect(await reader).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).n).toBe(5);
    expect(await fs.readdir(dir)).toEqual(['deck.json']);
    await fs.rm(dir, { recursive: true, force: true });
  }, 30_000);
});
