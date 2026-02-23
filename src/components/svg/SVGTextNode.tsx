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
  const transform = `translate(${element.x}, ${element.y}) rotate(${element.rotation || 0})`;

  return (
    <g transform={transform} data-element-id={element.id}>
      <rect
        x={0}
        y={0}
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
