import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SVGTextPaths } from './SVGTextPaths';
import { layoutForElement } from '../../utils/text/userTextSizing';
import { createTextElement } from '../../utils/model/slideFactory';

vi.mock('../../utils/text/glyphPaths', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/text/glyphPaths')>();
  const bytes = readFileSync(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url));
  const font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { ...actual, loadFont: async () => font, prewarmFonts: () => {} };
});

const draw = (el: ReturnType<typeof createTextElement>) =>
  renderToStaticMarkup(<svg><SVGTextPaths element={el} /></svg>);

describe('SVGTextPaths', () => {
  it('draws a settled layout on its first render instead of going blank', async () => {
    // Every resize step and every frame of a size/font animation is a fresh
    // set of layout inputs. The renderer used to clear its layout and draw
    // nothing until the new one resolved, which flickered — for LaTeX, whose
    // layout waits on MathJax, for several frames. A layout that has already
    // settled must be drawn synchronously.
    const el = createTextElement({ text: 'flicker', width: 300, height: 60, opacity: 0.4 });
    expect(draw(el)).not.toContain('<path');
    await layoutForElement(el);
    const svg = draw({ ...el });
    expect(svg).toContain('<path');
    // ...and with the element's own opacity, which callers no longer pass.
    expect(svg).toMatch(/opacity="0.4"/);
  });
});
