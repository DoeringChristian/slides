// Test-only certificate for equal-radius capsules on ONE horizontal axis.
// Intersecting centerline intervals merge exactly: Minkowski addition of a
// radius-r disk distributes over their union. Remaining intervals are accepted
// only when their capsules are strictly disjoint (gap > 2r). Thus every boundary
// of the returned capsules is exposed, and minimum boundary distance is exact.
// Overlapping caps from DISJOINT intervals need arc intersections; reject them
// rather than making a false general union-distance claim.
export function collinearCapsuleUnion(capsules) {
  if (!capsules.length) throw Error('Empty capsule union');
  const radius = capsules[0].radius;
  if (!(Number.isFinite(radius) && radius > 0) || capsules.some(c => c.radius !== radius || !Number.isFinite(c.lo) || !Number.isFinite(c.hi) || c.lo > c.hi)) {
    throw Error('Unsupported capsule geometry');
  }
  const merged = [];
  for (const c of [...capsules].sort((a, b) => a.lo - b.lo)) {
    const last = merged.at(-1);
    if (last && c.lo <= last.hi) last.hi = Math.max(last.hi, c.hi);
    else merged.push({ ...c });
  }
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].lo - merged[i - 1].hi <= 2 * radius) throw Error('Unsupported overlapping caps of disjoint centerline intervals');
  }
  return merged;
}

// x,y are relative to the certified common horizontal axis (y=0).
export function capsuleUnionBoundaryDistance(union, x, y) {
  return Math.min(...union.map(c => Math.abs(Math.hypot(x - Math.max(c.lo, Math.min(c.hi, x)), y) - c.radius)));
}
