/** Physical client-space containment, independent of pointer capture/retargeting.
 * The padded SVG can extend far beyond both the scrollport and the browser. */
export function isClientPointInCanvas(svg: SVGSVGElement, x: number, y: number): boolean {
  const view = svg.ownerDocument.defaultView;
  if (!view) return false;
  const rect = svg.getBoundingClientRect();
  const viewport = view.visualViewport;
  let left = Math.max(rect.left, viewport?.offsetLeft ?? 0);
  let top = Math.max(rect.top, viewport?.offsetTop ?? 0);
  let right = Math.min(rect.right, viewport ? viewport.offsetLeft + viewport.width : view.innerWidth);
  let bottom = Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : view.innerHeight);
  const scrollport = svg.closest<HTMLElement>('.canvas-scroll-parent');
  if (scrollport) {
    const bounds = scrollport.getBoundingClientRect();
    const sx = bounds.left + scrollport.clientLeft;
    const sy = bounds.top + scrollport.clientTop;
    left = Math.max(left, sx);
    top = Math.max(top, sy);
    right = Math.min(right, sx + scrollport.clientWidth);
    bottom = Math.min(bottom, sy + scrollport.clientHeight);
  }
  return x >= left && x < right && y >= top && y < bottom;
}
