import type {
  EasingType,
  ImageElement,
  ShapeElement,
  SlideElement,
  TextElement,
  TransitionGroup,
} from '../types/presentation';

export const EASING_LABELS: Record<EasingType, string> = {
  const: 'Constant',
  linear: 'Linear',
  ease: 'Ease',
  dissolve: 'Dissolve',
  fadeinout: 'Fade In/Out',
  typewriter: 'Typewriter',
  write: 'Write',
  create: 'Create',
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
    case 'fill': return element.type === 'shape' ? [(element as ShapeElement).fill] : [];
    case 'stroke': return element.type === 'shape' ? [(element as ShapeElement).stroke] : [];
    case 'strokeWidth': return element.type === 'shape' ? [(element as ShapeElement).strokeWidth] : [];
    case 'cornerRadius': return element.type === 'shape' ? [(element as ShapeElement).cornerRadius] : [];
    case 'fontSize': return element.type === 'text' ? [(element as TextElement).style.fontSize] : [];
    case 'color': return element.type === 'text' ? [(element as TextElement).style.color] : [];
    case 'lineHeight': return element.type === 'text' ? [(element as TextElement).style.lineHeight] : [];
    case 'crop': return element.type === 'image' ? [
      (element as ImageElement).cropX,
      (element as ImageElement).cropY,
      (element as ImageElement).cropWidth,
      (element as ImageElement).cropHeight,
    ] : [];
    case 'resource': return element.type === 'image' ? [(element as ImageElement).resourceId] : [];
    case 'visibility': return [element.visible];
    case 'content': return element.type === 'text' ? [(element as TextElement).text] : [];
    case 'controlPoints': {
      // controlPoints drives both the vertex list AND the curve mode.
      if (element.type !== 'shape') return [];
      const s = element as ShapeElement;
      return [
        s.points ? s.points.join(',') : '',
        s.curve ?? 'linear',
        s.closed ? 1 : 0,
      ];
    }
    case 'startArrow':
      return element.type === 'shape' ? [(element as ShapeElement).startArrow ? 1 : 0] : [];
    case 'endArrow':
      return element.type === 'shape' ? [(element as ShapeElement).endArrow ? 1 : 0] : [];
    default: return [];
  }
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

  return valsA.some((valA, i) => {
    const valB = valsB[i];
    if (typeof valA === 'number' && typeof valB === 'number') {
      return Math.round(valA) !== Math.round(valB);
    }
    return valA !== valB;
  });
}
