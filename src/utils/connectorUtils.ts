import type { SlideElement, ShapeElement, ConnectorBinding } from '../types/presentation';
import { pathBounds } from './pathShapes';

// Rotate a point around a center by an angle (in degrees)
function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angleDeg: number
): { x: number; y: number } {
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
function getRotationOrigin(el: SlideElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

export function getBindingTarget(
  point: { x: number; y: number },
  elements: SlideElement[],
  excludeId: string,
  threshold: number = 30
): ConnectorBinding | null {
  let bestDist = threshold;
  let bestBinding: ConnectorBinding | null = null;

  for (const el of elements) {
    if (el.id === excludeId) continue;
    // Invisible elements would make "ghost" bind targets the user can't see;
    // locked elements are excluded from every other interaction, so they
    // shouldn't silently capture connector endpoints either.
    if (el.visible === false || el.locked) continue;
    // Path shapes (lines, arrows, curves) can't be a binding target themselves.
    if (el.type === 'shape' && el.shapeType === 'path') continue;

    const anchors: ConnectorBinding['anchor'][] = ['center', 'top', 'bottom', 'left', 'right'];
    for (const anchor of anchors) {
      const pt = getAnchorPoint(el, anchor);
      if (!pt) continue;
      const dist = Math.hypot(point.x - pt.x, point.y - pt.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestBinding = { elementId: el.id, anchor };
      }
    }
  }

  return bestBinding;
}

export function getAnchorPoint(
  element: SlideElement,
  anchor: string
): { x: number; y: number } | null {
  if (!element) return null;

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const rotation = element.rotation || 0;
  const origin = getRotationOrigin(element);

  // Get anchor point in local (unrotated) coordinates
  let localPoint: { x: number; y: number };
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

export function resolveBindingPoint(
  binding: ConnectorBinding,
  elements: Record<string, SlideElement>
): { x: number; y: number } | null {
  const target = elements[binding.elementId];
  if (!target) return null;
  return getAnchorPoint(target, binding.anchor);
}

/**
 * Recompute a path shape's (x, y, width, height, points) so that its first
 * and/or last vertex tracks the connector anchor of `anchorElementId`.
 *
 * Works for ANY vertex count — old code assumed `pts[0..3]` (a 2-vertex
 * line), which on a curve with N > 2 was silently truncating the vertex
 * list down to 2 every time the bound-to element moved. Returns null when
 * the shape isn't a bound path or no rebind is needed.
 */
export function rebindPathToMovedAnchor(
  shape: ShapeElement,
  anchorElementId: string,
  elements: Record<string, SlideElement>,
): { x: number; y: number; width: number; height: number; points: number[] } | null {
  if (shape.shapeType !== 'path') return null;
  const pts = shape.points;
  if (!pts || pts.length < 4) return null;

  // Working set: every vertex in absolute slide coords. Only the first /
  // last get overwritten if a binding moved — interior vertices keep
  // their absolute positions, so a curved path holds its shape.
  const abs = pts.slice();
  for (let i = 0; i < abs.length; i += 2) {
    abs[i] += shape.x;
    abs[i + 1] += shape.y;
  }

  let changed = false;
  if (shape.startBinding?.elementId === anchorElementId) {
    const pt = resolveBindingPoint(shape.startBinding, elements);
    if (pt) { abs[0] = pt.x; abs[1] = pt.y; changed = true; }
  }
  if (shape.endBinding?.elementId === anchorElementId) {
    const pt = resolveBindingPoint(shape.endBinding, elements);
    if (pt) {
      const lastX = abs.length - 2;
      abs[lastX] = pt.x;
      abs[lastX + 1] = pt.y;
      changed = true;
    }
  }
  if (!changed) return null;

  const b = pathBounds(abs);
  return { x: b.x, y: b.y, width: b.width, height: b.height, points: b.points };
}

/** Geometry patch produced by the shared rebind pass. */
export interface RebindResult {
  elementId: string;
  changes: { x: number; y: number; width: number; height: number; points: number[] };
}

/**
 * THE rebind pass: after some elements moved / resized / rotated, recompute
 * every bound path on the slide so its endpoints keep tracking their anchors.
 *
 * `elements` must be the POST-move slide snapshot (anchor geometry already
 * updated); `movedIds` is the set of elements whose geometry changed this
 * mutation. Moved elements themselves are skipped — a dragged connector keeps
 * its own points; only connectors bound TO a moved element are recomputed.
 *
 * One shared implementation for all four store call sites (updateElement /
 * updateElements × Y / JSON) — the two paths MUST stay semantically
 * equivalent, so neither is allowed to inline its own variant of this loop.
 *
 * Tolerates stale `elementOrder` ids (missing element ⇒ skipped) and
 * non-shape elements.
 */
export function rebindAfterElementsMoved(
  elements: Record<string, SlideElement>,
  elementOrder: readonly string[],
  movedIds: ReadonlySet<string>,
): RebindResult[] {
  const results: RebindResult[] = [];
  if (movedIds.size === 0) return results;

  for (const elId of elementOrder) {
    if (movedIds.has(elId)) continue;
    const el = elements[elId];
    if (!el || el.type !== 'shape') continue;

    // Apply anchors successively so a path bound to TWO moved elements
    // (start → A, end → B) tracks both in one pass.
    let shape = el as ShapeElement;
    let changed = false;
    for (const movedId of movedIds) {
      const rebound = rebindPathToMovedAnchor(shape, movedId, elements);
      if (rebound) {
        shape = { ...shape, ...rebound };
        changed = true;
      }
    }
    if (changed && shape.points) {
      results.push({
        elementId: elId,
        changes: {
          x: shape.x, y: shape.y,
          width: shape.width, height: shape.height,
          points: shape.points,
        },
      });
    }
  }
  return results;
}

/**
 * Bind-while-drawing commit helper (pure, DOM-free): given a freshly drawn
 * path's vertices in ABSOLUTE slide coords, find binding targets for the
 * first and last vertex, snap those vertices onto the matched anchor points,
 * and return the adjusted vertices plus the bindings to store.
 *
 * The caller decides whether to call at all (Meta/Cmd held ⇒ binding
 * suppressed) and re-derives x/y/width/height from the returned vertices
 * via `pathBounds`.
 */
export function bindDraftEndpoints(
  absPoints: number[],
  elements: SlideElement[],
  threshold?: number,
): { absPoints: number[]; startBinding: ConnectorBinding | null; endBinding: ConnectorBinding | null } {
  const out = absPoints.slice();
  let startBinding: ConnectorBinding | null = null;
  let endBinding: ConnectorBinding | null = null;
  if (out.length >= 4) {
    const last = out.length - 2;
    startBinding = getBindingTarget({ x: out[0], y: out[1] }, elements, '', threshold);
    if (startBinding) {
      const pt = getAnchorPoint(elements.find((el) => el.id === startBinding!.elementId)!, startBinding.anchor);
      if (pt) { out[0] = pt.x; out[1] = pt.y; }
    }
    endBinding = getBindingTarget({ x: out[last], y: out[last + 1] }, elements, '', threshold);
    if (endBinding) {
      const pt = getAnchorPoint(elements.find((el) => el.id === endBinding!.elementId)!, endBinding.anchor);
      if (pt) { out[last] = pt.x; out[last + 1] = pt.y; }
    }
  }
  return { absPoints: out, startBinding, endBinding };
}
