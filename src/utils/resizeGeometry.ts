import type { ShapeElement, SlideElement } from '../types/presentation';
import { getBoundingBox, type BoundingBox, type Point } from './geometry';
import { pathPointsInSlide } from './pathEditing';
import { pathBoundsFor } from './pathShapes';

export type ResizeUpdate<T extends SlideElement = SlideElement> = { elementId: string; changes: Partial<T> };
export const rotateDelta = (p: Point, degrees: number): Point => {
  const r = degrees * Math.PI / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

/** Actual local path bounds, expressed about the renderer's stored-box pivot. */
export function resizeElementBounds(el: SlideElement): BoundingBox {
  if (el.type !== 'shape' || el.shapeType !== 'path' || !el.points?.length) return { x: el.x, y: el.y, width: el.width, height: el.height };
  const b = pathBoundsFor(el.points, el.curve ?? 'linear', !!el.closed, el.tangents);
  const offset = rotateDelta({ x: b.x + b.width / 2 - el.width / 2, y: b.y + b.height / 2 - el.height / 2 }, el.rotation);
  return { x: el.x + el.width / 2 + offset.x - b.width / 2, y: el.y + el.height / 2 + offset.y - b.height / 2, width: b.width, height: b.height };
}

export function selectionResizeBounds(elements: SlideElement[]): BoundingBox {
  if (elements.length === 1) return resizeElementBounds(elements[0]);
  return getBoundingBox(elements.map(el => {
    const b = resizeElementBounds(el), r = el.rotation * Math.PI / 180;
    const width = Math.abs(b.width * Math.cos(r)) + Math.abs(b.height * Math.sin(r));
    const height = Math.abs(b.width * Math.sin(r)) + Math.abs(b.height * Math.cos(r));
    return { x: b.x + (b.width - width) / 2, y: b.y + (b.height - height) / 2, width, height };
  }));
}

/** Delta is in local axes. Edge aspect-resizes expand the perpendicular axis
 * symmetrically. Crossing the fixed anchor clamps, rather than reflecting. */
export function resizeBounds(start: BoundingBox, anchor: string, delta: Point, aspect: boolean, centered: boolean, rotation = 0): BoundingBox {
  const hx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0;
  const hy = anchor.includes('top') ? -1 : anchor.includes('bottom') ? 1 : 0;
  const multiplier = centered ? 2 : 1;
  let width = start.width + hx * delta.x * multiplier;
  let height = start.height + hy * delta.y * multiplier;
  const minW = Math.min(10, start.width), minH = Math.min(10, start.height);
  if (aspect && start.width > 0 && start.height > 0) {
    const wx = width / start.width, hyScale = height / start.height;
    let scale = !hx ? hyScale : !hy ? wx : Math.abs(wx - 1) >= Math.abs(hyScale - 1) ? wx : hyScale;
    scale = Math.max(scale, minW / start.width, minH / start.height);
    width = start.width * scale; height = start.height * scale;
  } else {
    width = Math.max(minW, width); height = Math.max(minH, height);
  }
  const shift = centered ? { x: 0, y: 0 } : rotateDelta({ x: hx * (width - start.width) / 2, y: hy * (height - start.height) / 2 }, rotation);
  return { x: start.x + (start.width - width) / 2 + shift.x, y: start.y + (start.height - height) / 2 + shift.y, width, height };
}

/** Uniform group scaling is exact. Nonuniform scaling preserves rotation;
 * with no skew field, local axis lengths use scaled-axis norms. */
export function resizeSelection<T extends SlideElement>(elements: T[], start: BoundingBox, next: BoundingBox): ResizeUpdate<T>[];
export function resizeSelection(elements: SlideElement[], start: BoundingBox, next: BoundingBox): ResizeUpdate[] {
  const sx = start.width ? next.width / start.width : 1, sy = start.height ? next.height / start.height : 1;
  const moving = new Set(elements.map(el => el.id));
  return elements.map(el => {
    const old = resizeElementBounds(el);
    const r = el.rotation * Math.PI / 180;
    const fx = elements.length === 1 ? sx : Math.hypot(sx * Math.cos(r), sy * Math.sin(r));
    const fy = elements.length === 1 ? sy : Math.hypot(sx * Math.sin(r), sy * Math.cos(r));
    const width = old.width * fx, height = old.height * fy;
    const cx = elements.length === 1 ? next.x + next.width / 2 : next.x + (old.x + old.width / 2 - start.x) * sx;
    const cy = elements.length === 1 ? next.y + next.height / 2 : next.y + (old.y + old.height / 2 - start.y) * sy;
    const changes: Partial<ShapeElement> = { x: cx - width / 2, y: cy - height / 2, width, height };
    if (el.type === 'shape' && el.shapeType === 'path') {
      const b = pathBoundsFor(el.points ?? [0, 0, el.width, el.height], el.curve ?? 'linear', !!el.closed, el.tangents);
      changes.points = (el.points ?? [0, 0, el.width, el.height]).map((v, i) => (v - (i % 2 ? b.y : b.x)) * (i % 2 ? fy : fx));
      if (el.tangents) changes.tangents = el.tangents.map((v, i) => v * (i % 2 ? fy : fx));
      const before = pathPointsInSlide(el), after = pathPointsInSlide({ ...el, ...changes });
      for (const [key, index] of [['startBinding', 0], ['endBinding', before.length - 2]] as const) {
        const binding = el[key];
        if (!binding) continue;
        if (!moving.has(binding.elementId)) {
          if (Math.hypot(before[index] - after[index], before[index + 1] - after[index + 1]) > 1e-9) changes[key] = null;
        } else if (Math.abs(fx - fy) < 1e-9 && binding.gap !== undefined) {
          changes[key] = { ...binding, gap: binding.gap * fx };
        }
      }
    }
    if (elements.length > 1 && el.type === 'text' && !el.containerId && Math.abs(sx - sy) < 1e-9) {
      return { elementId: el.id, changes: { ...changes, style: { ...el.style, fontSize: Math.max(1, el.style.fontSize * sx) } } };
    }
    return { elementId: el.id, changes };
  });
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
/** Verify the complete local-box mapping; style, topology and rotation edits
 * must never acquire a geometry-solver exemption. */
export function verifiedBoxResize(before: SlideElement, after: SlideElement): boolean {
  if (before.type !== after.type || before.rotation !== after.rotation) return false;
  const old = resizeElementBounds(before), next = resizeElementBounds(after);
  if (old.width <= 0 || old.height <= 0 || next.width <= 0 || next.height <= 0) return false;
  const expected = resizeSelection([before], old, next)[0].changes as Partial<ShapeElement>;
  if ((['x', 'y', 'width', 'height'] as const).some(key => !near(expected[key]!, after[key]))) return false;
  const ignored = new Set(['x','y','width','height','points','tangents','startBinding','endBinding']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  if ([...keys].some(k => !ignored.has(k) && JSON.stringify(before[k as keyof SlideElement]) !== JSON.stringify(after[k as keyof SlideElement]))) return false;
  if (before.type === 'shape' && after.type === 'shape' && before.shapeType === 'path') {
    if (expected.points?.length !== after.points?.length || expected.tangents?.length !== after.tangents?.length) return false;
    if (expected.points?.some((v,i) => !near(v, after.points![i]))) return false;
    if (expected.tangents?.some((v,i) => !near(v, after.tangents![i]))) return false;
  }
  return true;
}
export function verifiedUniformResize(before: SlideElement, after: SlideElement): { scale: number; x: number; y: number } | undefined {
  if (!verifiedBoxResize(before, after)) return;
  const a = resizeElementBounds(before), b = resizeElementBounds(after);
  const scale = b.width / a.width;
  if (!near(scale, b.height / a.height)) return;
  return { scale, x: b.x + b.width / 2 - scale * (a.x + a.width / 2), y: b.y + b.height / 2 - scale * (a.y + a.height / 2) };
}
/** Endpoint-local verification for co-resizes and stationary external anchors. */
export function resizeKeepsBinding(before: ShapeElement, after: ShapeElement, oldTarget: SlideElement, target: SlideElement, end: 'startBinding' | 'endBinding'): boolean {
  const binding = after[end], oldBinding = before[end];
  if (!binding || !oldBinding || !verifiedBoxResize(before, after)) return false;
  if (JSON.stringify(oldTarget) === JSON.stringify(target) && JSON.stringify(binding) === JSON.stringify(oldBinding)) {
    const a = pathPointsInSlide(before), b = pathPointsInSlide(after), i = end === 'startBinding' ? 0 : a.length - 2;
    const adjacent = end === 'startBinding' ? 2 : a.length - 4;
    // A stationary visible aim endpoint is not enough: its incoming ray can
    // change during nonuniform resize while the target is left unselected.
    return near(a[i], b[i]) && near(a[i+1], b[i+1]) &&
      (binding.mode !== 'aim' || (near(a[adjacent], b[adjacent]) && near(a[adjacent+1], b[adjacent+1])));
  }
  const a = verifiedUniformResize(before, after), b = verifiedUniformResize(oldTarget, target);
  if (!a || !b || !near(a.scale, b.scale) || !near(a.x, b.x) || !near(a.y, b.y)) return false;
  return JSON.stringify(binding) === JSON.stringify({ ...oldBinding, ...(oldBinding.gap !== undefined ? { gap: oldBinding.gap * a.scale } : {}) });
}
