import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { snapPathPoint } from '../../utils/pathSnapping';
import { SVGAlignmentGuides } from './SVGAlignmentGuides';

const render = (guides: Guide[], zoom = 1) => renderToStaticMarkup(<svg><SVGAlignmentGuides guides={guides} zoom={zoom} /></svg>);
describe('SVGAlignmentGuides actual point destinations', () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315])('eight-ray %s° marker equals the computed point', degrees => {
    const angle = (degrees + 2) * Math.PI / 180;
    const result = snapPathPoint({ x: 40 + 100 * Math.cos(angle), y: 70 + 100 * Math.sin(angle) }, [{ x: 40, y: 70 }], 1, true);
    expect(result.guides[0]).toMatchObject({ destination: result.point });
    const markup = render(result.guides);
    expect(markup).toContain(`cx="${result.point.x}" cy="${result.point.y}"`);
    expect(markup).toContain('pointer-events="none"');
  });
  it('marks only winning alignment coordinate; uses unsnapped other axis rather than generic center', () => {
    const result = computePointSnap({ x: 102, y: 230 }, [{ x: 100, y: 10, width: 4, height: 20 }]);
    expect(result.snapX).toBe(102); expect(result.snapY).toBeNull();
    expect(result.guides.filter(g => 'destination' in g)).toEqual([{ type: 'vertical', position: 102, destination: { x: 102, y: 230 } }]);
    expect(render(result.guides)).toContain('cx="102" cy="230"');
  });
  it.each([.5, 1, 2])('deduplicates X/Y intersection and keeps marker screen size at zoom %s', zoom => {
    const result = computePointSnap({ x: 101, y: 199 }, [{ x: 100, y: 200, width: 50, height: 50 }]);
    const markup = render(result.guides, zoom);
    expect(markup.match(/class="snap-destination"/g)).toHaveLength(1);
    expect(markup).toContain('cx="100" cy="200"');
    expect(markup).toContain(`r="${4 / zoom}"`);
    expect(markup).toContain(`stroke-width="${1.5 / zoom}"`);
  });
  it('no inferred marker for generic alignment/spacing or empty snap result', () => {
    expect(render([{ type: 'vertical', position: 123 }])).not.toContain('snap-destination');
    expect(render(snapPathPoint({ x: 100, y: 20 }, [{ x: 0, y: 0 }], 1).guides)).not.toContain('snap-destination');
    expect(render([])).not.toContain('snap-destination');
  });
});
