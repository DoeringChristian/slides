import React, { useRef } from 'react';
import { Image, Rect } from 'react-konva';
import useImage from 'use-image';
import { usePresentationStore } from '../../store/presentationStore';
import type { ImageElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: ImageElement;
  isSelected: boolean;
  disableInteraction?: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number, node: Konva.Node) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
}

export const ImageNode: React.FC<Props> = ({ element, isSelected, disableInteraction, onSelect, onDragEnd, onDragMove, onTransformEnd }) => {
  const imgRef = useRef<Konva.Image>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );
  const [image] = useImage(resource?.src || '');

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    opacity: element.opacity,
    draggable: !element.locked && !disableInteraction,
    listening: !disableInteraction,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => onSelect(element.id, e),
    onTap: (e: any) => onSelect(element.id, e),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragMove?.(element.id, e.target.x(), e.target.y(), e.target);
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(element.id, e.target.x(), e.target.y());
    },
  };

  const handleTransformEnd = () => {
    const node = imgRef.current || rectRef.current;
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
  };

  // No resource: render placeholder
  if (!resource) {
    return (
      <Rect
        ref={rectRef}
        {...commonProps}
        fill="#f3f4f6"
        stroke="#9ca3af"
        strokeWidth={2}
        dash={[8, 4]}
        onTransformEnd={handleTransformEnd}
      />
    );
  }

  // Apply crop from element properties (only if valid crop values exist)
  const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;
  const crop = hasCrop ? {
    x: element.cropX,
    y: element.cropY,
    width: element.cropWidth,
    height: element.cropHeight,
  } : undefined;

  return (
    <Image
      ref={imgRef}
      {...commonProps}
      image={image}
      crop={crop}
      onTransformEnd={handleTransformEnd}
      perfectDrawEnabled={false}
    />
  );
};
