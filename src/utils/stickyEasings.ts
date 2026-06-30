import type {
  SlideElement,
  EasingType,
  TransitionGroup,
  PropertyTransitions,
  TransitionOptions,
} from '../types/presentation';
import { useEditorStore } from '../store/editorStore';

/**
 * Sticky animation defaults.
 *
 * Whenever the user picks an easing for a property group, editorStore
 * remembers it (`rememberEasing`). Newly-created elements pick up those
 * remembered easings as their default transitions — but only for groups
 * where the easing is applicable to the element's type. A `create`
 * visibility shouldn't follow to a freshly-added text element, for
 * example; `write` shouldn't follow to a shape.
 */

// Mirrors the lists in TransitionButton.tsx — keep these in sync if a new
// easing is added in either place.
const TEXT_VISIBILITY:  EasingType[] = ['const', 'linear', 'ease', 'write', 'fadebyglyph', 'wipe', 'slidein', 'grow', 'iris'];
const SHAPE_VISIBILITY: EasingType[] = ['const', 'linear', 'ease', 'create', 'wipe', 'slidein', 'grow', 'iris'];
const IMAGE_VISIBILITY: EasingType[] = ['const', 'linear', 'ease', 'wipe', 'slidein', 'grow', 'iris'];
const CONTENT_TYPES:    EasingType[] = ['const', 'dissolve', 'typewriter', 'write', 'fadebyglyph'];
const RESOURCE_TYPES:   EasingType[] = ['const', 'dissolve', 'fadeinout'];
const NUMERIC:          EasingType[] = ['const', 'linear', 'ease'];

function applicable(elementType: SlideElement['type'], group: TransitionGroup, easing: EasingType): boolean {
  switch (group) {
    case 'visibility':
      return (elementType === 'text'  ? TEXT_VISIBILITY
            : elementType === 'shape' ? SHAPE_VISIBILITY
            : elementType === 'image' ? IMAGE_VISIBILITY
            : NUMERIC).includes(easing);
    case 'content':
      return elementType === 'text' && CONTENT_TYPES.includes(easing);
    case 'resource':
      return elementType === 'image' && RESOURCE_TYPES.includes(easing);
    case 'fill': case 'stroke': case 'strokeWidth': case 'cornerRadius':
      return elementType === 'shape' && NUMERIC.includes(easing);
    case 'fontSize': case 'color': case 'lineHeight':
      return elementType === 'text' && NUMERIC.includes(easing);
    case 'crop':
      return elementType === 'image' && NUMERIC.includes(easing);
    case 'controlPoints': case 'startArrow': case 'endArrow':
      return elementType === 'shape' && NUMERIC.includes(easing);
    case 'position': case 'size': case 'rotation': case 'opacity':
      return NUMERIC.includes(easing);
    default:
      return false;
  }
}

/** Read the remembered easings for the element's type and return a
 *  `PropertyTransitions` containing only the applicable ones. Empty
 *  object if nothing is remembered. */
export function stickyTransitionsFor(element: SlideElement): PropertyTransitions {
  const editor = useEditorStore.getState();
  const remembered = editor.lastEasings[element.type] ?? {};
  const options = editor.lastEasingOptions[element.type] ?? {};
  const out: PropertyTransitions = {};
  for (const [key, easing] of Object.entries(remembered) as Array<[TransitionGroup, EasingType]>) {
    if (!applicable(element.type, key, easing)) continue;
    out[key] = easing;
  }
  if (options.visibility) out.visibilityOptions = options.visibility as TransitionOptions;
  if (options.content) out.contentOptions = options.content as TransitionOptions;
  return out;
}

/** Merge sticky defaults INTO an element's existing transitions without
 *  overwriting explicit values. The element wins where it already has
 *  an entry. */
export function applyStickyDefaults<T extends SlideElement>(element: T): T {
  const sticky = stickyTransitionsFor(element);
  if (Object.keys(sticky).length === 0) return element;
  return {
    ...element,
    transitions: { ...sticky, ...(element.transitions || {}) },
  };
}
