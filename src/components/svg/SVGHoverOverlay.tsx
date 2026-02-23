import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import type { SlideElement, ShapeElement, ImageElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
  isVisibleOnSlide: boolean;
}

const HIGHLIGHT_COLOR = '#f59e0b';
const GHOST_OPACITY = 0.35;

// Calculate bounding box for lines/arrows from their points
function getLineBoundingBox(element: ShapeElement): { x: number; y: number; width: number; height: number } {
  const points = element.points ?? [0, 0, element.width, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const GhostImage: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  const transform = `translate(${element.x}, ${element.y}) rotate(${element.rotation || 0})`;

  if (!resource || resource.type === 'video') {
    return (
      <g transform={transform}>
        <rect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          fill={resource?.type === 'video' ? '#1f2937' : '#f3f4f6'}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  return (
    <g transform={transform}>
      <image
        href={resource.src}
        x={0}
        y={0}
        width={element.width}
        height={element.height}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const GhostShape: React.FC<{ element: ShapeElement }> = ({ element }) => {
  const transform = `translate(${element.x}, ${element.y}) rotate(${element.rotation || 0})`;

  const commonProps = {
    fill: element.fill || 'transparent',
    stroke: element.stroke || 'none',
    strokeWidth: element.strokeWidth || 0,
    style: { pointerEvents: 'none' as const },
  };

  switch (element.shapeType) {
    case 'rect':
      return (
        <g transform={transform}>
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
        <g transform={transform}>
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
      const points = [
        [cx, cy - r],
        [cx - r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
        [cx + r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} Z`;
      return (
        <g transform={transform}>
          <path d={d} {...commonProps} />
        </g>
      );
    }
    case 'star': {
      const cx = element.width / 2;
      const cy = element.height / 2;
      const outerR = Math.min(element.width, element.height) / 2;
      const innerR = outerR / 2;
      const starPoints: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        starPoints.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      return (
        <g transform={transform}>
          <polygon points={starPoints.join(' ')} {...commonProps} />
        </g>
      );
    }
    case 'line': {
      const pts = element.points ?? [0, 0, element.width, 0];
      return (
        <g transform={transform}>
          <line
            x1={pts[0]}
            y1={pts[1]}
            x2={pts[2]}
            y2={pts[3]}
            stroke={element.stroke || element.fill || '#000'}
            strokeWidth={element.strokeWidth || 3}
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    }
    case 'arrow': {
      const pts = element.points ?? [0, 0, element.width, 0];
      const strokeColor = element.stroke || element.fill || '#000';
      const strokeW = element.strokeWidth || 3;
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
        <g transform={transform} style={{ pointerEvents: 'none' }}>
          <line
            x1={pts[0]}
            y1={pts[1]}
            x2={pts[2]}
            y2={pts[3]}
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
          <polygon
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill={strokeColor}
          />
        </g>
      );
    }
    default:
      return null;
  }
};

const GhostElement: React.FC<{ element: SlideElement }> = ({ element }) => {
  if (element.type === 'text') {
    // Text ghost - just a simple rect since actual text is rendered via HTML overlay
    const transform = `translate(${element.x}, ${element.y}) rotate(${element.rotation || 0})`;
    return (
      <g transform={transform}>
        <rect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          fill="#e5e7eb"
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  if (element.type === 'shape') {
    return <GhostShape element={element as ShapeElement} />;
  }

  if (element.type === 'image') {
    return <GhostImage element={element as ImageElement} />;
  }

  return null;
};

const HighlightRect: React.FC<{ element: SlideElement }> = ({ element }) => {
  const isLine = element.type === 'shape' &&
    ((element as ShapeElement).shapeType === 'line' || (element as ShapeElement).shapeType === 'arrow');

  const bounds = isLine
    ? getLineBoundingBox(element as ShapeElement)
    : { x: 0, y: 0, width: element.width, height: element.height };

  const transform = `translate(${element.x}, ${element.y}) rotate(${element.rotation || 0})`;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <rect
        x={bounds.x - 3}
        y={bounds.y - 3}
        width={bounds.width + 6}
        height={bounds.height + 6}
        fill="none"
        stroke={HIGHLIGHT_COLOR}
        strokeWidth={2}
        rx={3}
        ry={3}
        strokeDasharray="6 3"
      />
    </g>
  );
};

export const SVGHoverOverlay: React.FC<Props> = ({ element, isVisibleOnSlide }) => {
  if (isVisibleOnSlide) {
    return <HighlightRect element={element} />;
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      <g opacity={GHOST_OPACITY}>
        <GhostElement element={element} />
      </g>
      <HighlightRect element={element} />
    </g>
  );
};
