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
    case 'dissolve': return t;  // Handled separately for opacity
    case 'linear':
    default: return t;
  }
}

// Lerp with easing applied
function lerpEased(a: number, b: number, t: number, easing: EasingType | undefined): number {
  return lerp(a, b, applyEasing(t, easing));
}

// Lerp angles via the shortest path (handles wrapping around 360°)
function lerpAngle(a: number, b: number, t: number): number {
  // Normalize both to [0, 360)
  a = ((a % 360) + 360) % 360;
  b = ((b % 360) + 360) % 360;
  // Shortest angular distance
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return a + delta * t;
}

function lerpAngleEased(a: number, b: number, t: number, easing: EasingType | undefined): number {
  return lerpAngle(a, b, applyEasing(t, easing));
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

// Typewriter text interpolation
// Finds common prefix/suffix and animates the changing part
function interpolateTextTypewriter(a: string, b: string, t: number): string {
  if (a === b) return a;

  // Find common prefix
  let prefixLen = 0;
  while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (after prefix)
  let suffixLen = 0;
  while (
    suffixLen < a.length - prefixLen &&
    suffixLen < b.length - prefixLen &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = a.slice(0, prefixLen);
  const suffix = a.slice(a.length - suffixLen);
  const aMiddle = a.slice(prefixLen, a.length - suffixLen);
  const bMiddle = b.slice(prefixLen, b.length - suffixLen);

  // If only adding or removing text (no middle change on one side)
  if (aMiddle.length === 0) {
    // Pure addition: type out bMiddle
    const charsToShow = Math.round(bMiddle.length * t);
    return prefix + bMiddle.slice(0, charsToShow) + suffix;
  }

  if (bMiddle.length === 0) {
    // Pure deletion: backspace aMiddle
    const charsToKeep = Math.round(aMiddle.length * (1 - t));
    return prefix + aMiddle.slice(0, charsToKeep) + suffix;
  }

  // Both have middle content - do a two-phase animation:
  // First half: delete old middle, Second half: type new middle
  if (t < 0.5) {
    // Deleting phase
    const deleteT = t * 2;
    const charsToKeep = Math.round(aMiddle.length * (1 - deleteT));
    return prefix + aMiddle.slice(0, charsToKeep) + suffix;
  } else {
    // Typing phase
    const typeT = (t - 0.5) * 2;
    const charsToShow = Math.round(bMiddle.length * typeT);
    return prefix + bMiddle.slice(0, charsToShow) + suffix;
  }
}

// Text content interpolation result
interface TextInterpolation {
  text: string;
  opacityMultiplier: number; // 1 = normal, <1 = fading
  dissolveSource?: { text: string; opacityMultiplier: number }; // For crossfade dissolve
}

// Interpolate text based on easing type
function interpolateText(a: string, b: string, t: number, easing: EasingType | undefined): TextInterpolation {
  if (a === b) return { text: a, opacityMultiplier: 1 };

  switch (easing) {
    case 'typewriter':
      // Typewriter effect with easing
      return { text: interpolateTextTypewriter(a, b, easeInOutCubic(t)), opacityMultiplier: 1 };

    case 'dissolve':
    case 'linear':
    case 'ease':
      // Crossfade dissolve: render both old and new text simultaneously
      // Using sqrt curves like image dissolve for smooth blending
      return {
        text: b,
        opacityMultiplier: Math.sqrt(t),
        dissolveSource: { text: a, opacityMultiplier: Math.sqrt(1 - t) },
      };

    case 'const':
    default:
      // Snap at midpoint
      return { text: t < 0.5 ? a : b, opacityMultiplier: 1 };
  }
}

// Calculate fadeinout opacity for content changes
// First half: fade out (1 -> 0), Second half: fade in (0 -> 1)
function fadeinoutOpacity(baseOpacity: number, t: number): number {
  if (t < 0.5) {
    // Fade out: opacity goes from baseOpacity to 0 as t goes from 0 to 0.5
    return baseOpacity * (1 - t * 2);
  } else {
    // Fade in: opacity goes from 0 to baseOpacity as t goes from 0.5 to 1
    return baseOpacity * ((t - 0.5) * 2);
  }
}

// Dissolve source info for text crossfade
export interface TextDissolveSource {
  text: string;
  opacity: number;
}

// Crossfade source info for rendering both source and target
export interface CrossfadeSource {
  resourceId: string | null | undefined;
  opacity: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export function interpolateElement(a: SlideElement, b: SlideElement, t: number, isForward: boolean = true): SlideElement {
  // Get transition settings from the element that was the "target" in forward direction
  // Forward: A→B, use B's transitions
  // Backward: B→A (but A and B are swapped), so use A's transitions (which is now 'a')
  const tr = isForward ? (b.transitions || {}) : (a.transitions || {});

  // Base element properties with per-property easing
  const baseOpacity = lerpEased(a.opacity, b.opacity, t, tr.opacity);
  const base = {
    ...a,
    x: lerpEased(a.x, b.x, t, tr.position),
    y: lerpEased(a.y, b.y, t, tr.position),
    width: lerpEased(a.width, b.width, t, tr.size),
    height: lerpEased(a.height, b.height, t, tr.size),
    rotation: lerpAngleEased(a.rotation, b.rotation, t, tr.rotation),
    opacity: baseOpacity,
    visible: true,
  };

  // Text elements
  if (a.type === 'text' && b.type === 'text') {
    const ta = a as TextElement;
    const tb = b as TextElement;
    const textResult = interpolateText(ta.text, tb.text, t, tr.content ?? 'dissolve');
    const result: TextElement & { _dissolveText?: TextDissolveSource } = {
      ...base,
      type: 'text',
      text: textResult.text,
      opacity: baseOpacity * textResult.opacityMultiplier,
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
    };
    if (textResult.dissolveSource) {
      result._dissolveText = {
        text: textResult.dissolveSource.text,
        opacity: baseOpacity * textResult.dissolveSource.opacityMultiplier,
      };
    }
    return result;
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

    // Determine resource transition behavior (default to dissolve)
    const resourceEasing = tr.resource ?? 'dissolve';

    // For crop: if resource changes, snap values; otherwise interpolate with easing
    const cropT = applyEasing(t, tr.crop);

    // Build base image result
    const result: ImageElement & { _dissolveSource?: CrossfadeSource } = {
      ...base,
      type: 'image',
      resourceId: ib.resourceId,
      cropX: resourceChanges ? ib.cropX : lerp(ia.cropX, ib.cropX, cropT),
      cropY: resourceChanges ? ib.cropY : lerp(ia.cropY, ib.cropY, cropT),
      cropWidth: resourceChanges ? ib.cropWidth : lerp(ia.cropWidth, ib.cropWidth, cropT),
      cropHeight: resourceChanges ? ib.cropHeight : lerp(ia.cropHeight, ib.cropHeight, cropT),
      playing: ib.playing,
      loop: ib.loop,
      muted: ib.muted,
      startTime: ib.startTime,
    };

    if (resourceChanges) {
      switch (resourceEasing) {
        case 'dissolve':
          // True dissolve: both images blend with curves that minimize lightening
          // Using sqrt curves: combined alpha stays above 0.9 throughout
          // sqrt(t) + sqrt(1-t) * (1 - sqrt(t)) ≈ 0.91 at midpoint
          const sqrtT = Math.sqrt(t);
          const sqrtOneMinusT = Math.sqrt(1 - t);
          result.opacity = baseOpacity * sqrtT;
          result._dissolveSource = {
            resourceId: ia.resourceId,
            opacity: baseOpacity * sqrtOneMinusT,
            cropX: ia.cropX,
            cropY: ia.cropY,
            cropWidth: ia.cropWidth,
            cropHeight: ia.cropHeight,
          };
          break;

        case 'fadeinout':
          // Fade out first half, fade in second half
          result.resourceId = useFirst ? ia.resourceId : ib.resourceId;
          result.opacity = fadeinoutOpacity(baseOpacity, t);
          result.cropX = useFirst ? ia.cropX : ib.cropX;
          result.cropY = useFirst ? ia.cropY : ib.cropY;
          result.cropWidth = useFirst ? ia.cropWidth : ib.cropWidth;
          result.cropHeight = useFirst ? ia.cropHeight : ib.cropHeight;
          break;

        case 'const':
        default:
          // Snap at midpoint
          result.resourceId = useFirst ? ia.resourceId : ib.resourceId;
          result.cropX = useFirst ? ia.cropX : ib.cropX;
          result.cropY = useFirst ? ia.cropY : ib.cropY;
          result.cropWidth = useFirst ? ia.cropWidth : ib.cropWidth;
          result.cropHeight = useFirst ? ia.cropHeight : ib.cropHeight;
          break;
      }
    }

    return result;
  }

  // Fallback: snap at midpoint
  return (t < 0.5 ? { ...a } : { ...b }) as SlideElement;
}

// Build an interpolated element for visibility transitions
// Fade-out happens in the first half (t: 0 -> 0.5)
// Fade-in happens in the second half (t: 0.5 -> 1)
export function interpolateWithVisibility(
  elA: SlideElement | undefined,
  elB: SlideElement | undefined,
  t: number,
  isForward: boolean = true,
): SlideElement | null {
  const aVisible = elA && elA.visible;
  const bVisible = elB && elB.visible;

  if (!aVisible && !bVisible) return null;

  if (aVisible && bVisible) {
    return interpolateElement(elA, elB, t, isForward);
  }

  // For visibility transitions, use the element that was "target" in forward direction
  // Forward: appearing element (B) has the transition settings
  // Backward: disappearing element (A, which was B in forward) has the settings
  if (aVisible && !bVisible) {
    // Fade out: completes at t=0.5, stays invisible after
    if (t >= 0.5) return null;
    // Map t from [0, 0.5] to [0, 1] for the fade-out
    const fadeOutT = t * 2;
    // When going backward, A was the target in forward direction, so use A's transitions
    // When going forward, B doesn't exist, so use A's transitions (fade-out stored on source)
    const easing = elA.transitions?.visibility;
    const easedT = applyEasing(fadeOutT, easing);
    return { ...elA, opacity: lerp(elA.opacity, 0, easedT), visible: true } as SlideElement;
  }

  // !aVisible && bVisible: fade in starts at t=0.5
  if (t < 0.5) return null;
  // Map t from [0.5, 1] to [0, 1] for the fade-in
  const fadeInT = (t - 0.5) * 2;
  const target = elB!;
  // When going forward, B is the target, use B's transitions
  // When going backward, A doesn't exist, use B's transitions
  const easing = target.transitions?.visibility;
  const easedT = applyEasing(fadeInT, easing);
  return { ...target, opacity: lerp(0, target.opacity, easedT), visible: true } as SlideElement;
}
