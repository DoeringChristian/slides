import type { ShapeElement } from '../types/presentation';
import type { SvgPath } from '../components/svg/RenderPaths';
import { pathLengthFor } from './glyphPaths';

/**
 * Convert a ShapeElement to its outline path d-string. Used by the Create
 * animation: the shape's perimeter is fed through `RenderPaths` and reveals
 * via stroke-dasharray, then fills in. Coordinates are in absolute slide
 * space (no transform applied).
 */
export function shapeToPathD(shape: ShapeElement): string {
  const { x, y, width: w, height: h, shapeType, cornerRadius, points } = shape;

  switch (shapeType) {
    case 'rect': {
      const r = Math.min(cornerRadius ?? 0, w / 2, h / 2);
      if (r <= 0) {
        return `M ${x} ${y} h ${w} v ${h} h ${-w} z`;
      }
      // Rounded rectangle.
      return [
        `M ${x + r} ${y}`,
        `h ${w - 2 * r}`,
        `a ${r} ${r} 0 0 1 ${r} ${r}`,
        `v ${h - 2 * r}`,
        `a ${r} ${r} 0 0 1 ${-r} ${r}`,
        `h ${-(w - 2 * r)}`,
        `a ${r} ${r} 0 0 1 ${-r} ${-r}`,
        `v ${-(h - 2 * r)}`,
        `a ${r} ${r} 0 0 1 ${r} ${-r}`,
        'z',
      ].join(' ');
    }

    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      const cy = y + ry;
      // Two half-ellipse arcs traced from the left point.
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 z`;
    }

    case 'triangle': {
      const tcx = x + w / 2;
      const tcy = y + h / 2;
      const r = Math.min(w, h) / 2;
      const p0 = [tcx, tcy - r];
      const p1 = [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)];
      const p2 = [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)];
      return `M ${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} Z`;
    }

    case 'star': {
      const scx = x + w / 2;
      const scy = y + h / 2;
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR / 2;
      const segs: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const px = scx + r * Math.cos(angle);
        const py = scy + r * Math.sin(angle);
        segs.push(`${i === 0 ? 'M' : 'L'} ${px} ${py}`);
      }
      segs.push('Z');
      return segs.join(' ');
    }

    case 'line': {
      const pts = points ?? [0, 0, w, 0];
      return `M ${x + pts[0]} ${y + pts[1]} L ${x + pts[2]} ${y + pts[3]}`;
    }

    case 'arrow': {
      const pts = points ?? [0, 0, w, 0];
      const x1 = x + pts[0];
      const y1 = y + pts[1];
      const x2 = x + pts[2];
      const y2 = y + pts[3];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const angle = Math.atan2(dy, dx);
      const headLen = 10;
      const headW = 10;
      const tipX = x2;
      const tipY = y2;
      // Pull the shaft back so the head's triangle sits flush at the tip.
      const lineEndX = tipX - headLen * Math.cos(angle);
      const lineEndY = tipY - headLen * Math.sin(angle);
      const leftX = lineEndX + (headW / 2) * Math.sin(angle);
      const leftY = lineEndY - (headW / 2) * Math.cos(angle);
      const rightX = lineEndX - (headW / 2) * Math.sin(angle);
      const rightY = lineEndY + (headW / 2) * Math.cos(angle);
      // Shaft, then head wings — one continuous path so the pen draws in order.
      return `M ${x1} ${y1} L ${tipX} ${tipY} M ${leftX} ${leftY} L ${tipX} ${tipY} L ${rightX} ${rightY}`;
    }

    default:
      return '';
  }
}

/**
 * Cache for (d-string → length) pairs. The Create animation calls
 * shapeToSvgPaths inside renderElementInner, which fires every frame; without
 * caching, each call invokes pathLengthFor which forces an SVG layout via
 * getTotalLength(). At 60 fps for several shapes that's the difference
 * between buttery and choppy.
 *
 * Keyed on the d-string itself — two shapes with identical geometry get the
 * same length. Cache grows unbounded but is bounded by distinct shape
 * geometries in the deck, which is small.
 */
const geomCache = new Map<string, { d: string; length: number }>();

function shapeGeometryKey(shape: ShapeElement): string {
  // Only the fields that affect the d-string.
  return [
    shape.shapeType,
    shape.x, shape.y, shape.width, shape.height,
    shape.cornerRadius ?? 0,
    shape.points ? shape.points.join(',') : '',
  ].join('|');
}

/**
 * Build the SvgPath array for a shape's Create animation. Returns ONE entry
 * (single outline) — RenderPaths' stagger naturally degrades to "no stagger"
 * for N=1, and the REVEAL → FILL pacing runs across the full window.
 *
 * The d-string + path length are cached by geometry; fill/stroke colours are
 * applied on top and DON'T trigger a re-compute (they live on the SvgPath,
 * not the cache key).
 */
export function shapeToSvgPaths(shape: ShapeElement): SvgPath[] {
  const key = shapeGeometryKey(shape);
  let entry = geomCache.get(key);
  if (!entry) {
    const d = shapeToPathD(shape);
    if (!d) return [];
    entry = { d, length: pathLengthFor(d) };
    geomCache.set(key, entry);
  }
  return [{
    d: entry.d,
    transform: '',
    length: entry.length,
    fillColor: shape.fill || 'transparent',
    strokeColor: shape.stroke || shape.fill || '#000',
    nonScalingStroke: false,
  }];
}

/** Invalidate the geometry cache (e.g. after a bulk import). Not needed for
 *  normal operation — distinct geometries simply add new entries. */
export function clearShapePathCache(): void {
  geomCache.clear();
}
