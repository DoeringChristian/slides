import React from 'react';
import type { ShapeElement } from '../../types/presentation';

interface Props {
  element: ShapeElement;
  disableInteraction?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}

export const SVGShapeNode: React.FC<Props> = ({
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

  const commonProps = {
    opacity: element.opacity,
    fill: element.fill || 'transparent',
    stroke: element.stroke || 'none',
    strokeWidth: element.strokeWidth || 0,
    style: {
      cursor: disableInteraction ? 'default' : (element.locked ? 'default' : 'move'),
      pointerEvents: disableInteraction ? 'none' as const : 'auto' as const,
    },
    onMouseDown: disableInteraction ? undefined : onMouseDown,
    onMouseEnter: disableInteraction ? undefined : onMouseEnter,
    onMouseLeave: disableInteraction ? undefined : onMouseLeave,
    onDoubleClick: disableInteraction ? undefined : onDoubleClick,
  };

  switch (element.shapeType) {
    case 'rect':
      return (
        <g transform={transform} data-element-id={element.id}>
          <rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={element.cornerRadius || 0}
            ry={element.cornerRadius || 0}
            {...commonProps}
          />
        </g>
      );

    case 'ellipse':
      return (
        <g transform={transform} data-element-id={element.id}>
          <ellipse
            cx={element.x + element.width / 2}
            cy={element.y + element.height / 2}
            rx={element.width / 2}
            ry={element.height / 2}
            {...commonProps}
          />
        </g>
      );

    case 'triangle': {
      const tcx = element.x + element.width / 2;
      const tcy = element.y + element.height / 2;
      const r = Math.min(element.width, element.height) / 2;
      // Triangle points (pointing up)
      const points = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} Z`;
      return (
        <g transform={transform} data-element-id={element.id}>
          <path d={d} {...commonProps} />
        </g>
      );
    }

    case 'star': {
      const scx = element.x + element.width / 2;
      const scy = element.y + element.height / 2;
      const outerR = Math.min(element.width, element.height) / 2;
      const innerR = outerR / 2;
      const points: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        points.push(`${scx + r * Math.cos(angle)},${scy + r * Math.sin(angle)}`);
      }
      return (
        <g transform={transform} data-element-id={element.id}>
          <polygon points={points.join(' ')} {...commonProps} />
        </g>
      );
    }

    case 'line': {
      const pts = element.points ?? [0, 0, element.width, 0];
      const lineStroke = element.stroke || element.fill || '#000';
      const lineStrokeWidth = element.strokeWidth || 3;
      // Rotate around line center, not bounding box center
      const lineCx = element.x + (pts[0] + pts[2]) / 2;
      const lineCy = element.y + (pts[1] + pts[3]) / 2;
      const lineTransform = element.rotation ? `rotate(${element.rotation}, ${lineCx}, ${lineCy})` : undefined;
      return (
        <g transform={lineTransform} data-element-id={element.id}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke={lineStroke}
            strokeWidth={lineStrokeWidth}
            strokeLinecap="round"
            opacity={commonProps.opacity}
            fill="none"
            style={commonProps.style}
          />
          {/* Invisible wider line for easier selection */}
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke="transparent"
            strokeWidth={20}
            style={commonProps.style}
            onMouseDown={commonProps.onMouseDown}
            onMouseEnter={commonProps.onMouseEnter}
            onMouseLeave={commonProps.onMouseLeave}
          />
        </g>
      );
    }

    case 'arrow': {
      const pts = element.points ?? [0, 0, element.width, 0];
      const strokeColor = element.stroke || element.fill || '#000';
      const strokeW = element.strokeWidth || 3;

      // Calculate arrow head
      const dx = pts[2] - pts[0];
      const dy = pts[3] - pts[1];
      const angle = Math.atan2(dy, dx);
      const headLength = 10;
      const headWidth = 10;

      const tip = { x: element.x + pts[2], y: element.y + pts[3] };
      // Line should stop at the base of the arrowhead
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
      const arrowCx = element.x + (pts[0] + pts[2]) / 2;
      const arrowCy = element.y + (pts[1] + pts[3]) / 2;
      const arrowTransform = element.rotation ? `rotate(${element.rotation}, ${arrowCx}, ${arrowCy})` : undefined;

      return (
        <g transform={arrowTransform} data-element-id={element.id}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={lineEnd.x}
            y2={lineEnd.y}
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
            opacity={element.opacity}
          />
          <polygon
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill={strokeColor}
            opacity={element.opacity}
          />
          {/* Invisible wider line for easier selection */}
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke="transparent"
            strokeWidth={20}
            style={commonProps.style}
            onMouseDown={commonProps.onMouseDown}
            onMouseEnter={commonProps.onMouseEnter}
            onMouseLeave={commonProps.onMouseLeave}
          />
        </g>
      );
    }

    default:
      return null;
  }
};
