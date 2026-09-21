export interface LineGuide {
  type: 'horizontal' | 'vertical';
  position: number;
}

interface SpacingSegment {
  from: number;
  to: number;
}

/** Equal-spacing ("magnet") guide: two gap segments of identical length,
 *  drawn as bracketed measurement marks at cross-axis coordinate `at`. */
export interface SpacingGuide {
  type: 'spacing';
  axis: 'x' | 'y';
  at: number;
  segments: SpacingSegment[];
}

export type Guide = LineGuide | SpacingGuide;

export function guideKey(g: Guide): string {
  return g.type === 'spacing'
    ? `spacing-${g.axis}-${g.at}-${g.segments.map((s) => `${s.from}:${s.to}`).join(',')}`
    : `${g.type}-${g.position}`;
}

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarginBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface CandidateLines {
  verticals: number[];
  horizontals: number[];
}

// Candidate snap lines per source: each other element contributes its
// edges + center, and the margin bounds (when present) act as one more
// source, checked last.
function candidateLines(
  others: ElementBounds[],
  marginBounds?: MarginBounds | null
): CandidateLines[] {
  const candidates: CandidateLines[] = others.map((other) => ({
    verticals: [other.x, other.x + other.width / 2, other.x + other.width],
    horizontals: [other.y, other.y + other.height / 2, other.y + other.height],
  }));
  if (marginBounds) {
    candidates.push({
      verticals: [marginBounds.left, marginBounds.centerX, marginBounds.right],
      horizontals: [marginBounds.top, marginBounds.centerY, marginBounds.bottom],
    });
  }
  return candidates;
}

function dedupeGuides(guides: Guide[]): Guide[] {
  const seen = new Set<string>();
  return guides.filter((g) => {
    const key = guideKey(g);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface Range {
  lo: number;
  hi: number;
}

interface SpacingSnap {
  dist: number;
  target: number;
  guide: SpacingGuide;
}

// Equal-spacing magnet (Google Slides style): for every gapped pair A→B that
// shares a row/column band with the dragged element, the same gap repeated
// beyond B, before A, or split evenly between them are snap targets.
function bestSpacingSnap(
  dragged: ElementBounds,
  others: ElementBounds[],
  threshold: number,
  axis: 'x' | 'y'
): SpacingSnap | null {
  const main = (b: ElementBounds): Range =>
    axis === 'x' ? { lo: b.x, hi: b.x + b.width } : { lo: b.y, hi: b.y + b.height };
  const cross = (b: ElementBounds): Range =>
    axis === 'x' ? { lo: b.y, hi: b.y + b.height } : { lo: b.x, hi: b.x + b.width };

  const d = main(dragged);
  const dc = cross(dragged);
  const size = d.hi - d.lo;

  let best: SpacingSnap | null = null;
  // `target` is where dragged's leading edge (lo) would land.
  const consider = (target: number, segments: SpacingSegment[], at: number) => {
    const dist = Math.abs(d.lo - target);
    if (dist > threshold) return;
    if (best && best.dist <= dist) return;
    best = {
      dist,
      target,
      guide: {
        type: 'spacing',
        axis,
        at,
        segments: segments.slice().sort((s, t) => s.from - t.from),
      },
    };
  };

  // Precompute per-element ranges once — the pair loop below is O(n²) and
  // runs every pointermove frame.
  const ranges = others.map((el) => ({ main: main(el), cross: cross(el) }));

  for (let i = 0; i < ranges.length; i++) {
    for (let j = 0; j < ranges.length; j++) {
      if (i === j) continue;
      const a = ranges[i].main;
      const b = ranges[j].main;
      if (a.hi > b.lo) continue; // need a clean gap A → B

      // All three must share a band on the cross axis (roughly one row/column).
      const ac = ranges[i].cross;
      const bc = ranges[j].cross;
      const lo = Math.max(dc.lo, ac.lo, bc.lo);
      const hi = Math.min(dc.hi, ac.hi, bc.hi);
      if (lo >= hi) continue;
      const at = (lo + hi) / 2;
      const gap = b.lo - a.hi;

      // Same gap repeated after B
      consider(b.hi + gap, [
        { from: a.hi, to: b.lo },
        { from: b.hi, to: b.hi + gap },
      ], at);
      // Same gap repeated before A
      consider(a.lo - gap - size, [
        { from: a.lo - gap, to: a.lo },
        { from: a.hi, to: b.lo },
      ], at);
      // Centered between A and B with equal gaps on both sides
      const g = (gap - size) / 2;
      if (g >= 0) {
        consider(a.hi + g, [
          { from: a.hi, to: a.hi + g },
          { from: a.hi + g + size, to: b.lo },
        ], at);
      }
    }
  }

  return best;
}

export function computeGuides(
  dragged: ElementBounds,
  others: ElementBounds[],
  threshold: number = 5,
  marginBounds?: MarginBounds | null
): { guides: Guide[]; snapX: number | null; snapY: number | null } {
  const guides: Guide[] = [];
  let snapX: number | null = null;
  let snapY: number | null = null;

  const dragLeft = dragged.x;
  const dragCenterX = dragged.x + dragged.width / 2;
  const dragRight = dragged.x + dragged.width;
  const dragTop = dragged.y;
  const dragCenterY = dragged.y + dragged.height / 2;
  const dragBottom = dragged.y + dragged.height;

  const dragVerticals = [dragLeft, dragCenterX, dragRight];
  const dragHorizontals = [dragTop, dragCenterY, dragBottom];

  let bestDx = threshold + 1;
  let bestDy = threshold + 1;

  for (const { verticals, horizontals } of candidateLines(others, marginBounds)) {
    // Check vertical alignments (x-axis)
    for (const dv of dragVerticals) {
      for (const ov of verticals) {
        const dist = Math.abs(dv - ov);
        if (dist <= threshold && dist < bestDx) {
          bestDx = dist;
          snapX = dragged.x + (ov - dv);
        }
        if (dist <= threshold) {
          guides.push({ type: 'vertical', position: ov });
        }
      }
    }

    // Check horizontal alignments (y-axis)
    for (const dh of dragHorizontals) {
      for (const oh of horizontals) {
        const dist = Math.abs(dh - oh);
        if (dist <= threshold && dist < bestDy) {
          bestDy = dist;
          snapY = dragged.y + (oh - dh);
        }
        if (dist <= threshold) {
          guides.push({ type: 'horizontal', position: oh });
        }
      }
    }
  }

  // Equal-spacing magnets compete with edge/center alignment on the same
  // axis; the closer candidate wins. Only the winning spacing guide is
  // emitted (all matching gap pairs at once would be visual noise).
  const spacingX = bestSpacingSnap(dragged, others, threshold, 'x');
  if (spacingX && spacingX.dist < bestDx) {
    bestDx = spacingX.dist;
    snapX = spacingX.target;
    guides.push(spacingX.guide);
  }
  const spacingY = bestSpacingSnap(dragged, others, threshold, 'y');
  if (spacingY && spacingY.dist < bestDy) {
    bestDy = spacingY.dist;
    snapY = spacingY.target;
    guides.push(spacingY.guide);
  }

  return { guides: dedupeGuides(guides), snapX, snapY };
}

/**
 * Snap a single point to nearby element edges/centers and margin guides.
 * Used for drawing operations where we need to snap start and end points.
 */
export function computePointSnap(
  point: { x: number; y: number },
  others: ElementBounds[],
  threshold: number = 5,
  marginBounds?: MarginBounds | null
): { guides: Guide[]; snapX: number | null; snapY: number | null } {
  const guides: Guide[] = [];
  let snapX: number | null = null;
  let snapY: number | null = null;
  let bestDx = threshold + 1;
  let bestDy = threshold + 1;

  for (const { verticals, horizontals } of candidateLines(others, marginBounds)) {
    for (const ov of verticals) {
      const dist = Math.abs(point.x - ov);
      if (dist <= threshold) {
        if (dist < bestDx) { bestDx = dist; snapX = ov; }
        guides.push({ type: 'vertical', position: ov });
      }
    }

    for (const oh of horizontals) {
      const dist = Math.abs(point.y - oh);
      if (dist <= threshold) {
        if (dist < bestDy) { bestDy = dist; snapY = oh; }
        guides.push({ type: 'horizontal', position: oh });
      }
    }
  }

  return { guides: dedupeGuides(guides), snapX, snapY };
}

export function computeResizeSnap(
  bounds: ElementBounds,
  others: ElementBounds[],
  threshold: number = 5,
  marginBounds?: MarginBounds | null
): {
  guides: Guide[];
  leftSnap: number | null;
  rightSnap: number | null;
  topSnap: number | null;
  bottomSnap: number | null;
} {
  const guides: Guide[] = [];

  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;

  let bestLeftDist = threshold + 1;
  let bestRightDist = threshold + 1;
  let bestTopDist = threshold + 1;
  let bestBottomDist = threshold + 1;
  let leftSnap: number | null = null;
  let rightSnap: number | null = null;
  let topSnap: number | null = null;
  let bottomSnap: number | null = null;

  for (const { verticals, horizontals } of candidateLines(others, marginBounds)) {
    for (const ov of verticals) {
      const dLeft = Math.abs(left - ov);
      if (dLeft <= threshold) {
        if (dLeft < bestLeftDist) { bestLeftDist = dLeft; leftSnap = ov; }
        guides.push({ type: 'vertical', position: ov });
      }
      const dRight = Math.abs(right - ov);
      if (dRight <= threshold) {
        if (dRight < bestRightDist) { bestRightDist = dRight; rightSnap = ov; }
        guides.push({ type: 'vertical', position: ov });
      }
    }

    for (const oh of horizontals) {
      const dTop = Math.abs(top - oh);
      if (dTop <= threshold) {
        if (dTop < bestTopDist) { bestTopDist = dTop; topSnap = oh; }
        guides.push({ type: 'horizontal', position: oh });
      }
      const dBottom = Math.abs(bottom - oh);
      if (dBottom <= threshold) {
        if (dBottom < bestBottomDist) { bestBottomDist = dBottom; bottomSnap = oh; }
        guides.push({ type: 'horizontal', position: oh });
      }
    }
  }

  return { guides: dedupeGuides(guides), leftSnap, rightSnap, topSnap, bottomSnap };
}
