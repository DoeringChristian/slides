import React, { useRef } from 'react';
import { Image } from 'react-konva';
import useImage from 'use-image';
import type { ImageElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: ImageElement;
  isSelected: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
}

export const ImageNode: React.FC<Props> = ({ element, isSelected, onSelect, onDragEnd, onDragMove, onTransformEnd }) => {
  const imgRef = useRef<Konva.Image>(null);
  const [image] = useImage(element.src);

  return (
    <Image
      ref={imgRef}
      id={element.id}
      image={image}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      rotation={element.rotation}
      opacity={element.opacity}
      draggable={!element.locked}
      onClick={(e) => onSelect(element.id, e)}
      onTap={(e) => onSelect(element.id, e as any)}
      onDragMove={(e) => {
        onDragMove?.(element.id, e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        onDragEnd(element.id, e.target.x(), e.target.y());
      }}
      onTransformEnd={() => {
        const node = imgRef.current;
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
