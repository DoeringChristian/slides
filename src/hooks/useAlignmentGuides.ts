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

export function computeGuides(
  dragged: ElementBounds,
  others: ElementBounds[],
  threshold: number = 5
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
