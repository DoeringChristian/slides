import type {
  EasingType,
  ImageElement,
  ShapeElement,
  SlideElement,
  TextElement,
  TransitionGroup,
} from '../../types/presentation';

export const EASING_LABELS: Record<EasingType, string> = {
  const: 'Constant',
  linear: 'Linear',
  ease: 'Ease',
  dissolve: 'Dissolve',
  fadeinout: 'Fade Out/In',
  typewriter: 'Typewriter',
  write: 'Write',
  create: 'Create',
  extend: 'Extend',
  wipe: 'Wipe',
  slidein: 'Slide In',
  grow: 'Grow',
  iris: 'Iris',
  fadebyglyph: 'Fade by Glyph',
};

export function easingHasOptions(group: TransitionGroup, easing: EasingType): boolean {
  if (group === 'content' && (easing === 'write' || easing === 'typewriter')) return true;
  if (group === 'visibility' && (easing === 'wipe' || easing === 'slidein' || easing === 'grow' || easing === 'create')) return true;
  return false;
}

type TransitionPropertyValue = number | string | boolean | null | undefined;

export function transitionPropertyValues(element: SlideElement, group: TransitionGroup): TransitionPropertyValue[] {
  switch (group) {
    case 'position': return [element.x, element.y];
    case 'size': return [element.width, element.height];
    case 'rotation': return [element.rotation];
    case 'opacity': return [element.opacity];
    case 'fill': return element.type === 'shape' ? [(element as ShapeElement).fill, (element as ShapeElement).fillStyle,
      (element as ShapeElement).fillTo, (element as ShapeElement).fillLine?.join()]
      : element.type === 'image' ? [(element as ImageElement).tint, (element as ImageElement).tintStyle,
        (element as ImageElement).tintTo, (element as ImageElement).tintLine?.join()] : [];
    case 'stroke': return element.type === 'shape' ? [(element as ShapeElement).stroke] : [];
    case 'strokeWidth': return element.type === 'shape' ? [(element as ShapeElement).strokeWidth] : [];
    case 'cornerRadius': return element.type === 'shape' ? [(element as ShapeElement).cornerRadius] : [];
    case 'fontSize': return element.type === 'text' ? [(element as TextElement).style.fontSize] : [];
    case 'color': return element.type === 'text' ? [(element as TextElement).style.color] : [];
    case 'lineHeight': return element.type === 'text' ? [(element as TextElement).style.lineHeight] : [];
    case 'resource': return element.type === 'image' ? [(element as ImageElement).resourceId] : [];
    case 'visibility': return [element.visible];
    case 'content': return element.type === 'text' ? [(element as TextElement).text] : [];
    case 'controlPoints': {
      // controlPoints drives both the vertex list AND the curve mode.
      if (element.type !== 'shape') return [];
      const s = element as ShapeElement;
      return [
        s.shapeType === 'vector' ? JSON.stringify(s.geometry ?? null) : s.points ? s.points.join(',') : '',
        s.curve ?? 'linear',
        s.closed ? 1 : 0,
      ];
    }
    // Historical group names; they drive the typed startHead/endHead fields.
    case 'startArrow':
      return element.type === 'shape' ? [(element as ShapeElement).startHead ?? 'none'] : [];
    case 'endArrow':
      return element.type === 'shape' ? [(element as ShapeElement).endHead ?? 'none'] : [];
    case 'morph':
      // Fires exactly when the element TYPE or (for shapes) the shapeType
      // differs between the two keyframes — i.e. whenever a geometry morph
      // could run. Always length 2 so the differ compares pairwise.
      return [
        element.type,
        element.type === 'shape' ? (element as ShapeElement).shapeType : null,
      ];
    default: return [];
  }
}

/**
 * How far apart two numbers must be to count as a change, per group.
 *
 * Pixel- and degree-valued groups ignore sub-half-unit drift, which a drag or
 * a float round-trip leaves behind and which no viewer could see animate.
 * Unit-scale groups cannot use that tolerance: opacity lives in [0, 1] and
 * line height near 1.2, so half a unit swallowed every real change —
 * 0.2 → 0.4 compared equal and the transition was never offered.
 */
const UNIT_SCALE_GROUPS: ReadonlySet<TransitionGroup> = new Set(['opacity', 'lineHeight']);

function numberTolerance(group: TransitionGroup): number {
  return UNIT_SCALE_GROUPS.has(group) ? 1e-3 : 0.5;
}

export function transitionPropertiesDiffer(
  a: SlideElement | undefined,
  b: SlideElement | undefined,
  group: TransitionGroup,
): boolean {
  if (group === 'visibility') {
    const aVisible = a?.visible ?? false;
    const bVisible = b?.visible ?? false;
    return (!!a && aVisible) !== (!!b && bVisible);
  }
  if (!a || !b) return false;

  const valsA = transitionPropertyValues(a, group);
  const valsB = transitionPropertyValues(b, group);
  if (valsA.length !== valsB.length) return false;

  const tolerance = numberTolerance(group);
  return valsA.some((valA, i) => {
    const valB = valsB[i];
    if (typeof valA === 'number' && typeof valB === 'number') {
      return Math.abs(valA - valB) >= tolerance;
    }
    return valA !== valB;
  });
}
