import type { SlideElement, TextElement, ShapeElement, ImageElement } from '../types/presentation';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0');
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0');
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

export function lerpColor(a: string, b: string, t: number): string {
  if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) {
    return t < 0.5 ? a : b;
  }
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t));
}

function lerpPoints(a: number[], b: number[], t: number): number[] {
  if (a.length !== b.length) return t < 0.5 ? a : b;
  return a.map((v, i) => lerp(v, b[i], t));
}

export function interpolateElement(a: SlideElement, b: SlideElement, t: number): SlideElement {
  // Base element properties — always tween
  const base = {
    ...a,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    rotation: lerp(a.rotation, b.rotation, t),
    opacity: lerp(a.opacity, b.opacity, t),
    visible: true,
  };

  // Text elements
  if (a.type === 'text' && b.type === 'text') {
    const ta = a as TextElement;
    const tb = b as TextElement;
    return {
      ...base,
      type: 'text',
      text: t < 0.5 ? ta.text : tb.text,
      style: {
        fontFamily: t < 0.5 ? ta.style.fontFamily : tb.style.fontFamily,
        fontSize: lerp(ta.style.fontSize, tb.style.fontSize, t),
        fontWeight: t < 0.5 ? ta.style.fontWeight : tb.style.fontWeight,
        fontStyle: t < 0.5 ? ta.style.fontStyle : tb.style.fontStyle,
        textDecoration: t < 0.5 ? ta.style.textDecoration : tb.style.textDecoration,
        color: lerpColor(ta.style.color, tb.style.color, t),
        align: t < 0.5 ? ta.style.align : tb.style.align,
        verticalAlign: t < 0.5 ? ta.style.verticalAlign : tb.style.verticalAlign,
        lineHeight: lerp(ta.style.lineHeight, tb.style.lineHeight, t),
      },
    } as TextElement;
  }

  // Shape elements
  if (a.type === 'shape' && b.type === 'shape') {
    const sa = a as ShapeElement;
    const sb = b as ShapeElement;
    return {
      ...base,
      type: 'shape',
      shapeType: t < 0.5 ? sa.shapeType : sb.shapeType,
      fill: lerpColor(sa.fill, sb.fill, t),
      stroke: lerpColor(sa.stroke, sb.stroke, t),
      strokeWidth: lerp(sa.strokeWidth, sb.strokeWidth, t),
      cornerRadius: lerp(sa.cornerRadius, sb.cornerRadius, t),
      points: sa.points && sb.points ? lerpPoints(sa.points, sb.points, t) : (t < 0.5 ? sa.points : sb.points),
      startBinding: t < 0.5 ? sa.startBinding : sb.startBinding,
      endBinding: t < 0.5 ? sa.endBinding : sb.endBinding,
    } as ShapeElement;
  }

  // Image elements
  if (a.type === 'image' && b.type === 'image') {
    const ia = a as ImageElement;
    const ib = b as ImageElement;

    // If resourceId changes, snap crop values along with it to avoid visual movement
    const resourceChanges = ia.resourceId !== ib.resourceId;
    const useFirst = t < 0.5;

    return {
      ...base,
      type: 'image',
      resourceId: useFirst ? ia.resourceId : ib.resourceId,
      // Snap crop values when resource changes, otherwise interpolate for crop animations
      cropX: resourceChanges ? (useFirst ? ia.cropX : ib.cropX) : lerp(ia.cropX, ib.cropX, t),
      cropY: resourceChanges ? (useFirst ? ia.cropY : ib.cropY) : lerp(ia.cropY, ib.cropY, t),
      cropWidth: resourceChanges ? (useFirst ? ia.cropWidth : ib.cropWidth) : lerp(ia.cropWidth, ib.cropWidth, t),
      cropHeight: resourceChanges ? (useFirst ? ia.cropHeight : ib.cropHeight) : lerp(ia.cropHeight, ib.cropHeight, t),
      // Also snap video playback properties when resource changes
      playing: useFirst ? ia.playing : ib.playing,
      loop: useFirst ? ia.loop : ib.loop,
      muted: useFirst ? ia.muted : ib.muted,
      startTime: useFirst ? ia.startTime : ib.startTime,
    } as ImageElement;
  }

  // Fallback: snap at midpoint
  return (t < 0.5 ? { ...a } : { ...b }) as SlideElement;
}

// Build an interpolated element for visibility transitions
export function interpolateWithVisibility(
  elA: SlideElement | undefined,
  elB: SlideElement | undefined,
  t: number,
): SlideElement | null {
  const aVisible = elA && elA.visible;
  const bVisible = elB && elB.visible;

  if (!aVisible && !bVisible) return null;

  if (aVisible && bVisible) {
    return interpolateElement(elA, elB, t);
  }

  if (aVisible && !bVisible) {
    // Fade out: tween opacity to 0
    return { ...elA, opacity: lerp(elA.opacity, 0, t), visible: true } as SlideElement;
  }

  // !aVisible && bVisible: fade in
  const target = elB!;
  return { ...target, opacity: lerp(0, target.opacity, t), visible: true } as SlideElement;
}
