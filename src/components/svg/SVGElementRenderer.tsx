import React from 'react';
import { SVGTextNode } from './SVGTextNode';
import { SVGShapeNode } from './SVGShapeNode';
import { SVGImageNode } from './SVGImageNode';
import type { SlideElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
  disableInteraction?: boolean;
  onMouseDown?: (id: string, e: React.MouseEvent) => void;
  onMouseEnter?: (id: string) => void;
  onMouseLeave?: (id: string) => void;
  onDoubleClick?: (id: string) => void;
}

export const SVGElementRenderer: React.FC<Props> = ({
  element,
  disableInteraction,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
}) => {
  if (!element.visible) return null;

  const handleMouseDown = (e: React.MouseEvent) => onMouseDown?.(element.id, e);
  const handleMouseEnter = () => onMouseEnter?.(element.id);
  const handleMouseLeave = () => onMouseLeave?.(element.id);
  const handleDoubleClick = () => onDoubleClick?.(element.id);

  switch (element.type) {
    case 'text':
      return (
        <SVGTextNode
          element={element}
          disableInteraction={disableInteraction}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
        />
      );
    case 'shape':
      return (
        <SVGShapeNode
          element={element}
          disableInteraction={disableInteraction}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
        />
      );
    case 'image':
      return (
        <SVGImageNode
          element={element}
          disableInteraction={disableInteraction}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      );
    default:
      return null;
  }
};
