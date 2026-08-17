import { useCallback } from 'react';
import { CANVAS_PADDING } from '../../utils/constants';

// Convert screen coordinates to SVG coordinates.
export function useScreenToSVG(
  svgRef: React.RefObject<SVGSVGElement | null> | undefined,
  zoom: number,
) {
  return useCallback((clientX: number, clientY: number) => {
    if (!svgRef?.current) {
      // Fallback: simple zoom division (less accurate but works)
      return { x: clientX / zoom - CANVAS_PADDING, y: clientY / zoom - CANVAS_PADDING };
    }
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - CANVAS_PADDING,
      y: (clientY - rect.top) / zoom - CANVAS_PADDING,
    };
  }, [svgRef, zoom]);
}
