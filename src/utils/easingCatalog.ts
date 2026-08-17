import type { EasingType, SlideElement } from '../types/presentation';

/**
 * Which easings are available per transition group (and, for visibility,
 * per element type). Single source of truth for the transition picker
 * (TransitionButton) and the sticky-defaults filter (stickyEasings).
 */

export const DEFAULT_TYPES: EasingType[] = ['const', 'linear', 'ease'];
export const RESOURCE_TYPES: EasingType[] = ['const', 'dissolve', 'fadeinout'];

// Visibility easings differ by element type:
// - text:  glyph reveal (write/typewriter/fadebyglyph) + visual wrappers
// - shape: outline create + visual wrappers
// - image: visual wrappers (no glyphs / no outline trace)
export const TEXT_VISIBILITY_TYPES:  EasingType[] = ['const', 'linear', 'ease', 'write', 'fadebyglyph', 'wipe', 'slidein', 'grow', 'iris'];
export const SHAPE_VISIBILITY_TYPES: EasingType[] = ['const', 'linear', 'ease', 'create', 'wipe', 'slidein', 'grow', 'iris'];
export const IMAGE_VISIBILITY_TYPES: EasingType[] = ['const', 'linear', 'ease', 'wipe', 'slidein', 'grow', 'iris'];

// Content easings — text only.
export const CONTENT_TYPES: EasingType[] = ['const', 'dissolve', 'typewriter', 'write', 'fadebyglyph'];

export function visibilityTypesFor(elementType: SlideElement['type'] | undefined): EasingType[] {
  switch (elementType) {
    case 'text':  return TEXT_VISIBILITY_TYPES;
    case 'shape': return SHAPE_VISIBILITY_TYPES;
    // Other element types (e.g. groups) fall back to the safe visual wrappers.
    default:      return IMAGE_VISIBILITY_TYPES;
  }
}
