import { describe, expect, it } from 'vitest';
import { planLayerFade } from './layerFade';
import { interpolateWithVisibility } from './interpolation';
import { createImageElement, createShapeElement } from '../model/slideFactory';
import type { SlideElement } from '../../types/presentation';

const rect = (id: string, x: number, extra: Partial<SlideElement> = {}) =>
  createShapeElement('rect', { id, x, y: 100, width: 200, height: 200, strokeWidth: 0, ...extra } as never);
const exit = (el: SlideElement, t: number) => interpolateWithVisibility(el, { ...el, visible: false }, t)!;
const entry = (el: SlideElement, t: number) => interpolateWithVisibility({ ...el, visible: false }, el, t)!;
const noVideo = () => false;

describe('objects that fade together fade as one layer', () => {
  it('a and c disappear, b stays between them: one layer {a, c}, b drawn again over it', () => {
    // Stacking c (bottom), b, a (top); a covers both.
    const c = rect('c', 0), b = rect('b', 100), a = rect('a', 50, { width: 300 } as never);
    const frame = [exit(c, 0.25), b, exit(a, 0.25)];
    const plan = planLayerFade(frame, noVideo)!;
    expect(plan.alpha).toBeCloseTo(0.5);
    expect([...plan.members].sort()).toEqual(['a', 'c']);
    expect(plan.overlay).toEqual(['b']);
    expect(plan.opacity.get('a')).toBe(1);
  });

  it('objects above the layer are drawn once after it, not copied: a video on top keeps the layer', () => {
    const video = createImageElement(null, 200, 200, { id: 'v', x: 60, y: 100, width: 200, height: 200 });
    const b = rect('b', 100);
    const frame = [exit(rect('c', 0), 0.25), b, exit(rect('a', 50), 0.25), video];
    const plan = planLayerFade(frame, el => el.id === 'v')!;
    expect(plan.overlay).toEqual(['b']);
    expect(plan.drawnAfter).toBe(3);
  });

  it('keeps a member’s own opacity', () => {
    const a = rect('a', 0, { opacity: 0.6 } as never), c = rect('c', 50);
    const plan = planLayerFade([exit(c, 0.1), exit(a, 0.1)], noVideo)!;
    expect(plan.opacity.get('a')).toBe(0.6);
  });

  it('entrances form a layer too, with their own alpha', () => {
    const plan = planLayerFade([entry(rect('a', 0), 0.75), entry(rect('c', 50), 0.75)], noVideo)!;
    expect(plan.alpha).toBeCloseTo(0.5);
    expect(plan.members.size).toBe(2);
  });

  it('a lone fade over nothing that stays is left a plain fade', () => {
    expect(planLayerFade([rect('far', 1400), exit(rect('a', 0), 0.25)], noVideo)).toBeNull();
  });

  it('different easings: the larger set forms the layer, the rest fade on their own', () => {
    const eased = (el: SlideElement) => ({ ...el, transitions: { visibility: 'ease' as const } });
    const frame = [exit(eased(rect('c', 40)), 0.2), exit(rect('a', 0), 0.2), exit(rect('b', 20), 0.2)];
    const plan = planLayerFade(frame, noVideo)!;
    expect([...plan.members].sort()).toEqual(['a', 'b']);
    expect(plan.overlay).toEqual(['c']);
  });

  it('effects (wipe, write…) are not plain fades and stay out of the layer', () => {
    const wiped = { ...rect('w', 0), transitions: { visibility: 'wipe' as const } };
    expect((exit(wiped, 0.25) as { _layerFade?: unknown })._layerFade).toBeUndefined();
  });

  it('a fading video is in the layer (drawn once); objects over a staying video fade on their own', () => {
    const video = createImageElement(null, 200, 200, { id: 'v', x: 60, y: 100, width: 200, height: 200 });
    const isVideo = (el: SlideElement) => el.id === 'v';
    const fadingVideo = planLayerFade([exit(video, 0.25), exit(rect('a', 0), 0.25), exit(rect('c', 30), 0.25)], isVideo)!;
    expect([...fadingVideo.members].sort()).toEqual(['a', 'c', 'v']);
    // A staying video under a and c: they cannot be layered over it…
    expect(planLayerFade([video, exit(rect('a', 0), 0.25), exit(rect('c', 30), 0.25)], isVideo)).toBeNull();
    // …but members elsewhere still are.
    const plan = planLayerFade([video, exit(rect('a', 0), 0.25), exit(rect('far1', 1200), 0.25), exit(rect('far2', 1250), 0.25)], isVideo)!;
    expect([...plan.members].sort()).toEqual(['far1', 'far2']);
  });
});
