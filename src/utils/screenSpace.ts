/** Convert interaction tolerances exactly once at the input boundary.
 * Geometry and persisted connector gaps remain in slide units; omitted zoom is 1. */
export function screenPixelsToSlide(pixels: number, zoom = 1): number {
  return pixels / Math.max(zoom, 1e-6);
}
