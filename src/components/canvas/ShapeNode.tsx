import React, { useRef } from 'react';
import { Rect, Ellipse, Line, Arrow, Star, RegularPolygon } from 'react-konva';
import type { ShapeElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: ShapeElement;
  isSelected: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
}

export const ShapeNode: React.FC<Props> = ({ element, isSelected, onSelect, onDragEnd, onTransformEnd }) => {
  const shapeRef = useRef<any>(null);

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    draggable: !element.locked,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => onSelect(element.id, e),
    onTap: (e: any) => onSelect(element.id, e),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(element.id, e.target.x(), e.target.y());
    },
    onTransformEnd: () => {
      const node = shapeRef.current;
      if (!node) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      onTransformEnd(element.id, {
        x: node.x(),
        y: node.y(),
        width: Math.max(5, (node.width?.() ?? element.width) * scaleX),
        height: Math.max(5, (node.height?.() ?? element.height) * scaleY),
        rotation: node.rotation(),
      });
    },
    perfectDrawEnabled: false,
  };

  switch (element.shapeType) {
    case 'rect':
      return (
        <Rect
          ref={shapeRef}
          {...commonProps}
          width={element.width}
          height={element.height}
          cornerRadius={element.cornerRadius}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          ref={shapeRef}
          {...commonProps}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          radiusX={element.width / 2}
          radiusY={element.height / 2}
        />
      );
    case 'triangle':
      return (
        <RegularPolygon
          ref={shapeRef}
          {...commonProps}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          sides={3}
          radius={Math.min(element.width, element.height) / 2}
        />
      );
    case 'star':
      return (
        <Star
          ref={shapeRef}
          {...commonProps}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          numPoints={5}
          innerRadius={Math.min(element.width, element.height) / 4}
          outerRadius={Math.min(element.width, element.height) / 2}
        />
      );
    case 'line':
      return (
        <Line
          ref={shapeRef}
          {...commonProps}
          points={element.points ?? [0, 0, element.width, 0]}
          stroke={element.stroke || element.fill}
          strokeWidth={element.strokeWidth || 3}
          fill=""
        />
      );
    case 'arrow':
      return (
        <Arrow
          ref={shapeRef}
          {...commonProps}
          points={element.points ?? [0, 0, element.width, 0]}
          stroke={element.stroke || element.fill}
          strokeWidth={element.strokeWidth || 3}
          fill={element.stroke || element.fill}
          pointerLength={10}
          pointerWidth={10}
        />
      );
    default:
      return null;
  }
};
