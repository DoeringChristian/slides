import { describe, expect, it } from 'vitest';
import { composeSlideFrame, renderPresenterElement } from '../../components/presenter/presenterUtils';
import { createImageElement, createShapeElement, createSlide } from './slideFactory';
import type { GroupCropElement } from './groupCrop';
import type { ImageElement, ShapeElement, Slide, SlideElement } from '../../types/presentation';

const image = (x: number, extra: Partial<ImageElement> = {}) =>
  createImageElement('r', 300, 200, { id: 'img', x, y: 100, width: 300, height: 200, objectGroupIds: ['g'], ...extra });
const mask = (x: number, extra: Partial<ShapeElement> = {}) =>
  createShapeElement('ellipse', { id: 'mask', x, y: 120, width: 150, height: 120, objectGroupIds: ['g'], cropGroupId: 'g', ...extra });
const slideOf = (els: SlideElement[]): Slide => {
  const s = createSlide();
  for (const e of els) { s.elements[e.id] = e; s.elementOrder.push(e.id); }
  return s;
};
const frame = (a: SlideElement[], b: SlideElement[], t: number) => {
  const f = composeSlideFrame({ slideA: slideOf(a), slideB: slideOf(b), isForward: true, animProgress: t, isAnimating: true });
  const by = Object.fromEntries(f.renderedElements.map(e => [e.id, e]));
  return { img: by.img, mask: by.mask };
};

describe('a crop moves with the media it crops', () => {
  it('stays put relative to the image even when their transitions differ', () => {
    // The image eases, the crop shape has the default linear position: they
    // used to drift apart mid-transition.
    const a = [image(100), mask(150)];
    const b = [image(400, { transitions: { position: 'ease' } }), mask(450)];
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const { img, mask: m } = frame(a, b, t);
      expect(m.x - img.x).toBeCloseTo(50, 6);
      expect(m.y - img.y).toBeCloseTo(20, 6);
      // The clip the image renders with is the moved crop, not a stale one.
      expect((img as GroupCropElement)._groupClips?.[0].x).toBeCloseTo(m.x, 6);
    }
  });

  it('scales with the image', () => {
    const a = [image(100), mask(150)];
    const b = [image(100, { width: 600, height: 400 }), mask(250, { y: 140, width: 300, height: 240 })];
    const { img, mask: m } = frame(a, b, 0.5);
    expect(m.width / img.width).toBeCloseTo(0.5, 6);
    expect(m.height / img.height).toBeCloseTo(0.6, 6);
  });

  it('turns with a rotating image', () => {
    const a = [image(100), mask(150)];
    const b = [image(100, { rotation: 90 }), mask(150)];
    // Rotating the image about its centre carries the crop round with it:
    // slide B's crop pose is the one rotated with the image.
    const bMask = (() => {
      const cx = 250, cy = 200, dx = 225 - cx, dy = 180 - cy; // mask centre relative to image centre
      return mask(0, { x: cx - dy - 75, y: cy + dx - 60, rotation: 90 });
    })();
    const { img, mask: m } = frame(a, [b[0], bMask], 0.5);
    expect(m.rotation).toBeCloseTo(img.rotation, 6);
    const r = img.rotation * Math.PI / 180;
    const icx = img.x + img.width / 2, icy = img.y + img.height / 2;
    expect(m.x + m.width / 2).toBeCloseTo(icx + (-25) * Math.cos(r) - (-20) * Math.sin(r), 6);
    expect(m.y + m.height / 2).toBeCloseTo(icy + (-25) * Math.sin(r) + (-20) * Math.cos(r), 6);
  });

  it('pans smoothly when the image moves under a fixed crop', () => {
    const a = [image(100), mask(150)];
    const b = [image(0), mask(150)];
    for (const t of [0, 0.5, 1]) {
      const { mask: m } = frame(a, b, t);
      expect(m.x).toBeCloseTo(150, 6);
    }
  });

  it('keys clipped media in the presenter, so it is not remounted mid-transition', () => {
    const f = composeSlideFrame({ slideA: slideOf([image(100), mask(150)]), slideB: null, isForward: true, animProgress: 0, isAnimating: false });
    const img = f.renderedElements.find(e => e.id === 'img')!;
    expect((renderPresenterElement(img, {}) as { key: string | null }).key).toBe('img');
  });
});
