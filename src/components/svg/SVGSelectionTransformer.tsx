import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SlideElement, ShapeElement } from '../../types/presentation';
import { CANVAS_PADDING } from '../../utils/constants';
import { useEditorStore } from '../../store/editorStore';
import { computeResizeSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { isShiftHeld } from '../../utils/keyboard';

interface Props {
  elements: SlideElement[];
  selectedIds: string[];
  locked?: boolean;
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onTransformStart?: () => void;
  onTransform?: (id: string, attrs: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => void;
  onTransformEnd?: (id: string, attrs: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => void;
  onGuidesChange?: (guides: Guide[]) => void;
}

const COLOR_DEFAULT = '#4285f4';
const COLOR_LOCKED = '#dc2626';
const ANCHOR_SIZE = 10;
const ROTATION_ANCHOR_OFFSET = 30;

// Calculate bounding box for lines/arrows from their points
function getLineBoundingBox(element: ShapeElement): { x: number; y: number; width: number; height: number } {
  const points = element.points ?? [0, 0, element.width, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }

  return { x: element.x + minX, y: element.y + minY, width: maxX - minX, height: maxY - minY };
}

function getElementBounds(element: SlideElement): { x: number; y: number; width: number; height: number } {
  const isLine = element.type === 'shape' &&
    ((element as ShapeElement).shapeType === 'line' || (element as ShapeElement).shapeType === 'arrow');

  if (isLine) {
    return getLineBoundingBox(element as ShapeElement);
  }

  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

function getBoundingBox(elements: SlideElement[]): { x: number; y: number; width: number; height: number } {
  if (elements.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  if (elements.length === 1) {
    return getElementBounds(elements[0]);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const el of elements) {
    const bounds = getElementBounds(el);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

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
  // Convert screen coordinates to SVG coordinates
  const screenToSVG = useCallback((clientX: number, clientY: number) => {
    if (!svgRef?.current) {
      // Fallback: simple zoom division (less accurate but works)
      return { x: clientX / zoom - CANVAS_PADDING, y: clientY / zoom - CANVAS_PADDING };
    }
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - CANVAS_PADDING,
      y: (clientY - rect.top) / zoom - CANVAS_PADDING,
    };
  }, [svgRef, zoom]);
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

  const bounds = getBoundingBox(selectedElements);
  const singleElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const rotation = singleElement?.rotation || 0;

  const handleResizeStart = useCallback((anchor: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection
    e.stopPropagation();
    if (locked) return;
    onTransformStart?.();
    setResizing({
      anchor,
      startX: e.clientX,
      startY: e.clientY,
      startBounds: { ...bounds },
    });
  }, [bounds, locked, onTransformStart]);

  const handleRotateStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection
    e.stopPropagation();
    if (locked || !singleElement) return;
    onTransformStart?.();
    // Use the center of the element as rotation center
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

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault(); // Prevent text selection during transform
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

        const attrs = { rotation: finalRotation };
        lastTransformAttrs.current = attrs;
        onTransform?.(singleElement.id, attrs);
      }
    };

    const handleMouseUp = () => {
      if (resizing && singleElement) {
        // Pass the final transform values that were stored during drag
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

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, rotating, zoom, singleElement, onTransform, onTransformEnd, screenToSVG]);

  // Early return after all hooks are called
  if (selectedIds.length === 0 || selectedElements.length === 0) return null;

  const color = locked ? COLOR_LOCKED : COLOR_DEFAULT;
  const halfAnchor = ANCHOR_SIZE / 2;

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
    { name: 'bottom-left', x: bounds.x, y: bounds.y + bounds.width, cursor: 'nesw-resize' },
    { name: 'bottom-center', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height, cursor: 'ns-resize' },
    { name: 'bottom-right', x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: 'nwse-resize' },
  ];

  // Fix bottom-left y coordinate
  anchors[5].y = bounds.y + bounds.height;

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
        strokeWidth={2}
        style={{ pointerEvents: 'none' }}
      />

      {/* Resize anchors */}
      {!locked && anchors.map((anchor) => (
        <rect
          key={anchor.name}
          x={anchor.x - halfAnchor}
          y={anchor.y - halfAnchor}
          width={ANCHOR_SIZE}
          height={ANCHOR_SIZE}
          fill="white"
          stroke={color}
          strokeWidth={2}
          rx={2}
          ry={2}
          style={{ cursor: anchor.cursor }}
          onMouseDown={(e) => handleResizeStart(anchor.name, e)}
        />
      ))}

      {/* Rotation anchor (only for single selection) */}
      {!locked && singleElement && (
        <>
          {/* Line from top-center to rotation anchor */}
          <line
            x1={bounds.x + bounds.width / 2}
            y1={bounds.y}
            x2={bounds.x + bounds.width / 2}
            y2={bounds.y - ROTATION_ANCHOR_OFFSET}
            stroke={color}
            strokeWidth={1}
            style={{ pointerEvents: 'none' }}
          />
          {/* Rotation anchor circle */}
          <circle
            cx={bounds.x + bounds.width / 2}
            cy={bounds.y - ROTATION_ANCHOR_OFFSET}
            r={ANCHOR_SIZE / 2 + 2}
            fill="white"
            stroke={color}
            strokeWidth={2}
            style={{ cursor: 'grab' }}
            onMouseDown={handleRotateStart}
          />
          {/* Rotation icon (simple arc) */}
          <path
            d={`M ${bounds.x + bounds.width / 2 - 4} ${bounds.y - ROTATION_ANCHOR_OFFSET - 2}
                A 4 4 0 1 1 ${bounds.x + bounds.width / 2 + 4} ${bounds.y - ROTATION_ANCHOR_OFFSET - 2}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}
    </g>
  );
};
