import { anchorTextSize, measureFreeTextResizeBaseline, resizeFreeText, scalesFreeText } from '../../utils/freeTextResize';
import { useCanvasGestureGuard } from './useCanvasGestureGuard';
import { CONTROL_THEME } from './controlTheme';
/* eslint-disable react-hooks/refs -- gesture refs are accessed only by pointer/key callbacks, never during render */
import { screenPixelsToSlide } from '../../utils/screenSpace';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useElementVisualBounds, selectionControlMetrics } from '../../utils/shapeVisualBounds';
import { getRotationCenter } from '../../utils/geometry';
import type { SlideElement } from '../../types/presentation';
import { getActiveDoc } from '../../collab/yDocAdapter';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { computeResizeSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { resizeBounds, resizeSelection, selectionResizeBounds, rotateDelta, type ResizeUpdate } from '../../utils/resizeGeometry';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCoarsePointer } from '../../hooks/useCoarsePointer';
import { useScreenToSVG } from './useScreenToSVG';

interface Props {
  elements: SlideElement[];
  displayElements?: SlideElement[];
  selectedIds: string[];
  locked?: boolean;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onTransformStart?: () => void;
  onTransform?: (id: string, attrs: { x?: number; y?: number; width?: number; height?: number; rotation?: number; cursorX?: number; cursorY?: number }) => void;
  onTransformEnd?: (id: string, attrs: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => void;
  onBatchTransform?: (updates: ResizeUpdate[]) => void;
  onBatchTransformEnd?: (updates: ResizeUpdate[]) => void;
  onTransformCancel?: () => void;
  onGuidesChange?: (guides: Guide[]) => void;
}

const COLOR_DEFAULT = CONTROL_THEME.color;
const COLOR_LOCKED = CONTROL_THEME.lockedColor;
const ANCHOR_SIZE = 8;
const ROTATION_ANCHOR_OFFSET = 16;

export const SVGSelectionTransformer: React.FC<Props> = ({
  elements,
  displayElements,
  selectedIds,
  locked = false,
  zoom,
  svgRef,
  onTransformStart,
  onTransform,
  onTransformEnd,
  onGuidesChange, onBatchTransform, onBatchTransformEnd, onTransformCancel,
}) => {
  const { start: startGuard, finish: finishGuard } = useCanvasGestureGuard();
  const transformerRef = useRef<SVGGElement>(null);
  const coarse = useCoarsePointer();
  const mobile = useIsMobile();
  const screenToSVG = useScreenToSVG(svgRef, zoom);
  type Pointer = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId' | 'shiftKey' | 'ctrlKey' | 'metaKey'>;
  const [gesture, setGesture] = useState<{
    anchor: string; pointer: Pointer; elements: SlideElement[];
    doc: ReturnType<typeof getActiveDoc>; presentationId: string;
    slideId: string; selectionIds: string[]; transformerIds: string[];
    bounds: ReturnType<typeof selectionResizeBounds>; rotation: number;
  } | null>(null);
  const latest = useRef<Pointer | null>(null);
  const lastUpdates = useRef<ResizeUpdate[]>([]);
  const requestGeneration = useRef(0);
  const pendingMeasurement = useRef<Promise<void> | null>(null);
  const released = useRef(false);
  const textBaselineMeasurement = useRef<ReturnType<typeof measureFreeTextResizeBaseline> | null>(null);
  useEffect(() => () => { requestGeneration.current++; latest.current = null; }, []);
  const selectedElements = elements.filter(el => selectedIds.includes(el.id));
  const bounds = selectionResizeBounds(selectedElements);
  const singleElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const rotation = singleElement?.rotation || 0;
  const displayedSelection = (displayElements ?? elements).filter(el => selectedIds.includes(el.id));
  const displayBounds = selectionResizeBounds(displayedSelection);
  const displaySingle = displayedSelection.length === 1 ? displayedSelection[0] : null;
  const displayRotation = displaySingle?.rotation || 0;
  const visualBounds = useElementVisualBounds(displaySingle);

  const handleResizeStart = useCallback((anchor: string, e: React.PointerEvent | PointerEvent) => {
    if (locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    try { (svgRef?.current ?? e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* detached */ }
    const pointer = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    if (!startGuard(() => { requestGeneration.current++; latest.current = null; lastUpdates.current = []; setGesture(null); onGuidesChange?.([]); onTransformCancel?.(); }, selectedElements)) return;
    requestGeneration.current++; released.current = false; pendingMeasurement.current = null; textBaselineMeasurement.current = null;
    latest.current = pointer; lastUpdates.current = [];
    onTransformStart?.();
    const editor = useEditorStore.getState();
    setGesture({ anchor, pointer, doc: getActiveDoc(), presentationId: usePresentationStore.getState().presentation.id, elements: structuredClone(selectedElements), bounds, rotation,
      slideId: editor.activeSlideId, selectionIds: [...editor.selectedElementIds], transformerIds: [...selectedIds] });
  }, [locked, selectedElements, selectedIds, bounds, rotation, onTransformStart, svgRef, startGuard, onGuidesChange, onTransformCancel]);
  const handleRotateStart = (e: React.PointerEvent) => handleResizeStart('rotate', e);

  useEffect(() => {
    // Pen/touch acquisition uses the ACTUAL incoming pointer type, even on a
    // fine-pointer laptop. No oversized mouse DOM target swallows body space.
    const svg = transformerRef.current?.ownerSVGElement;
    if (!svg) return;
    const down = (e: PointerEvent) => {
      const target = e.target;
      // Listen only on this SVG's visible event surface. HTML overlays and
      // scroll-clipped/off-canvas regions must keep their native ownership.
      if (locked || !['pen', 'touch'].includes(e.pointerType) || !(target instanceof SVGElement)
        || (target !== svg && target.ownerSVGElement !== svg) || target.closest('foreignObject')
        || target.closest('.path-handles, .corner-radius-handle, [data-text-auto-fit]')) return;
      const topmost = document.elementFromPoint(e.clientX, e.clientY);
      if (topmost !== target) return;
      // Native visible controls win over enlarged neighbours (especially on
      // tiny objects). Their existing pointer handlers perform the gesture.
      if (target.closest('[data-resize-visual], [data-rotation-visual]')
        || target.closest('g[data-resize-handle]')) return;
      const half = (e.pointerType === 'pen' ? 8 : 14) / zoom;
      const root = transformerRef.current;
      // Rotation owns overlapping enlarged zones before corners, matching the
      // reference resize hit order without changing either visual geometry.
      const controls = [
        ...root?.querySelectorAll<SVGGraphicsElement>('[data-rotation-visual]') ?? [],
        ...root?.querySelectorAll<SVGGraphicsElement>('[data-resize-visual]') ?? [],
      ];
      for (const node of controls) {
        const matrix = node.getScreenCTM();
        if (!matrix) continue;
        const b = node.getBBox();
        const center = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2);
        const screenCenter = center.matrixTransform(matrix);
        // CTMs alone ignore clipping/occlusion. Do not enlarge a control whose
        // center is hidden behind UI or outside the visible canvas viewport.
        if (document.elementFromPoint(screenCenter.x, screenCenter.y) !== node) continue;
        const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
        if (Math.abs(point.x - center.x) <= half && Math.abs(point.y - center.y) <= half) {
          handleResizeStart(node.hasAttribute('data-rotation-visual') ? 'rotate' : node.closest('[data-resize-handle]')!.getAttribute('data-resize-handle')!, e);
          return;
        }
      }
    };
    svg.addEventListener('pointerdown', down, true);
    return () => svg.removeEventListener('pointerdown', down, true);
  }, [locked, zoom, handleResizeStart]);


  useEffect(() => {
    if (!gesture) return;
    const { anchor, bounds: start, elements: original, rotation: rot, pointer } = gesture;
    let cancelled = false;
    const cancel = () => { requestGeneration.current++; finishGuard(); cancelled = true; latest.current = null; lastUpdates.current = []; setGesture(null); onGuidesChange?.([]); onTransformCancel?.(); };
    const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
    const contextMatches = () => {
      const editor = useEditorStore.getState();
      return !cancelled && latest.current !== null && getActiveDoc() === gesture.doc
        && usePresentationStore.getState().presentation.id === gesture.presentationId && editor.activeSlideId === gesture.slideId && sameIds(editor.selectedElementIds, gesture.selectionIds)
        && sameIds(selectedIds, gesture.transformerIds);
    };
    // Never apply a stale preview after selection/slide changes or remote geometry edits.
    if (!contextMatches() || original.some(el => !selectedIds.includes(el.id) || JSON.stringify(elements.find(now => now.id === el.id)) !== JSON.stringify(el))) {
      cancel(); return;
    }
    const publish = (updates: ResizeUpdate[]) => {
      lastUpdates.current = updates;
      if (onBatchTransform) onBatchTransform(updates);
      else for (const update of updates) onTransform?.(update.elementId, update.changes);
    };
    const move = (e: Pointer) => {
      if (!contextMatches()) { cancel(); return; }
      if (e.pointerId !== pointer.pointerId) return;
      latest.current = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
      const generation = ++requestGeneration.current;
      pendingMeasurement.current = null;
      let updates: ResizeUpdate[];
      if (anchor === 'rotate') {
        const from = screenToSVG(pointer.clientX, pointer.clientY), to = screenToSVG(e.clientX, e.clientY);
        const cx = start.x + start.width / 2, cy = start.y + start.height / 2;
        let angle = rot + (Math.atan2(to.y - cy, to.x - cx) - Math.atan2(from.y - cy, from.x - cx)) * 180 / Math.PI;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15;
        updates = [{ elementId: original[0].id, changes: { rotation: (angle % 360 + 360) % 360 } }];
      } else {
        const delta = rotateDelta({ x: (e.clientX - pointer.clientX) / zoom, y: (e.clientY - pointer.clientY) / zoom }, -rot);
        const freeText = original.length === 1 && original[0].type === 'text' && !original[0].containerId ? original[0] : null;
        const aspect = freeText ? scalesFreeText(anchor, e.shiftKey) : e.shiftKey;
        const constrainedBounds = (baseline: typeof start) => {
          let next = resizeBounds(baseline, anchor, delta, aspect, e.ctrlKey, rot);
          onGuidesChange?.([]);
          const editor = useEditorStore.getState();
          if (!rot && editor.snapToGrid && !e.metaKey) {
            const layout = getMarginLayout(editor.marginLayoutId);
            const others = elements.filter(el => !original.some(o => o.id === el.id) && el.visible);
            const tolerance = screenPixelsToSlide(5, zoom);
            const snap = computeResizeSnap(next, others, tolerance, layout ? getMarginBounds(layout) : null);
            // Snap a driven handle coordinate, then rerun the SAME constrained
            // geometry. Never independently snap a passive/opposite edge.
            const candidates: { delta: typeof delta; distance: number }[] = [];
            if (anchor.includes('left') && snap.leftSnap !== null) candidates.push({ delta: { ...delta, x: delta.x + (snap.leftSnap - next.x) }, distance: Math.abs(snap.leftSnap - next.x) });
            if (anchor.includes('right') && snap.rightSnap !== null) candidates.push({ delta: { ...delta, x: delta.x + snap.rightSnap - next.x - next.width }, distance: Math.abs(snap.rightSnap - next.x - next.width) });
            if (anchor.includes('top') && snap.topSnap !== null) candidates.push({ delta: { ...delta, y: delta.y + snap.topSnap - next.y }, distance: Math.abs(snap.topSnap - next.y) });
            if (anchor.includes('bottom') && snap.bottomSnap !== null) candidates.push({ delta: { ...delta, y: delta.y + snap.bottomSnap - next.y - next.height }, distance: Math.abs(snap.bottomSnap - next.y - next.height) });
            candidates.sort((a,b) => a.distance - b.distance);
            if (candidates[0]) next = resizeBounds(baseline, anchor, candidates[0].delta, aspect, e.ctrlKey, rot);
            onGuidesChange?.(computeResizeSnap(next, others, 1e-6, layout ? getMarginBounds(layout) : null).guides);
          }
          return next;
        };
        if (freeText) {
          // No-op clicks must never change text sizing metadata.
          if (!delta.x && !delta.y) { lastUpdates.current = []; onTransformCancel?.(); return; }
          const measurement = textBaselineMeasurement.current ??= measureFreeTextResizeBaseline(freeText);
          pendingMeasurement.current = measurement.then(async size => {
            if (requestGeneration.current !== generation) return;
            if (!contextMatches()) { cancel(); return; }
            const baseline = anchorTextSize(freeText, size, anchor, e.ctrlKey);
            // Delta is from the ORIGINAL physical grab, not the normalized
            // handle: its initial grab offset cancels in p(t) - p(0). Re-anchor
            // the same measured baseline on every Ctrl/Shift change, without
            // treating normalization itself as pointer travel or font scale.
            const update = await resizeFreeText(freeText, baseline, constrainedBounds(baseline), anchor, e.shiftKey, e.ctrlKey);
            if (requestGeneration.current !== generation) return;
            if (!contextMatches()) { cancel(); return; }
            publish([update]);
          }).catch(() => { if (requestGeneration.current === generation) cancel(); });
          return;
        }
        updates = resizeSelection(original, start, constrainedBounds(start));
      }
      publish(updates);
    };
    const up = async (e: PointerEvent) => {
      if (!contextMatches()) { cancel(); return; }
      if (e.pointerId !== pointer.pointerId) return;
      if (released.current) return;
      released.current = true;
      if (lastUpdates.current.length || pendingMeasurement.current) move(e);
      const generation = requestGeneration.current;
      await pendingMeasurement.current;
      if (generation !== requestGeneration.current) return;
      if (!contextMatches()) { cancel(); return; }
      finishGuard();
      if (lastUpdates.current.length) {
        if (onBatchTransformEnd) onBatchTransformEnd(lastUpdates.current);
        else for (const update of lastUpdates.current) onTransformEnd?.(update.elementId, update.changes);
      }
      lastUpdates.current = []; setGesture(null); onGuidesChange?.([]);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (!released.current && ['Shift','Control','Meta'].includes(e.key) && latest.current && (lastUpdates.current.length || pendingMeasurement.current)) move({ ...latest.current, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
    };
    const context = (e: Event) => { if (anchor !== 'rotate') { e.preventDefault(); e.stopPropagation(); } };
    // Subscribe synchronously: switching away and back between React renders
    // still invalidates this gesture, even for identical duplicate keyframes.
    const unsubscribe = useEditorStore.subscribe(() => { if (!contextMatches()) cancel(); });
    const pointerMove = (e: PointerEvent) => { if (!released.current) move(e); };
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
    window.addEventListener('contextmenu', context, true);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
      window.removeEventListener('contextmenu', context, true);
    };
  }, [gesture, zoom, elements, selectedIds, screenToSVG, onTransform, onTransformEnd, onBatchTransform, onBatchTransformEnd, onTransformCancel, onGuidesChange, finishGuard]);

  // Early return after all hooks are called
  if (selectedIds.length === 0 || selectedElements.length === 0) return null;

  const color = locked ? COLOR_LOCKED : COLOR_DEFAULT;

  // Scale sizes inversely with zoom to keep them constant on screen
  const anchorSize = ANCHOR_SIZE / zoom;
  const halfAnchor = anchorSize / 2;
  const strokeW = CONTROL_THEME.strokeWidth / zoom;
  const metrics = selectionControlMetrics(displaySingle, zoom);
  const linearExtra = metrics.pathCornerOffset;
  const rotationOffset = ROTATION_ANCHOR_OFFSET / zoom + linearExtra;
  const anchorRadius = 2 / zoom;

  // Rotate around the center of the bounding box (matches how elements rotate)
  const rotationOriginX = displaySingle ? getRotationCenter(displaySingle).x : displayBounds.x + displayBounds.width / 2;
  const rotationOriginY = displaySingle ? getRotationCenter(displaySingle).y : displayBounds.y + displayBounds.height / 2;
  const transform = displayRotation ? `rotate(${displayRotation}, ${rotationOriginX}, ${rotationOriginY})` : undefined;

  // DISPLAY ONLY. Resize math and snapping above retain the true bounds.
  const pad = metrics.padding;
  const visible = visualBounds ?? displayBounds;
  const overlay = { x: visible.x - pad, y: visible.y - pad, width: visible.width + 2 * pad, height: visible.height + 2 * pad };
  const anchors = [
    { name: 'top-left', x: overlay.x, y: overlay.y, cursor: 'nwse-resize' },
    { name: 'top-center', x: overlay.x + overlay.width / 2, y: overlay.y, cursor: 'ns-resize' },
    { name: 'top-right', x: overlay.x + overlay.width, y: overlay.y, cursor: 'nesw-resize' },
    { name: 'middle-left', x: overlay.x, y: overlay.y + overlay.height / 2, cursor: 'ew-resize' },
    { name: 'middle-right', x: overlay.x + overlay.width, y: overlay.y + overlay.height / 2, cursor: 'ew-resize' },
    { name: 'bottom-left', x: overlay.x, y: overlay.y + overlay.height, cursor: 'nesw-resize' },
    { name: 'bottom-center', x: overlay.x + overlay.width / 2, y: overlay.y + overlay.height, cursor: 'ns-resize' },
    { name: 'bottom-right', x: overlay.x + overlay.width, y: overlay.y + overlay.height, cursor: 'nwse-resize' },
  ];
  const corners = anchors.filter(a => !a.name.includes('center') && !a.name.startsWith('middle')).map(a => ({ ...a,
    x: a.x + (a.name.includes('left') ? -linearExtra : linearExtra),
    y: a.y + (a.name.includes('top') ? -linearExtra : linearExtra),
  }));
  const sides = anchors.filter(a => a.name.includes('center') || a.name.startsWith('middle'));


  return (
    <g ref={transformerRef} className="selection-transformer" transform={transform}>
      {/* Selection border */}
      <rect
        x={overlay.x}
        y={overlay.y}
        width={overlay.width}
        height={overlay.height}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        style={{ pointerEvents: 'none' }}
      />

      {/* Whole outside edges resize one axis; keep their hit band OUTSIDE the
          shape, so body/vertex picking is never covered by an invisible strip. */}
      {!locked && !(coarse && mobile) && sides.map(anchor => {
        const horizontal = anchor.name.includes('center');
        const inset = 4 / zoom, hit = 8 / zoom;
        const length = Math.max(0, (horizontal ? overlay.width : overlay.height) - 2 * inset);
        return <rect key={anchor.name} data-resize-handle={anchor.name}
          x={horizontal ? overlay.x + inset : anchor.x - hit / 2}
          y={horizontal ? anchor.y - hit / 2 : overlay.y + inset}
          width={horizontal ? length : hit} height={horizontal ? hit : length}
          fill="transparent" style={{ cursor: anchor.cursor, touchAction: 'none' }}
          onPointerDown={e => handleResizeStart(anchor.name, e)} />;
      })}

      {/* Resize anchors — each pairs a visible (small, desktop precision) anchor
          with an invisible input-appropriate hit ring so touch users can grab it with a thumb. */}
      {!locked && corners.map((anchor) => {
        const hitSize = 8 / zoom;
        const halfHit = Math.min(hitSize / 2, overlay.width / 4, overlay.height / 4);
        return (
          <g key={anchor.name} data-resize-handle={anchor.name}>
            {/* Invisible touch-friendly hit target (larger on coarse pointers for pointer events). */}
            <rect
              x={anchor.x - halfHit}
              y={anchor.y - halfHit}
              width={halfHit * 2}
              height={halfHit * 2}
              fill="transparent"
              style={{ cursor: anchor.cursor, touchAction: 'none', pointerEvents: 'all' }}
              onPointerDown={(e) => handleResizeStart(anchor.name, e)}
            />
            {/* Visible anchor (8x8 on screen). Pointer events are still enabled
                so a mouse drag from inside the small visible region works exactly
                like before. */}
            <rect
              data-resize-visual
              x={anchor.x - halfAnchor}
              y={anchor.y - halfAnchor}
              width={anchorSize}
              height={anchorSize}
              fill={CONTROL_THEME.fill}
              stroke={color}
              strokeWidth={strokeW}
              rx={anchorRadius}
              ry={anchorRadius}
              style={{ cursor: anchor.cursor, touchAction: 'none' }}
              onPointerDown={(e) => handleResizeStart(anchor.name, e)}
            />
          </g>
        );
      })}

      {/* Rotation anchor (only for single selection) */}
      {!locked && singleElement && (
        <>
          {/* Invisible input-appropriate hit ring for the rotation handle (touch-friendly). */}
          <circle
            cx={overlay.x + overlay.width / 2}
            cy={overlay.y - rotationOffset}
            r={4 / zoom}
            fill="transparent"
            style={{ cursor: 'grab', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={handleRotateStart}
          />
          {/* Rotation anchor circle */}
          <circle data-rotation-visual
            cx={overlay.x + overlay.width / 2}
            cy={overlay.y - rotationOffset}
            r={4 / zoom}
            fill={CONTROL_THEME.fill}
            stroke={color}
            strokeWidth={strokeW}
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={handleRotateStart}
          />

        </>
      )}
    </g>
  );
};
