import type { SlideElement, TextElement, ShapeElement, ImageElement, EasingType } from '../types/presentation';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Easing functions
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Apply easing based on type
function applyEasing(t: number, easing: EasingType | undefined): number {
  switch (easing) {
    case 'const': return t < 0.5 ? 0 : 1;  // Snap at midpoint
    case 'ease': return easeInOutCubic(t);
    case 'crossfade': return t;  // Handled separately for opacity
    case 'linear':
    default: return t;
  }
}

// Lerp with easing applied
function lerpEased(a: number, b: number, t: number, easing: EasingType | undefined): number {
  return lerp(a, b, applyEasing(t, easing));
}

// Color lerp with easing applied
function lerpColorEased(a: string, b: string, t: number, easing: EasingType | undefined): string {
  return lerpColor(a, b, applyEasing(t, easing));
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

// Calculate crossfade opacity for content changes
// First half: fade out (1 -> 0), Second half: fade in (0 -> 1)
function crossfadeOpacity(baseOpacity: number, t: number, contentChanges: boolean): number {
  if (!contentChanges) return baseOpacity;
  if (t < 0.5) {
    // Fade out: opacity goes from baseOpacity to 0 as t goes from 0 to 0.5
    return baseOpacity * (1 - t * 2);
  } else {
    // Fade in: opacity goes from 0 to baseOpacity as t goes from 0.5 to 1
    return baseOpacity * ((t - 0.5) * 2);
  }
}

export function interpolateElement(a: SlideElement, b: SlideElement, t: number): SlideElement {
  // Get transition settings from destination element (b)
  const tr = b.transitions || {};

  // Base element properties with per-property easing
  const baseOpacity = lerpEased(a.opacity, b.opacity, t, tr.opacity);
  const base = {
    ...a,
    x: lerpEased(a.x, b.x, t, tr.position),
    y: lerpEased(a.y, b.y, t, tr.position),
    width: lerpEased(a.width, b.width, t, tr.size),
    height: lerpEased(a.height, b.height, t, tr.size),
    rotation: lerpEased(a.rotation, b.rotation, t, tr.rotation),
    opacity: baseOpacity,
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
        fontSize: lerpEased(ta.style.fontSize, tb.style.fontSize, t, tr.fontSize),
        fontWeight: t < 0.5 ? ta.style.fontWeight : tb.style.fontWeight,
        fontStyle: t < 0.5 ? ta.style.fontStyle : tb.style.fontStyle,
        textDecoration: t < 0.5 ? ta.style.textDecoration : tb.style.textDecoration,
        color: lerpColorEased(ta.style.color, tb.style.color, t, tr.color),
        align: t < 0.5 ? ta.style.align : tb.style.align,
        verticalAlign: t < 0.5 ? ta.style.verticalAlign : tb.style.verticalAlign,
        lineHeight: lerpEased(ta.style.lineHeight, tb.style.lineHeight, t, tr.lineHeight),
      },
    } as TextElement;
  }

  // Shape elements
  if (a.type === 'shape' && b.type === 'shape') {
    const sa = a as ShapeElement;
    const sb = b as ShapeElement;
    const fillT = applyEasing(t, tr.fill);
    const strokeT = applyEasing(t, tr.stroke);
    return {
      ...base,
      type: 'shape',
      shapeType: t < 0.5 ? sa.shapeType : sb.shapeType,
      fill: lerpColor(sa.fill, sb.fill, fillT),
      stroke: lerpColor(sa.stroke, sb.stroke, strokeT),
      strokeWidth: lerpEased(sa.strokeWidth, sb.strokeWidth, t, tr.strokeWidth),
      cornerRadius: lerpEased(sa.cornerRadius, sb.cornerRadius, t, tr.cornerRadius),
      points: sa.points && sb.points ? lerpPoints(sa.points, sb.points, t) : (t < 0.5 ? sa.points : sb.points),
      startBinding: t < 0.5 ? sa.startBinding : sb.startBinding,
      endBinding: t < 0.5 ? sa.endBinding : sb.endBinding,
    } as ShapeElement;
  }

  // Image elements
  if (a.type === 'image' && b.type === 'image') {
    const ia = a as ImageElement;
    const ib = b as ImageElement;

    // Check if resourceId changes
    const resourceChanges = ia.resourceId !== ib.resourceId;
    const useFirst = t < 0.5;

    // Determine resource transition behavior (default to const when resource changes)
    const resourceEasing = tr.resource ?? 'const';
    const useCrossfade = resourceChanges && resourceEasing === 'crossfade';

    // For crop: if resource changes, snap values; otherwise interpolate with easing
    const cropT = applyEasing(t, tr.crop);

    return {
      ...base,
      type: 'image',
      resourceId: useFirst ? ia.resourceId : ib.resourceId,
      // Crossfade opacity when resource changes and using crossfade easing
      opacity: useCrossfade ? crossfadeOpacity(baseOpacity, t, true) : baseOpacity,
      // Snap crop values when resource changes, otherwise interpolate with easing
      cropX: resourceChanges ? (useFirst ? ia.cropX : ib.cropX) : lerp(ia.cropX, ib.cropX, cropT),
      cropY: resourceChanges ? (useFirst ? ia.cropY : ib.cropY) : lerp(ia.cropY, ib.cropY, cropT),
      cropWidth: resourceChanges ? (useFirst ? ia.cropWidth : ib.cropWidth) : lerp(ia.cropWidth, ib.cropWidth, cropT),
      cropHeight: resourceChanges ? (useFirst ? ia.cropHeight : ib.cropHeight) : lerp(ia.cropHeight, ib.cropHeight, cropT),
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
