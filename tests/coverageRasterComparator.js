// Flatness is spatial, not an alpha==0/255 test: fractional interiors matter.
export function compareCoverageRaster(actual, expected, size, tolerance = 1) {
  const alpha = (image, x, y) => image.data[(y * size + x) * 4 + 3];
  let flatMismatch = 0, flatCount = 0, fractionalFlatCount = 0, aaPixels = 0, aaDelta = 0, maxDelta = 0;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const b = alpha(expected, x, y), d = Math.abs(alpha(actual, x, y) - b);
    const flat = [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => alpha(expected, x + dx, y + dy) === b));
    if (flat) { flatCount++; if (b > 0 && b < 255) fractionalFlatCount++; if (d > tolerance) flatMismatch++; }
    else if (d) { aaPixels++; aaDelta += d; maxDelta = Math.max(maxDelta, d); }
  }
  return { flatMismatch, flatCount, fractionalFlatCount, aaPixels, aaDelta, maxDelta };
}
