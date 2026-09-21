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

/** A diamond adjustment handle riding the rectangle's TOP edge. Dragging
 * follows local horizontal displacement, not the pointer's absolute inset,
 * so grabbing the hit area (including at radius zero) never jumps. A local
 * preview is committed once on release; cancellation never touches the store. */
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
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const screenToSVG = useScreenToSVG(svgRef, zoom);

  const displayR = liveR ?? storedR;
  const inset = Math.max(displayR, Math.min(MIN_INSET / zoom, element.width / 2));

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
    const pos = screenToSVG(e.clientX, e.clientY);
    gestureRef.current = { pointerId: e.pointerId, ...pos };
    onTransformStart?.();
    liveRRef.current = storedR;
    setLiveR(storedR);
    setDragging(true);
  }, [storedR, onTransformStart, screenToSVG]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const start = gestureRef.current;
      if (!start || e.pointerId !== start.pointerId) return;
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      const rad = rotation * Math.PI / 180;
      const dx = (pos.x - start.x) * Math.cos(rad) + (pos.y - start.y) * Math.sin(rad);
      const r = Math.max(0, Math.min(storedR + dx, maxR));
      liveRRef.current = r;
      setLiveR(r);
    };

    const cancel = () => {
      gestureRef.current = null;
      liveRRef.current = null;
      setLiveR(null);
      setDragging(false);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== gestureRef.current?.pointerId) return;
      onMove(e);
      const finalR = liveRRef.current;
      cancel();
      if (finalR !== null && finalR !== storedR) {
        onUpdate({ cornerRadius: Math.round(finalR * 100) / 100 });
      }
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === gestureRef.current?.pointerId) cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancel);
    window.addEventListener('lostpointercapture', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('lostpointercapture', onCancel);
    };
  }, [dragging, rotation, storedR, maxR, screenToSVG, onUpdate]);

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
          y2={element.y}
          stroke={COLOR}
          strokeWidth={1 / zoom}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <circle
        cx={element.x + inset}
        cy={element.y}
        r={12 / zoom}
        fill="transparent"
        style={{ cursor: 'ew-resize', touchAction: 'none', pointerEvents: 'all' }}
        onPointerDown={handlePointerDown}
      />
      <path
        d={`M ${element.x + inset} ${element.y - 4 / zoom} l ${4 / zoom} ${4 / zoom} l ${-4 / zoom} ${4 / zoom} l ${-4 / zoom} ${-4 / zoom} Z`}
        fill="#fbbc04"
        stroke={COLOR}
        strokeWidth={2 / zoom}
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
      />
    </g>
  );
};
