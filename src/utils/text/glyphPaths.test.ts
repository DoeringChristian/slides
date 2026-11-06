import { afterEach, describe, expect, test, vi } from 'vitest';
import { samplePathD, setPathSamplerForTests } from './glyphPaths';

// samplePathD normally measures via a hidden SVG <path> probe
// (getTotalLength / getPointAtLength), which node has no implementation
// for — tests inject a deterministic sampler through the seam instead.

afterEach(() => {
  setPathSamplerForTests(null);
});

describe('samplePathD', () => {
  test('delegates to the injected sampler and returns its points', () => {
    setPathSamplerForTests((d, n) => {
      // Fake equal-arc sampling of a horizontal 10-unit segment.
      const out: number[] = [];
      for (let k = 0; k < n; k++) out.push((10 * k) / (n - 1), d.length);
      return out;
    });
    const pts = samplePathD('M 0 0 L 10 0', 3);
    expect(pts).toEqual([0, 12, 5, 12, 10, 12]);
  });

  test('caches by (d, n) — the sampler runs once per distinct key', () => {
    const sampler = vi.fn((_d: string, n: number) => new Array(2 * n).fill(0));
    setPathSamplerForTests(sampler);
    const first = samplePathD('M 0 0 L 1 1', 4);
    const second = samplePathD('M 0 0 L 1 1', 4);
    expect(second).toBe(first); // same cached array
    expect(sampler).toHaveBeenCalledTimes(1);
    // Different n or d → separate cache entries.
    samplePathD('M 0 0 L 1 1', 5);
    samplePathD('M 0 0 L 2 2', 4);
    expect(sampler).toHaveBeenCalledTimes(3);
  });

  test('degenerate inputs return empty without touching the sampler', () => {
    const sampler = vi.fn(() => [0, 0]);
    setPathSamplerForTests(sampler);
    expect(samplePathD('', 8)).toEqual([]);
    expect(samplePathD('M 0 0', 1)).toEqual([]);
    expect(sampler).not.toHaveBeenCalled();
  });

  test('without DOM and without an injected sampler it degrades to []', () => {
    // afterEach cleared the sampler; explicitly ensure none is set.
    setPathSamplerForTests(null);
    expect(samplePathD('M 0 0 L 5 5', 4)).toEqual([]);
  });
});
