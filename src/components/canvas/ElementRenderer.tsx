import React from 'react';
import { TextNode } from './TextNode';
import { ShapeNode } from './ShapeNode';
import { ImageNode } from './ImageNode';
import type { SlideElement } from '../../types/presentation';
import type Konva from 'konva';

interface Props {
  element: SlideElement;
  isSelected: boolean;
  disableInteraction?: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string, x: number, y: number, node: Konva.Node) => void;
  onTransformEnd: (id: string, attrs: Record<string, number>) => void;
  onDoubleClick: (id: string) => void;
  onMouseEnter?: (id: string) => void;
  onMouseLeave?: (id: string) => void;
}

export const ElementRenderer: React.FC<Props> = (props) => {
  const { element } = props;

  if (!element.visible) return null;

  switch (element.type) {
    case 'text':
      return <TextNode {...props} element={element} />;
    case 'shape':
      return <ShapeNode {...props} element={element} />;
    case 'image':
      return <ImageNode {...props} element={element} />;
    default:
      return null;
  }
};
