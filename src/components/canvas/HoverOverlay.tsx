import React from 'react';
import { Group, Rect, Text, Ellipse, Line, Arrow, Star, RegularPolygon, Image as KonvaImage } from 'react-konva';
import useImage from 'use-image';
import type { SlideElement, TextElement, ShapeElement, ImageElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
}

const HIGHLIGHT_COLOR = '#f59e0b';
const GHOST_OPACITY = 0.35;

const GhostImage: React.FC<{ element: ImageElement }> = ({ element }) => {
  const [image] = useImage(element.src);
  return (
    <KonvaImage
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      listening={false}
    />
  );
};

const GhostElement: React.FC<{ element: SlideElement }> = ({ element }) => {
  if (element.type === 'text') {
    const el = element as TextElement;
    return (
      <Text
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        rotation={el.rotation}
        text={el.text}
        fontSize={el.style.fontSize}
        fontFamily={el.style.fontFamily}
        fontStyle={
          `${el.style.fontWeight === 'bold' ? 'bold' : ''} ${el.style.fontStyle === 'italic' ? 'italic' : ''}`.trim() || 'normal'
        }
        fill={el.style.color}
        align={el.style.align}
        verticalAlign={el.style.verticalAlign}
        lineHeight={el.style.lineHeight}
        listening={false}
      />
    );
  }

  if (element.type === 'shape') {
    const el = element as ShapeElement;
    const common = {
      x: el.x,
      y: el.y,
      rotation: el.rotation,
      fill: el.fill,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      listening: false as const,
    };
    switch (el.shapeType) {
      case 'rect':
        return <Rect {...common} width={el.width} height={el.height} cornerRadius={el.cornerRadius} />;
      case 'ellipse':
        return <Ellipse {...common} x={el.x + el.width / 2} y={el.y + el.height / 2} radiusX={el.width / 2} radiusY={el.height / 2} />;
      case 'triangle':
        return <RegularPolygon {...common} x={el.x + el.width / 2} y={el.y + el.height / 2} sides={3} radius={Math.min(el.width, el.height) / 2} />;
      case 'star':
        return <Star {...common} x={el.x + el.width / 2} y={el.y + el.height / 2} numPoints={5} innerRadius={Math.min(el.width, el.height) / 4} outerRadius={Math.min(el.width, el.height) / 2} />;
      case 'line':
        return <Line {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} strokeWidth={el.strokeWidth || 3} fill="" />;
      case 'arrow':
        return <Arrow {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} strokeWidth={el.strokeWidth || 3} fill={el.stroke || el.fill} pointerLength={10} pointerWidth={10} />;
      default:
        return null;
    }
  }

  if (element.type === 'image') {
    return <GhostImage element={element as ImageElement} />;
  }

  return null;
};

const HighlightRect: React.FC<{ element: SlideElement }> = ({ element }) => (
  <Rect
    x={element.x - 3}
    y={element.y - 3}
    width={element.width + 6}
    height={element.height + 6}
    stroke={HIGHLIGHT_COLOR}
    strokeWidth={2}
    cornerRadius={3}
    dash={[6, 3]}
    listening={false}
  />
);

export const HoverOverlay: React.FC<Props> = ({ element }) => {
  if (element.visible) {
    return <HighlightRect element={element} />;
  }

  return (
    <Group listening={false}>
      <Group opacity={GHOST_OPACITY}>
        <GhostElement element={element} />
      </Group>
      <HighlightRect element={element} />
    </Group>
  );
};
