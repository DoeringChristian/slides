import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SVGAdjustmentGlyph } from './SVGAdjustmentGlyph';
import { CONTROL_THEME } from './controlTheme';

describe('SVGAdjustmentGlyph', () => {
  for (const zoom of [.25, .5, 1, 2, 4]) it(`shares selection paint with a 1 screen-pixel border at zoom ${zoom}`, () => {
    const html = renderToStaticMarkup(<SVGAdjustmentGlyph x={100} y={200} zoom={zoom} />);
    expect(html).toContain(`stroke="${CONTROL_THEME.color}"`);
    expect(html).toContain('fill="white"');
    expect(html).toContain(`stroke-width="${1 / zoom}"`);
    expect(html).toContain(`M 100 ${200 - 4 / zoom}`);
    expect(html).toContain('pointer-events:none');
  });
});
