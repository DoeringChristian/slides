import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { RenderMorph } from './RenderMorph';
import { createShapeElement, createTextElement } from '../../utils/slideFactory';
import { samplePathD } from '../../utils/glyphPaths';
import type { MorphFx } from '../../utils/interpolation';

vi.mock('../../utils/glyphPaths', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/glyphPaths')>(),
  prewarmFonts: vi.fn(),
  samplePathD: vi.fn(() => Array(64).fill(0)),
}));
vi.mock('../../utils/textLayout', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/textLayout')>(),
  getLayoutSync: () => ({ width: 100, height: 20, paths: [{ d: 'M0 0L1 1', transform: 'translate(3,4)', fillColor: '#000000' }], lines: [] }),
}));

it('morph pairing separates equal-content-box inset policies, but reuses unrelated baseline changes', () => {
  const shape = createShapeElement('rect', { width: 100, height: 60 });
  const legacy = createTextElement({ text: 'Inset cache regression', width: 128, height: 60, containerId: 'padded-container', boundTextLayout: 'padded' });
  legacy.style.verticalAlign = 'top';
  const measured = { ...legacy, width: 100, containerId: shape.id, boundTextLayout: 'measured' as const, boundTextBaselineHeight: 190 };
  const render = (text: typeof legacy) => renderToStaticMarkup(<RenderMorph element={{
    ...shape, _morphFx: { from: text, to: shape, t: 0 } as MorphFx,
  } as typeof shape} />);
  const before = render(legacy);
  const after = render(measured);
  expect(before).toContain('M 17.00 18.00');
  expect(after).toContain('M 3.00 4.00');
  expect(samplePathD).toHaveBeenCalledTimes(2);
  expect(render({ ...measured, boundTextBaselineHeight: 250 })).toBe(after);
  expect(samplePathD).toHaveBeenCalledTimes(2);
});
