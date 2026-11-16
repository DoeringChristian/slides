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

/** The media a crop boundary clips: the first non-boundary image member of
 *  its crop group on that slide. */
function cropMedia(elements: Record<string, SlideElement>, boundary: ShapeElement): SlideElement | undefined {
  return Object.values(elements).find(el => el.id !== boundary.id && el.type === 'image'
    && el.objectGroupIds?.includes(boundary.cropGroupId!));
}

type Pose = { cx: number; cy: number; w: number; h: number; rot: number };
const poseOf = (el: SlideElement): Pose => ({ cx: el.x + el.width / 2, cy: el.y + el.height / 2, w: el.width, h: el.height, rot: el.rotation || 0 });

/** A boundary's pose in its media's own frame: centre offset in media-
 *  relative units along the media's rotated axes, size as a fraction of the
 *  media's, rotation relative to the media's. */
function relativePose(boundary: Pose, media: Pose): Pose {
  const r = -media.rot * Math.PI / 180;
  const dx = boundary.cx - media.cx, dy = boundary.cy - media.cy;
  return {
    cx: (dx * Math.cos(r) - dy * Math.sin(r)) / (media.w || 1),
    cy: (dx * Math.sin(r) + dy * Math.cos(r)) / (media.h || 1),
    w: boundary.w / (media.w || 1),
    h: boundary.h / (media.h || 1),
    rot: boundary.rot - media.rot,
  };
}

function absolutePose(rel: Pose, media: Pose): Pose {
  const r = media.rot * Math.PI / 180;
  const dx = rel.cx * media.w, dy = rel.cy * media.h;
  return {
    cx: media.cx + dx * Math.cos(r) - dy * Math.sin(r),
    cy: media.cy + dx * Math.sin(r) + dy * Math.cos(r),
    w: rel.w * media.w,
    h: rel.h * media.h,
    rot: rel.rot + media.rot,
  };
}

/**
 * During a transition, a crop boundary moves WITH the media it crops.
 *
 * Interpolating the boundary and the image independently lets them drift
 * apart whenever their transitions differ (an `ease` image under a `linear`
 * crop slides beneath a crop that lags behind). A crop group is one object,
 * so the boundary is interpolated in the media's own frame — its pose
 * relative to the image at each keyframe, eased like the image's position —
 * and placed with the media's interpolated pose. A crop that is fixed
 * relative to the image stays fixed; one that changes relative to it
 * (panning the image under the crop) changes smoothly between keyframes.
 *
 * Applies only where boundary and media are both visible on both keyframes;
 * entering and exiting groups already appear and disappear together.
 */
export function followCropMedia(
  frame: SlideElement[],
  slideA: { elements: Record<string, SlideElement> },
  slideB: { elements: Record<string, SlideElement> },
  t: number,
  ease: (media: SlideElement, t: number) => number,
): SlideElement[] {
  if (!frame.some(groupCropBoundary)) return frame;
  const byId = new Map(frame.map(el => [el.id, el]));
  const replaced = new Map<string, SlideElement>();
  for (const el of frame) {
    if (!groupCropBoundary(el)) continue;
    const a = slideA.elements[el.id], b = slideB.elements[el.id];
    if (!a?.visible || !b?.visible || a.type !== 'shape' || b.type !== 'shape') continue;
    const mediaA = cropMedia(slideA.elements, a), mediaB = cropMedia(slideB.elements, b);
    if (!mediaA?.visible || !mediaB?.visible || mediaA.id !== mediaB.id) continue;
    const media = byId.get(mediaA.id);
    if (!media) continue;
    const relA = relativePose(poseOf(a), poseOf(mediaA)), relB = relativePose(poseOf(b), poseOf(mediaB));
    const k = ease(mediaB, t);
    const rel: Pose = {
      cx: relA.cx + (relB.cx - relA.cx) * k,
      cy: relA.cy + (relB.cy - relA.cy) * k,
      w: relA.w + (relB.w - relA.w) * k,
      h: relA.h + (relB.h - relA.h) * k,
      rot: relA.rot + (relB.rot - relA.rot) * k,
    };
    const pose = absolutePose(rel, poseOf(media));
    const next: SlideElement = { ...el, x: pose.cx - pose.w / 2, y: pose.cy - pose.h / 2, width: pose.w, height: pose.h, rotation: pose.rot };
    if (next.type === 'shape' && next.shapeType === 'path' && next.points && el.width && el.height) {
      const sx = pose.w / el.width, sy = pose.h / el.height;
      next.points = next.points.map((v, i) => v * (i % 2 ? sy : sx));
      if (next.tangents) next.tangents = next.tangents.map((v, i) => v * (i % 2 ? sy : sx));
    }
    replaced.set(el.id, next);
  }
  return replaced.size ? frame.map(el => replaced.get(el.id) ?? el) : frame;
}
