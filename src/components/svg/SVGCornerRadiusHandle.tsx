import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ShapeElement } from '../../types/presentation';
import { pathD } from '../../utils/pathShapes';
import { useScreenToSVG } from './useScreenToSVG';

interface Props {
  /** Sole-selected 'rect' shape or closed LINEAR path shape. */
  element: ShapeElement;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
}

const COLOR = '#4285f4';
/** Minimum inset from the corner (screen px / zoom) so the handle stays
 *  grabbable at cornerRadius 0. */
const MIN_INSET = 12;

/**
 * On-canvas corner-radius handle: a single small circle inset from the
 * element's top-left corner along the 45° diagonal, at a distance equal to
 * the cornerRadius (the rounded corner's arc centre sits at exactly
 * (r, r)). Dragging maps the diagonal distance min(localX, localY) back to
 * cornerRadius, clamped to [0, min(w, h) / 2]. Rotation-aware: everything
 * renders inside the element's rotation transform and the pointer position
 * is inverse-rotated into local coordinates.
 *
 * Live preview is drawn here (dashed outline through the production
 * geometry — `<rect rx>` for rects, `pathD` for closed linear paths); the
 * store sees a SINGLE updateElement commit on release.
 */
export const SVGCornerRadiusHandle: React.FC<Props> = ({
  element,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart,
}) => {
  const maxR = Math.min(element.width, element.height) / 2;
  const storedR = Math.max(0, Math.min(element.cornerRadius ?? 0, maxR));

  const [liveR, setLiveR] = useState<number | null>(null);
  // Ref mirror: the commit on pointerup must read the final radius and call
  // onUpdate OUTSIDE any setState updater (React 19 StrictMode).
  const liveRRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const screenToSVG = useScreenToSVG(svgRef, zoom);

  const displayR = liveR ?? storedR;
  const inset = Math.max(displayR, MIN_INSET / zoom);

  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const rotation = element.rotation || 0;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    onTransformStart?.();
    liveRRef.current = storedR;
    setLiveR(storedR);
    setDragging(true);
  }, [storedR, onTransformStart]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      // Inverse-rotate the pointer around the element centre into local
      // (unrotated) element coordinates.
      const rad = (-rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const relX = pos.x - cx;
      const relY = pos.y - cy;
      const localX = relX * cos - relY * sin + element.width / 2;
      const localY = relX * sin + relY * cos + element.height / 2;
      // Diagonal distance from the top-left corner → radius.
      const r = Math.max(0, Math.min(Math.min(localX, localY), maxR));
      liveRRef.current = r;
      setLiveR(r);
    };

    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      setDragging(false);
      // Commit from the ref, NOT inside a setState updater — single store
      // write (one undo entry) on release.
      const finalR = liveRRef.current;
      liveRRef.current = null;
      setLiveR(null);
      if (finalR === null) return;
      onUpdate({ cornerRadius: Math.round(finalR * 100) / 100 });
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, rotation, cx, cy, element.width, element.height, maxR, screenToSVG, onUpdate]);

  // Live dashed preview of the rounded outline while dragging.
  let preview: React.ReactNode = null;
  if (dragging) {
    const dashProps = {
      fill: 'none' as const,
      stroke: COLOR,
      strokeWidth: Math.max(2 / zoom, 1),
      strokeDasharray: `${4 / zoom} ${3 / zoom}`,
      opacity: 0.8,
      style: { pointerEvents: 'none' as const },
    };
    if (element.shapeType === 'rect') {
      preview = (
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rx={displayR}
          {...dashProps}
        />
      );
    } else if (element.points && element.points.length >= 4) {
      preview = (
        <path
          d={pathD(element.points, 'linear', true, displayR)}
          transform={`translate(${element.x} ${element.y})`}
          {...dashProps}
        />
      );
    }
  }

  return (
    <g className="corner-radius-handle" transform={transform}>
      {preview}
      {/* Guide from the corner to the handle while dragging. */}
      {dragging && (
        <line
          x1={element.x}
          y1={element.y}
          x2={element.x + inset}
          y2={element.y + inset}
          stroke={COLOR}
          strokeWidth={1 / zoom}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <circle
        cx={element.x + inset}
        cy={element.y + inset}
        r={12 / zoom}
        fill="transparent"
        style={{ cursor: 'nwse-resize', touchAction: 'none', pointerEvents: 'all' }}
        onPointerDown={handlePointerDown}
      />
      <circle
        cx={element.x + inset}
        cy={element.y + inset}
        r={5 / zoom}
        fill="#fff"
        stroke={COLOR}
        strokeWidth={2 / zoom}
        style={{ cursor: 'nwse-resize', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
      />
    </g>
  );
};
