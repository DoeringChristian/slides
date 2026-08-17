import { describe, expect, test } from 'vitest';
import {
  lerp,
  lerpColor,
  interpolateElement,
  interpolateWithVisibility,
  defaultVisibilityEasing,
  type WriteEffect,
  type TextDissolveSource,
  type CrossfadeSource,
} from './interpolation';
import type {
  SlideElement,
  TextElement,
  ShapeElement,
  ImageElement,
} from '../types/presentation';

// =============================================================================
// Element factories — full required field sets, overridable per test.
// =============================================================================

function makeShape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 'el-shape',
    type: 'shape',
    shapeType: 'rect',
    x: 0, y: 0, width: 100, height: 50,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2, cornerRadius: 0,
    ...overrides,
  };
}

function makeText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    x: 10, y: 20, width: 300, height: 80,
    rotation: 0, opacity: 1, locked: false, visible: true,
    text: 'hello',
    style: {
      fontFamily: 'Inter', fontSize: 24,
      fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
      color: '#000000', align: 'left', verticalAlign: 'top', lineHeight: 1.2,
    },
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    id: 'el-img',
    type: 'image',
    x: 0, y: 0, width: 200, height: 100,
    rotation: 0, opacity: 1, locked: false, visible: true,
    resourceId: 'res-a',
    cropX: 0, cropY: 0, cropWidth: 400, cropHeight: 200,
    ...overrides,
  };
}

type WithFx = SlideElement & { _writeFx?: WriteEffect };
type WithDissolveText = TextElement & { _dissolveText?: TextDissolveSource };
type WithDissolveImage = ImageElement & { _dissolveSource?: CrossfadeSource };
type WithArrowAlpha = ShapeElement & { _startArrowAlpha?: number; _endArrowAlpha?: number };

// =============================================================================
// lerp / lerpColor primitives
// =============================================================================

describe('lerp', () => {
  test('endpoints are exact and midpoints linear', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBeCloseTo(2.5);
    expect(lerp(-5, 5, 0.5)).toBeCloseTo(0);
  });
});

describe('lerpColor', () => {
  test('hex endpoints round-trip exactly (lowercase 6-digit)', () => {
    expect(lerpColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(lerpColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  test('midpoint of black→white is mid-grey', () => {
    // 127.5 rounds to 128 = 0x80 per channel.
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  test('3-digit hex is expanded before interpolation', () => {
    expect(lerpColor('#f00', '#00f', 0)).toBe('#ff0000');
    expect(lerpColor('#f00', '#00f', 1)).toBe('#0000ff');
  });

  test('non-hex colors snap at the midpoint instead of blending', () => {
    expect(lerpColor('red', 'blue', 0.49)).toBe('red');
    expect(lerpColor('red', 'blue', 0.5)).toBe('blue');
    expect(lerpColor('', '#ffffff', 0.4)).toBe('');
  });
});

// =============================================================================
// Rotation — shortest-arc angle interpolation (via the public
// interpolateElement path; lerpAngle itself is private).
// =============================================================================

describe('rotation takes the shortest arc', () => {
  const rotAt = (a: number, b: number, t: number): number => {
    const out = interpolateElement(makeShape({ rotation: a }), makeShape({ rotation: b }), t);
    return out.rotation;
  };
  // Angles are equivalent mod 360; the renderer only cares about congruence.
  const norm = (deg: number) => ((deg % 360) + 360) % 360;

  test('no-wrap case interpolates directly', () => {
    expect(rotAt(0, 90, 0.5)).toBeCloseTo(45);
    expect(rotAt(0, 90, 0)).toBeCloseTo(0);
    expect(rotAt(0, 90, 1)).toBeCloseTo(90);
  });

  test('350° → 10° goes forward through 0°, not backward through 180°', () => {
    // Shortest delta is +20°, so midpoint is 360 ≡ 0, not 180.
    expect(norm(rotAt(350, 10, 0.5))).toBeCloseTo(0);
    expect(norm(rotAt(350, 10, 0.25))).toBeCloseTo(355);
    expect(norm(rotAt(350, 10, 1))).toBeCloseTo(10);
  });

  test('10° → 350° goes backward through 0°', () => {
    expect(norm(rotAt(10, 350, 0.5))).toBeCloseTo(0);
    expect(norm(rotAt(10, 350, 1))).toBeCloseTo(350);
  });

  test('negative input angles are normalized first', () => {
    // -10 ≡ 350, so -10 → 10 sweeps +20° through zero.
    expect(norm(rotAt(-10, 10, 0.5))).toBeCloseTo(0);
    expect(norm(rotAt(-10, 10, 1))).toBeCloseTo(10);
  });

  test('exactly-opposite angles (180° apart) do not flip direction', () => {
    // delta of exactly +180 keeps the forward sweep.
    expect(norm(rotAt(0, 180, 0.5))).toBeCloseTo(90);
  });
});

// =============================================================================
// interpolateElement — endpoint exactness at t=0 / t=1
// =============================================================================

describe('interpolateElement endpoints', () => {
  const a = makeShape({ x: 0, y: 10, width: 100, height: 50, opacity: 0.25, fill: '#112233', stroke: '#445566', strokeWidth: 1, rotation: 0 });
  const b = makeShape({ x: 40, y: 90, width: 300, height: 150, opacity: 0.75, fill: '#aabbcc', stroke: '#ddeeff', strokeWidth: 9, rotation: 45 });

  test('t=0 returns the source position/size/opacity/fill exactly', () => {
    const out = interpolateElement(a, b, 0) as ShapeElement;
    expect(out.x).toBe(0);
    expect(out.y).toBe(10);
    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    expect(out.opacity).toBe(0.25);
    expect(out.fill).toBe('#112233');
    expect(out.stroke).toBe('#445566');
    expect(out.strokeWidth).toBe(1);
    expect(out.rotation).toBeCloseTo(0);
  });

  test('t=1 returns the target position/size/opacity/fill exactly', () => {
    const out = interpolateElement(a, b, 1) as ShapeElement;
    expect(out.x).toBe(40);
    expect(out.y).toBe(90);
    expect(out.width).toBe(300);
    expect(out.height).toBe(150);
    expect(out.opacity).toBe(0.75);
    expect(out.fill).toBe('#aabbcc');
    expect(out.stroke).toBe('#ddeeff');
    expect(out.strokeWidth).toBe(9);
    expect(out.rotation).toBeCloseTo(45);
  });

  test('t=0.5 with default (linear) easing is the arithmetic midpoint', () => {
    const out = interpolateElement(a, b, 0.5) as ShapeElement;
    expect(out.x).toBeCloseTo(20);
    expect(out.width).toBeCloseTo(200);
    expect(out.opacity).toBeCloseTo(0.5);
  });

  test('interpolated element is always marked visible', () => {
    expect(interpolateElement(a, b, 0.3).visible).toBe(true);
  });

  test('text: default content easing snaps text at midpoint, lerps fontSize', () => {
    const ta = makeText({ text: 'old', style: { ...makeText().style, fontSize: 10 } });
    const tb = makeText({ text: 'new', style: { ...makeText().style, fontSize: 30 } });
    const at0 = interpolateElement(ta, tb, 0) as TextElement;
    const at49 = interpolateElement(ta, tb, 0.49) as TextElement;
    const at50 = interpolateElement(ta, tb, 0.5) as TextElement;
    const at1 = interpolateElement(ta, tb, 1) as TextElement;
    expect(at0.text).toBe('old');
    expect(at49.text).toBe('old');
    expect(at50.text).toBe('new');
    expect(at1.text).toBe('new');
    expect(at0.style.fontSize).toBe(10);
    expect(at1.style.fontSize).toBe(30);
    expect(interpolateElement(ta, tb, 0.5).type === 'text' && (interpolateElement(ta, tb, 0.5) as TextElement).style.fontSize).toBeCloseTo(20);
  });

  test('image: crop values hit source at t=0 and target at t=1 (same resource)', () => {
    const ia = makeImage({ cropX: 0, cropY: 0, cropWidth: 400, cropHeight: 200 });
    const ib = makeImage({ cropX: 40, cropY: 20, cropWidth: 200, cropHeight: 100 });
    const at0 = interpolateElement(ia, ib, 0) as ImageElement;
    const at1 = interpolateElement(ia, ib, 1) as ImageElement;
    expect(at0.cropX).toBe(0);
    expect(at0.cropWidth).toBe(400);
    expect(at1.cropX).toBe(40);
    expect(at1.cropWidth).toBe(200);
  });

  test('mismatched element types snap at the midpoint (fallback)', () => {
    const s = makeShape();
    const txt = makeText();
    expect(interpolateElement(s, txt, 0.49).type).toBe('shape');
    expect(interpolateElement(s, txt, 0.5).type).toBe('text');
  });
});

// =============================================================================
// Easing curves via the public position path
// =============================================================================

describe('easing curves', () => {
  const withEasing = (easing: 'ease' | 'const' | 'linear') => {
    const a = makeShape({ x: 0 });
    const b = makeShape({ x: 100, transitions: { position: easing } });
    return (t: number) => interpolateElement(a, b, t).x;
  };

  test("'ease' (easeInOutCubic) is monotonically non-decreasing with exact endpoints", () => {
    const x = withEasing('ease');
    expect(x(0)).toBe(0);
    expect(x(1)).toBe(100);
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = x(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Symmetric S-curve: midpoint is exactly halfway.
    expect(x(0.5)).toBeCloseTo(50);
    // Ease-in: slower than linear early on.
    expect(x(0.25)).toBeLessThan(25);
    // Ease-out: closer to target than linear late.
    expect(x(0.75)).toBeGreaterThan(75);
  });

  test("'linear' easing is the identity ramp", () => {
    const x = withEasing('linear');
    expect(x(0.3)).toBeCloseTo(30);
    expect(x(0.7)).toBeCloseTo(70);
  });

  test("'const' easing snaps at the midpoint", () => {
    const x = withEasing('const');
    expect(x(0)).toBe(0);
    expect(x(0.499)).toBe(0);
    expect(x(0.5)).toBe(100);
    expect(x(1)).toBe(100);
  });

  test('backward transitions read easing from the source element (isForward=false)', () => {
    // Backward playback swaps a/b, so the settings live on what is now `a`.
    const a = makeShape({ x: 0, transitions: { position: 'const' } });
    const b = makeShape({ x: 100 });
    expect(interpolateElement(a, b, 0.3, false).x).toBe(0);
    expect(interpolateElement(a, b, 0.7, false).x).toBe(100);
    // Forward, the same pair uses b's (unset → linear) easing.
    expect(interpolateElement(a, b, 0.3, true).x).toBeCloseTo(30);
  });
});

// =============================================================================
// Text content transitions
// =============================================================================

describe('text content transitions', () => {
  test("content='dissolve' crossfades: target text plus _dissolveText source with sqrt curves", () => {
    const ta = makeText({ text: 'old', opacity: 0.8 });
    const tb = makeText({ text: 'new', opacity: 0.8, transitions: { content: 'dissolve' } });
    const out = interpolateElement(ta, tb, 0.25) as WithDissolveText;
    expect(out.text).toBe('new');
    // opacity = baseOpacity * sqrt(t); dissolve source = baseOpacity * sqrt(1-t)
    expect(out.opacity).toBeCloseTo(0.8 * Math.sqrt(0.25));
    expect(out._dissolveText).toBeDefined();
    expect(out._dissolveText!.text).toBe('old');
    expect(out._dissolveText!.opacity).toBeCloseTo(0.8 * Math.sqrt(0.75));
  });

  test("content='write' attaches an 'in' _writeFx spanning the full window (snap-clear default)", () => {
    const ta = makeText({ text: 'old' });
    const tb = makeText({ text: 'new', transitions: { content: 'write' } });
    const out = interpolateElement(ta, tb, 0.3) as WithFx & TextElement;
    // write defaults to undoFirst=false: target text from t=0+, reveal over full duration.
    expect(out.text).toBe('new');
    expect(out._writeFx).toEqual({ t: 0.3, direction: 'in', mode: 'write' });
  });

  test("content='typewriter' defaults to delete-then-type (undoFirst) with out/in halves", () => {
    const ta = makeText({ text: 'old' });
    const tb = makeText({ text: 'new', transitions: { content: 'typewriter' } });
    const firstHalf = interpolateElement(ta, tb, 0.25) as WithFx & TextElement;
    expect(firstHalf.text).toBe('old');
    expect(firstHalf._writeFx).toBeDefined();
    expect(firstHalf._writeFx!.direction).toBe('out');
    expect(firstHalf._writeFx!.mode).toBe('typewriter');
    expect(firstHalf._writeFx!.t).toBeCloseTo(0.5); // 1 - 2*0.25

    const secondHalf = interpolateElement(ta, tb, 0.75) as WithFx & TextElement;
    expect(secondHalf.text).toBe('new');
    expect(secondHalf._writeFx!.direction).toBe('in');
    expect(secondHalf._writeFx!.t).toBeCloseTo(0.5); // (0.75-0.5)*2
  });

  test('unchanged text never gets a _writeFx even with a glyph easing set', () => {
    const ta = makeText({ text: 'same' });
    const tb = makeText({ text: 'same', transitions: { content: 'write' } });
    const out = interpolateElement(ta, tb, 0.5) as WithFx;
    expect(out._writeFx).toBeUndefined();
  });
});

// =============================================================================
// Image resource transitions
// =============================================================================

describe('image resource change', () => {
  test('default dissolve renders both resources with sqrt alpha curves', () => {
    const ia = makeImage({ resourceId: 'res-a', cropX: 1, cropY: 2, cropWidth: 3, cropHeight: 4 });
    const ib = makeImage({ resourceId: 'res-b', cropX: 5, cropY: 6, cropWidth: 7, cropHeight: 8 });
    const out = interpolateElement(ia, ib, 0.25) as WithDissolveImage;
    expect(out.resourceId).toBe('res-b');
    expect(out.opacity).toBeCloseTo(Math.sqrt(0.25));
    // Crop snaps to the target when the resource changes.
    expect(out.cropX).toBe(5);
    expect(out._dissolveSource).toEqual({
      resourceId: 'res-a',
      opacity: Math.sqrt(0.75),
      cropX: 1, cropY: 2, cropWidth: 3, cropHeight: 4,
    });
  });

  test("resource='const' snaps resource and crop at the midpoint with no dissolve source", () => {
    const ia = makeImage({ resourceId: 'res-a', cropX: 1 });
    const ib = makeImage({ resourceId: 'res-b', cropX: 5, transitions: { resource: 'const' } });
    const before = interpolateElement(ia, ib, 0.4) as WithDissolveImage;
    const after = interpolateElement(ia, ib, 0.6) as WithDissolveImage;
    expect(before.resourceId).toBe('res-a');
    expect(before.cropX).toBe(1);
    expect(before._dissolveSource).toBeUndefined();
    expect(after.resourceId).toBe('res-b');
    expect(after.cropX).toBe(5);
  });

  test("resource='fadeinout' dips opacity to 0 at the midpoint", () => {
    const ia = makeImage({ resourceId: 'res-a' });
    const ib = makeImage({ resourceId: 'res-b', transitions: { resource: 'fadeinout' } });
    expect((interpolateElement(ia, ib, 0.25) as ImageElement).opacity).toBeCloseTo(0.5);
    expect((interpolateElement(ia, ib, 0.5) as ImageElement).opacity).toBeCloseTo(0);
    expect((interpolateElement(ia, ib, 0.75) as ImageElement).opacity).toBeCloseTo(0.5);
  });
});

// =============================================================================
// Path-shape specifics: points, morphing, arrow alpha
// =============================================================================

describe('path shape interpolation', () => {
  test('same-length point lists lerp pairwise', () => {
    const sa = makeShape({ shapeType: 'path', points: [0, 0, 100, 0] });
    const sb = makeShape({ shapeType: 'path', points: [0, 0, 100, 100] });
    const out = interpolateElement(sa, sb, 0.5) as ShapeElement;
    expect(out.points).toEqual([0, 0, 100, 50]);
  });

  test('curve/closed mismatch morphs through an open linear polyline mid-flight', () => {
    const sa = makeShape({ shapeType: 'path', points: [0, 0, 100, 0], curve: 'linear', closed: false });
    const sb = makeShape({ shapeType: 'path', points: [0, 0, 100, 0, 100, 100, 0, 100], curve: 'bspline3', closed: true });
    const mid = interpolateElement(sa, sb, 0.5) as ShapeElement;
    // In-flight rendering contract: plain open linear polyline.
    expect(mid.curve).toBe('linear');
    expect(mid.closed).toBe(false);
    expect(mid.points).toBeDefined();
    expect(mid.points!.length % 2).toBe(0);
    expect(mid.points!.length).toBeGreaterThan(4);
    // End states keep the original curve/closed and exact points.
    const at0 = interpolateElement(sa, sb, 0) as ShapeElement;
    const at1 = interpolateElement(sa, sb, 1) as ShapeElement;
    expect(at0.curve).toBe('linear');
    expect(at0.closed).toBe(false);
    expect(at0.points).toEqual(sa.points);
    expect(at1.curve).toBe('bspline3');
    expect(at1.closed).toBe(true);
    expect(at1.points).toEqual(sb.points);
  });

  test('endArrow easing produces a numeric _endArrowAlpha; without easing it snaps', () => {
    const sa = makeShape({ shapeType: 'path', points: [0, 0, 100, 0], endArrow: false });
    const sbEased = makeShape({ shapeType: 'path', points: [0, 0, 100, 0], endArrow: true, transitions: { endArrow: 'linear' } });
    const eased = interpolateElement(sa, sbEased, 0.3) as WithArrowAlpha;
    expect(eased._endArrowAlpha).toBeCloseTo(0.3);
    expect(eased._startArrowAlpha).toBeUndefined(); // startArrow agrees on both sides

    const sbSnap = makeShape({ shapeType: 'path', points: [0, 0, 100, 0], endArrow: true });
    const snapped = interpolateElement(sa, sbSnap, 0.3) as WithArrowAlpha;
    expect(snapped._endArrowAlpha).toBeUndefined();
    expect(snapped.endArrow).toBe(false); // boolean snaps at t=0.5
    expect((interpolateElement(sa, sbSnap, 0.7) as ShapeElement).endArrow).toBe(true);
  });
});

// =============================================================================
// defaultVisibilityEasing
// =============================================================================

describe('defaultVisibilityEasing', () => {
  test("path shapes default to 'create', everything else to 'linear'", () => {
    expect(defaultVisibilityEasing(makeShape({ shapeType: 'path', points: [0, 0, 1, 1] }))).toBe('create');
    expect(defaultVisibilityEasing(makeShape({ shapeType: 'rect' }))).toBe('linear');
    expect(defaultVisibilityEasing(makeText())).toBe('linear');
    expect(defaultVisibilityEasing(undefined)).toBe('linear');
  });
});

// =============================================================================
// interpolateWithVisibility — appear / disappear
// =============================================================================

describe('interpolateWithVisibility', () => {
  test('absent (or invisible) on both sides yields null', () => {
    expect(interpolateWithVisibility(undefined, undefined, 0.5)).toBeNull();
    expect(interpolateWithVisibility(makeText({ visible: false }), makeText({ visible: false }), 0.5)).toBeNull();
  });

  test('visible on both sides delegates to interpolateElement', () => {
    const a = makeShape({ x: 0 });
    const b = makeShape({ x: 100 });
    expect(interpolateWithVisibility(a, b, 0.5)!.x).toBeCloseTo(50);
  });

  test('appearing element with default linear fade: hidden until t=0.5, then ramps 0 → full', () => {
    const b = makeText({ opacity: 0.8 });
    expect(interpolateWithVisibility(undefined, b, 0)).toBeNull();
    expect(interpolateWithVisibility(undefined, b, 0.25)).toBeNull();
    expect(interpolateWithVisibility(undefined, b, 0.5)!.opacity).toBeCloseTo(0);
    expect(interpolateWithVisibility(undefined, b, 0.75)!.opacity).toBeCloseTo(0.4);
    const done = interpolateWithVisibility(undefined, b, 1)!;
    expect(done.opacity).toBeCloseTo(0.8);
    expect(done.visible).toBe(true);
  });

  test('disappearing element with default linear fade: ramps full → 0 by t=0.5, then null', () => {
    const a = makeText({ opacity: 0.8 });
    expect(interpolateWithVisibility(a, undefined, 0)!.opacity).toBeCloseTo(0.8);
    expect(interpolateWithVisibility(a, undefined, 0.25)!.opacity).toBeCloseTo(0.4);
    expect(interpolateWithVisibility(a, undefined, 0.5)).toBeNull();
    expect(interpolateWithVisibility(a, undefined, 1)).toBeNull();
  });

  test('visible:false is treated the same as an absent element', () => {
    const a = makeText({ opacity: 1 });
    const bHidden = makeText({ visible: false });
    // a → hidden b behaves like a → undefined (fade out).
    expect(interpolateWithVisibility(a, bHidden, 0.25)!.opacity).toBeCloseTo(0.5);
    expect(interpolateWithVisibility(a, bHidden, 0.75)).toBeNull();
  });

  test("appearing with visibility='wipe' spans the FULL window via _writeFx", () => {
    const b = makeText({
      transitions: { visibility: 'wipe', visibilityOptions: { wipe: { from: 'left' } } },
    });
    // Wrapper animations start at t=0 — no hidden first half.
    const early = interpolateWithVisibility(undefined, b, 0.1) as WithFx;
    expect(early).not.toBeNull();
    expect(early._writeFx).toEqual({ t: 0.1, direction: 'in', mode: 'wipe', from: 'left' });
    const late = interpolateWithVisibility(undefined, b, 0.9) as WithFx;
    expect(late._writeFx!.t).toBeCloseTo(0.9);
    expect(late.opacity).toBe(b.opacity); // opacity untouched; the wrapper clips instead
  });

  test("appearing with visibility='write' attaches a write _writeFx", () => {
    const b = makeText({ transitions: { visibility: 'write' } });
    const out = interpolateWithVisibility(undefined, b, 0.4) as WithFx;
    expect(out._writeFx).toEqual({ t: 0.4, direction: 'in', mode: 'write' });
  });

  test("appearing path shape defaults to 'create' with tipDraw from options", () => {
    const plain = makeShape({ shapeType: 'path', points: [0, 0, 100, 0] });
    const out = interpolateWithVisibility(undefined, plain, 0.3) as WithFx;
    expect(out._writeFx).toEqual({ t: 0.3, direction: 'in', mode: 'create', tipDraw: undefined });

    const tipped = makeShape({
      shapeType: 'path', points: [0, 0, 100, 0], endArrow: true,
      transitions: { visibility: 'create', visibilityOptions: { create: { tipDraw: true } } },
    });
    const tippedOut = interpolateWithVisibility(undefined, tipped, 0.3) as WithFx;
    expect(tippedOut._writeFx!.tipDraw).toBe(true);
  });

  test('disappearing path shape runs create in reverse (t mirrored, direction out)', () => {
    const a = makeShape({ shapeType: 'path', points: [0, 0, 100, 0] });
    const out = interpolateWithVisibility(a, undefined, 0.25) as WithFx;
    expect(out._writeFx!.mode).toBe('create');
    expect(out._writeFx!.direction).toBe('out');
    expect(out._writeFx!.t).toBeCloseTo(0.75); // 1 - t
    // Unlike the fade ramp, wrapper/draw animations persist past t=0.5.
    expect(interpolateWithVisibility(a, undefined, 0.9)).not.toBeNull();
  });

  test("appearing with visibility='grow'/'iris' forwards their options", () => {
    const grow = makeText({ transitions: { visibility: 'grow', visibilityOptions: { grow: { anchor: 'top-left' } } } });
    expect((interpolateWithVisibility(undefined, grow, 0.5) as WithFx)._writeFx)
      .toEqual({ t: 0.5, direction: 'in', mode: 'grow', anchor: 'top-left' });
    const iris = makeText({ transitions: { visibility: 'iris', visibilityOptions: { iris: { cx: 0.2, cy: 0.8 } } } });
    expect((interpolateWithVisibility(undefined, iris, 0.5) as WithFx)._writeFx)
      .toEqual({ t: 0.5, direction: 'in', mode: 'iris', cx: 0.2, cy: 0.8 });
  });
});
