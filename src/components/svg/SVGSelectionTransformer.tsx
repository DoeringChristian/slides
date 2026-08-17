import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SlideElement } from '../../types/presentation';
import { useEditorStore } from '../../store/editorStore';
import { computeResizeSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { isShiftHeld } from '../../utils/keyboard';
import { getBoundingBox, getElementBounds } from '../../utils/geometry';
import { useScreenToSVG } from './useScreenToSVG';

interface Props {
  elements: SlideElement[];
  selectedIds: string[];
  locked?: boolean;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onTransformStart?: () => void;
  onTransform?: (id: string, attrs: { x?: number; y?: number; width?: number; height?: number; rotation?: number; cursorX?: number; cursorY?: number }) => void;
  onTransformEnd?: (id: string, attrs: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => void;
  onGuidesChange?: (guides: Guide[]) => void;
}

const COLOR_DEFAULT = '#4285f4';
const COLOR_LOCKED = '#dc2626';
const ANCHOR_SIZE = 10;
const ROTATION_ANCHOR_OFFSET = 30;

export const SVGSelectionTransformer: React.FC<Props> = ({
  elements,
  selectedIds,
  locked = false,
  zoom,
  svgRef,
  onTransformStart,
  onTransform,
  onTransformEnd,
  onGuidesChange,
}) => {
  const screenToSVG = useScreenToSVG(svgRef, zoom);
  const [resizing, setResizing] = useState<{
    anchor: string;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const [rotating, setRotating] = useState<{
    startAngle: number;
    elementRotation: number;
    centerX: number;
    centerY: number;
  } | null>(null);

  // Track last transform values for onTransformEnd (since we use preview, element isn't updated during drag)
  const lastTransformAttrs = useRef<{ x?: number; y?: number; width?: number; height?: number; rotation?: number }>({});

  const ctrlHeld = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') ctrlHeld.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') ctrlHeld.current = false;
    };
    const onBlur = () => { ctrlHeld.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const selectedElements = elements.filter((el) => selectedIds.includes(el.id));

  const bounds = getBoundingBox(selectedElements.map(getElementBounds));
  const singleElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const rotation = singleElement?.rotation || 0;

  const handleResizeStart = useCallback((anchor: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    onTransformStart?.();
    setResizing({
      anchor,
      startX: e.clientX,
      startY: e.clientY,
      startBounds: { ...bounds },
    });
  }, [bounds, locked, onTransformStart]);

  const handleRotateStart = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (locked || !singleElement) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    onTransformStart?.();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const pos = screenToSVG(e.clientX, e.clientY);
    const dx = pos.x - centerX;
    const dy = pos.y - centerY;
    setRotating({
      startAngle: Math.atan2(dy, dx) * 180 / Math.PI,
      elementRotation: singleElement.rotation || 0,
      centerX,
      centerY,
    });
  }, [locked, singleElement, bounds, screenToSVG, onTransformStart]);

  useEffect(() => {
    if (!resizing && !rotating) return;

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault();
      if (resizing && singleElement) {
        const screenDx = (e.clientX - resizing.startX) / zoom;
        const screenDy = (e.clientY - resizing.startY) / zoom;
        const { anchor, startBounds } = resizing;
        const rot = singleElement.rotation || 0;
        const isRotated = rot !== 0;

        // Project screen delta onto element's local (rotated) axes
        const rad = rot * Math.PI / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const localDx = isRotated ? screenDx * cosR + screenDy * sinR : screenDx;
        const localDy = isRotated ? -screenDx * sinR + screenDy * cosR : screenDy;

        // Compute edge deltas in local space
        let dLeft = 0, dRight = 0, dTop = 0, dBottom = 0;
        if (anchor.includes('left')) dLeft = localDx;
        if (anchor.includes('right')) dRight = localDx;
        if (anchor.includes('top')) dTop = localDy;
        if (anchor.includes('bottom')) dBottom = localDy;

        let newWidth = startBounds.width - dLeft + dRight;
        let newHeight = startBounds.height - dTop + dBottom;

        // Lock aspect ratio for image elements on diagonal resize
        const isDiagonal = (anchor.includes('left') || anchor.includes('right')) &&
                           (anchor.includes('top') || anchor.includes('bottom'));
        if (isDiagonal && singleElement.type === 'image' && startBounds.width > 0 && startBounds.height > 0) {
          const aspect = startBounds.width / startBounds.height;
          // Use the axis with the larger proportional change to drive the other
          const wRatio = Math.abs(newWidth) / startBounds.width;
          const hRatio = Math.abs(newHeight) / startBounds.height;
          if (wRatio > hRatio) {
            newHeight = newWidth / aspect;
            if (anchor.includes('top')) dTop = startBounds.height - newHeight;
            else dBottom = newHeight - startBounds.height;
          } else {
            newWidth = newHeight * aspect;
            if (anchor.includes('left')) dLeft = startBounds.width - newWidth;
            else dRight = newWidth - startBounds.width;
          }
        }

        // Minimum size
        if (newWidth < 10) {
          if (anchor.includes('left')) dLeft = startBounds.width - 10;
          else dRight = 10 - startBounds.width;
          newWidth = 10;
        }
        if (newHeight < 10) {
          if (anchor.includes('top')) dTop = startBounds.height - 10;
          else dBottom = 10 - startBounds.height;
          newHeight = 10;
        }

        let newX: number, newY: number;

        if (isRotated) {
          // For rotated elements: compute new center so the opposite anchor stays fixed
          const oldCx = startBounds.x + startBounds.width / 2;
          const oldCy = startBounds.y + startBounds.height / 2;

          // Center shift in local space
          const dCenterLocalX = (dLeft + dRight) / 2;
          const dCenterLocalY = (dTop + dBottom) / 2;

          // Transform center shift to world space
          const dCenterWorldX = dCenterLocalX * cosR - dCenterLocalY * sinR;
          const dCenterWorldY = dCenterLocalX * sinR + dCenterLocalY * cosR;

          newX = oldCx + dCenterWorldX - newWidth / 2;
          newY = oldCy + dCenterWorldY - newHeight / 2;
        } else {
          // Non-rotated: simple axis-aligned resize
          newX = startBounds.x + dLeft;
          newY = startBounds.y + dTop;

          // Snap to alignment guides if enabled (only for non-rotated)
          const { snapToGrid: snappingEnabled, marginLayoutId } = useEditorStore.getState();
          const effectiveSnapping = snappingEnabled && !isShiftHeld();

          if (effectiveSnapping) {
            const marginLayout = getMarginLayout(marginLayoutId);
            const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
            const others = elements
              .filter((el) => el.id !== singleElement.id && el.visible)
              .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

            const currentBounds = { x: newX, y: newY, width: newWidth, height: newHeight };
            const snapResult = computeResizeSnap(currentBounds, others, 5, marginBounds);

            onGuidesChange?.(snapResult.guides);

            if (anchor.includes('left') && snapResult.leftSnap !== null) {
              const snapDelta = snapResult.leftSnap - newX;
              newX = snapResult.leftSnap;
              newWidth = newWidth - snapDelta;
            }
            if (anchor.includes('right') && snapResult.rightSnap !== null) {
              newWidth = snapResult.rightSnap - newX;
            }
            if (anchor.includes('top') && snapResult.topSnap !== null) {
              const snapDelta = snapResult.topSnap - newY;
              newY = snapResult.topSnap;
              newHeight = newHeight - snapDelta;
            }
            if (anchor.includes('bottom') && snapResult.bottomSnap !== null) {
              newHeight = snapResult.bottomSnap - newY;
            }
          } else {
            onGuidesChange?.([]);
          }
        }

        const attrs = { x: newX, y: newY, width: newWidth, height: newHeight };
        lastTransformAttrs.current = attrs;
        onTransform?.(singleElement.id, attrs);
      }

      if (rotating && singleElement) {
        // Convert screen coordinates to SVG coordinates
        const pos = screenToSVG(e.clientX, e.clientY);
        const dx = pos.x - rotating.centerX;
        const dy = pos.y - rotating.centerY;
        let newAngle = Math.atan2(dy, dx) * 180 / Math.PI;
        let deltaAngle = newAngle - rotating.startAngle;
        let finalRotation = rotating.elementRotation + deltaAngle;

        // Snap to 15 degree increments only when Ctrl/Cmd held
        if (ctrlHeld.current) {
          finalRotation = Math.round(finalRotation / 15) * 15;
        }

        // Normalize to 0-360
        while (finalRotation < 0) finalRotation += 360;
        while (finalRotation >= 360) finalRotation -= 360;

        const attrs = { rotation: finalRotation, cursorX: pos.x, cursorY: pos.y };
        lastTransformAttrs.current = attrs;
        onTransform?.(singleElement.id, attrs);
      }
    };

    const handlePointerUp = () => {
      if (resizing && singleElement) {
        onTransformEnd?.(singleElement.id, lastTransformAttrs.current);
        onGuidesChange?.([]);
        lastTransformAttrs.current = {};
      }
      if (rotating && singleElement) {
        onTransformEnd?.(singleElement.id, lastTransformAttrs.current);
        lastTransformAttrs.current = {};
      }
      setResizing(null);
      setRotating(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    // pointercancel (iOS gesture, alt-tab) must clean up the same as pointerup.
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [resizing, rotating, zoom, singleElement, onTransform, onTransformEnd, screenToSVG, onGuidesChange, elements]);

  // Early return after all hooks are called
  if (selectedIds.length === 0 || selectedElements.length === 0) return null;

  const color = locked ? COLOR_LOCKED : COLOR_DEFAULT;

  // Scale sizes inversely with zoom to keep them constant on screen
  const anchorSize = ANCHOR_SIZE / zoom;
  const halfAnchor = anchorSize / 2;
  const strokeW = 2 / zoom;
  const thinStrokeW = 1 / zoom;
  const rotationOffset = ROTATION_ANCHOR_OFFSET / zoom;
  const anchorRadius = 2 / zoom;

  // Rotate around the center of the bounding box (matches how elements rotate)
  const rotationOriginX = bounds.x + bounds.width / 2;
  const rotationOriginY = bounds.y + bounds.height / 2;
  const transform = rotation ? `rotate(${rotation}, ${rotationOriginX}, ${rotationOriginY})` : undefined;

  const anchors = [
    { name: 'top-left', x: bounds.x, y: bounds.y, cursor: 'nwse-resize' },
    { name: 'top-center', x: bounds.x + bounds.width / 2, y: bounds.y, cursor: 'ns-resize' },
    { name: 'top-right', x: bounds.x + bounds.width, y: bounds.y, cursor: 'nesw-resize' },
    { name: 'middle-left', x: bounds.x, y: bounds.y + bounds.height / 2, cursor: 'ew-resize' },
    { name: 'middle-right', x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2, cursor: 'ew-resize' },
    { name: 'bottom-left', x: bounds.x, y: bounds.y + bounds.height, cursor: 'nesw-resize' },
    { name: 'bottom-center', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height, cursor: 'ns-resize' },
    { name: 'bottom-right', x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: 'nwse-resize' },
  ];

  return (
    <g className="selection-transformer" transform={transform}>
      {/* Selection border */}
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        style={{ pointerEvents: 'none' }}
      />

      {/* Resize anchors — each pairs a visible (small, desktop precision) anchor
          with an invisible 44px hit ring so touch users can grab it with a thumb. */}
      {!locked && anchors.map((anchor) => {
        const hitSize = 44 / zoom;
        const halfHit = hitSize / 2;
        return (
          <g key={anchor.name}>
            {/* Invisible touch-friendly hit target (44x44, always-on for pointer events). */}
            <rect
              x={anchor.x - halfHit}
              y={anchor.y - halfHit}
              width={hitSize}
              height={hitSize}
              fill="transparent"
              style={{ cursor: anchor.cursor, touchAction: 'none', pointerEvents: 'all' }}
              onPointerDown={(e) => handleResizeStart(anchor.name, e)}
            />
            {/* Visible anchor (10x10 on screen). Pointer events are still enabled
                so a mouse drag from inside the small visible region works exactly
                like before. */}
            <rect
              x={anchor.x - halfAnchor}
              y={anchor.y - halfAnchor}
              width={anchorSize}
              height={anchorSize}
              fill="white"
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
          {/* Line from top-center to rotation anchor */}
          <line
            x1={bounds.x + bounds.width / 2}
            y1={bounds.y}
            x2={bounds.x + bounds.width / 2}
            y2={bounds.y - rotationOffset}
            stroke={color}
            strokeWidth={thinStrokeW}
            style={{ pointerEvents: 'none' }}
          />
          {/* Invisible 44px hit ring for the rotation handle (touch-friendly). */}
          <circle
            cx={bounds.x + bounds.width / 2}
            cy={bounds.y - rotationOffset}
            r={22 / zoom}
            fill="transparent"
            style={{ cursor: 'grab', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={handleRotateStart}
          />
          {/* Rotation anchor circle */}
          <circle
            cx={bounds.x + bounds.width / 2}
            cy={bounds.y - rotationOffset}
            r={anchorSize / 2 + 2 / zoom}
            fill="white"
            stroke={color}
            strokeWidth={strokeW}
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={handleRotateStart}
          />
          {/* Rotation icon (270° arc with arrowhead) */}
          <path
            d={(() => {
              const cx = bounds.x + bounds.width / 2;
              const cy = bounds.y - rotationOffset;
              const r = 4 / zoom;
              const a = 2 / zoom;
              // Arc: 12 o'clock → 9 o'clock, 270° clockwise (large-arc=1, sweep=1)
              const sx = cx;
              const sy = cy - r;
              const ex = cx - r;
              const ey = cy;
              // Arrowhead: tip is ABOVE the arc endpoint (into the gap)
              // Wings are at the arc endpoint, splayed left/right
              const tipX = ex;
              const tipY = ey - a;
              const w1x = ex - a * 0.6;
              const w1y = ey;
              const w2x = ex + a * 0.6;
              const w2y = ey;
              return `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey} M ${w1x} ${w1y} L ${tipX} ${tipY} L ${w2x} ${w2y}`;
            })()}
            fill="none"
            stroke={color}
            strokeWidth={1.5 / zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}
    </g>
  );
};
