import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextElement } from './slideFactory';
import { layoutSvgText, type SvgTextDoc } from './textLayout';
import { layoutUserText, measureUserText } from './userTextSizing';

vi.mock('./textLayout', () => ({ layoutSvgText: vi.fn() }));
const doc: SvgTextDoc = { paths: [], lines: [], totalLength: 0, width: 180, height: 60 };
afterEach(() => vi.resetAllMocks());

describe('layoutUserText', () => {
  it('measures and paints auto-content at the same unbounded width despite a stale box', async () => {
    const element = createTextElement({ text: 'abc * _ ` [x]', textSizing: 'auto-content', width: 29 });
    const raw = new Set([0]);
    vi.mocked(layoutSvgText).mockResolvedValue(doc);
    expect(await layoutUserText(element, raw)).toBe(doc);
    expect(layoutSvgText).toHaveBeenCalledWith(element.text, element.style, Number.MAX_SAFE_INTEGER, raw);
    expect(await measureUserText(element, raw)).toEqual({ width: 180, height: 60 });
  });
  for (const align of ['center', 'right'] as const) it(`aligns ${align} against measured content, never infinite width`, async () => {
    const element = createTextElement({ text: '$x$\nshort', textSizing: 'auto-content', width: 29 });
    element.style.align = align;
    const raw = new Set([1]);
    vi.mocked(layoutSvgText).mockResolvedValue(doc);
    expect(await layoutUserText(element, raw)).toBe(doc);
    expect(layoutSvgText).toHaveBeenNthCalledWith(1, element.text, { ...element.style, align: 'left' }, Number.MAX_SAFE_INTEGER, raw);
    expect(layoutSvgText).toHaveBeenNthCalledWith(2, element.text, element.style, 180.001, raw);
  });
  for (const textSizing of ['user-width'] as const) it(`preserves finite width for ${textSizing ?? 'legacy'} text`, async () => {
    const element = createTextElement({ textSizing, width: 100 });
    vi.mocked(layoutSvgText).mockResolvedValue(doc);
    await layoutUserText(element);
    expect(layoutSvgText).toHaveBeenCalledExactlyOnceWith(element.text, element.style, textSizing ? 100 : 72, undefined);
  });
  it('does not apply free-text auto width to a bound label', async () => {
    const element = createTextElement({ textSizing: 'auto-content', containerId: 'shape', width: 100 });
    vi.mocked(layoutSvgText).mockResolvedValue(doc);
    await layoutUserText(element);
    expect(layoutSvgText).toHaveBeenCalledExactlyOnceWith(element.text, element.style, 72, undefined);
  });
});
