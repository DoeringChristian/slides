export interface Guide {
  type: 'horizontal' | 'vertical';
  position: number;
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

  for (const other of others) {
    const otherLeft = other.x;
    const otherCenterX = other.x + other.width / 2;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherCenterY = other.y + other.height / 2;
    const otherBottom = other.y + other.height;

    const otherVerticals = [otherLeft, otherCenterX, otherRight];
    const otherHorizontals = [otherTop, otherCenterY, otherBottom];

    // Check vertical alignments (x-axis)
    for (const dv of dragVerticals) {
      for (const ov of otherVerticals) {
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
      for (const oh of otherHorizontals) {
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

  // Check margin bounds if provided
  if (marginBounds) {
    const marginVerticals = [marginBounds.left, marginBounds.centerX, marginBounds.right];
    const marginHorizontals = [marginBounds.top, marginBounds.centerY, marginBounds.bottom];

    for (const dv of dragVerticals) {
      for (const mv of marginVerticals) {
        const dist = Math.abs(dv - mv);
        if (dist <= threshold && dist < bestDx) {
          bestDx = dist;
          snapX = dragged.x + (mv - dv);
        }
        if (dist <= threshold) {
          guides.push({ type: 'vertical', position: mv });
        }
      }
    }

    for (const dh of dragHorizontals) {
      for (const mh of marginHorizontals) {
        const dist = Math.abs(dh - mh);
        if (dist <= threshold && dist < bestDy) {
          bestDy = dist;
          snapY = dragged.y + (mh - dh);
        }
        if (dist <= threshold) {
          guides.push({ type: 'horizontal', position: mh });
        }
      }
    }
  }

  // Deduplicate guides
  const seen = new Set<string>();
  const uniqueGuides = guides.filter((g) => {
    const key = `${g.type}-${g.position}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { guides: uniqueGuides, snapX, snapY };
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

  for (const other of others) {
    const otherVerticals = [other.x, other.x + other.width / 2, other.x + other.width];
    const otherHorizontals = [other.y, other.y + other.height / 2, other.y + other.height];

    for (const ov of otherVerticals) {
      const dist = Math.abs(point.x - ov);
      if (dist <= threshold) {
        if (dist < bestDx) { bestDx = dist; snapX = ov; }
        guides.push({ type: 'vertical', position: ov });
      }
    }

    for (const oh of otherHorizontals) {
      const dist = Math.abs(point.y - oh);
      if (dist <= threshold) {
        if (dist < bestDy) { bestDy = dist; snapY = oh; }
        guides.push({ type: 'horizontal', position: oh });
      }
    }
  }

  // Check margin bounds if provided
  if (marginBounds) {
    const marginVerticals = [marginBounds.left, marginBounds.centerX, marginBounds.right];
    const marginHorizontals = [marginBounds.top, marginBounds.centerY, marginBounds.bottom];

    for (const mv of marginVerticals) {
      const dist = Math.abs(point.x - mv);
      if (dist <= threshold) {
        if (dist < bestDx) { bestDx = dist; snapX = mv; }
        guides.push({ type: 'vertical', position: mv });
      }
    }

    for (const mh of marginHorizontals) {
      const dist = Math.abs(point.y - mh);
      if (dist <= threshold) {
        if (dist < bestDy) { bestDy = dist; snapY = mh; }
        guides.push({ type: 'horizontal', position: mh });
      }
    }
  }

  const seen = new Set<string>();
  const uniqueGuides = guides.filter((g) => {
    const key = `${g.type}-${g.position}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { guides: uniqueGuides, snapX, snapY };
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

  for (const other of others) {
    const otherVerticals = [other.x, other.x + other.width / 2, other.x + other.width];
    const otherHorizontals = [other.y, other.y + other.height / 2, other.y + other.height];

    for (const ov of otherVerticals) {
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

    for (const oh of otherHorizontals) {
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

  // Check margin bounds if provided
  if (marginBounds) {
    const marginVerticals = [marginBounds.left, marginBounds.centerX, marginBounds.right];
    const marginHorizontals = [marginBounds.top, marginBounds.centerY, marginBounds.bottom];

    for (const mv of marginVerticals) {
      const dLeft = Math.abs(left - mv);
      if (dLeft <= threshold) {
        if (dLeft < bestLeftDist) { bestLeftDist = dLeft; leftSnap = mv; }
        guides.push({ type: 'vertical', position: mv });
      }
      const dRight = Math.abs(right - mv);
      if (dRight <= threshold) {
        if (dRight < bestRightDist) { bestRightDist = dRight; rightSnap = mv; }
        guides.push({ type: 'vertical', position: mv });
      }
    }

    for (const mh of marginHorizontals) {
      const dTop = Math.abs(top - mh);
      if (dTop <= threshold) {
        if (dTop < bestTopDist) { bestTopDist = dTop; topSnap = mh; }
        guides.push({ type: 'horizontal', position: mh });
      }
      const dBottom = Math.abs(bottom - mh);
      if (dBottom <= threshold) {
        if (dBottom < bestBottomDist) { bestBottomDist = dBottom; bottomSnap = mh; }
        guides.push({ type: 'horizontal', position: mh });
      }
    }
  }

  const seen = new Set<string>();
  const uniqueGuides = guides.filter((g) => {
    const key = `${g.type}-${g.position}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { guides: uniqueGuides, leftSnap, rightSnap, topSnap, bottomSnap };
}
