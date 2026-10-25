import { describe, expect, it } from 'vitest';
import { createShapeElement, createTextElement } from './slideFactory';
import { autoFitTextGeometry, canAutoFitText, textAutoFitHandle } from './textAutoFit';
import { textHoverOwner } from './textHoverOwner';
import { rotateDelta } from './resizeGeometry';

describe('source text auto-fit geometry', () => {
  it('has 16px bar, 12px padded gap, 10x18 hit target and exact tiny threshold', () => {
    for (const zoom of [.5, 1, 2]) {
      const el = createTextElement({ x: 30, y: 40, width: 200, height: 50 });
      const h = textAutoFitHandle(el, zoom)!;
      expect((h.x - el.x - el.width) * zoom).toBe(16);
      expect([h.width * zoom, h.height * zoom, h.length * zoom]).toEqual([10, 18, 16]);
      expect(textAutoFitHandle({ ...el, height: 12 / zoom }, zoom)).not.toBeNull();
      expect(textAutoFitHandle({ ...el, height: 11.99 / zoom }, zoom)).toBeNull();
    }
  });
  it('preserves all nine rotated alignment anchors while growing or shrinking', () => {
    for (const rotation of [0, 30, 90, -70]) for (const align of ['left', 'center', 'right'] as const)
      for (const verticalAlign of ['top', 'middle', 'bottom'] as const) for (const width of [80, 700]) {
        const el = createTextElement({ rotation }); el.style = { ...el.style, align, verticalAlign };
        const anchor = (box: typeof el) => {
          const delta = rotateDelta({ x: ({ left: -.5, center: 0, right: .5 }[align]) * box.width,
            y: ({ top: -.5, middle: 0, bottom: .5 }[verticalAlign]) * box.height }, rotation);
          return { x: box.x + box.width / 2 + delta.x, y: box.y + box.height / 2 + delta.y };
        };
        const a = anchor(el), b = anchor({ ...el, ...autoFitTextGeometry(el, { width, height: 120 }) });
        expect(a.x).toBeCloseTo(b.x, 10); expect(a.y).toBeCloseTo(b.y, 10);
      }
  });
  it('only eligible visible unlocked free fixed text owns the bar', () => {
    expect(canAutoFitText(createTextElement())).toBe(true);
    for (const patch of [{ textSizing: 'auto-content' as const }, { containerId: 'missing' }, { locked: true }, { visible: false }])
      expect(canAutoFitText(createTextElement(patch))).toBe(false);
  });
});

describe('text hover-only ownership', () => {
  for (const shapeType of ['rect', 'ellipse', 'path'] as const) it(`resolves current ${shapeType} before selected-parent suppression`, () => {
    const label = createTextElement({ id: 'label', containerId: 'parent' });
    const parent = createShapeElement(shapeType, { id: 'parent', rotation: 30 });
    expect(textHoverOwner(label, { parent }, ['parent'], null)).toBe(parent);
    expect(textHoverOwner(label, { parent }, ['label'], null)).toBe(label);
    expect(textHoverOwner(label, { parent }, [], 'label')).toBe(label);
    expect(textHoverOwner(label, { parent: { ...parent, visible: false } }, [], null)).toBe(label);
    expect(textHoverOwner(label, {}, [], null)).toBe(label);
    expect(textHoverOwner(label, { parent: createTextElement() }, [], null)).toBe(label);
    expect(textHoverOwner({ ...label, containerId: null }, { parent }, [], null)?.id).toBe('label');
  });
});
