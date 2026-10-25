import { describe, expect, it, vi } from 'vitest';
import { createTextElement, createShapeElement } from './slideFactory';
import { resizeFreeText, measureFreeTextResizeBaseline, anchorTextSize, scalesFreeText } from './freeTextResize';
import { resizeBounds, resizeSelection, rotateDelta } from './resizeGeometry';
import { layoutSvgText } from './textLayout';
vi.mock('./textLayout', () => ({ layoutSvgText: vi.fn(async (_text, style, width) => ({
  width: Math.min(width, style.fontSize * 10), height: style.fontSize * 2, paths: [], lines: [], totalLength: 0,
})) }));
const anchors = ['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'];
describe('freeTextResize shared measured geometry', () => {
  for (const rotation of [0,30,90]) for (const centered of [false,true]) it(`all anchors preserve rotated anchor or center ${rotation} ${centered}`, async () => {
    const el = createTextElement({ x: 20, y: 40, width: 200, height: 40, rotation, text: '**hello** $x$\nworld', textSizing: 'auto-content', style: { ...createTextElement().style, fontSize: 20 } });
    for (const anchor of anchors) for (const shift of [false,true]) {
      const next = resizeBounds(el, anchor, { x: 40, y: 20 }, scalesFreeText(anchor, shift), centered, rotation);
      const changes = (await resizeFreeText(el, el, next, anchor, shift, centered)).changes;
      const out = { ...el, ...changes } as typeof el;
      expect(out.text).toBe(el.text);
      expect(out.style.fontSize).toBe(scalesFreeText(anchor, shift) ? el.style.fontSize * next.width / el.width : el.style.fontSize);
      expect(out.textSizing).toBe(scalesFreeText(anchor, shift) ? 'auto-content' : 'user-width');
      const hx = centered ? 0 : anchor.includes('left') ? 1 : anchor.includes('right') ? -1 : 0;
      const hy = centered ? 0 : anchor.includes('top') ? 1 : anchor.includes('bottom') ? -1 : 0;
      const point = (e: typeof el) => { const d = rotateDelta({ x: hx * e.width / 2, y: hy * e.height / 2 }, rotation); return { x: e.x + e.width / 2 + d.x, y: e.y + e.height / 2 + d.y }; };
      expect(point(out).x).toBeCloseTo(point(el).x, 10); expect(point(out).y).toBeCloseTo(point(el).y, 10);
    }
  });
  for (const textSizing of ['auto-content', 'user-width'] as const) it(`normalizes ${textSizing ?? 'legacy adoption'} at original source/font before scaling`, async () => {
    const el = createTextElement({ width: 228, height: 108, text: '**source** $x$', textSizing,
      style: { ...createTextElement().style, fontSize: 20 } });
    const original = structuredClone(el);
    vi.mocked(layoutSvgText).mockClear();
    const size = await measureFreeTextResizeBaseline(el);
    expect(size).toEqual({ width: textSizing === 'auto-content' ? 200 : 228, height: 40 });
    expect(layoutSvgText).toHaveBeenNthCalledWith(1, el.text, el.style,
      textSizing === 'auto-content' ? Number.MAX_SAFE_INTEGER : 228, undefined);
    for (const centered of [false, true]) for (const anchor of anchors) for (const shift of [false, true]) {
      const baseline = anchorTextSize(el, size, anchor, centered);
      const next = resizeBounds(baseline, anchor, { x: 40, y: 8 }, scalesFreeText(anchor, shift), centered, el.rotation);
      const update = await resizeFreeText(el, baseline, next, anchor, shift, centered);
      const out = { ...el, ...update.changes } as typeof el;
      if (scalesFreeText(anchor, shift)) {
        expect(out.style.fontSize).toBeCloseTo(el.style.fontSize * next.width / baseline.width);
        expect(out.width / baseline.width).toBeCloseTo(out.style.fontSize / el.style.fontSize);
        expect(out.height / baseline.height).toBeCloseTo(out.style.fontSize / el.style.fontSize);
      }
      expect(out.text).toBe(el.text);
    }
    expect(el).toEqual(original);
  });
  it('waits for original math layout before using a measured baseline', async () => {
    const el = createTextElement({ text: '$x$', textSizing: 'auto-content', width: 228, height: 68 });
    let resolve!: (doc: Awaited<ReturnType<typeof layoutSvgText>>) => void;
    vi.mocked(layoutSvgText).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    let settled = false;
    const measurement = measureFreeTextResizeBaseline(el).then(size => { settled = true; return size; });
    await Promise.resolve(); expect(settled).toBe(false);
    resolve({ width: 200, height: 40, paths: [], lines: [], totalLength: 0 });
    expect(await measurement).toEqual({ width: 200, height: 40 });
    expect(el.width).toBe(228); expect(el.height).toBe(68);
  });
  it('font minimum is stable and reanchors measured height', async () => {
    const el = createTextElement({ textSizing: 'user-width', width: 200, height: 100 });
    const a = await resizeFreeText(el, el, { ...el, width: 0.01 }, 'top-left', true, false);
    const b = await resizeFreeText(el, el, { ...el, width: 0.001 }, 'top-left', true, false);
    expect(a).toEqual(b); expect(a.changes).toMatchObject({ style: { fontSize: 1 } });
  });
  it('group uniform font scale excludes bound labels; nonuniform preserves fonts', () => {
    const free = createTextElement({ width: 100, height: 50 });
    const bound = { ...free, id: 'bound', containerId: 'box' };
    const box = createShapeElement('rect');
    const start = { x: 0, y: 0, width: 400, height: 200 };
    const uniform = resizeSelection([free,bound,box], start, { ...start, width: 800, height: 400 });
    expect(uniform[0].changes).toMatchObject({ style: { fontSize: free.style.fontSize * 2 } });
    expect(uniform[1].changes).not.toHaveProperty('style');
    expect(resizeSelection([free,bound], start, { ...start, width: 800 })[0].changes).not.toHaveProperty('style');
  });
  it('anchor placement is independent of provisional reflow height', () => {
    expect(anchorTextSize({ x: 0,y: 0,width: 200,height: 40,rotation: 0 }, { width: 100,height: 80 }, 'middle-right',false)).toEqual({x:0,y:-20,width:100,height:80});
  });
});
