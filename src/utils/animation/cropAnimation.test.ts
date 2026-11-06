import { describe, expect, it } from 'vitest';
import { applyImageCrop, cropFadeRegions, imagePoint, type CropFadeImage } from './cropAnimation';
import { interpolateElement } from './interpolation';
import { createImageElement, createPresentation } from '../model/slideFactory';
import { jsonToYDoc, yDocToJson } from '../../collab/ySchema';

const a = createImageElement('photo', 200, 100, { x: 50, y: 50, width: 200, height: 100 });
const b = { ...a, x: 100, y: 75, width: 100, height: 50,
  cropX: 50, cropY: 25, cropWidth: 100, cropHeight: 50,
  transitions: { crop: 'cropfade' as const, position: 'linear' as const, size: 'linear' as const } };
function alpha(image: CropFadeImage, x: number, y: number) {
  return cropFadeRegions(image._cropFade!).filter(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
    .reduce((sum, r) => sum + r.opacity, 0);
}

describe('crop focus', () => {
  it('applies a crop without moving any source pixel, including rotated stretched images', () => {
    for (const rotation of [0, 30, 90, -150]) {
      const original = { ...a, width: 400, height: 80, rotation };
      const cropped = { ...original, ...applyImageCrop(original, { x: 50, y: 25, width: 100, height: 50 }) };
      for (const [u, v] of [[0, 0], [75, 50], [200, 100]]) {
        const start = imagePoint(original, u, v), end = imagePoint(cropped, u, v);
        expect(end.x).toBeCloseTo(start.x);
        expect(end.y).toBeCloseTo(start.y);
      }
      expect(cropped.width / cropped.cropWidth).toBe(original.width / original.cropWidth);
      expect(cropped.height / cropped.cropHeight).toBe(original.height / original.cropHeight);
    }
  });
  it('ordinary crop and zoom also keep the focus fixed and scale steadily', () => {
    const focus = imagePoint(a, 100, 50);
    const end = { ...b, x: focus.x - 150, y: focus.y - 75, width: 300, height: 150 };
    for (const crop of ['linear', 'ease', 'cropfade', 'cropfadeease'] as const) {
      const target = { ...end, transitions: { ...b.transitions, crop } };
      for (const t of [0, .1, .25, .5, .75, .9, 1]) {
        const frame = interpolateElement(a, target, t) as CropFadeImage;
        const actual = imagePoint(frame, 100, 50);
        expect(actual.x).toBeCloseTo(focus.x);
        expect(actual.y).toBeCloseTo(focus.y);
        expect(frame.width / frame.cropWidth).toBeCloseTo(1 + 2 * t);
        expect(frame.height / frame.cropHeight).toBeCloseTo(1 + 2 * t);
      }
    }
  });
  it('keeps the retained area opaque and source pixels stationary while surroundings fade', () => {
    for (const t of [0, .25, .5, .75, 1]) {
      const frame = interpolateElement(a, b, t) as CropFadeImage;
      expect(alpha(frame, 75, 50)).toBe(1);
      expect(alpha(frame, 25, 50)).toBe(1 - t);
      expect(alpha(frame, 25, 10)).toBe(1 - t);
      expect(frame.x + (75 - frame.cropX) * frame.width / frame.cropWidth).toBeCloseTo(125);
      expect(frame.y + (50 - frame.cropY) * frame.height / frame.cropHeight).toBeCloseTo(100);
    }
  });
  it('composes with zoom, movement, rotation and opacity and reverses symmetrically', () => {
    const zoom = { ...b, x: 250, y: 180, width: 300, height: 150, rotation: 30, opacity: .6 };
    for (const t of [0, .25, .5, .75, 1]) {
      const f = interpolateElement(a, zoom, t) as CropFadeImage;
      const reverse = interpolateElement(zoom, a, 1 - t, false) as CropFadeImage;
      for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'cropX', 'cropY', 'cropWidth', 'cropHeight'] as const) {
        expect(reverse[key]).toBeCloseTo(f[key]);
      }
      expect(alpha(f, 75, 50)).toBe(1);
      expect(alpha(reverse, 25, 50)).toBeCloseTo(1 - t);
    }
  });
  it('supports eased fades and cross-resource changes without leaking the crop effect', () => {
    const eased = interpolateElement(a, { ...b, transitions: { crop: 'cropfadeease' } }, .25) as CropFadeImage;
    expect(alpha(eased, 25, 50)).toBe(.9375);
    expect((interpolateElement(a, { ...b, resourceId: 'other' }, .5) as CropFadeImage)._cropFade).toBeUndefined();
  });
  it('fades newly exposed regions in without changing the shared region', () => {
    const frame = interpolateElement(b, { ...a, transitions: b.transitions }, .25) as CropFadeImage;
    expect(alpha(frame, 25, 50)).toBe(.25);
    expect(alpha(frame, 75, 50)).toBe(1);
  });
  it('lifts a fixed crop while the original transform stays fixed, including reverse playback', () => {
    const target = { ...b, x: 320, y: 180, width: 300, height: 150, rotation: 30,
      transitions: { ...b.transitions, crop: 'croplift' as const } };
    for (const t of [0, .25, .5, .75, 1]) {
      const frame = interpolateElement(a, target, t) as CropFadeImage;
      const reverse = interpolateElement(target, a, 1 - t, false) as CropFadeImage;
      expect(frame._cropLift).toEqual({ original: a, t });
      expect(reverse._cropLift).toEqual(frame._cropLift);
      expect(frame.cropWidth).toBe(target.cropWidth);
      expect(frame.cropHeight).toBe(target.cropHeight);
      expect(frame.width / frame.cropWidth).toBeCloseTo(1 + 2 * t);
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const)
        expect(reverse[key]).toBeCloseTo(frame[key]);
    }
    const start = interpolateElement(a, target, 0) as CropFadeImage;
    expect(imagePoint(start, 75, 50)).toEqual(imagePoint(a, 75, 50));
    expect((interpolateElement(a, { ...target, resourceId: 'other' }, .5) as CropFadeImage)._cropLift).toBeUndefined();
    const eased = interpolateElement(a, { ...target, transitions: { crop: 'cropliftease' } }, .25) as CropFadeImage;
    expect(eased._cropLift?.t).toBe(.0625);
  });
  it('round trips crop transition choices through JSON and Yjs', () => {
    for (const crop of ['cropfade', 'cropfadeease', 'croplift', 'cropliftease'] as const) {
      const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
      slide.elements[b.id] = { ...b, transitions: { crop } };
      slide.elementOrder.push(b.id);
      const doc = jsonToYDoc(JSON.parse(JSON.stringify(p)));
      try { expect(yDocToJson(doc)!.slides[slide.id].elements[b.id].transitions?.crop).toBe(crop); }
      finally { doc.destroy(); }
    }
  });
});
