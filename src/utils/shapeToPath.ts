import { resolveShapePaint, rectangleRadii } from './shapePaint';
import { resolveShapeGeometry } from './vectorGeometry';
import type { ShapeElement } from '../types/presentation';
import type { SvgPath } from '../components/svg/RenderPaths';
import { pathLengthFor } from './glyphPaths';
import { pathArrowGeometry, type ClosurePathShape, type ExtendPathShape } from './pathShapes';

/**
 * Convert a ShapeElement to its outline path d-string. Used by the Create
 * animation: the shape's perimeter is fed through `RenderPaths` and reveals
 * via stroke-dasharray, then fills in. Coordinates are in absolute slide
 * space (no transform applied).
 */
export function shapeToPathD(shape: ShapeElement): string {
  const { x, y, width: w, height: h, shapeType, points } = shape;

  switch (shapeType) {
    case 'vector': return resolveShapeGeometry(shape).strokes.join(' ');
    case 'rect': {
      const { rx, ry } = rectangleRadii(shape);
      if (rx <= 0 || ry <= 0) {
        return `M ${x} ${y} h ${w} v ${h} h ${-w} z`;
      }
      // Rounded rectangle.
      return [
        `M ${x + rx} ${y}`,
        `h ${w - 2 * rx}`,
        `a ${rx} ${ry} 0 0 1 ${rx} ${ry}`,
        `v ${h - 2 * ry}`,
        `a ${rx} ${ry} 0 0 1 ${-rx} ${ry}`,
        `h ${-(w - 2 * rx)}`,
        `a ${rx} ${ry} 0 0 1 ${-rx} ${-ry}`,
        `v ${-(h - 2 * ry)}`,
        `a ${rx} ${ry} 0 0 1 ${rx} ${-ry}`,
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

    case 'path': {
      const pts = points ?? [];
      if (pts.length < 4) return '';
      const abs = pts.map((v, i) => v + (i % 2 === 0 ? x : y));
      const { startGeo, endGeo, d: main } = pathArrowGeometry({ ...shape, points: abs });
      // Append the head primitives to the path so the Create pen traces
      // through them in order — fills as closed polygon outlines, strokes
      // and circle d-strings verbatim.
      const heads: string[] = [];
      const addGeo = (geo: NonNullable<typeof startGeo>) => {
        for (const f of geo.fills) {
          if ('points' in f) {
            const p = f.points;
            const cmds = [`M ${p[0]} ${p[1]}`];
            for (let i = 2; i < p.length; i += 2) cmds.push(`L ${p[i]} ${p[i + 1]}`);
            cmds.push('Z');
            heads.push(cmds.join(' '));
          } else {
            heads.push(f.d);
          }
        }
        for (const s of geo.strokes) heads.push(s.d);
      };
      if (startGeo) addGeo(startGeo);
      if (endGeo) addGeo(endGeo);
      return [main, ...heads].join(' ');
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
// Headed Create splits the shaft and glyphs; retain the same no-layout-per-frame
// guarantee for these individually measured paths.
const headedLengthCache = new Map<string, number>();
function headedPathLength(d: string): number {
  let length = headedLengthCache.get(d);
  if (length === undefined) {
    length = pathLengthFor(d);
    headedLengthCache.set(d, length);
  }
  return length;
}

function shapeGeometryKey(shape: ShapeElement): string {
  // Only the fields that affect the d-string.
  return [
    shape.shapeType,
    shape.x, shape.y, shape.width, shape.height,
    shape.cornerRadius ?? 0,
    shape.points ? shape.points.join(',') : '',
    shape.tangents ? shape.tangents.join(',') : '',
    shape.closed ? 1 : 0,
    shape.curve ?? 'linear',
    shape.startHead ?? 'none',
    shape.endHead ?? 'none',
    // Head size scales with strokeWidth, so it's part of the geometry key.
    shape.strokeWidth ?? 0,
    // An in-flight `extend` prefix changes the d-string every frame.
    (shape as ExtendPathShape)._extendFx?.progress ?? '',
  ].join('|');
}

/**
 * Build the SvgPath array for Create. Headed paths separate shaft and glyphs
 * so shaft cuts cannot erase heads or paint across outlined head holes.
 * Other shapes keep a single outline and the existing no-stagger timing.
 *
 * The d-string + path length are cached by geometry; fill/stroke colours are
 * applied on top and DON'T trigger a re-compute (they live on the SvgPath,
 * not the cache key).
 */
export function shapeToSvgPaths(shape: ShapeElement, fillPaint = shape.fill || 'transparent'): SvgPath[] {
  const paint = resolveShapePaint(shape, fillPaint);
  if (shape.shapeType === 'vector') {
    const geometry = resolveShapeGeometry(shape);
    return [
      ...geometry.fills.map(region => ({ d: region.d, fillColor: fillPaint, fillSourceColor: shape.fill,
        strokeColor: 'none', fillRule: region.rule, createRole: 'fill' as const })),
      { d: geometry.strokes.join(' '), fillColor: 'none', strokeColor: paint.stroke, createRole: 'stroke' as const },
    ].map(path => ({ ...path, transform: '',
      // Dash phase resets at each M. Using the compound SUM would leave every
      // short contour invisible at the start. One stroke operation preserves
      // paint alpha at intersections; the longest contour defines its clock.
      length: path.createRole === 'stroke' ? Math.max(0, ...geometry.strokes.map(headedPathLength)) : headedPathLength(path.d),
      nonScalingStroke: false }));
  }
  const closure = (shape as ClosurePathShape)._pathClosure;
  if (shape.shapeType === 'path' && (closure || shape.startHead && shape.startHead !== 'none' || shape.endHead && shape.endHead !== 'none')) {
    const geo = pathArrowGeometry(shape);
    const strokeColor = paint.stroke;
    const transform = `translate(${shape.x}, ${shape.y})`;
    const path = (d: string, fillColor: string, shaftClipPaths?: string[]): SvgPath => ({
      d, length: headedPathLength(d), transform, fillColor, strokeColor, nonScalingStroke: false, shaftClipPaths,
    });
    const paths: SvgPath[] = geo.d || geo.strokePlan ? [{
      ...path(geo.d, closure ? 'none' : paint.fill, geo.shaftClipPaths),
      fillD: geo.fillD, strokePlan: geo.strokePlan,
      length: geo.strokePlan?.length ?? headedPathLength(geo.d),
      fillSourceColor: closure ? 'none' : shape.closed ? shape.fill : 'none',
    }] : [];
    if (closure) paths.unshift({ ...path(geo.fillD, paint.fill), strokeColor: 'none',
      fillSourceColor: shape.fill, fillOpacity: closure.fillOpacity, createRole: 'fill' });
    for (const head of [geo.startGeo, geo.endGeo]) {
      if (!head) continue;
      for (const f of head.fills) {
        const d = 'd' in f ? f.d : f.points.reduce((d, v, i) => d + (i % 2 ? ` ${v}` : `${i ? ' L' : 'M'} ${v}`), '') + ' Z';
        paths.push(path(d, strokeColor));
      }
      for (const stroke of head.strokes) paths.push(path(stroke.d, 'none'));
    }
    return paths;
  }
  const key = shapeGeometryKey(shape);
  let entry = geomCache.get(key);
  if (!entry) {
    const d = shapeToPathD(shape);
    if (!d) return [];
    entry = { d, length: pathLengthFor(d) };
    geomCache.set(key, entry);
  }
  // Open paths (line / arrow / unclosed polyline) have no fillable area —
  // mirror ElementRenderer's `fillCol = closed ? fillAttr : 'none'` so the
  // Create animation's FILL phase has nothing to fill with. RenderPaths
  // detects `none` and holds the stroke instead of fading it out, which
  // would otherwise blink the line off for one frame before the steady
  // render takes over.
  const isOpenPath = shape.shapeType === 'path' && !(shape.closed ?? false);
  const fillColor = isOpenPath ? 'none' : fillPaint;
  return [{
    d: entry.d,
    transform: '',
    length: entry.length,
    fillColor,
    fillSourceColor: isOpenPath ? 'none' : shape.fill,
    strokeColor: paint.stroke,
    // Preserve the existing ordinary-shape Create outline pen, even when
    // steady paint has no stroke. Picking deliberately ignores this field.
    ...(shape.shapeType !== 'path' ? { traceStrokeColor: shape.stroke || shape.fill || '#000' } : {}),
    nonScalingStroke: false,
  }];
}

/** Invalidate the geometry cache (e.g. after a bulk import). Not needed for
 *  normal operation — distinct geometries simply add new entries. */
export function clearShapePathCache(): void {
  geomCache.clear();
  headedLengthCache.clear();
}
