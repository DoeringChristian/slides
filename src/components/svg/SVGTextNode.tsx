import React from 'react';
import type { TextElement } from '../../types/presentation';
import { SVGTextContent } from './SVGTextContent';

interface Props {
  element: TextElement;
  disableInteraction?: boolean;
  isEditing?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}

// SVGTextNode renders text elements as actual SVG text
// with a transparent hit area rect on top for interaction
export const SVGTextNode: React.FC<Props> = ({
  element,
  disableInteraction,
  isEditing = false,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
}) => {
  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  return (
    <g data-element-id={element.id}>
      {/* Render actual text content */}
      <SVGTextContent
        element={element}
        isEditing={isEditing}
      />

      {/* Transparent hit area for interaction (on top of text, extends below for overflow) */}
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height + 500}
          fill="transparent"
          opacity={element.opacity}
          style={{
            cursor: disableInteraction ? 'default' : (element.locked ? 'default' : 'move'),
            pointerEvents: disableInteraction ? 'none' : 'auto',
          }}
          onMouseDown={disableInteraction ? undefined : onMouseDown}
          onMouseEnter={disableInteraction ? undefined : onMouseEnter}
          onMouseLeave={disableInteraction ? undefined : onMouseLeave}
          onDoubleClick={disableInteraction ? undefined : onDoubleClick}
        />
      </g>
    </g>
  );
};
