import type { CropOp, ShapeElement, SlideElement, TextElement } from '../../types/presentation';
import { shapeToPathD } from '../paths/shapeToPath';
import { resolveShapeGeometry, vectorContourD } from '../geometry/vectorGeometry';
import { getRotationCenter } from '../geometry/geometry';
import { layoutForElement, layoutForElementSync } from '../text/userTextSizing';
import { textInsets } from '../text/boundTextLayout';
import { textVerticalOffset } from '../text/textLayout';
import { parseTransformChain, type Mat2x3 } from '../animation/morphGeometry';

/** What can crop: a shape (its outline) or free text (its glyphs). */
export type CropShape = ShapeElement | TextElement;

/** A group property carried by its boundary member, rather than an image link.
 * Membership remains the only authority: ungrouping/removing the boundary
 * releases the crop without deleting or changing any member's geometry. */
export function groupCropBoundary(el: SlideElement): el is CropShape {
  return (el.type === 'shape' || el.type === 'text' && !el.containerId)
    && !!el.cropGroupId && !!el.objectGroupIds?.includes(el.cropGroupId);
}
/** Elements that can become crop shapes (bound labels ride with their containers). */
export const canCrop = (el: SlideElement): el is CropShape => el.type === 'shape' || el.type === 'text' && !el.containerId;
export type GroupCropElement = SlideElement & { _groupClips?: CropShape[]; _groupCropBoundary?: boolean };
export function attachGroupCrops(elements: SlideElement[]): SlideElement[] {
  const boundaries = elements.filter(groupCropBoundary);
  if (!boundaries.length) return elements;
  const painted = elements.map(el => {
    // A crop shape is not clipped by its own crop group (its outline frames
    // the crop, and the group's other shapes must not cut it) — only by
    // crop groups it is nested in.
    const own = groupCropBoundary(el) ? el.cropGroupId : undefined;
    const clips = boundaries.filter(shape => shape.id !== el.id && shape.cropGroupId !== own && el.objectGroupIds?.includes(shape.cropGroupId!));
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

/** An element's crops, one per crop group it belongs to, outermost first.
 *  The crop shapes of one group reveal their UNION (each shape adds the area
 *  it covers); separate — nested — crop groups intersect. Every renderer
 *  (editor, presenter, SVG/PNG, PDF) clips through this. */
export function groupCropClips(element: SlideElement): Array<{ group: string; shapes: CropShape[] }> {
  const clips = (element as GroupCropElement)._groupClips ?? [];
  const path = element.objectGroupIds ?? [];
  const byGroup = new Map<string, CropShape[]>();
  for (const shape of clips) {
    const list = byGroup.get(shape.cropGroupId!) ?? [];
    list.push(shape);
    byGroup.set(shape.cropGroupId!, list);
  }
  return [...byGroup].sort((a, b) => path.indexOf(a[0]) - path.indexOf(b[0])).map(([group, shapes]) => ({ group, shapes }));
}

export interface CropRegion {
  d: string;
  rule: 'evenodd' | 'nonzero';
  /** SVG transform placing `d` on the slide (absent: already there). */
  transform?: string;
  /** The same placement as a matrix, for canvas (PDF) clipping. */
  matrix: Mat2x3;
}

const rotationAbout = (el: SlideElement): { transform?: string; matrix: Mat2x3 } => {
  if (!el.rotation) return { matrix: [1, 0, 0, 1, 0, 0] };
  const { x, y } = getRotationCenter(el);
  const r = el.rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  return { transform: `rotate(${el.rotation}, ${x}, ${y})`, matrix: [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y] };
};
const mul = (A: Mat2x3, B: Mat2x3): Mat2x3 => [
  A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
];

/** Shared geometry for SVG clipping and raster/PDF export. Fill regions retain
 * their winding rule (including holes); open paths close for clipping only.
 * Text crops by its glyph outlines, laid out exactly as the renderer draws
 * them (the same cached layout; none until it has settled). */
export function groupCropRegions(shape: CropShape): CropRegion[] {
  const rotation = rotationAbout(shape);
  if (shape.type === 'text') {
    const doc = layoutForElementSync(shape);
    // Not laid out yet: start it (renderers redraw when it settles; exports
    // await ensureCropLayouts first) and crop to nothing meanwhile.
    if (!doc) { void layoutForElement(shape).catch(() => {}); return []; }
    const padding = textInsets(shape);
    const dx = shape.x + padding, dy = shape.y + padding + textVerticalOffset(shape.style.verticalAlign, shape.height, padding, doc.height);
    return doc.paths.map(path => ({
      d: path.fillD ?? path.d,
      rule: path.fillRule ?? 'nonzero',
      transform: `${rotation.transform ?? ''} translate(${dx}, ${dy}) ${path.transform ?? ''}`.trim(),
      matrix: mul(mul(rotation.matrix, [1, 0, 0, 1, dx, dy]), parseTransformChain(path.transform)),
    }));
  }
  const regions = shape.shapeType === 'vector'
    ? (resolveShapeGeometry(shape).fills.length ? resolveShapeGeometry(shape).fills
      : (shape.geometry?.contours ?? []).map(c => ({ d: vectorContourD(c, shape, true), rule: 'nonzero' as const })))
    : [{ d: shapeToPathD({ ...shape, closed: true, startHead: 'none', endHead: 'none' }), rule: 'nonzero' as const }];
  return regions.map(region => ({ ...region, ...rotation }));
}

/** The rest of the crop groups that `ids` are crop shapes of (their image
 *  and other crop shapes), for showing a crop shape in context — alone it
 *  draws nothing. */
export function cropContext(elements: Record<string, SlideElement>, ids: string[]): SlideElement[] {
  const groups = new Set(ids.map(id => elements[id]).filter((el): el is CropShape => !!el && groupCropBoundary(el)).map(el => el.cropGroupId!));
  if (!groups.size) return [];
  const chosen = new Set(ids);
  return Object.values(elements).filter(el => !chosen.has(el.id) && [...groups].some(g => el.objectGroupIds?.includes(g)));
}

/** Lay out every crop text in these slides, so synchronous renderers
 *  (exports) clip to their glyphs. */
export async function ensureCropLayouts(slides: Array<{ elements: Record<string, SlideElement> }>): Promise<void> {
  await Promise.all(slides.flatMap(slide => Object.values(slide.elements))
    .filter((el): el is TextElement => el.type === 'text' && groupCropBoundary(el))
    .map(el => layoutForElement(el).catch(() => undefined)));
}

/** One crop group's crop as a sequence of steps over its shapes in layer
 *  order, starting from nothing — or from the whole image when the first
 *  shape subtracts (a first shape that intersects just adds). Every renderer
 *  evaluates these the same way: SVG (a clip path when all add, else a
 *  mask) and canvas/PDF (compositing). */
export function cropSteps(shapes: CropShape[]): { full: boolean; union: boolean; steps: Array<{ op: CropOp; shape: CropShape }> } {
  const ops = shapes.map(shape => shape.cropOp ?? 'add');
  return {
    full: ops[0] === 'subtract',
    union: ops.every(op => op === 'add'),
    steps: shapes.map((shape, i) => ({ op: i === 0 && ops[i] === 'intersect' ? 'add' : ops[i], shape })),
  };
}

/** Suppress the boundary's own fill while cropping (its saved paint is
 *  kept): a crop shape keeps its outline; crop text, which only has fill,
 *  draws nothing — the image shows through its glyphs instead. A tinting
 *  crop shape keeps its fill: it paints over the image (crop shapes draw
 *  after their group's members), exactly over the area it reveals. */
export function groupCropPaint<T extends SlideElement>(element: T): T {
  if (!(element as GroupCropElement)._groupCropBoundary) return element;
  if (element.type === 'shape') return element.cropTint ? element : { ...element, fill: 'none', fillStyle: undefined };
  if (element.type === 'text') return { ...element, opacity: 0 };
  return element;
}

/** The crop group an image is the target of (its innermost object group
 *  that has a crop shape), or undefined. */
export function cropGroupOf(elements: Record<string, SlideElement>, imageId: string): string | undefined {
  const image = elements[imageId];
  if (image?.type !== 'image') return undefined;
  const boundaries = new Set(Object.values(elements).filter(groupCropBoundary).map(el => el.cropGroupId!));
  return [...(image.objectGroupIds ?? [])].reverse().find(group => boundaries.has(group));
}

/** The one image a crop group crops: its member image whose own crop group
 *  it is (an image in a nested crop group belongs to that one instead). */
export function cropTarget(elements: Record<string, SlideElement>, group: string): SlideElement | undefined {
  return Object.values(elements).find(el => el.type === 'image' && el.objectGroupIds?.includes(group)
    && cropGroupOf(elements, el.id) === group);
}

/** The members of an object group (bound labels ride with their containers). */
function groupMembers(elements: Record<string, SlideElement>, group: string): SlideElement[] {
  return Object.values(elements).filter(el => el.objectGroupIds?.includes(group) && !(el.type === 'text' && el.containerId));
}

export type CropAction =
  /** One image with no crop yet: crop mode starts empty. */
  | { kind: 'start'; imageId: string }
  /** One image plus shapes and nothing else: the shapes become its crop. */
  | { kind: 'make'; imageId: string; shapeIds: string[] }
  /** Exactly one crop group (or its image alone): edit or remove the crop. */
  | { kind: 'edit'; imageId: string; group: string };

/** What the Crop control offers for a selection. Cropping belongs to the
 *  crop group, so it is offered only when the selection is exactly one image,
 *  exactly one crop group, or one image with the shapes to crop it to. */
export function selectionCropAction(elements: Record<string, SlideElement>, selectedIds: string[]): CropAction | null {
  const selected = [...new Set(selectedIds)].map(id => elements[id])
    .filter((el): el is SlideElement => !!el && el.visible && !(el.type === 'text' && el.containerId));
  const images = selected.filter(el => el.type === 'image');
  if (images.length !== 1 || selected.some(el => el.locked)) return null;
  const image = images[0];
  const group = cropGroupOf(elements, image.id);
  if (selected.length === 1) return group ? { kind: 'edit', imageId: image.id, group } : { kind: 'start', imageId: image.id };
  if (group) {
    const members = groupMembers(elements, group).filter(el => el.visible);
    const ids = new Set(selected.map(el => el.id));
    return members.length === ids.size && members.every(el => ids.has(el.id)) ? { kind: 'edit', imageId: image.id, group } : null;
  }
  const others = selected.filter(el => el !== image);
  const shapes = others.filter((el): el is CropShape => canCrop(el) && !groupCropBoundary(el));
  if (shapes.length !== others.length) return null;
  return { kind: 'make', imageId: image.id, shapeIds: shapes.map(el => el.id) };
}

type Changes = Array<{ elementId: string; changes: Partial<SlideElement> }>;

/** Make `shapeIds` the crop of `imageId` (reusing the object group that holds
 *  exactly those members, else a new group nested under their shared path —
 *  so it works inside an entered group), or with `shapeIds === null` remove
 *  the image's crop and keep the plain group. Geometry and order untouched. */
export function planCrop(elements: Record<string, SlideElement>, imageId: string, shapeIds: string[] | null,
  newGroupId: () => string): Changes {
  const image = elements[imageId];
  if (image?.type !== 'image') return [];
  if (shapeIds === null) {
    const group = cropGroupOf(elements, imageId);
    return group ? Object.values(elements).filter(el => groupCropBoundary(el) && el.cropGroupId === group)
      .map(el => ({ elementId: el.id, changes: { cropGroupId: null } })) : [];
  }
  const shapes = shapeIds.map(id => elements[id]);
  if (!shapes.length || shapes.some(el => !el || !canCrop(el))) return [];
  const members = [image, ...shapes];
  if (members.some(el => el.locked)) return [];
  const ids = new Set(members.map(el => el.id));
  const existing = cropGroupOf(elements, imageId);
  const common = existing && shapes.every(el => el.objectGroupIds?.includes(existing)) ? existing
    : [...(image.objectGroupIds ?? [])].reverse().find(group =>
      members.every(el => el.objectGroupIds?.includes(group)) &&
      Object.values(elements).every(el => !el.objectGroupIds?.includes(group) || ids.has(el.id) || el.type === 'text' && el.containerId));
  const group = common ?? newGroupId();
  const prefix = (image.objectGroupIds ?? []).filter((id, i) => members.every(el => el.objectGroupIds?.[i] === id));
  return members.map(el => ({ elementId: el.id, changes: {
    ...(!common ? { objectGroupIds: [...prefix, group, ...(el.objectGroupIds ?? []).slice(prefix.length)] } : {}),
    ...(el.type !== 'image' ? { cropGroupId: group } : {}),
  } }));
}

/** A shape drawn in crop mode, as a crop shape of `imageId`'s crop group
 *  (created when the image has none). Returns the shape to add and the
 *  image's change, if its group path grows. */
export function planCropShape(elements: Record<string, SlideElement>, imageId: string, shape: CropShape,
  newGroupId: () => string): { shape: CropShape; group: string; changes: Changes } | null {
  const image = elements[imageId];
  if (image?.type !== 'image' || image.locked) return null;
  const existing = cropGroupOf(elements, imageId);
  const group = existing ?? newGroupId();
  const imagePath = image.objectGroupIds ?? [];
  const path = existing ? imagePath.slice(0, imagePath.indexOf(existing) + 1) : [...imagePath, group];
  return {
    shape: { ...shape, objectGroupIds: path, cropGroupId: group },
    group,
    changes: existing ? [] : [{ elementId: imageId, changes: { objectGroupIds: path } }],
  };
}

/** In crop mode, everything but the image and its crop group is dimmed
 *  and inert. */
export function cropModeMember(el: SlideElement, imageId: string, group: string | undefined): boolean {
  return el.id === imageId || (!!group && !!el.objectGroupIds?.includes(group));
}

/** Leaving crop mode: a crop group left without a visible crop shape is
 *  dissolved (its level removed from every member), so an emptied or
 *  never-drawn crop leaves no trace. */
export function planCropCleanup(elements: Record<string, SlideElement>, group: string): Changes {
  const members = Object.values(elements).filter(el => el.objectGroupIds?.includes(group));
  if (!members.length || members.some(el => groupCropBoundary(el) && el.cropGroupId === group && el.visible)) return [];
  return members.map(el => ({ elementId: el.id, changes: {
    objectGroupIds: el.objectGroupIds!.filter(id => id !== group),
    ...(el.type !== 'image' && 'cropGroupId' in el && el.cropGroupId === group ? { cropGroupId: null } : {}),
  } }));
}

/** The media a crop boundary clips: the first non-boundary image member of
 *  its crop group on that slide. */
function cropMedia(elements: Record<string, SlideElement>, boundary: CropShape): SlideElement | undefined {
  return cropTarget(elements, boundary.cropGroupId!);
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
 * relative to the image at each keyframe, eased by the crop shape's own
 * position / size / rotation easings —
 * and placed with the media's interpolated pose. A crop that is fixed
 * relative to the image stays fixed; one that changes relative to it
 * (panning the image under the crop) changes smoothly between keyframes.
 *
 * A crop shape on only one keyframe (drawn there, or gone after) keeps its
 * pose relative to the media from that keyframe, so it travels with the
 * media while it fades in or out.
 */
export function followCropMedia(
  frame: SlideElement[],
  slideA: { elements: Record<string, SlideElement> },
  slideB: { elements: Record<string, SlideElement> },
  t: number,
  /** Eased progress for an element's transition group — called with the
   *  crop shape, whose own easings drive its motion relative to the media. */
  ease: (element: SlideElement, group: 'position' | 'size' | 'rotation', t: number) => number,
): SlideElement[] {
  if (!frame.some(groupCropBoundary)) return frame;
  const byId = new Map(frame.map(el => [el.id, el]));
  const replaced = new Map<string, SlideElement>();
  for (const el of frame) {
    if (!groupCropBoundary(el)) continue;
    const a = slideA.elements[el.id], b = slideB.elements[el.id];
    // A crop shape present on only one keyframe (drawn there, or removed
    // after) still moves with its media, at its offset on that keyframe —
    // otherwise it would stand at its own place while the image moves.
    const onA = !!a?.visible && canCrop(a), onB = !!b?.visible && canCrop(b);
    if (!onA && !onB) continue;
    const mediaA = onA ? cropMedia(slideA.elements, a) : undefined;
    const mediaB = onB ? cropMedia(slideB.elements, b) : undefined;
    if ((onA && !mediaA?.visible) || (onB && !mediaB?.visible)) continue;
    if (onA && onB && mediaA!.id !== mediaB!.id) continue;
    const media = byId.get((mediaA ?? mediaB)!.id);
    if (!media) continue;
    const relA = onA ? relativePose(poseOf(a), poseOf(mediaA!)) : null;
    const relB = onB ? relativePose(poseOf(b), poseOf(mediaB!)) : null;
    // The crop shape's own easings (it is the object whose position, size
    // and rotation are animating — relative to its media).
    const own = (b ?? a)!;
    const kp = ease(own, 'position', t), ks = ease(own, 'size', t), kr = ease(own, 'rotation', t);
    const rel: Pose = relA && relB ? {
      cx: relA.cx + (relB.cx - relA.cx) * kp,
      cy: relA.cy + (relB.cy - relA.cy) * kp,
      w: relA.w + (relB.w - relA.w) * ks,
      h: relA.h + (relB.h - relA.h) * ks,
      rot: relA.rot + (relB.rot - relA.rot) * kr,
    } : (relA ?? relB)!;
    const pose = absolutePose(rel, poseOf(media));
    // Text keeps its own (interpolated) box size — resizing it would reflow
    // the glyphs — and follows the media's position and rotation.
    const w = el.type === 'text' ? el.width : pose.w, h = el.type === 'text' ? el.height : pose.h;
    const next: SlideElement = { ...el, x: pose.cx - w / 2, y: pose.cy - h / 2, width: w, height: h, rotation: pose.rot };
    if (next.type === 'shape' && next.shapeType === 'path' && next.points && el.width && el.height) {
      const sx = pose.w / el.width, sy = pose.h / el.height;
      next.points = next.points.map((v, i) => v * (i % 2 ? sy : sx));
      if (next.tangents) next.tangents = next.tangents.map((v, i) => v * (i % 2 ? sy : sx));
    }
    replaced.set(el.id, next);
  }
  return replaced.size ? frame.map(el => replaced.get(el.id) ?? el) : frame;
}
