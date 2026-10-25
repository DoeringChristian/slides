import { resizeKeepsBinding } from './resizeGeometry';
import { sameTranslation, verifiedTranslations } from './elementTranslation';
import { screenPixelsToSlide } from './screenSpace';
import type {
  SlideElement,
  ShapeElement,
  ConnectorBinding,
  BindingMode,
} from '../types/presentation';
import { pathPointsInSlide, slidePointToPath, pathGeometryUpdate } from './pathEditing';

export interface Pt { x: number; y: number }

const EPS = 1e-9;

// Rotate a point around a center by an angle (in degrees)
function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angleDeg: number
): Pt {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

// Get the rotation origin for an element
// SVG rotates all elements around the center of their bounding box
function getRotationOrigin(el: SlideElement): Pt {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

export function effectiveBindingMode(binding: ConnectorBinding): BindingMode {
  return binding.mode;
}

export function isPinnedBinding(binding: ConnectorBinding): boolean {
  return effectiveBindingMode(binding) === 'pinned';
}

// =============================================================================
// Silhouette geometry
// =============================================================================

/** Smallest ray parameter t (≥ EPS) where `from + t·dir` crosses the segment
 *  (x1,y1)–(x2,y2), or null. */
function raySegmentT(
  fx: number, fy: number, dx: number, dy: number,
  x1: number, y1: number, x2: number, y2: number,
): number | null {
  const sx = x2 - x1;
  const sy = y2 - y1;
  const det = dx * (-sy) - (-sx) * dy;
  if (Math.abs(det) < EPS) return null;
  const ex = x1 - fx;
  const ey = y1 - fy;
  const t = (ex * (-sy) - (-sx) * ey) / det;
  const u = (dx * ey - dy * ex) / det;
  if (t < EPS || u < -EPS || u > 1 + EPS) return null;
  return t;
}

/** Smallest positive t over a closed polygon boundary (flat vertex list). */
function rayPolygonT(fx: number, fy: number, dx: number, dy: number, poly: number[]): number | null {
  const n = poly.length / 2;
  let best: number | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t = raySegmentT(fx, fy, dx, dy, poly[2 * i], poly[2 * i + 1], poly[2 * j], poly[2 * j + 1]);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Both circle-intersection ts (may be negative), or empty. */
function rayCircleTs(fx: number, fy: number, dx: number, dy: number, cx: number, cy: number, r: number): number[] {
  const ox = fx - cx;
  const oy = fy - cy;
  const a = dx * dx + dy * dy;
  if (a < EPS) return [];
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-b - s) / (2 * a), (-b + s) / (2 * a)];
}

function rayRoundedRectT(
  fx: number, fy: number, dx: number, dy: number,
  x: number, y: number, w: number, h: number, r: number,
): number | null {
  if (r <= 0) {
    return rayPolygonT(fx, fy, dx, dy, [x, y, x + w, y, x + w, y + h, x, y + h]);
  }
  const cand: number[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    const t = raySegmentT(fx, fy, dx, dy, x1, y1, x2, y2);
    if (t !== null) cand.push(t);
  };
  // Straight edges shortened by the corner radius.
  seg(x + r, y, x + w - r, y);              // top
  seg(x + w, y + r, x + w, y + h - r);      // right
  seg(x + w - r, y + h, x + r, y + h);      // bottom
  seg(x, y + h - r, x, y + r);              // left
  // Quarter-circle corners, filtered to their quadrant.
  const corner = (ccx: number, ccy: number, qx: number, qy: number) => {
    for (const t of rayCircleTs(fx, fy, dx, dy, ccx, ccy, r)) {
      if (t < EPS) continue;
      const px = fx + t * dx;
      const py = fy + t * dy;
      if ((px - ccx) * qx >= -EPS && (py - ccy) * qy >= -EPS) cand.push(t);
    }
  };
  corner(x + r, y + r, -1, -1);          // top-left
  corner(x + w - r, y + r, 1, -1);       // top-right
  corner(x + w - r, y + h - r, 1, 1);    // bottom-right
  corner(x + r, y + h - r, -1, 1);       // bottom-left
  return cand.length ? Math.min(...cand) : null;
}

function rayEllipseT(
  fx: number, fy: number, dx: number, dy: number,
  cx: number, cy: number, rx: number, ry: number,
): number | null {
  if (rx < EPS || ry < EPS) return null;
  // Normalize to the unit circle.
  const ox = (fx - cx) / rx;
  const oy = (fy - cy) / ry;
  const ux = dx / rx;
  const uy = dy / ry;
  const a = ux * ux + uy * uy;
  if (a < EPS) return null;
  const b = 2 * (ox * ux + oy * uy);
  const c = ox * ox + oy * oy - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  if (t1 >= EPS) return t1;
  if (t2 >= EPS) return t2;
  return null;
}

/** Triangle vertices exactly as rendered (equilateral inscribed in a circle
 *  of radius min(w,h)/2 centered on the bbox — mirrors shapeToPathD). */
function triangleVerts(x: number, y: number, w: number, h: number): number[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  return [
    cx, cy - r,
    cx - r * cos30, cy + r * sin30,
    cx + r * cos30, cy + r * sin30,
  ];
}

/** 10-point star exactly as rendered (mirrors shapeToPathD). */
function starVerts(x: number, y: number, w: number, h: number): number[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outerR = Math.min(w, h) / 2;
  const innerR = outerR / 2;
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    out.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  return out;
}

/** Ray/silhouette hit in the element's LOCAL (unrotated) frame. */
function localSilhouetteT(el: SlideElement, fx: number, fy: number, dx: number, dy: number): number | null {
  const { x, y, width: w, height: h } = el;
  if (el.type === 'shape') {
    const s = el as ShapeElement;
    switch (s.shapeType) {
      case 'ellipse':
        return rayEllipseT(fx, fy, dx, dy, x + w / 2, y + h / 2, w / 2, h / 2);
      case 'triangle':
        return rayPolygonT(fx, fy, dx, dy, triangleVerts(x, y, w, h));
      case 'star':
        return rayPolygonT(fx, fy, dx, dy, starVerts(x, y, w, h));
      case 'rect': {
        const r = Math.max(0, Math.min(s.cornerRadius ?? 0, w / 2, h / 2));
        return rayRoundedRectT(fx, fy, dx, dy, x, y, w, h, r);
      }
      default:
        // Vectors/icons deliberately bind to their design box, not detail strokes.
        // Path shapes are never binding targets; fall through to bbox.
        return rayRoundedRectT(fx, fy, dx, dy, x, y, w, h, 0);
    }
  }
  // Text / image / group: silhouette = bounding box.
  return rayRoundedRectT(fx, fy, dx, dy, x, y, w, h, 0);
}

/**
 * Intersection of the ray `from → toward` with `target`'s silhouette
 * (nearest crossing along the ray), in absolute slide coords. Honors the
 * element's rotation (unrotate ray → intersect local shape → re-rotate) and
 * a rect's cornerRadius arcs. Ellipse / triangle / star use their exact
 * rendered outline; text / image (and any other type) use the bounding box.
 * Returns null when the ray misses or is degenerate.
 */
export function silhouetteIntersect(target: SlideElement, from: Pt, toward: Pt): Pt | null {
  let fx = from.x;
  let fy = from.y;
  let tx = toward.x;
  let ty = toward.y;
  const rotation = target.rotation || 0;
  const origin = getRotationOrigin(target);
  if (rotation) {
    ({ x: fx, y: fy } = rotatePoint(fx, fy, origin.x, origin.y, -rotation));
    ({ x: tx, y: ty } = rotatePoint(tx, ty, origin.x, origin.y, -rotation));
  }
  const dx = tx - fx;
  const dy = ty - fy;
  if (Math.hypot(dx, dy) < EPS) return null;
  const t = localSilhouetteT(target, fx, fy, dx, dy);
  if (t === null) return null;
  const hx = fx + t * dx;
  const hy = fy + t * dy;
  return rotation ? rotatePoint(hx, hy, origin.x, origin.y, rotation) : { x: hx, y: hy };
}

// =============================================================================
// Binding resolution (binding → point) and inverse (point → binding)
// =============================================================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Object-local focus transformed with the target, never the visible endpoint. */
export function bindingAimPoint(binding: ConnectorBinding, target: SlideElement): Pt {
  const [u, v] = binding.fixedPoint;
  const c = getRotationOrigin(target);
  return rotatePoint(target.x + u * target.width, target.y + v * target.height, c.x, c.y, target.rotation || 0);
}

/** Resolve a local aim against the silhouette or a fixed pin against the box. */
export function resolveBinding(
  binding: ConnectorBinding,
  target: SlideElement,
  otherEndAbs: Pt,
): Pt {
  const c = getRotationOrigin(target);

  if (effectiveBindingMode(binding) === 'aim') {
    const focus = bindingAimPoint(binding, target);
    const dx = otherEndAbs.x - focus.x, dy = otherEndAbs.y - focus.y;
    const length = Math.hypot(dx, dy);
    if (length < EPS) return focus;
    const hit = silhouetteIntersect(target, focus, otherEndAbs);
    // Upstream updateBoundPoint safeguard intent: when no exposed span exists
    // (origin inside target, tiny/overlapping targets), focus avoids inversion.
    if (!hit) return focus;
    const distance = Math.hypot(hit.x - focus.x, hit.y - focus.y);
    const gap = Math.max(0, binding.gap ?? 0);
    if (distance + gap >= length - EPS) return focus;
    return { x: hit.x + dx / length * gap, y: hit.y + dy / length * gap };
  }

  if (effectiveBindingMode(binding) === 'pinned') {
    const [u, v] = binding.fixedPoint;
    const lx = target.x + u * target.width;
    const ly = target.y + v * target.height;
    return rotatePoint(lx, ly, c.x, c.y, target.rotation || 0);
  }

  throw new Error('Unsupported connector binding mode');
}

/** Capture an object-local point for aim or pinned tracking. */
export function bindingFor(point: Pt, target: SlideElement, mode: BindingMode): ConnectorBinding {
  const c = getRotationOrigin(target);
  const local = rotatePoint(point.x, point.y, c.x, c.y, -(target.rotation || 0));
  const u = target.width > EPS ? clamp((local.x - target.x) / target.width, 0, 1) : 0.5;
  const v = target.height > EPS ? clamp((local.y - target.y) / target.height, 0, 1) : 0.5;
  return { elementId: target.id, mode, fixedPoint: [u, v], ...(mode === 'aim' ? { gap: 0 } : {}) };
}

/** Signed shortest distance to the rendered silhouette (negative inside).
 * Rotation is removed before measuring. Polygon edges and rounded rectangles
 * are exact; ellipse distance minimizes on its analytic first-quadrant arc. */
export function silhouetteDistance(target: SlideElement, point: Pt): number {
  const c = getRotationOrigin(target);
  const p = rotatePoint(point.x, point.y, c.x, c.y, -(target.rotation || 0));
  const { x, y, width: w, height: h } = target;
  if (target.type === 'shape') {
    if (target.shapeType === 'ellipse' && w > EPS && h > EPS) {
      const px = Math.abs(p.x - c.x), py = Math.abs(p.y - c.y);
      const rx = w / 2, ry = h / 2;
      const distanceSq = (angle: number) => (rx * Math.cos(angle) - px) ** 2 + (ry * Math.sin(angle) - py) ** 2;
      // Bracket the closest point, including axis endpoints, then refine.
      const step = Math.PI / 128;
      let best = 0;
      for (let i = 1; i <= 64; i++) if (distanceSq(i * step) < distanceSq(best * step)) best = i;
      let lo = Math.max(0, (best - 1) * step), hi = Math.min(Math.PI / 2, (best + 1) * step);
      for (let i = 0; i < 40; i++) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (distanceSq(a) < distanceSq(b)) hi = b; else lo = a;
      }
      const d = Math.sqrt(Math.min(distanceSq(0), distanceSq(Math.PI / 2), distanceSq((lo + hi) / 2)));
      return (px / rx) ** 2 + (py / ry) ** 2 < 1 ? -d : d;
    }
    if (target.shapeType === 'triangle' || target.shapeType === 'star') {
      const poly = target.shapeType === 'triangle' ? triangleVerts(x, y, w, h) : starVerts(x, y, w, h);
      let inside = false, distance = Infinity;
      const n = poly.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = poly[2 * j], ay = poly[2 * j + 1], bx = poly[2 * i], by = poly[2 * i + 1];
        if ((ay > p.y) !== (by > p.y) && p.x < (bx - ax) * (p.y - ay) / (by - ay) + ax) inside = !inside;
        const dx = bx - ax, dy = by - ay;
        const t = clamp(((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        distance = Math.min(distance, Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy));
      }
      return inside ? -distance : distance;
    }
  }
  const r = target.type === 'shape' && target.shapeType === 'rect'
    ? clamp(target.cornerRadius ?? 0, 0, Math.min(w, h) / 2) : 0;
  const qx = Math.abs(p.x - c.x) - w / 2 + r;
  const qy = Math.abs(p.y - c.y) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export interface ConnectorDockCue { point: Pt; binding: ConnectorBinding; active: boolean }
export type ConnectorHighlightCallback = (elementId: string | null, dock?: ConnectorDockCue | null) => void;

/** Bounded counterpart of Excalidraw c0ad61c utils.getSnapOutlineMidPoint:
 * rotated side midpoints, exterior-only, simple binding zoom budget. Use the
 * nearest candidate for BOTH paint and acquisition (upstream paint/picker differ
 * on tiny targets). No guessed triangle/star/icon bounding-box docks. */
export function supportsConnectorDocks(target: SlideElement): boolean {
  return target.visible !== false && !target.locked && target.width > EPS && target.height > EPS
    && (target.type === 'image' || (target.type === 'text' && !target.containerId)
      || (target.type === 'shape' && (target.shapeType === 'rect' || target.shapeType === 'ellipse')));
}

export function connectorDockCue(point: Pt, target: SlideElement, zoom = 1, angleLocked = false, rayOrigin?: Pt): ConnectorDockCue | null {
  if ((angleLocked && !rayOrigin) || !supportsConnectorDocks(target) || silhouetteDistance(target, point) < -EPS) return null;
  const threshold = clamp(15 / (Math.min(Math.max(zoom, EPS), 1) * 1.5), 15, 30)
    + (target.type === 'shape' ? target.strokeWidth / 2 : 0);
  const candidates = ([[1, .5], [.5, 1], [0, .5], [.5, 0]] as [number, number][]).map(fixedPoint => bindingAimPoint({ elementId: target.id, mode: 'pinned', fixedPoint }, target));
  let nearest = candidates[0], distance = Infinity;
  for (const candidate of candidates) {
    if (angleLocked && rayOrigin && !pointOnBindingRay(point, rayOrigin, candidate)) continue;
    const d = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (d < distance) { nearest = candidate; distance = d; }
  }
  if (distance > threshold * 2) return null;
  return { point: nearest, binding: bindingFor(nearest, target, 'pinned'), active: distance <= threshold };
}

/** New attachments aim into the object.
 * Outside drops acquire the center; interior drops preserve the exact local aim.
 * This also keeps off-ray proximity acquisition rejectable under Shift. */
export function bindingForDrop(point: Pt, target: SlideElement): ConnectorBinding {
  const focus = silhouetteDistance(target, point) <= 0 ? point : getRotationOrigin(target);
  return bindingFor(focus, target, 'aim');
}

// =============================================================================
// Target picking
// =============================================================================

/** Size-based acquisition budget (16–32 SCREEN pixels), converted at every
 * zoom, not just below 1. Keep the existing smaller budget for tiny targets. */
function bindThreshold(el: SlideElement, zoom?: number): number {
  const base = Math.max(16, Math.min(0.5 * Math.min(el.width, el.height), 32));
  return screenPixelsToSlide(base, zoom);
}

/**
 * Binding-target lookup, v2 (Excalidraw semantics): an element binds when
 * `point` is INSIDE its silhouette or within a size-scaled threshold of it
 * (max(16, min(0.5·minDim, 32)) screen pixels, divided by zoom).
 *
 * `elements` must be in z-order (bottom → top, i.e. `elementOrder` order —
 * exactly what the canvas / drawing call sites pass); the TOPMOST matching
 * element wins. Invisible / locked elements and path shapes are never
 * targets (unchanged policy).
 *
 * Uses shortest distance to the true silhouette, not the bounding box or
 * radial distance (important at star notches and rounded corners).
 */
export function getBindingTarget2(
  point: Pt,
  elements: SlideElement[],
  excludeId: string,
  zoom?: number,
): SlideElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el || el.id === excludeId) continue;
    if (el.visible === false || el.locked) continue;
    // A bound label is part of its container, not an independent target.
    // Let the container's silhouette and eligibility decide acquisition.
    if (el.type === 'text' && el.containerId) continue;
    if (el.type === 'shape' && (el as ShapeElement).shapeType === 'path') continue;
    if (silhouetteDistance(el, point) <= bindThreshold(el, zoom)) return el;
  }
  return null;
}

// =============================================================================
// Rebind pass + draw-commit binding
// =============================================================================

/** Geometry patch produced by the shared rebind pass. */
export interface RebindResult {
  elementId: string;
  changes: { x: number; y: number; width: number; height: number; points: number[] };
}

/**
 * THE rebind pass: after some elements moved / resized / rotated / had their
 * points edited, recompute every bound path on the slide so its endpoints
 * keep tracking their targets.
 *
 * `elements` must be the POST-move slide snapshot (target geometry already
 * updated); `movedIds` is the set of elements whose geometry changed this
 * mutation. Optional `beforeElements` verifies rigid co-translations, whose
 * endpoints must not be re-solved. Otherwise, two triggers per bound end:
 *   - the binding's TARGET is in `movedIds` (any mode), or
 *   - the path ITSELF is in `movedIds` and the binding is aim-mode — the
 *     solution depends on the ray direction, so the path's own geometry
 *     change (vertex edit) re-solves its ends. Pinned ends
 *     of a moved path are left alone only when their target did not move
 *     (whole-arrow drags clear external bindings at the call site). Verified
 *     co-translations / uniform co-resizes above bypass both triggers.
 *
 * One shared implementation for all four store call sites (updateElement /
 * updateElements × Y / JSON) — the two paths MUST stay semantically
 * equivalent, so neither is allowed to inline its own variant of this loop.
 *
 * Tolerates stale `elementOrder` ids (missing element ⇒ skipped),
 * non-shape elements, and bindings whose target no longer exists.
 */
export function rebindAfterElementsMoved(
  elements: Record<string, SlideElement>,
  elementOrder: readonly string[],
  movedIds: ReadonlySet<string>,
  beforeElements?: Record<string, SlideElement>,
): RebindResult[] {
  const results: RebindResult[] = [];
  if (movedIds.size === 0) return results;
  const translations = beforeElements ? verifiedTranslations(beforeElements, elements, movedIds) : undefined;

  for (const elId of elementOrder) {
    const el = elements[elId];
    if (!el || el.type !== 'shape') continue;
    const shape = el as ShapeElement;
    if (shape.shapeType !== 'path') continue;
    const pts = shape.points;
    if (!pts || pts.length < 4) continue;

    const selfMoved = movedIds.has(elId);
    const straightPair = pts.length === 4 && (shape.curve ?? 'linear') === 'linear';
    const needsSolve = (binding: ConnectorBinding | null | undefined, end: 'startBinding' | 'endBinding'): binding is ConnectorBinding => {
      if (!binding || !elements[binding.elementId]) return false;
      const beforeShape = beforeElements?.[elId];
      const oppositeKey = end === 'startBinding' ? 'endBinding' : 'startBinding';
      const opposite = shape[oppositeKey];
      const pairedAim = straightPair && binding.mode === 'aim' && opposite && elements[opposite.elementId];
      // Creation solves against raw adjacent vertices, so re-solving already
      // snapped endpoints is not idempotent. Preserve a verified rigid move,
      // but never exempt endpoint/parameter edits or unequal target deltas.
      if (beforeShape?.type === 'shape' &&
          JSON.stringify(beforeShape[end]) === JSON.stringify(binding) &&
          (!pairedAim || (JSON.stringify(beforeShape[oppositeKey]) === JSON.stringify(opposite) && sameTranslation(translations?.get(elId), translations?.get(opposite!.elementId)))) &&
          sameTranslation(translations?.get(elId), translations?.get(binding.elementId))) return false;
      const oldTarget = beforeElements?.[binding.elementId];
      if (selfMoved && beforeShape?.type === 'shape' && oldTarget &&
          resizeKeepsBinding(beforeShape, shape, oldTarget, elements[binding.elementId], end) &&
          (!pairedAim || (!!beforeElements?.[opposite!.elementId] && resizeKeepsBinding(beforeShape, shape, beforeElements[opposite!.elementId], elements[opposite!.elementId], oppositeKey)))) return false;
      if (selfMoved) return !isPinnedBinding(binding) || movedIds.has(binding.elementId);
      return movedIds.has(binding.elementId) || (straightPair && !!opposite && (binding.mode === 'aim' || opposite.mode === 'aim') && movedIds.has(opposite.elementId));
    };
    const solveStart = needsSolve(shape.startBinding, 'startBinding');
    const solveEnd = needsSolve(shape.endBinding, 'endBinding');
    if (!solveStart && !solveEnd) continue;

    // Working set: every vertex in absolute slide coords. Only the bound
    // first / last vertices get overwritten — interior vertices keep their
    // absolute positions, so a curved path holds its shape.
    const abs = pathPointsInSlide(shape);
    const last = abs.length - 2;
    // Adjacent vertices from the PRE-pass snapshot (both ends solved against
    // the same snapshot, mirroring Excalidraw's updateBoundPoint).
    const rawEndAdj = { x: abs[last - 2], y: abs[last - 1] };
    const oppositeAim = (binding: ConnectorBinding | null | undefined, fallback: Pt) =>
      straightPair && binding && elements[binding.elementId]
        ? bindingAimPoint(binding, elements[binding.elementId]) : fallback;
    const startAdj = oppositeAim(shape.endBinding, { x: abs[2], y: abs[3] });
    const endAdj = oppositeAim(shape.startBinding, { x: abs[last - 2], y: abs[last - 1] });

    if (solveStart) {
      const p = resolveBinding(shape.startBinding!, elements[shape.startBinding!.elementId], effectiveBindingMode(shape.startBinding!) === 'aim' ? startAdj : { x: abs[2], y: abs[3] });
      abs[0] = p.x;
      abs[1] = p.y;
    }
    if (solveEnd) {
      const p = resolveBinding(shape.endBinding!, elements[shape.endBinding!.elementId], effectiveBindingMode(shape.endBinding!) === 'aim' ? endAdj : rawEndAdj);
      abs[last] = p.x;
      abs[last + 1] = p.y;
    }

    // Overlapping two-target outlines can reverse endpoint order. As upstream,
    // use focus points for the exceptional collapsed span, never stale geometry.
    if (straightPair && shape.startBinding?.mode === 'aim' && shape.endBinding?.mode === 'aim') {
      const dx = startAdj.x - endAdj.x, dy = startAdj.y - endAdj.y;
      if ((abs[2] - abs[0]) * dx + (abs[3] - abs[1]) * dy <= EPS) {
        abs[0] = endAdj.x; abs[1] = endAdj.y; abs[2] = startAdj.x; abs[3] = startAdj.y;
      }
    }

    // Curve-aware bounds: bezier tangent bulges count toward the box
    // (identical to pathBounds for every other curve mode).
    const local: number[] = [];
    for (let i = 0; i < abs.length; i += 2) {
      const p = slidePointToPath(shape, abs[i], abs[i + 1]);
      local.push(p.x, p.y);
    }
    const b = pathGeometryUpdate(shape, local, shape.tangents);
    results.push({
      elementId: elId,
      changes: { x: b.x!, y: b.y!, width: b.width!, height: b.height!, points: b.points! },
    });
  }
  return results;
}

/** Keep explicit angle constraints on their original forward ray. Nearby targets
 * may be acquired without intersecting that ray; focus clamping must not bend it. */
export function pointOnBindingRay(point: Pt, adjacent: Pt, resolved: Pt): boolean {
  const dx = point.x - adjacent.x, dy = point.y - adjacent.y;
  const rx = resolved.x - adjacent.x, ry = resolved.y - adjacent.y;
  const length = Math.hypot(dx, dy);
  return length > EPS && Math.abs(dx * ry - dy * rx) / length < 1e-7 && dx * rx + dy * ry >= 0;
}

/** One acquisition/solution/constraint decision shared by preview and commit. */
export function bindingDrop(point: Pt, adjacent: Pt, elements: SlideElement[], excludeId: string, zoom?: number, preserveRay = false, allowDock = true) {
  const target = getBindingTarget2(point, elements, excludeId, zoom);
  if (!target) return null;
  const dock = allowDock ? connectorDockCue(point, target, zoom, preserveRay, adjacent) : null;
  const binding = dock?.active ? dock.binding : bindingForDrop(point, target);
  const resolved = resolveBinding(binding, target, adjacent);
  if (preserveRay && !pointOnBindingRay(point, adjacent, resolved)) return null;
  return { target, binding, point: resolved, dock };
}

/**
 * Bind-while-drawing commit helper (pure, DOM-free): given a freshly drawn
 * path's vertices in ABSOLUTE slide coords, find binding targets for the
 * first and last vertex (getBindingTarget2 semantics: inside or near the
 * silhouette, topmost wins), store normalized aims, and snap each bound
 * vertex to its binding's visible silhouette position. Outside proximity
 * acquisition aims at the center; interior drops retain their relative aim.
 *
 * The caller decides whether to call at all (Meta/Cmd held ⇒ binding
 * suppressed). `preserveRay` (Shift) rejects attachment solutions that bend
 * either terminal's raw ray. The caller re-derives x/y/width/height from the
 * returned vertices via `pathBounds`.
 */
export function bindDraftEndpoints(
  absPoints: number[],
  elements: SlideElement[],
  zoom?: number,
  preserveRay = false,
  retainedStart?: ConnectorBinding | null,
): { absPoints: number[]; startBinding: ConnectorBinding | null; endBinding: ConnectorBinding | null } {
  const out = absPoints.slice();
  let startBinding: ConnectorBinding | null = null;
  let endBinding: ConnectorBinding | null = null;
  if (out.length >= 4) {
    const last = out.length - 2;
    const bindEnd = (idx: number, adjIdx: number): ConnectorBinding | null => {
      const pt: Pt = { x: out[idx], y: out[idx + 1] };
      const adj: Pt = { x: absPoints[adjIdx], y: absPoints[adjIdx + 1] };
      const drop = bindingDrop(pt, adj, elements, '', zoom, preserveRay);
      if (!drop) return null;
      out[idx] = drop.point.x;
      out[idx + 1] = drop.point.y;
      return drop.binding;
    };
    const retainedTarget = retainedStart && elements.find(el => el.id === retainedStart.elementId && supportsConnectorDocks(el));
    if (retainedStart && retainedTarget) {
      startBinding = retainedStart;
      const start = resolveBinding(retainedStart, retainedTarget, { x: out[2], y: out[3] });
      out[0] = start.x; out[1] = start.y;
    } else startBinding = retainedStart === undefined ? bindEnd(0, 2) : null;
    endBinding = bindEnd(last, last - 2);
  }
  if (out.length === 4 && startBinding && endBinding) {
    const a = elements.find(el => el.id === startBinding!.elementId)!;
    const b = elements.find(el => el.id === endBinding!.elementId)!;
    const af = bindingAimPoint(startBinding, a), bf = bindingAimPoint(endBinding, b);
    let ap = resolveBinding(startBinding, a, bf), bp = resolveBinding(endBinding, b, af);
    if ((bp.x - ap.x) * (bf.x - af.x) + (bp.y - ap.y) * (bf.y - af.y) <= EPS) { ap = af; bp = bf; }
    if (!preserveRay || (pointOnBindingRay({ x: absPoints[0], y: absPoints[1] }, { x: absPoints[2], y: absPoints[3] }, ap) && pointOnBindingRay({ x: absPoints[2], y: absPoints[3] }, { x: absPoints[0], y: absPoints[1] }, bp))) {
      out.splice(0, 4, ap.x, ap.y, bp.x, bp.y);
    } else {
      // A latched start is the origin of the explicit Shift ray, not a new
      // acquisition. Reject only an incompatible end; never erase that pin.
      return { absPoints: absPoints.slice(), startBinding: retainedStart ? startBinding : null, endBinding: null };
    }
  }
  return { absPoints: out, startBinding, endBinding };
}

export interface BindingAimGuide { endpoint: Pt; focus: Pt }
export function bindingAimGuides(abs: number[], start: ConnectorBinding | null | undefined, end: ConnectorBinding | null | undefined, elements: SlideElement[]): BindingAimGuide[] {
  return ([start, end] as const).flatMap((binding, i) => {
    const target = elements.find(el => el.id === binding?.elementId);
    if (binding?.mode !== 'aim' || !target || abs.length < 4) return [];
    const idx = i === 0 ? 0 : abs.length - 2;
    return [{ endpoint: { x: abs[idx], y: abs[idx + 1] }, focus: bindingAimPoint(binding, target) }];
  });
}
