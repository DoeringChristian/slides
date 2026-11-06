import { describe, expect, it } from 'vitest';
import { isClientPointInCanvas } from './canvasViewport';

function canvas(svgRect = { left: -1000, top: -1000, right: 3000, bottom: 3000 }, visualViewport: object | null = null) {
  return {
    ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 800, visualViewport } },
    getBoundingClientRect: () => svgRect,
    closest: () => ({ getBoundingClientRect: () => ({ left: 100, top: 50 }), clientLeft: 2, clientTop: 2, clientWidth: 800, clientHeight: 900 }),
  } as unknown as SVGSVGElement;
}
describe('physical visible canvas intersection', () => {
  it('clips huge captured SVG to scrollport content and browser viewport', () => {
    const svg = canvas();
    expect(isClientPointInCanvas(svg, 101, 100)).toBe(false);
    expect(isClientPointInCanvas(svg, 102, 100)).toBe(true);
    expect(isClientPointInCanvas(svg, 901, 799)).toBe(true);
    expect(isClientPointInCanvas(svg, 902, 100)).toBe(false);
    expect(isClientPointInCanvas(svg, 500, 800)).toBe(false);
  });
  it('also clips to the outer SVG, not just the scrollport', () => {
    const svg = canvas({ left: 300, top: 200, right: 500, bottom: 400 });
    expect(isClientPointInCanvas(svg, 299, 250)).toBe(false);
    expect(isClientPointInCanvas(svg, 350, 250)).toBe(true);
    expect(isClientPointInCanvas(svg, 500, 250)).toBe(false);
  });
  it('uses the visible browser viewport under pinch zoom', () => {
    const svg = canvas(undefined, { offsetLeft: 200, offsetTop: 100, width: 400, height: 300 });
    expect(isClientPointInCanvas(svg, 199, 150)).toBe(false);
    expect(isClientPointInCanvas(svg, 300, 399)).toBe(true);
    expect(isClientPointInCanvas(svg, 300, 400)).toBe(false);
  });
});
