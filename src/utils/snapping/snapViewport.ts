import type { BoundingBox } from '../geometry/geometry';

/** Read on each gesture update: scrolling/panning must not leave stale magnets.
 * The SVG is larger than its scrollport, so its own rect is insufficient. */
export function snapViewport(svg: SVGSVGElement | null | undefined): BoundingBox | undefined {
  if (!svg) return undefined;
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const rect = svg.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = svg.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), r = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, r.left + parent.clientLeft); right = Math.min(right, r.left + parent.clientLeft + parent.clientWidth);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, r.top + parent.clientTop); bottom = Math.min(bottom, r.top + parent.clientTop + parent.clientHeight);
    }
  }
  const inverse = matrix.inverse();
  const points = [[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y]) => new DOMPoint(x,y).matrixTransform(inverse));
  const x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y));
  return { x, y, width: right < left ? -1 : Math.max(...points.map(p=>p.x))-x, height: bottom < top ? -1 : Math.max(...points.map(p=>p.y))-y };
}
