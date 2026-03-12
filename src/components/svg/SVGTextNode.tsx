import React, { useMemo } from 'react';
import type { TextElement } from '../../types/presentation';
import { SVGTextContent } from './SVGTextContent';
import { parseBlocks, getBlockFontMultiplier } from '../canvas/CustomMarkdownRenderer';
import { measureBlockHeight } from '../../utils/textHitTest';
import { TEXT_BOX_PADDING } from '../../utils/constants';

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
export const SVGTextNode: React.FC<Props> = React.memo(({
  element,
  disableInteraction,
  isEditing = false,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onDoubleClick,
}) => {
  // Compute actual rendered text height to size hit rect dynamically
  const hitRectHeight = useMemo(() => {
    const { text, width, style } = element;
    if (!text || text.trim() === '') return element.height;

    const { fontSize, fontFamily, fontWeight, lineHeight } = style;
    const lineHeightMultiplier = lineHeight || 1.2;
    const contentWidth = width - TEXT_BOX_PADDING * 2;
    const blocks = parseBlocks(text);

    let totalHeight = 0;
    for (const block of blocks) {
      const multiplier = getBlockFontMultiplier(block.type);
      const blockFontSize = fontSize * multiplier;
      const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
      const blockFontWeight = isHeader ? 'bold' : (fontWeight || 'normal');
      totalHeight += measureBlockHeight(
        block.displayContent, blockFontSize, fontFamily, blockFontWeight,
        lineHeightMultiplier, contentWidth
      );
    }

    const renderedContentHeight = totalHeight + TEXT_BOX_PADDING * 2;
    return Math.max(element.height, renderedContentHeight);
  }, [element]);

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
          height={hitRectHeight}
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
});
