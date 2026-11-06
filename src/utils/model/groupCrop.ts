import type { ShapeElement, SlideElement } from '../../types/presentation';
import { shapeToPathD } from '../paths/shapeToPath';
import { resolveShapeGeometry, vectorContourD } from '../geometry/vectorGeometry';
import { getRotationCenter } from '../geometry/geometry';

/** A group property carried by its boundary member, rather than an image link.
 * Membership remains the only authority: ungrouping/removing the boundary
 * releases the crop without deleting or changing any member's geometry. */
export function groupCropBoundary(el: SlideElement): el is ShapeElement {
  return el.type === 'shape' && !!el.cropGroupId && !!el.objectGroupIds?.includes(el.cropGroupId);
}
export type GroupCropElement = SlideElement & { _groupClips?: ShapeElement[]; _groupCropBoundary?: boolean };
export function attachGroupCrops(elements: SlideElement[]): SlideElement[] {
  const boundaries = elements.filter(groupCropBoundary);
  if (!boundaries.length) return elements;
  const painted = elements.map(el => {
    const clips = boundaries.filter(shape => shape.id !== el.id && el.objectGroupIds?.includes(shape.cropGroupId!));
    return { ...el, ...(clips.length ? { _groupClips: clips } : {}),
      ...(groupCropBoundary(el) ? { _groupCropBoundary: true } : {}) };
  });
  // Boundaries paint last in their group, regardless of which member was
  // originally in front. Stored layer order and paint remain untouched.
  for (const boundary of [...boundaries].sort((a,b) => (b.objectGroupIds?.length ?? 0) - (a.objectGroupIds?.length ?? 0))) {
    const index = painted.findIndex(el => el.id === boundary.id);
    const [outline] = painted.splice(index, 1);
    let last = -1;
    painted.forEach((el, i) => { if (el.objectGroupIds?.includes(boundary.cropGroupId!)) last = i; });
    painted.splice(last < 0 ? index : last + 1, 0, outline);
  }
  return painted;
}

/** Shared geometry for SVG clipping and raster/PDF export. Fill regions retain
 * their winding rule (including holes); open paths close for clipping only. */
export function groupCropRegions(shape: ShapeElement) {
  const { x, y } = getRotationCenter(shape);
  const transform = shape.rotation ? `rotate(${shape.rotation}, ${x}, ${y})` : undefined;
  const regions = shape.shapeType === 'vector'
    ? (resolveShapeGeometry(shape).fills.length ? resolveShapeGeometry(shape).fills
      : (shape.geometry?.contours ?? []).map(c => ({ d: vectorContourD(c, shape, true), rule: 'nonzero' as const })))
    : [{ d: shapeToPathD({ ...shape, closed: true, startHead: 'none', endHead: 'none' }), rule: 'nonzero' as const }];
  return regions.map(region => ({ ...region, transform }));
}

/** Suppress only the boundary fill while cropping; preserve its saved paint. */
export function groupCropPaint<T extends SlideElement>(element: T): T {
  return element.type === 'shape' && (element as GroupCropElement)._groupCropBoundary
    ? { ...element, fill: 'none', fillStyle: undefined } : element;
}

export function planGroupCrop(elements: Record<string, SlideElement>, ids: string[], shapeId: string | null,
  newGroupId: () => string): Array<{ elementId: string; changes: Partial<SlideElement> }> {
  const members = ids.map(id => elements[id]).filter(Boolean);
  if (members.some(el => el.locked)) return [];
  if (!shapeId) return members.filter(groupCropBoundary).map(el => ({ elementId: el.id, changes: { cropGroupId: null } }));
  const shape = elements[shapeId];
  if (shape?.type !== 'shape' || !ids.includes(shapeId) || !members.some(el => el.type === 'image')) return [];
  const common = [...(shape.objectGroupIds ?? [])].reverse().find(group =>
    members.every(el => el.objectGroupIds?.includes(group)) &&
    Object.values(elements).every(el => !el.objectGroupIds?.includes(group) || ids.includes(el.id) || el.type === 'text' && el.containerId));
  const group = common ?? newGroupId();
  // In an entered group retain the shared prefix and insert a nested group.
  const prefix = (shape.objectGroupIds ?? []).filter((id, i) => members.every(el => el.objectGroupIds?.[i] === id));
  return members.map(el => ({ elementId: el.id, changes: {
    ...(!common ? { objectGroupIds: [...prefix, group, ...(el.objectGroupIds ?? []).slice(prefix.length)] } : {}),
    ...(el.id === shapeId ? { cropGroupId: group } : el.type === 'shape' && el.cropGroupId === group ? { cropGroupId: null } : {}),
  } }));
}
