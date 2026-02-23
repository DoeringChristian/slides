import React from 'react';
import type { TextElement } from '../../types/presentation';

interface Props {
  element: TextElement;
  disableInteraction?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}

// SVGTextNode renders an invisible hit area for text elements
// The actual text rendering is handled by MarkdownTextOverlay (HTML)
export const SVGTextNode: React.FC<Props> = ({
  element,
  disableInteraction,
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
    <g transform={transform} data-element-id={element.id}>
      <rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
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
  );
};
