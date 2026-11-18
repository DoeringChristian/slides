import type { SlideElement, TextElement } from '../../types/presentation';
import { shapeToPathD } from '../paths/shapeToPath';
import { resolveShapeGeometry, vectorContourD } from '../geometry/vectorGeometry';
import { getRotationCenter } from '../geometry/geometry';
import { layoutForElement, layoutForElementSync, textHorizontalOffset } from '../text/userTextSizing';
import { textInsets } from '../text/boundTextLayout';
import { textVerticalOffset } from '../text/textLayout';
import { parseTransformChain, type Mat2x3 } from '../animation/morphGeometry';
import { groupCropBoundary, type CropShape } from './groupCrop';

/**
 * Crop GEOMETRY: where a crop shape's region lies on the slide — a shape's
 * outline, or free text's glyphs from the same layout the renderer draws.
 * Only drawing code imports this (editor canvas, presenter, exports): it
 * loads the text layout and its fonts, which the backend cannot — and need
 * not, since it never draws. The crop model is groupCrop.ts.
 */

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
    const dx = shape.x + padding + textHorizontalOffset(shape, doc.width), dy = shape.y + padding + textVerticalOffset(shape.style.verticalAlign, shape.height, padding, doc.height);
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


/** Lay out every crop text in these slides, so synchronous renderers
 *  (exports) clip to their glyphs. */
export async function ensureCropLayouts(slides: Array<{ elements: Record<string, SlideElement> }>): Promise<void> {
  await Promise.all(slides.flatMap(slide => Object.values(slide.elements))
    .filter((el): el is TextElement => el.type === 'text' && groupCropBoundary(el))
    .map(el => layoutForElement(el).catch(() => undefined)));
}

