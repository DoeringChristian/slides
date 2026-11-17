import React, { useId, type ReactNode } from 'react';
import { isWrapperMode, wrapVisualFx } from './visualFx';
import type { WriteEffect } from '../../utils/animation/interpolation';
import { useCropLayouts } from './useCropLayouts';
import type { SlideElement } from '../../types/presentation';
import { cropSteps, groupCropClips, groupCropRegions, type CropShape, type GroupCropElement } from '../../utils/model/groupCrop';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

/** Mask region: the slide with a slide's margin all round (content and crop
 *  shapes may hang off the slide). */
const REGION = { x: -SLIDE_WIDTH, y: -SLIDE_HEIGHT, width: SLIDE_WIDTH * 3, height: SLIDE_HEIGHT * 3 };

const regionPaths = (shape: CropShape, fill?: string) => groupCropRegions(shape).map((region, j) =>
  <path key={`${shape.id}-${j}`} d={region.d} transform={region.transform} clipRule={region.rule} fillRule={region.rule} fill={fill} />);

/** The visibility effect a crop shape is playing (appearing / leaving). */
const fxOf = (shape: CropShape) => (shape as CropShape & { _writeFx?: WriteEffect })._writeFx;

/** A crop shape's mask contribution: its region, shaped by its own appear
 *  effect (wipe / slide-in / grow / iris through the shared wrapper; other
 *  effects by their progress) and its opacity (a fade) — so a crop appears
 *  the way its shape is set to appear. */
function contribution(shape: CropShape, fill: string, idPrefix: string, key: string, full = false): ReactNode {
  const fx = fxOf(shape);
  // The crop's fade relative to its image's (followCropMedia), and the
  // progress of a non-wrapping effect.
  const strength = full ? 1 : ((shape as GroupCropElement)._cropStrength ?? 1)
    * (fx && !isWrapperMode(fx) ? Math.max(0, Math.min(1, fx.t)) : 1);
  const node = <g key={key} opacity={strength}>{regionPaths(shape, fill)}</g>;
  return fx && isWrapperMode(fx) && !full ? <React.Fragment key={key}>{wrapVisualFx(node, shape, fx, idPrefix)}</React.Fragment> : node;
}
/** How far a crop shape's appear/leave effect has got (1 = fully there). */
const strengthOf = (shape: CropShape) => {
  const fx = fxOf(shape);
  return Math.max(0, Math.min(1, (fx ? fx.t : 1) * ((shape as GroupCropElement)._cropStrength ?? 1)));
};
/** Whether a crop shape is mid-effect, or coming / going on its own: then
 *  the crop needs the mask, which can show effects and partial strength. */
const animating = (shape: CropShape) => !!fxOf(shape) || (shape as GroupCropElement)._cropStrength !== undefined
  || !!(shape as GroupCropElement)._cropReveal;

/**
 * Crops `children` by the element's crop groups. Each crop group is one
 * clip — nested crop groups nest, so they intersect. Within a group the crop
 * shapes combine in layer order by their `cropOp` (see `cropSteps`): when
 * they all add, a clip path (their union); otherwise a luminance mask where
 * adding paints white, subtracting black, and intersecting wraps everything
 * so far in a mask of that shape. Coordinates stay in slide space, so image
 * and crop shapes move and rotate independently inside a group.
 */
export function GroupCrop({ element, children, scope }: { element: SlideElement; children: ReactNode;
  /** Input layers only: the entered group. Inside an entered crop group the
   *  media stays grabbable in full (to pan it under the crop), so crops at or
   *  above the scope do not clip input. */
  scope?: string | null }) {
  // Static export renders several elements into one document: keep ids unique.
  const prefix = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-${element.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const path = element.objectGroupIds ?? [];
  const depth = scope ? path.indexOf(scope) : -1;
  const clips = groupCropClips(element).filter(clip => depth < 0 || path.indexOf(clip.group) > depth);
  // A text crop reads its glyph layout synchronously; redraw when it settles.
  useCropLayouts(clips.some(clip => clip.shapes.some(shape => shape.type === 'text')));
  const input = scope !== undefined;
  return clips.reduce<ReactNode>((content, clip, i) => {
    const id = `group-crop-${prefix}-${i}`;
    const mark = input ? { 'data-group-crop-input': clip.group } : { 'data-group-crop': clip.group };
    const { full, union, steps } = cropSteps(clip.shapes);
    if ((union && !clip.shapes.some(animating)) || input) {
      // Hit areas (masks do not clip pointer input) use the adding shapes;
      // a crop that starts from the whole image does not narrow them.
      if (input && full) return content;
      const adding = union ? clip.shapes : steps.filter(step => step.op === 'add').map(step => step.shape);
      return <g key={id} {...mark}>
        <defs><clipPath id={id} clipPathUnits="userSpaceOnUse">{adding.flatMap(shape => regionPaths(shape))}</clipPath></defs>
        <g clipPath={`url(#${id})`}>{content}</g>
      </g>;
    }
    const masks: ReactNode[] = [];
    // An image cropped (or uncropped) between keyframes while on screen:
    // what lies outside the crop fades out (or back) with the crop's effect.
    const reveal = clip.shapes.every(shape => (shape as GroupCropElement)._cropReveal);
    const outside = reveal ? 1 - Math.min(...clip.shapes.map(strengthOf)) : 0;
    let mask: ReactNode = full ? <rect key="full" {...REGION} fill="white" />
      : outside > 0 ? <rect key="outside" {...REGION} fill="white" opacity={outside} /> : null;
    steps.forEach(({ op, shape }, k) => {
      const fxPrefix = `${id}-fx${k}-`;
      // Cropping an on-screen image: the crop itself shows in full throughout.
      if (op === 'add') mask = <g key={`s${k}`}>{mask}{contribution(shape, 'white', fxPrefix, 'c', reveal)}</g>;
      else if (op === 'subtract') mask = <g key={`s${k}`}>{mask}{contribution(shape, 'black', fxPrefix, 'c')}</g>;
      else {
        // An intersecting shape mid-effect keeps only what it covers so far.
        const sub = `${id}-k${k}`;
        masks.push(<mask key={sub} id={sub} maskUnits="userSpaceOnUse" {...REGION} style={{ maskType: 'luminance' }}>{contribution(shape, 'white', fxPrefix, 'c')}</mask>);
        mask = <g key={`s${k}`} mask={`url(#${sub})`}>{mask}</g>;
      }
    });
    return <g key={id} {...mark}>
      <defs>{masks}<mask id={id} maskUnits="userSpaceOnUse" {...REGION} style={{ maskType: 'luminance' }}>{mask}</mask></defs>
      <g mask={`url(#${id})`}>{content}</g>
    </g>;
  }, children);
}
