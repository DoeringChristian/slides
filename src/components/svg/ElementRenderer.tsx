import React, { memo } from 'react';
import { SVGTextContent } from './SVGTextContent';
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
      // Rotate around line center, not bounding box center
      const lineCx = x + (pts[0] + pts[2]) / 2;
      const lineCy = y + (pts[1] + pts[3]) / 2;
      const lineTransform = rotation ? `rotate(${rotation}, ${lineCx}, ${lineCy})` : undefined;
      return (
        <g transform={lineTransform}>
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
      // Rotate around line center, not bounding box center
      const arrowCx = x + (pts[0] + pts[2]) / 2;
      const arrowCy = y + (pts[1] + pts[3]) / 2;
      const arrowTransform = rotation ? `rotate(${rotation}, ${arrowCx}, ${arrowCy})` : undefined;
      return (
        <g transform={arrowTransform} style={{ pointerEvents: 'none' }}>
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

  // No resource - render placeholder
  if (!resource) {
    return (
      <g transform={transform}>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="#f3f4f6"
          stroke="#9ca3af"
          strokeWidth={2}
          strokeDasharray="8 4"
          opacity={opacity}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  // Video - show first frame using paused video in foreignObject
  if (resource.type === 'video') {
    return (
      <g transform={transform}>
        <foreignObject
          x={x}
          y={y}
          width={width}
          height={height}
          opacity={opacity}
          style={{ pointerEvents: 'none' }}
        >
          <video
            src={resource.src}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
            muted
            playsInline
            preload="metadata"
          />
        </foreignObject>
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
      return <SVGTextContent element={element as TextElement} isEditing={isEditing} opacity={element.opacity} clipIdPrefix={clipIdPrefix ? `text-clip-${clipIdPrefix}` : 'text-clip'} />;
    case 'shape':
      return <RenderShape element={element as ShapeElement} />;
    case 'image':
      return <RenderImage element={element as ImageElement} resource={resource} clipIdPrefix={clipIdPrefix} />;
    default:
      return null;
  }
});
