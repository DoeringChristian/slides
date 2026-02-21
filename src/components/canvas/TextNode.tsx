import React, { useRef, useEffect } from 'react';
import { Text } from 'react-konva';
import type { TextElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: TextElement;
  isSelected: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number, node: Konva.Node) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
  onDoubleClick: (id: string) => void;
}

export const TextNode: React.FC<Props> = ({ element, isSelected, onSelect, onDragEnd, onDragMove, onTransformEnd, onDoubleClick }) => {
  const textRef = useRef<Konva.Text>(null);

  useEffect(() => {
    if (textRef.current) {
      textRef.current.cache();
    }
  }, [element]);

  return (
    <Text
      ref={textRef}
      id={element.id}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      text={element.text}
      fontSize={element.style.fontSize}
      fontFamily={element.style.fontFamily}
      fontStyle={`${element.style.fontWeight === 'bold' ? 'bold' : ''} ${element.style.fontStyle === 'italic' ? 'italic' : ''}`.trim() || 'normal'}
      textDecoration={element.style.textDecoration === 'none' ? '' : element.style.textDecoration}
      fill={element.style.color}
      align={element.style.align}
      verticalAlign={element.style.verticalAlign}
      lineHeight={element.style.lineHeight}
      draggable={!element.locked}
      onClick={(e) => onSelect(element.id, e)}
      onTap={(e) => onSelect(element.id, e as any)}
      onDblClick={() => onDoubleClick(element.id)}
      onDblTap={() => onDoubleClick(element.id)}
      onDragMove={(e) => {
        onDragMove?.(element.id, e.target.x(), e.target.y(), e.target);
      }}
      onDragEnd={(e) => {
        onDragEnd(element.id, e.target.x(), e.target.y());
      }}
      onTransformEnd={() => {
        const node = textRef.current;
        if (!node) return;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onTransformEnd(element.id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(5, node.width() * scaleX),
          height: Math.max(5, node.height() * scaleY),
          rotation: node.rotation(),
        });
      }}
      perfectDrawEnabled={false}
    />
  );
};
