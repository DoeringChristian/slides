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
  const transform = `translate(${element.x}, ${element.y}) rotate(${element.rotation || 0})`;

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
            x={0}
            y={0}
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
            cx={element.width / 2}
            cy={element.height / 2}
            rx={element.width / 2}
            ry={element.height / 2}
            {...commonProps}
          />
        </g>
      );

    case 'triangle': {
      const cx = element.width / 2;
      const cy = element.height / 2;
      const r = Math.min(element.width, element.height) / 2;
      // Triangle points (pointing up)
      const points = [
        [cx, cy - r],
        [cx - r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
        [cx + r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} Z`;
      return (
        <g transform={transform} data-element-id={element.id}>
          <path d={d} {...commonProps} />
        </g>
      );
    }

    case 'star': {
      const cx = element.width / 2;
      const cy = element.height / 2;
      const outerR = Math.min(element.width, element.height) / 2;
      const innerR = outerR / 2;
      const points: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
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
      return (
        <g transform={transform} data-element-id={element.id}>
          <line
            x1={pts[0]}
            y1={pts[1]}
            x2={pts[2]}
            y2={pts[3]}
            stroke={lineStroke}
            strokeWidth={lineStrokeWidth}
            strokeLinecap="round"
            opacity={commonProps.opacity}
            fill="none"
            style={commonProps.style}
          />
          {/* Invisible wider line for easier selection */}
          <line
            x1={pts[0]}
            y1={pts[1]}
            x2={pts[2]}
            y2={pts[3]}
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

      const tip = { x: pts[2], y: pts[3] };
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };

      return (
        <g transform={transform} data-element-id={element.id}>
          <line
            x1={pts[0]}
            y1={pts[1]}
            x2={pts[2]}
            y2={pts[3]}
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
            x1={pts[0]}
            y1={pts[1]}
            x2={pts[2]}
            y2={pts[3]}
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
