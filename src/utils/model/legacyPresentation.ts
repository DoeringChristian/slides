import type { Presentation, ShapeElement, SlideElement, ConnectorBinding, Slide } from '../../types/presentation';
import { assertPresentation, restoreStoredProject } from './currentPresentation';
import { bindingFor, silhouetteIntersect } from '../paths/connectorUtils';
import { pathPointsInSlide } from '../paths/pathEditing';
import { getRotationCenter } from '../geometry/geometry';

type LegacyBinding = Omit<ConnectorBinding, 'mode' | 'fixedPoint'> & {
  mode?: string; fixedPoint?: [number, number]; anchor?: string; focus?: number;
};
type LegacyShape = Omit<ShapeElement, 'shapeType' | 'startBinding' | 'endBinding'> & {
  shapeType: string; startArrow?: boolean; endArrow?: boolean; bsplineDegree?: number;
  startBinding?: LegacyBinding | null; endBinding?: LegacyBinding | null;
};
type LegacySlide = Slide & { autoAdvance?: boolean };

function upgradeBinding(binding: LegacyBinding | null | undefined, shape: ShapeElement, end: boolean,
  elements: Record<string, SlideElement>): ConnectorBinding | null | undefined {
  if (!binding) return binding;
  if ((binding.mode === 'aim' || binding.mode === 'pinned') && binding.fixedPoint && binding.focus === undefined && binding.anchor === undefined) return binding as ConnectorBinding;
  const { anchor, focus, ...rest } = binding;
  const anchors: Record<string, [number, number]> = { center: [.5,.5], top: [.5,0], bottom: [.5,1], left: [0,.5], right: [1,.5] };
  if (binding.mode === 'pinned' || (anchor && binding.mode !== 'edge')) {
    return { ...rest, mode: 'pinned', fixedPoint: binding.fixedPoint ?? anchors[anchor ?? 'center'] ?? [.5,.5] };
  }
  const target = elements[binding.elementId];
  if (!target) return { ...rest, mode: 'aim', fixedPoint: [.5,.5] }; // validation reports the dangling target
  const center = getRotationCenter(target);
  let aim = center;
  const points = pathPointsInSlide(shape);
  const i = end ? points.length - 4 : 2;
  if (focus && points.length >= 4) {
    const dx = center.x - points[i], dy = center.y - points[i + 1], length = Math.hypot(dx, dy);
    if (length > 1e-9) {
      const sign = focus < 0 ? -1 : 1;
      const dir = { x: -dy / length * sign, y: dx / length * sign };
      const hit = silhouetteIntersect(target, center, { x: center.x + dir.x, y: center.y + dir.y });
      const extent = hit ? Math.hypot(hit.x - center.x, hit.y - center.y) : Math.min(target.width, target.height) / 2;
      aim = { x: center.x + dir.x * Math.min(1, Math.abs(focus)) * extent, y: center.y + dir.y * Math.min(1, Math.abs(focus)) * extent };
    }
  }
  return { ...rest, ...bindingFor(aim, target, 'aim'), gap: binding.gap ?? 0 };
}

/** Explicit import boundary: upgrade old native payloads, then validate the
 * current schema. Work on a copy so failed imports never modify the source. */
export function upgradeNativePresentation(value: unknown): Presentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return assertPresentation(value);
  const original = value as Presentation;
  if (!original.slides || !original.templates || !Array.isArray(original.slideOrder)) return assertPresentation(value);
  const p = restoreStoredProject(structuredClone(original));
  for (const slide of [...Object.values(p.slides), ...Object.values(p.templates)]) {
    if (!slide.elements || !Array.isArray(slide.elementOrder)) return assertPresentation(value);
    slide.elementOrder.push(...Object.keys(slide.elements).filter(id => !slide.elementOrder.includes(id)));
    for (const el of Object.values(slide.elements)) {
      if (el.type === 'text') {
        // Keep imported wrapping/box geometry; auto-content would reflow it.
        el.textSizing ??= 'user-width';
        const container = el.containerId ? slide.elements[el.containerId] : null;
        el.boundTextLayout ??= container?.type === 'shape' && ['rect', 'ellipse'].includes(container.shapeType) ? 'measured' : 'padded';
      }
      if (el.type !== 'shape') continue;
      const old = el as unknown as LegacyShape;
      const kind = old.shapeType;
      if (['line', 'arrow', 'polygon', 'bspline'].includes(kind)) {
        old.shapeType = 'path';
        old.curve ??= kind === 'bspline' ? (old.bsplineDegree === 2 ? 'bspline2' : 'bspline3') : 'linear';
        old.closed ??= false;
        if (kind === 'arrow' && old.endArrow === undefined && old.endHead === undefined) old.endHead = 'triangle';
      }
      if (old.startArrow && old.startHead === undefined) old.startHead = 'triangle';
      if (old.endArrow && old.endHead === undefined) old.endHead = 'triangle';
      delete old.startArrow; delete old.endArrow; delete old.bsplineDegree;
      el.creationPreset ??= el.shapeType === 'vector' ? 'icon' : el.shapeType === 'path'
        ? (kind === 'polygon' || el.closed ? 'polygon' : kind === 'bspline' || (el.curve && el.curve !== 'linear') ? 'curve'
          : kind === 'arrow' || (el.endHead && el.endHead !== 'none') || (el.startHead && el.startHead !== 'none') ? 'arrow' : 'line')
        : el.shapeType as ShapeElement['creationPreset'];
    }
    for (const el of Object.values(slide.elements)) if (el.type === 'shape') {
      el.startBinding = upgradeBinding(el.startBinding, el, false, slide.elements);
      el.endBinding = upgradeBinding(el.endBinding, el, true, slide.elements);
    }
  }
  // Legacy timed runs include their landing slide. Stable IDs make repeated
  // imports and server recovery deterministic.
  const slides = p.slides as Record<string, LegacySlide>;
  for (let i = 0; i < p.slideOrder.length;) {
    if (!slides[p.slideOrder[i]]?.autoAdvance) { i++; continue; }
    let j = i;
    while (j < p.slideOrder.length && slides[p.slideOrder[j]]?.autoAdvance) j++;
    const ids = p.slideOrder.slice(i, Math.min(j + 1, p.slideOrder.length));
    if (ids.length > 1 && ids.every(id => !slides[id].groupId)) for (const id of ids) slides[id].groupId = 'import-chain-' + ids[0];
    i = Math.min(j + 1, p.slideOrder.length);
  }
  for (const slide of [...Object.values(slides), ...Object.values(p.templates)]) delete (slide as LegacySlide).autoAdvance;
  const upgraded = assertPresentation(p);
  return JSON.stringify(upgraded) === JSON.stringify(original) ? original : upgraded;
}
