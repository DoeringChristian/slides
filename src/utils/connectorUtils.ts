import type {
  SlideElement,
  ShapeElement,
  ConnectorBinding,
  BindingMode,
  BindingAnchor,
} from '../types/presentation';
import { pathBoundsFor } from './pathShapes';

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

/** Legacy 5-anchor → [u,v] fixed-point mapping (binding v2 migration). */
export const ANCHOR_TO_UV: Record<BindingAnchor, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0],
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
};

/** Effective mode of a binding: explicit `mode` wins; a legacy `anchor`
 *  implies 'pinned' (it maps to a fixedPoint); otherwise 'edge'. */
export function effectiveBindingMode(binding: ConnectorBinding): BindingMode {
  return binding.mode ?? (binding.anchor !== undefined ? 'pinned' : 'edge');
}

export function isPinnedBinding(binding: ConnectorBinding): boolean {
  return effectiveBindingMode(binding) === 'pinned';
}

/** Legacy helper (still used for the 5-anchor mapping in tests / migration
 *  equivalence checks): absolute position of a named anchor on an element,
 *  honoring rotation. */
export function getAnchorPoint(
  element: SlideElement,
  anchor: string
): Pt | null {
  if (!element) return null;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const rotation = element.rotation || 0;
  const origin = getRotationOrigin(element);

  // Get anchor point in local (unrotated) coordinates
  let localPoint: Pt;
  switch (anchor) {
    case 'center': localPoint = { x: cx, y: cy }; break;
    case 'top': localPoint = { x: cx, y: element.y }; break;
    case 'bottom': localPoint = { x: cx, y: element.y + element.height }; break;
    case 'left': localPoint = { x: element.x, y: cy }; break;
    case 'right': localPoint = { x: element.x + element.width, y: cy }; break;
    default: localPoint = { x: cx, y: cy };
  }

  // Rotate the anchor point around the element's rotation origin
  return rotatePoint(localPoint.x, localPoint.y, origin.x, origin.y, rotation);
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

/** Distance from the target's center to its silhouette along `dir`
 *  (unnormalized ok). Falls back to half the smaller bbox dimension for
 *  degenerate shapes. Local-frame helper for the focus parameterization. */
function perpExtent(target: SlideElement, c: Pt, dir: Pt): number {
  const hit = silhouetteIntersect(target, c, { x: c.x + dir.x, y: c.y + dir.y });
  if (hit) return Math.hypot(hit.x - c.x, hit.y - c.y);
  return Math.max(EPS, Math.min(target.width, target.height) / 2);
}

// =============================================================================
// Binding resolution (binding → point) and inverse (point → binding)
// =============================================================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pinnedUV(binding: ConnectorBinding): [number, number] {
  if (binding.fixedPoint) return binding.fixedPoint;
  if (binding.anchor && ANCHOR_TO_UV[binding.anchor]) return ANCHOR_TO_UV[binding.anchor];
  return [0.5, 0.5];
}

/**
 * Absolute endpoint position a binding resolves to.
 *
 *  pinned — fixedPoint [u,v] mapped into the target's bbox, rotated with it.
 *           (Legacy `anchor` bindings resolve through the same path via the
 *           ANCHOR_TO_UV mapping, so unmigrated in-memory decks still work.)
 *  edge   — Excalidraw-style: a focus point is placed on the chord through
 *           the target's center perpendicular to the (otherEndAbs → center)
 *           axis (focus 0 = center, ±1 = the silhouette-grazing ends of the
 *           chord); the endpoint is the silhouette intersection of the ray
 *           otherEndAbs → focusPoint, pulled back toward otherEndAbs by
 *           `gap`.
 *
 * `otherEndAbs` is the vertex ADJACENT to the bound endpoint (for a 2-point
 * line, the opposite endpoint) — same semantics as Excalidraw's
 * adjacentPoint.
 */
export function resolveBinding(
  binding: ConnectorBinding,
  target: SlideElement,
  otherEndAbs: Pt,
): Pt {
  const c = getRotationOrigin(target);

  if (effectiveBindingMode(binding) === 'pinned') {
    const [u, v] = pinnedUV(binding);
    const lx = target.x + u * target.width;
    const ly = target.y + v * target.height;
    return rotatePoint(lx, ly, c.x, c.y, target.rotation || 0);
  }

  const focus = clamp(binding.focus ?? 0, -1, 1);
  const gap = Math.max(0, binding.gap ?? 0);

  const axisX = c.x - otherEndAbs.x;
  const axisY = c.y - otherEndAbs.y;
  const axisLen = Math.hypot(axisX, axisY);
  if (axisLen < EPS) return c; // degenerate: other end sits on the center

  // Focus point on the perpendicular chord through the center.
  let focusPoint = c;
  if (focus !== 0) {
    const perp = { x: -axisY / axisLen, y: axisX / axisLen };
    const dir = focus >= 0 ? perp : { x: -perp.x, y: -perp.y };
    const extent = perpExtent(target, c, dir);
    focusPoint = {
      x: c.x + dir.x * Math.abs(focus) * extent,
      y: c.y + dir.y * Math.abs(focus) * extent,
    };
  }

  const hit = silhouetteIntersect(target, otherEndAbs, focusPoint);
  if (!hit) return focusPoint;
  const rayX = focusPoint.x - otherEndAbs.x;
  const rayY = focusPoint.y - otherEndAbs.y;
  const rayLen = Math.hypot(rayX, rayY);
  if (rayLen < EPS) return hit;
  const ux = rayX / rayLen;
  const uy = rayY / rayLen;
  const hitDist = (hit.x - otherEndAbs.x) * ux + (hit.y - otherEndAbs.y) * uy;
  const d = Math.max(0, hitDist - gap);
  return { x: otherEndAbs.x + ux * d, y: otherEndAbs.y + uy * d };
}

/**
 * Inverse of `resolveBinding`: derive the binding that makes the endpoint
 * `point` (absolute) resolve back to (approximately) itself.
 *
 *  edge   — ports Excalidraw's calculateFocusAndGap: focus = signed ratio of
 *           the chord offset where the line otherEndAbs → point crosses the
 *           perpendicular axis through the center; gap = how far short of
 *           the silhouette the point sits along that line (0 when the point
 *           is on/inside the silhouette — resolving then pulls it onto the
 *           outline).
 *  pinned — fixedPoint = the point's [u,v] in the target's unrotated bbox,
 *           clamped to [0,1]².
 *
 * ROUND-TRIP INVARIANT: for a point outside the silhouette on a line that
 * crosses it, resolveBinding(bindingFor(p, …), …) ≈ p.
 */
export function bindingFor(
  point: Pt,
  target: SlideElement,
  otherEndAbs: Pt,
  mode: BindingMode,
): ConnectorBinding {
  const c = getRotationOrigin(target);

  if (mode === 'pinned') {
    const local = rotatePoint(point.x, point.y, c.x, c.y, -(target.rotation || 0));
    const u = target.width > EPS ? clamp((local.x - target.x) / target.width, 0, 1) : 0.5;
    const v = target.height > EPS ? clamp((local.y - target.y) / target.height, 0, 1) : 0.5;
    return { elementId: target.id, mode: 'pinned', fixedPoint: [u, v] };
  }

  const axisX = c.x - otherEndAbs.x;
  const axisY = c.y - otherEndAbs.y;
  const axisLen = Math.hypot(axisX, axisY);

  let focus = 0;
  if (axisLen >= EPS) {
    const perp = { x: -axisY / axisLen, y: axisX / axisLen };
    // Solve otherEnd + t·(point−otherEnd) = c + s·perp for the signed chord
    // offset s (Cramer's rule). Degenerate (line ∥ perp axis) → focus 0.
    const dX = point.x - otherEndAbs.x;
    const dY = point.y - otherEndAbs.y;
    const eX = c.x - otherEndAbs.x;
    const eY = c.y - otherEndAbs.y;
    const det = -dX * perp.y + perp.x * dY;
    if (Math.abs(det) > EPS) {
      const s = (dX * eY - dY * eX) / det;
      const dir = s >= 0 ? perp : { x: -perp.x, y: -perp.y };
      const extent = perpExtent(target, c, dir);
      focus = clamp(s / extent, -1, 1);
    }
  }

  let gap = 0;
  const hit = silhouetteIntersect(target, otherEndAbs, point);
  if (hit) {
    const distPoint = Math.hypot(point.x - otherEndAbs.x, point.y - otherEndAbs.y);
    const distHit = Math.hypot(hit.x - otherEndAbs.x, hit.y - otherEndAbs.y);
    gap = Math.max(0, distHit - distPoint);
  }

  return { elementId: target.id, mode: 'edge', focus, gap };
}

// =============================================================================
// Target picking
// =============================================================================

/** Excalidraw-style bind threshold: scales with the target (small shapes get
 *  the 16-unit floor, large ones cap at 32) and grows when zoomed out so
 *  binding stays reachable on screen. */
function bindThreshold(el: SlideElement, zoom?: number): number {
  const base = Math.max(16, Math.min(0.5 * Math.min(el.width, el.height), 32));
  return zoom !== undefined && zoom < 1 ? base / zoom : base;
}

/**
 * Binding-target lookup, v2 (Excalidraw semantics): an element binds when
 * `point` is INSIDE its silhouette or within a size-scaled threshold of it
 * (max(16, min(0.5·minDim, 32)) slide units, divided by zoom when < 1).
 *
 * `elements` must be in z-order (bottom → top, i.e. `elementOrder` order —
 * exactly what the canvas / drawing call sites pass); the TOPMOST matching
 * element wins. Invisible / locked elements and path shapes are never
 * targets (unchanged policy).
 *
 * Distance is measured radially from the element's center (the silhouette
 * crossing of the center→point ray) — a simplification vs Excalidraw's
 * per-shape exact distance functions; see the module tests.
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
    if (el.type === 'shape' && (el as ShapeElement).shapeType === 'path') continue;
    const c = getRotationOrigin(el);
    const dPoint = Math.hypot(point.x - c.x, point.y - c.y);
    if (dPoint < EPS) return el; // exactly on the center
    const hit = silhouetteIntersect(el, c, point);
    const dBoundary = hit ? Math.hypot(hit.x - c.x, hit.y - c.y) : 0;
    if (dPoint <= dBoundary + bindThreshold(el, zoom)) return el;
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
 * mutation. Two triggers per bound end:
 *   - the binding's TARGET is in `movedIds` (any mode), or
 *   - the path ITSELF is in `movedIds` and the binding is edge-mode — the
 *     edge solution depends on the ray direction, so the path's own geometry
 *     change (vertex edit) re-solves its ends. Pinned / legacy-anchor ends
 *     of a moved path are left alone (a dragged connector keeps its points;
 *     whole-arrow drags clear bindings at the call site).
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
): RebindResult[] {
  const results: RebindResult[] = [];
  if (movedIds.size === 0) return results;

  for (const elId of elementOrder) {
    const el = elements[elId];
    if (!el || el.type !== 'shape') continue;
    const shape = el as ShapeElement;
    if (shape.shapeType !== 'path') continue;
    const pts = shape.points;
    if (!pts || pts.length < 4) continue;

    const selfMoved = movedIds.has(elId);
    const needsSolve = (binding: ConnectorBinding | null | undefined): binding is ConnectorBinding => {
      if (!binding || !elements[binding.elementId]) return false;
      if (selfMoved) return effectiveBindingMode(binding) === 'edge';
      return movedIds.has(binding.elementId);
    };
    const solveStart = needsSolve(shape.startBinding);
    const solveEnd = needsSolve(shape.endBinding);
    if (!solveStart && !solveEnd) continue;

    // Working set: every vertex in absolute slide coords. Only the bound
    // first / last vertices get overwritten — interior vertices keep their
    // absolute positions, so a curved path holds its shape.
    const abs = pts.map((v, i) => v + (i % 2 === 0 ? shape.x : shape.y));
    const last = abs.length - 2;
    // Adjacent vertices from the PRE-pass snapshot (both ends solved against
    // the same snapshot, mirroring Excalidraw's updateBoundPoint).
    const startAdj: Pt = { x: abs[2], y: abs[3] };
    const endAdj: Pt = { x: abs[last - 2], y: abs[last - 1] };

    if (solveStart) {
      const p = resolveBinding(shape.startBinding!, elements[shape.startBinding!.elementId], startAdj);
      abs[0] = p.x;
      abs[1] = p.y;
    }
    if (solveEnd) {
      const p = resolveBinding(shape.endBinding!, elements[shape.endBinding!.elementId], endAdj);
      abs[last] = p.x;
      abs[last + 1] = p.y;
    }

    // Curve-aware bounds: bezier tangent bulges count toward the box
    // (identical to pathBounds for every other curve mode).
    const b = pathBoundsFor(abs, shape.curve ?? 'linear', shape.closed ?? false, shape.tangents);
    results.push({
      elementId: elId,
      changes: { x: b.x, y: b.y, width: b.width, height: b.height, points: b.points },
    });
  }
  return results;
}

/**
 * Bind-while-drawing commit helper (pure, DOM-free): given a freshly drawn
 * path's vertices in ABSOLUTE slide coords, find binding targets for the
 * first and last vertex (getBindingTarget2 semantics: inside or near the
 * silhouette, topmost wins), derive edge-mode bindings, and snap each bound
 * vertex to its binding's resolved position (identity for points outside
 * the silhouette; points inside get pulled onto the outline).
 *
 * The caller decides whether to call at all (Meta/Cmd held ⇒ binding
 * suppressed) and re-derives x/y/width/height from the returned vertices
 * via `pathBounds`.
 */
export function bindDraftEndpoints(
  absPoints: number[],
  elements: SlideElement[],
  zoom?: number,
): { absPoints: number[]; startBinding: ConnectorBinding | null; endBinding: ConnectorBinding | null } {
  const out = absPoints.slice();
  let startBinding: ConnectorBinding | null = null;
  let endBinding: ConnectorBinding | null = null;
  if (out.length >= 4) {
    const last = out.length - 2;
    const bindEnd = (idx: number, adjIdx: number): ConnectorBinding | null => {
      const pt: Pt = { x: out[idx], y: out[idx + 1] };
      const target = getBindingTarget2(pt, elements, '', zoom);
      if (!target) return null;
      const adj: Pt = { x: absPoints[adjIdx], y: absPoints[adjIdx + 1] };
      const binding = bindingFor(pt, target, adj, 'edge');
      const snapped = resolveBinding(binding, target, adj);
      out[idx] = snapped.x;
      out[idx + 1] = snapped.y;
      return binding;
    };
    startBinding = bindEnd(0, 2);
    endBinding = bindEnd(last, last - 2);
  }
  return { absPoints: out, startBinding, endBinding };
}
