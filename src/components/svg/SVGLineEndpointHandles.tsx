import React, { useState, useEffect, useCallback } from 'react';
import type { ShapeElement, SlideElement, ConnectorBinding } from '../../types/presentation';
import { isCtrlHeld } from '../../utils/keyboard';
import { constrainToAngle } from '../../utils/geometry';
import { CANVAS_PADDING } from '../../utils/constants';
import { useEditorStore } from '../../store/editorStore';
import { computePointSnap, type Guide } from '../../hooks/useAlignmentGuides';
import { getMarginLayout, getMarginBounds } from '../../utils/marginLayouts';
import { getBindingTarget, getAnchorPoint } from '../../utils/connectorUtils';

interface Props {
  element: ShapeElement;
  elements: SlideElement[];
  zoom: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onTransformStart?: () => void;
  onGuidesChange?: (guides: Guide[]) => void;
  onConnectorHighlight?: (elementId: string | null) => void;
}

const HANDLE_RADIUS = 6;
const STROKE_WIDTH = 2;
const COLOR = '#4285f4';

export const SVGLineEndpointHandles: React.FC<Props> = ({
  element,
  elements,
  zoom,
  svgRef,
  onUpdate,
  onTransformStart,
  onGuidesChange,
  onConnectorHighlight,
}) => {
  const points = element.points ?? [0, 0, element.width, 0];

  // Absolute positions of start and end
  const startX = element.x + points[0];
  const startY = element.y + points[1];
  const endX = element.x + points[2];
  const endY = element.y + points[3];

  const [dragging, setDragging] = useState<{
    endpoint: 'start' | 'end';
    startMouseX: number;
    startMouseY: number;
    startPointX: number;
    startPointY: number;
  } | null>(null);

  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);

  // Convert screen coordinates to SVG coordinates
  const screenToSVG = useCallback((clientX: number, clientY: number) => {
    if (!svgRef?.current) {
      return { x: clientX / zoom - CANVAS_PADDING, y: clientY / zoom - CANVAS_PADDING };
    }
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom - CANVAS_PADDING,
      y: (clientY - rect.top) / zoom - CANVAS_PADDING,
    };
  }, [svgRef, zoom]);

  const handleMouseDown = useCallback((endpoint: 'start' | 'end', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onTransformStart?.();

    const pointX = endpoint === 'start' ? startX : endX;
    const pointY = endpoint === 'start' ? startY : endY;

    setDragging({
      endpoint,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPointX: pointX,
      startPointY: pointY,
    });
    setCurrentPos({ x: pointX, y: pointY });
  }, [startX, startY, endX, endY, onTransformStart]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();

      const pos = screenToSVG(e.clientX, e.clientY);
      let newX = pos.x;
      let newY = pos.y;

      // Constrain to angle if Ctrl held
      if (isCtrlHeld()) {
        const anchorX = dragging.endpoint === 'start' ? endX : startX;
        const anchorY = dragging.endpoint === 'start' ? endY : startY;
        const constrained = constrainToAngle({ x: newX, y: newY }, { x: anchorX, y: anchorY });
        newX = constrained.x;
        newY = constrained.y;
      }

      // Check for binding target (connector snap)
      const bindingTarget = getBindingTarget({ x: newX, y: newY }, elements, element.id);
      if (bindingTarget) {
        // Snap to the binding anchor point
        const targetElement = elements.find(el => el.id === bindingTarget.elementId);
        if (targetElement) {
          const anchorPoint = getAnchorPoint(targetElement, bindingTarget.anchor);
          if (anchorPoint) {
            newX = anchorPoint.x;
            newY = anchorPoint.y;
          }
        }
        onConnectorHighlight?.(bindingTarget.elementId);
        onGuidesChange?.([]);
      } else {
        onConnectorHighlight?.(null);

        // Apply snapping to other elements (only if not binding)
        const { snapToGrid: snappingEnabled, marginLayoutId } = useEditorStore.getState();
        if (snappingEnabled) {
          const marginLayout = getMarginLayout(marginLayoutId);
          const marginBounds = marginLayout ? getMarginBounds(marginLayout) : null;
          const others = elements
            .filter((el) => el.id !== element.id && el.visible)
            .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));

          const snapResult = computePointSnap({ x: newX, y: newY }, others, 5, marginBounds);
          onGuidesChange?.(snapResult.guides);

          if (snapResult.snapX !== null) newX = snapResult.snapX;
          if (snapResult.snapY !== null) newY = snapResult.snapY;
        } else {
          onGuidesChange?.([]);
        }
      }

      setCurrentPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (!currentPos) {
        setDragging(null);
        onGuidesChange?.([]);
        onConnectorHighlight?.(null);
        return;
      }

      let newX = currentPos.x;
      let newY = currentPos.y;

      // Apply final constraint
      if (isCtrlHeld()) {
        const anchorX = dragging.endpoint === 'start' ? endX : startX;
        const anchorY = dragging.endpoint === 'start' ? endY : startY;
        const constrained = constrainToAngle({ x: newX, y: newY }, { x: anchorX, y: anchorY });
        newX = constrained.x;
        newY = constrained.y;
      }

      // Check for binding target
      const bindingTarget = getBindingTarget({ x: newX, y: newY }, elements, element.id);
      let newBinding: ConnectorBinding | null = null;

      if (bindingTarget) {
        // Snap to the binding anchor point
        const targetElement = elements.find(el => el.id === bindingTarget.elementId);
        if (targetElement) {
          const anchorPoint = getAnchorPoint(targetElement, bindingTarget.anchor);
          if (anchorPoint) {
            newX = anchorPoint.x;
            newY = anchorPoint.y;
            newBinding = bindingTarget;
          }
        }
      }

      if (dragging.endpoint === 'start') {
        // New element position becomes the start point
        // End point stays at its absolute position, recalculated relative to new origin
        const newPoints = [0, 0, endX - newX, endY - newY];
        onUpdate({
          x: newX,
          y: newY,
          points: newPoints,
          width: Math.abs(endX - newX),
          height: Math.abs(endY - newY),
          startBinding: newBinding,
        });
      } else {
        // Keep start point as origin, update end point relative to start
        const newPoints = [0, 0, newX - startX, newY - startY];
        onUpdate({
          x: startX,
          y: startY,
          points: newPoints,
          width: Math.abs(newX - startX),
          height: Math.abs(newY - startY),
          endBinding: newBinding,
        });
      }

      setDragging(null);
      setCurrentPos(null);
      onGuidesChange?.([]);
      onConnectorHighlight?.(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, currentPos, screenToSVG, startX, startY, endX, endY, onUpdate, element.id, elements, onGuidesChange, onConnectorHighlight]);

  // Calculate display positions (use current drag position if dragging)
  const displayStartX = dragging?.endpoint === 'start' && currentPos ? currentPos.x : startX;
  const displayStartY = dragging?.endpoint === 'start' && currentPos ? currentPos.y : startY;
  const displayEndX = dragging?.endpoint === 'end' && currentPos ? currentPos.x : endX;
  const displayEndY = dragging?.endpoint === 'end' && currentPos ? currentPos.y : endY;

  return (
    <g className="line-endpoint-handles">
      {/* Selection line connecting endpoints */}
      <line
        x1={displayStartX}
        y1={displayStartY}
        x2={displayEndX}
        y2={displayEndY}
        stroke={COLOR}
        strokeWidth={1}
        strokeDasharray="4 2"
        style={{ pointerEvents: 'none' }}
      />

      {/* Start handle */}
      <circle
        cx={displayStartX}
        cy={displayStartY}
        r={HANDLE_RADIUS}
        fill="white"
        stroke={COLOR}
        strokeWidth={STROKE_WIDTH}
        style={{ cursor: 'move' }}
        onMouseDown={(e) => handleMouseDown('start', e)}
      />

      {/* End handle */}
      <circle
        cx={displayEndX}
        cy={displayEndY}
        r={HANDLE_RADIUS}
        fill="white"
        stroke={COLOR}
        strokeWidth={STROKE_WIDTH}
        style={{ cursor: 'move' }}
        onMouseDown={(e) => handleMouseDown('end', e)}
      />
    </g>
  );
};
