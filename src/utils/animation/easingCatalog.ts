import type { EasingType, SlideElement } from '../../types/presentation';

/**
 * Which easings are available per transition group (and, for visibility,
 * per element type). Single source of truth for the transition picker
 * (TransitionButton) and the sticky-defaults filter (stickyEasings).
 */

export const DEFAULT_TYPES: EasingType[] = ['const', 'linear', 'ease'];
export const CROP_TYPES: EasingType[] = ['const', 'linear', 'ease', 'cropfade', 'cropfadeease', 'croplift', 'cropliftease'];
export const RESOURCE_TYPES: EasingType[] = ['const', 'dissolve', 'fadeinout'];

// Cross-TYPE morph (text ↔ shape): 'const' = the historical hard cut at
// t=0.5 (the default when unset); 'linear'/'ease' drive the geometry morph.
export const MORPH_TYPES: EasingType[] = ['const', 'linear', 'ease'];

// Visibility easings differ by element type:
// - text:  glyph reveal (write/typewriter/fadebyglyph) + visual wrappers
// - shape: outline create + route extend (paths only) + visual wrappers
// - image: visual wrappers (no glyphs / no outline trace)
export const TEXT_VISIBILITY_TYPES:  EasingType[] = ['const', 'linear', 'ease', 'write', 'fadebyglyph', 'wipe', 'slidein', 'grow', 'iris'];
// 'extend' only has a route to grow along on `path` shapes, so
// `visibilityTypesFor` drops it for every other shape type.
export const SHAPE_VISIBILITY_TYPES: EasingType[] = ['const', 'linear', 'ease', 'create', 'extend', 'wipe', 'slidein', 'grow', 'iris'];
export const IMAGE_VISIBILITY_TYPES: EasingType[] = ['const', 'linear', 'ease', 'wipe', 'slidein', 'grow', 'iris'];

// Content easings — text only.
export const CONTENT_TYPES: EasingType[] = ['const', 'dissolve', 'typewriter', 'write', 'fadebyglyph'];

/** Shape visibility easings minus `extend`, for shapes with no route. */
const PRIMITIVE_VISIBILITY_TYPES: EasingType[] = SHAPE_VISIBILITY_TYPES.filter(t => t !== 'extend');

/**
 * The visibility easings that actually animate on `element`.
 *
 * Takes the element rather than its type because shapes split: `extend` grows
 * along a path's route, and `buildExtendFx` has nothing to grow on a rect or
 * ellipse — offering it there produced a plain fade under a misleading name.
 */
export function visibilityTypesFor(
  element: Pick<SlideElement, 'type'> & { shapeType?: string } | undefined,
): EasingType[] {
  switch (element?.type) {
    case 'text':  return TEXT_VISIBILITY_TYPES;
    case 'shape': return element.shapeType === 'path' ? SHAPE_VISIBILITY_TYPES : PRIMITIVE_VISIBILITY_TYPES;
    // Other element types (e.g. groups) fall back to the safe visual wrappers.
    default:      return IMAGE_VISIBILITY_TYPES;
  }
}
