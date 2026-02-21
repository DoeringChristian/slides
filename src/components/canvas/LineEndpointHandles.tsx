import React, { useCallback, useState } from 'react';
import { Circle } from 'react-konva';
import type { ShapeElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: ShapeElement;
  zoom: number;
  onUpdate: (attrs: Partial<ShapeElement>) => void;
  onBindingDrag?: (point: { x: number; y: number }, endpoint: 'start' | 'end') => void;
  onBindingDragEnd?: (point: { x: number; y: number }, endpoint: 'start' | 'end') => void;
  onBindingDragStop?: () => void;
}

export const LineEndpointHandles: React.FC<Props> = ({
  element,
  zoom,
  onUpdate,
  onBindingDrag,
  onBindingDragEnd,
  onBindingDragStop,
}) => {
  const points = element.points ?? [0, 0, element.width, 0];

  // Absolute positions of start and end
  const startX = element.x + points[0];
  const startY = element.y + points[1];
  const endX = element.x + points[2];
  const endY = element.y + points[3];

  const radius = 6 / zoom;
  const strokeWidth = 2 / zoom;

  const handleStartDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const absX = node.x();
    const absY = node.y();
    onBindingDrag?.({ x: absX, y: absY }, 'start');
  }, [onBindingDrag]);

  const handleStartDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newStartX = node.x();
    const newStartY = node.y();

    // Check for binding snap
    onBindingDragEnd?.({ x: newStartX, y: newStartY }, 'start');

    // New element position becomes the start point
    // End point stays at its absolute position, recalculated relative to new origin
    const newPoints = [0, 0, endX - newStartX, endY - newStartY];

    onUpdate({
      x: newStartX,
      y: newStartY,
      points: newPoints,
      width: Math.abs(endX - newStartX),
      height: Math.abs(endY - newStartY),
    });

    onBindingDragStop?.();
  }, [endX, endY, onUpdate, onBindingDragEnd, onBindingDragStop]);

  const handleEndDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const absX = node.x();
    const absY = node.y();
    onBindingDrag?.({ x: absX, y: absY }, 'end');
  }, [onBindingDrag]);

  const handleEndDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const newEndX = node.x();
    const newEndY = node.y();

    // Check for binding snap
    onBindingDragEnd?.({ x: newEndX, y: newEndY }, 'end');

    // Keep start point as origin, update end point relative to start
    const newPoints = [0, 0, newEndX - startX, newEndY - startY];

    onUpdate({
      x: startX,
      y: startY,
      points: newPoints,
      width: Math.abs(newEndX - startX),
      height: Math.abs(newEndY - startY),
    });

    onBindingDragStop?.();
  }, [startX, startY, onUpdate, onBindingDragEnd, onBindingDragStop]);

  return (
    <>
      {/* Start handle */}
      <Circle
        x={startX}
        y={startY}
        radius={radius}
        fill="#fff"
        stroke="#4285f4"
        strokeWidth={strokeWidth}
        draggable
        onDragMove={handleStartDragMove}
        onDragEnd={handleStartDragEnd}
      />
      {/* End handle */}
      <Circle
        x={endX}
        y={endY}
        radius={radius}
        fill="#fff"
        stroke="#4285f4"
        strokeWidth={strokeWidth}
        draggable
        onDragMove={handleEndDragMove}
        onDragEnd={handleEndDragEnd}
      />
    </>
  );
};
