import { expect, test } from 'vitest';
import { compareCoverageRaster } from './coverageRasterComparator.js';
const image = alpha => ({ data: new Uint8ClampedArray(Array.from({ length: 25 }, () => [0, 0, 0, alpha]).flat()) });
test('fractional flat interiors are not mistaken for antialiasing', () => {
  expect(compareCoverageRaster(image(159), image(128), 5)).toMatchObject({ flatMismatch: 9, fractionalFlatCount: 9, aaPixels: 0 });
  expect(compareCoverageRaster(image(127), image(128), 5)).toMatchObject({ flatMismatch: 0, fractionalFlatCount: 9 });
});
test('geometry edges remain separately counted', () => {
  const expected = image(128); expected.data[3] = 0;
  expect(compareCoverageRaster(image(159), expected, 5)).toMatchObject({ flatMismatch: 8, aaPixels: 1 });
});
