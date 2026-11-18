import { describe, expect, test } from 'vitest';
import { LOG_STEPS, logThumb, logValue } from './logScale';

describe('logarithmic slider scale (zoom 25%–1600%)', () => {
  test('each doubling takes the same travel', () => {
    expect(logThumb(25, 25, 1600)).toBe(0);
    expect(logThumb(100, 25, 1600)).toBe(Math.round(LOG_STEPS / 3));
    expect(logThumb(1600, 25, 1600)).toBe(LOG_STEPS);
    expect(logThumb(5000, 25, 1600)).toBe(LOG_STEPS);
  });
  test('positions map back to whole values', () => {
    expect(logValue(0, 25, 1600, 1)).toBe(25);
    expect(logValue(LOG_STEPS / 2, 25, 1600, 1)).toBe(200);
    expect(logValue(LOG_STEPS, 25, 1600, 1)).toBe(1600);
    for (const v of [25, 100, 300, 1600]) expect(Math.abs(logValue(logThumb(v, 25, 1600), 25, 1600, 1) - v) / v).toBeLessThan(0.005);
  });
});
