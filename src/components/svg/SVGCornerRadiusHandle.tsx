import { useCanvasGestureGuard } from './useCanvasGestureGuard';
import { CONTROL_THEME } from './controlTheme';
import { SVGAdjustmentGlyph } from './SVGAdjustmentGlyph';
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import type { ShapeElement } from '../../types/presentation';
import { cornerRadiusControl, cornerRadiusClearance, readRadiusControlObstacles, type CornerRadiusPlacement } from '../../utils/cornerRadiusControl';
import { useCoarsePointer } from '../../hooks/useCoarsePointer';
import { useScreenToSVG } from './useScreenToSVG';

interface Props {
  /** Sole-selected rectangle or linear path with a roundable vertex. */
  element: ShapeElement;
  displayElement?: ShapeElement;
  onPreview?: (attrs: Partial<ShapeElement> | null) => void;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
}

const COLOR = CONTROL_THEME.color;
/** Minimum inset from the corner (screen px / zoom) so the handle stays
 *  grabbable at cornerRadius 0. */
const MIN_INSET = 12;

/** A diamond adjustment handle riding the rectangle's TOP edge. Dragging
 * follows local horizontal displacement, not the pointer's absolute inset,
 * so grabbing the hit area (including at radius zero) never jumps. A local
 * preview is committed once on release; cancellation never touches the store. */
export const SVGCornerRadiusHandle: React.FC<Props> = ({
  element,
  displayElement, onPreview,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart,
}) => {
  const { start: startGuard, finish: finishGuard } = useCanvasGestureGuard();
  const visualElement = displayElement ?? element;
  const control = cornerRadiusControl(element);
  const coarse = useCoarsePointer();
  const maxR = control?.maxRadius ?? 0;
  const axisX = control?.dx ?? 1, axisY = control?.dy ?? 0;
  // Paths round back from vertex 2; rectangles still increase along +X.
  const dragDirection = element.shapeType === 'path' ? -1 : 1;
  const storedR = Math.max(0, Math.min(element.cornerRadius ?? 0, maxR));

  const [liveR, setLiveR] = useState<number | null>(null);
  // Ref mirror: the commit on pointerup must read the final radius and call
  // onUpdate OUTSIDE any setState updater (React 19 StrictMode).
  const liveRRef = useRef<number | null>(null);
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const screenToSVG = useScreenToSVG(svgRef, zoom);

  const visualControl = cornerRadiusControl(visualElement) ?? control;
  const visualMaxR = visualControl?.maxRadius ?? maxR;
  const displayR = liveR ?? Math.min(visualElement.cornerRadius ?? 0, visualMaxR);
  const inset = Math.min(visualControl?.segmentLength ? visualControl.segmentLength / 2 : Infinity,
    Math.max(displayR, Math.min(MIN_INSET / zoom, visualMaxR)));
  const hitRadius = Math.min((coarse ? 12 : 6) / zoom, element.shapeType === 'rect' ? visualElement.height / 3 : maxR / 2);
  const frameRef = useRef<SVGGElement>(null);
  const [placement, setPlacement] = useState<{ key: string; interval: CornerRadiusPlacement | null } | null>(null);
  const [dragPlacement, setDragPlacement] = useState<CornerRadiusPlacement | null>(null);
  // Radius is deliberately absent: choose a stable finite interval once.
  const placementKey = JSON.stringify([element.shapeType, visualElement.shapeType, visualElement.closed, visualElement.curve, hitRadius, visualElement.x, visualElement.y, visualElement.width, visualElement.height,
    visualElement.rotation, visualElement.points, visualElement.startBinding, visualElement.endBinding, zoom, coarse]);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || element.shapeType !== 'path' || dragging) return;
    const measure = () => {
      const obstacles = readRadiusControlObstacles(frame, zoom);
      const current = cornerRadiusControl(visualElement);
      if (!obstacles || !current) { setPlacement(previous => previous === null ? previous : null); return; }
      const interval = cornerRadiusClearance({ ...current, x: visualElement.x + current.x, y: visualElement.y + current.y }, zoom, hitRadius, obstacles);
      setPlacement(previous => previous?.key === placementKey && previous.interval?.start === interval?.start && previous.interval?.end === interval?.end ? previous : { key: placementKey, interval });
    };
    measure();
    // Observe only relevant sibling controls, never this knob or scene paint.
    const observeControls = () => frame.ownerSVGElement?.querySelectorAll('.path-handles, .selection-transformer').forEach(node => observer.observe(node,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'transform', 'style'] }));
    const observer = new MutationObserver(() => { observeControls(); measure(); });
    observeControls();
    if (frame.parentElement) observer.observe(frame.parentElement, { childList: true });
    return () => observer.disconnect();
    // placementKey captures geometry; projected radius must not restart measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementKey, dragging]);
  const interval = dragPlacement ?? (placement?.key === placementKey ? placement.interval : null);
  const ready = element.shapeType !== 'path' || interval != null;
  const along = element.shapeType === 'path' && interval && maxR > 0
    ? interval.end - Math.max(0, Math.min(1, displayR / maxR)) * (interval.end - interval.start)
    : inset;

  const handleX = visualElement.x + (visualControl?.x ?? 0) + (visualControl?.dx ?? 1) * along;
  const handleY = visualElement.y + (visualControl?.y ?? 0) + (visualControl?.dy ?? 0) * along;
  const cx = visualElement.x + visualElement.width / 2;
  const cy = visualElement.y + visualElement.height / 2;
  const rotation = element.rotation || 0;
  const displayRotation = visualElement.rotation || 0;
  const transform = displayRotation ? `rotate(${displayRotation}, ${cx}, ${cy})` : undefined;

  const cancel = useCallback(() => {
    finishGuard(); gestureRef.current = null; liveRRef.current = null;
    setLiveR(null); setDragging(false); setDragPlacement(null); onPreview?.(null);
  }, [finishGuard, onPreview]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!ready || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    if (!startGuard(cancel, [element])) return;
    const pos = screenToSVG(e.clientX, e.clientY);
    gestureRef.current = { pointerId: e.pointerId, ...pos };
    onTransformStart?.();
    liveRRef.current = storedR;
    setLiveR(storedR);
    setDragPlacement(interval);
    setDragging(true);
  }, [storedR, onTransformStart, screenToSVG, startGuard, cancel, element, ready, interval]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const start = gestureRef.current;
      if (!start || e.pointerId !== start.pointerId) return;
      e.preventDefault();
      const pos = screenToSVG(e.clientX, e.clientY);
      const rad = rotation * Math.PI / 180;
      const localDx = (pos.x - start.x) * Math.cos(rad) + (pos.y - start.y) * Math.sin(rad);
      const localDy = -(pos.x - start.x) * Math.sin(rad) + (pos.y - start.y) * Math.cos(rad);
      const delta = (localDx * axisX + localDy * axisY) * dragDirection;
      const r = Math.max(0, Math.min(storedR + delta, maxR));
      liveRRef.current = r;
      setLiveR(r);
      onPreview?.({ cornerRadius: Math.round(r * 100) / 100 });
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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('lostpointercapture', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('lostpointercapture', onCancel);
    };
  }, [dragging, rotation, axisX, axisY, dragDirection, storedR, maxR, screenToSVG, onUpdate, onPreview, cancel]);

  if (!control || maxR <= 0) return null;

  return (
    <g ref={frameRef} className="corner-radius-handle" transform={transform} visibility={ready ? undefined : 'hidden'}>
      {/* Guide from the corner to the handle while dragging. */}
      {dragging && (
        <line
          x1={visualElement.x + control.x}
          y1={visualElement.y + control.y}
          x2={handleX}
          y2={handleY}
          stroke={COLOR}
          strokeWidth={CONTROL_THEME.strokeWidth / zoom}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <circle
        cx={handleX}
        cy={handleY}
        r={hitRadius}
        fill="transparent"
        style={{ cursor: 'ew-resize', touchAction: 'none', pointerEvents: ready ? 'all' : 'none' }}
        onPointerDown={handlePointerDown}
      />
      <SVGAdjustmentGlyph x={handleX} y={handleY} zoom={zoom} />
    </g>
  );
};
