import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { ColorPicker } from './ColorPicker';
import { QUICK_PAINT_COLORS } from '../../utils/quickPaintColors';
import { createShapeElement } from '../../utils/slideFactory';

describe('ColorPicker quick presentation', () => {
  for (const palette of ['fill', 'stroke'] as const) it(`${palette}: five choices and one current/custom trigger`, () => {
    const html = renderToStaticMarkup(<ColorPicker color="rgba(18, 52, 86, 0.4)" palette={palette} label="Paint" onChange={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(6);
    for (const color of QUICK_PAINT_COLORS[palette]) expect(html).toContain(color === 'transparent' ? 'Paint: No color' : `Paint: ${color}`);
    expect(html).toContain('current/custom color (rgba(18, 52, 86, 0.4))');
    expect(html).toContain('background-color:rgba(18, 52, 86, 0.4)');
  });
  it('no-color is disabled when a fill caller disallows transparency', () => {
    const html = renderToStaticMarkup(<ColorPicker palette="fill" allowTransparent={false} color="#123456" onChange={() => {}} />);
    expect(html).toMatch(/aria-label="Color: No color"[^>]*disabled=""/);
    expect(html.match(/<button/g)).toHaveLength(6);
  });
  it('compact toolbars use the same current/custom trigger without overflowing presets', () => {
    const html = renderToStaticMarkup(<ColorPicker compact color="#123456" onChange={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(1);
  });
  it('palette choices do not replace black 2px/no-fill factory defaults', () => {
    expect(createShapeElement('rect')).toMatchObject({ fill: '', stroke: '#000000', strokeWidth: 2 });
  });
  it('RGB selection reflects alpha-bearing paint and no-fill sentinels', () => {
    const html = renderToStaticMarkup(<ColorPicker color="rgba(224, 49, 49, 0.3)" onChange={() => {}} />);
    expect(html).toContain('aria-label="Color: #e03131" aria-pressed="true"');
    for (const color of ['', 'none', 'transparent']) {
      expect(renderToStaticMarkup(<ColorPicker palette="fill" color={color} onChange={() => {}} />))
        .toContain('aria-label="Color: No color" aria-pressed="true"');
    }
  });
});
