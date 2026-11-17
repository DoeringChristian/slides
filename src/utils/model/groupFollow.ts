import type { SlideElement } from '../../types/presentation';
import { groupCropBoundary } from './groupCrop';

type Box = { x: number; y: number; width: number; height: number };
const boxOf = (els: SlideElement[]): Box => {
  const x0 = Math.min(...els.map(e => e.x)), y0 = Math.min(...els.map(e => e.y));
  const x1 = Math.max(...els.map(e => e.x + e.width)), y1 = Math.max(...els.map(e => e.y + e.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

/**
 * During a transition, an element appearing (only on the keyframe being
 * moved to) or disappearing (only on the one being left) moves with its
 * group: its place relative to the group's members that are on both
 * keyframes — taken on the keyframe where it exists — is applied to where
 * those members are now. So a part added to a moving group (the second
 * half of a split video) comes in with it instead of appearing at its final
 * place while the rest of the group is still on its way.
 *
 * The group is the element's innermost object group that has such members;
 * their bounding box gives position and scale. Crop shapes are left to
 * followCropMedia (run after this), which keeps them on their image —
 * including an image that this moved.
 */
export function followGroups(frame: SlideElement[], slideA: { elements: Record<string, SlideElement> },
  slideB: { elements: Record<string, SlideElement> }): SlideElement[] {
  const byId = new Map(frame.map(el => [el.id, el]));
  const onBoth = (id: string) => !!slideA.elements[id]?.visible && !!slideB.elements[id]?.visible && byId.has(id);
  let changed = false;
  const out = frame.map(el => {
    const a = slideA.elements[el.id], b = slideB.elements[el.id];
    const onA = !!a?.visible, onB = !!b?.visible;
    if (onA === onB) return el;
    const own = (onB ? b : a)!;
    if (groupCropBoundary(own)) return el;
    const side = onB ? slideB : slideA;
    const path = own.objectGroupIds ?? [];
    for (let i = path.length - 1; i >= 0; i--) {
      const anchors = Object.values(side.elements).filter(m => m.id !== el.id && m.objectGroupIds?.includes(path[i]) && onBoth(m.id));
      if (!anchors.length) continue;
      const then = boxOf(anchors), now = boxOf(anchors.map(m => byId.get(m.id)!));
      const sx = then.width > 1e-6 ? now.width / then.width : 1, sy = then.height > 1e-6 ? now.height / then.height : 1;
      if (Math.abs(now.x - then.x) < 1e-9 && Math.abs(now.y - then.y) < 1e-9 && Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return el;
      changed = true;
      // Text keeps its size (resizing would reflow it) and moves its centre.
      const keepSize = el.type === 'text';
      const w = keepSize ? el.width : el.width * sx, h = keepSize ? el.height : el.height * sy;
      const cx = now.x + (own.x + own.width / 2 - then.x) * sx, cy = now.y + (own.y + own.height / 2 - then.y) * sy;
      const next = { ...el, x: cx - w / 2, y: cy - h / 2, width: w, height: h } as SlideElement;
      if (next.type === 'shape' && next.points && !keepSize) {
        next.points = next.points.map((v, k) => v * (k % 2 ? sy : sx));
        if (next.tangents) next.tangents = next.tangents.map((v, k) => v * (k % 2 ? sy : sx));
      }
      return next;
    }
    return el;
  });
  return changed ? out : frame;
}
