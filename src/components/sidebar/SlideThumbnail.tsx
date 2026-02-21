import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Text, Ellipse, Image as KonvaImage, Line, Arrow, Star, RegularPolygon } from 'react-konva';
import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement } from '../../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';

const THUMB_WIDTH = 192;
const THUMB_SCALE = THUMB_WIDTH / SLIDE_WIDTH;
const THUMB_HEIGHT = SLIDE_HEIGHT * THUMB_SCALE;

interface Props {
  slide: Slide;
  index: number;
  isActive: boolean;
  onClick: () => void;
}

const ThumbnailElement: React.FC<{ element: SlideElement }> = ({ element }) => {
  if (!element.visible) return null;

  if (element.type === 'text') {
    const el = element as TextElement;
    return (
      <Text
        x={el.x} y={el.y} width={el.width} height={el.height}
        text={el.text} fontSize={el.style.fontSize} fontFamily={el.style.fontFamily}
        fill={el.style.color} align={el.style.align} rotation={el.rotation}
        opacity={el.opacity} listening={false}
        fontStyle={`${el.style.fontWeight === 'bold' ? 'bold' : ''} ${el.style.fontStyle === 'italic' ? 'italic' : ''}`.trim() || 'normal'}
      />
    );
  }

  if (element.type === 'shape') {
    const el = element as ShapeElement;
    const common = { x: el.x, y: el.y, rotation: el.rotation, opacity: el.opacity, fill: el.fill, stroke: el.stroke, strokeWidth: el.strokeWidth, listening: false };
    switch (el.shapeType) {
      case 'rect': return <Rect {...common} width={el.width} height={el.height} cornerRadius={el.cornerRadius} />;
      case 'ellipse': return <Ellipse {...common} x={el.x + el.width/2} y={el.y + el.height/2} radiusX={el.width/2} radiusY={el.height/2} />;
      case 'triangle': return <RegularPolygon {...common} x={el.x + el.width/2} y={el.y + el.height/2} sides={3} radius={Math.min(el.width, el.height)/2} />;
      case 'star': return <Star {...common} x={el.x + el.width/2} y={el.y + el.height/2} numPoints={5} innerRadius={Math.min(el.width, el.height)/4} outerRadius={Math.min(el.width, el.height)/2} />;
      case 'line': return <Line {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} />;
      case 'arrow': return <Arrow {...common} points={el.points ?? [0, 0, el.width, 0]} stroke={el.stroke || el.fill} fill={el.stroke || el.fill} pointerLength={10} pointerWidth={10} />;
      default: return null;
    }
  }

  return null;
};

export const SlideThumbnail: React.FC<Props> = ({ slide, index, isActive, onClick }) => {
  const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer group ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
    >
      <span className="text-xs text-gray-400 w-5 text-right shrink-0">{index + 1}</span>
      <div className={`rounded border-2 overflow-hidden ${isActive ? 'border-blue-500' : 'border-gray-200 group-hover:border-gray-300'}`}>
        <Stage width={THUMB_WIDTH} height={THUMB_HEIGHT} scaleX={THUMB_SCALE} scaleY={THUMB_SCALE} listening={false}>
          <Layer listening={false}>
            <Rect x={0} y={0} width={SLIDE_WIDTH} height={SLIDE_HEIGHT} fill={bgColor} listening={false} />
            {elements.map((el) => (
              <ThumbnailElement key={el.id} element={el} />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  );
};
