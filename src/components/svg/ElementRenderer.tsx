import React, { memo, useMemo } from 'react';
import katex from 'katex';
import { TEXT_BOX_PADDING } from '../../utils/constants';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier, type ParsedBlock, type InlineSegment } from '../canvas/CustomMarkdownRenderer';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Resource } from '../../types/presentation';

// ============================================================================
// Shape Renderer
// ============================================================================

interface ShapeProps {
  element: ShapeElement;
}

export const RenderShape: React.FC<ShapeProps> = memo(({ element }) => {
  if (!element.visible) return null;

  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, cornerRadius, points } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const fillAttr = fill || 'transparent';
  const strokeAttr = stroke || 'none';
  const strokeWidthAttr = strokeWidth || 0;

  const commonProps = {
    fill: fillAttr,
    stroke: strokeAttr,
    strokeWidth: strokeWidthAttr,
    opacity,
    style: { pointerEvents: 'none' as const },
  };

  switch (shapeType) {
    case 'rect':
      return (
        <g transform={transform}>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={cornerRadius || 0}
            ry={cornerRadius || 0}
            {...commonProps}
          />
        </g>
      );

    case 'ellipse':
      return (
        <g transform={transform}>
          <ellipse
            cx={x + width / 2}
            cy={y + height / 2}
            rx={width / 2}
            ry={height / 2}
            {...commonProps}
          />
        </g>
      );

    case 'triangle': {
      const tcx = x + width / 2;
      const tcy = y + height / 2;
      const r = Math.min(width, height) / 2;
      const pts = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} Z`;
      return (
        <g transform={transform}>
          <path d={d} {...commonProps} />
        </g>
      );
    }

    case 'star': {
      const scx = x + width / 2;
      const scy = y + height / 2;
      const outerR = Math.min(width, height) / 2;
      const innerR = outerR / 2;
      const starPoints: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        starPoints.push(`${scx + r * Math.cos(angle)},${scy + r * Math.sin(angle)}`);
      }
      return (
        <g transform={transform}>
          <polygon points={starPoints.join(' ')} {...commonProps} />
        </g>
      );
    }

    case 'line': {
      const pts = points ?? [0, 0, width, 0];
      const lineStroke = stroke || fill || '#000';
      const lineWidth = strokeWidth || 3;
      return (
        <g transform={transform}>
          <line
            x1={x + pts[0]}
            y1={y + pts[1]}
            x2={x + pts[2]}
            y2={y + pts[3]}
            stroke={lineStroke}
            strokeWidth={lineWidth}
            strokeLinecap="round"
            opacity={opacity}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    }

    case 'arrow': {
      const pts = points ?? [0, 0, width, 0];
      const arrowStroke = stroke || fill || '#000';
      const arrowWidth = strokeWidth || 3;
      const dx = pts[2] - pts[0];
      const dy = pts[3] - pts[1];
      const angle = Math.atan2(dy, dx);
      const headLength = 10;
      const headWidth = 10;
      const tip = { x: x + pts[2], y: y + pts[3] };
      const lineEnd = {
        x: tip.x - headLength * Math.cos(angle),
        y: tip.y - headLength * Math.sin(angle),
      };
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };
      return (
        <g transform={transform} style={{ pointerEvents: 'none' }}>
          <line
            x1={x + pts[0]}
            y1={y + pts[1]}
            x2={lineEnd.x}
            y2={lineEnd.y}
            stroke={arrowStroke}
            strokeWidth={arrowWidth}
            strokeLinecap="round"
            opacity={opacity}
          />
          <polygon
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill={arrowStroke}
            opacity={opacity}
          />
        </g>
      );
    }

    default:
      return null;
  }
});

// ============================================================================
// Image Renderer
// ============================================================================

interface ImageProps {
  element: ImageElement;
  resource?: Resource;
  clipIdPrefix?: string;
}

export const RenderImage: React.FC<ImageProps> = memo(({ element, resource, clipIdPrefix = 'img' }) => {
  if (!element.visible) return null;

  const { x, y, width, height, rotation, opacity, cropX, cropY, cropWidth, cropHeight } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  // No resource or video - render placeholder
  if (!resource || resource.type === 'video') {
    return (
      <g transform={transform}>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={resource?.type === 'video' ? '#1f2937' : '#f3f4f6'}
          stroke={resource?.type === 'video' ? undefined : '#9ca3af'}
          strokeWidth={resource?.type === 'video' ? undefined : 2}
          strokeDasharray={resource?.type === 'video' ? undefined : '8 4'}
          opacity={opacity}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  const hasCrop = cropWidth > 0 && cropHeight > 0;

  if (hasCrop) {
    const clipId = `${clipIdPrefix}-${element.id}`;
    const scaleX = width / cropWidth;
    const scaleY = height / cropHeight;

    return (
      <g transform={transform}>
        <defs>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image
            href={resource.src}
            x={x - cropX * scaleX}
            y={y - cropY * scaleY}
            width={resource.originalWidth * scaleX}
            height={resource.originalHeight * scaleY}
            opacity={opacity}
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      </g>
    );
  }

  return (
    <g transform={transform}>
      <image
        href={resource.src}
        x={x}
        y={y}
        width={width}
        height={height}
        opacity={opacity}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
});

// ============================================================================
// Text Renderer (using foreignObject for markdown support)
// ============================================================================

// Render LaTeX to HTML string
function renderLatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return latex;
  }
}

// Render text block as HTML
function renderBlockAsHtml(_block: ParsedBlock, segments: InlineSegment[]): string {
  return segments.map((segment) => {
    if (segment.type === 'latex') {
      return renderLatex(segment.displayContent, segment.isBlock);
    }
    if (segment.type === 'link') {
      const escaped = segment.displayContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span style="color:#2563eb;text-decoration:underline">${escaped}</span>`;
    }
    if (segment.type === 'formatted') {
      let style = '';
      if (segment.bold) style += 'font-weight:bold;';
      if (segment.italic) style += 'font-style:italic;';
      if (segment.strikethrough) style += 'text-decoration:line-through;';
      if (segment.underline) style += 'text-decoration:underline;';
      const escaped = segment.displayContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span style="${style}">${escaped}</span>`;
    }
    return segment.displayContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }).join('');
}

interface TextProps {
  element: TextElement;
  isEditing?: boolean;
}

export const RenderText: React.FC<TextProps> = memo(({ element, isEditing = false }) => {
  if (!element.visible || isEditing) return null;

  const { text, style, x: elementX, y: elementY, width, height, rotation, opacity } = element;

  // Parse and render text
  const htmlContent = useMemo(() => {
    const blocks = parseBlocks(text || '');
    const lineHeight = style.lineHeight || 1.2;

    return blocks.map(block => {
      const segments = parseInlineSegments(block.displayContent, block.sourceStart + block.prefixLength);
      const html = renderBlockAsHtml(block, segments);
      const multiplier = getBlockFontMultiplier(block.type);
      const fontSize = style.fontSize * multiplier;
      const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
      const fontWeight = isHeader ? 'bold' : style.fontWeight;

      return `<div style="font-size:${fontSize}px;font-weight:${fontWeight};line-height:${lineHeight};min-height:${fontSize * lineHeight}px;margin:0;padding:0;">${html || '&nbsp;'}</div>`;
    }).join('');
  }, [text, style.fontSize, style.fontWeight, style.lineHeight]);

  const verticalAlignStyle = useMemo(() => {
    switch (style.verticalAlign) {
      case 'middle':
        return { display: 'flex', flexDirection: 'column' as const, justifyContent: 'center' };
      case 'bottom':
        return { display: 'flex', flexDirection: 'column' as const, justifyContent: 'flex-end' };
      default:
        return {};
    }
  }, [style.verticalAlign]);

  const cx = elementX + width / 2;
  const cy = elementY + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const padding = TEXT_BOX_PADDING;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <foreignObject
        x={elementX + padding}
        y={elementY + padding}
        width={width - padding * 2}
        height={height - padding * 2}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            fontFamily: style.fontFamily,
            fontStyle: style.fontStyle,
            color: style.color,
            textAlign: style.align,
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            opacity,
            ...verticalAlignStyle,
          }}
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </foreignObject>
    </g>
  );
}, (prevProps, nextProps) => {
  const prev = prevProps.element;
  const next = nextProps.element;

  return (
    prevProps.isEditing === nextProps.isEditing &&
    prev.visible === next.visible &&
    prev.text === next.text &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.x === next.x &&
    prev.y === next.y &&
    prev.rotation === next.rotation &&
    prev.opacity === next.opacity &&
    prev.style.fontSize === next.style.fontSize &&
    prev.style.fontFamily === next.style.fontFamily &&
    prev.style.fontWeight === next.style.fontWeight &&
    prev.style.fontStyle === next.style.fontStyle &&
    prev.style.color === next.style.color &&
    prev.style.align === next.style.align &&
    prev.style.verticalAlign === next.style.verticalAlign &&
    prev.style.lineHeight === next.style.lineHeight
  );
});

// ============================================================================
// Unified Element Renderer
// ============================================================================

interface ElementProps {
  element: SlideElement;
  resource?: Resource;
  isEditing?: boolean;
  clipIdPrefix?: string;
}

export const RenderElement: React.FC<ElementProps> = memo(({ element, resource, isEditing, clipIdPrefix }) => {
  if (!element.visible) return null;

  switch (element.type) {
    case 'text':
      return <RenderText element={element as TextElement} isEditing={isEditing} />;
    case 'shape':
      return <RenderShape element={element as ShapeElement} />;
    case 'image':
      return <RenderImage element={element as ImageElement} resource={resource} clipIdPrefix={clipIdPrefix} />;
    default:
      return null;
  }
});
