import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { getLineCenter, getElementBounds, getElementCenter } from '../../utils/geometry';
import type { SlideElement, ShapeElement, ImageElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
  isVisibleOnSlide: boolean;
  zoom?: number;
}

const HIGHLIGHT_COLOR = '#f59e0b';
const GHOST_OPACITY = 0.35;

const GhostImage: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  if (!resource || resource.type === 'video') {
    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
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
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const GhostShape: React.FC<{ element: ShapeElement }> = ({ element }) => {
  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

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
        <g transform={transform}>
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
      const points = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} Z`;
      return (
        <g transform={transform}>
          <path d={d} {...commonProps} />
        </g>
      );
    }
    case 'star': {
      const scx = element.x + element.width / 2;
      const scy = element.y + element.height / 2;
      const outerR = Math.min(element.width, element.height) / 2;
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
      const pts = element.points ?? [0, 0, element.width, 0];
      const lineCenter = getLineCenter(element);
      const lineTransform = element.rotation ? `rotate(${element.rotation}, ${lineCenter.x}, ${lineCenter.y})` : undefined;
      return (
        <g transform={lineTransform}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
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
      const lineCenter = getLineCenter(element);
      const arrowTransform = element.rotation ? `rotate(${element.rotation}, ${lineCenter.x}, ${lineCenter.y})` : undefined;
      return (
        <g transform={arrowTransform} style={{ pointerEvents: 'none' }}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={lineEnd.x}
            y2={lineEnd.y}
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
    // Rotate around the center of the element
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;
    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
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

const HighlightRect: React.FC<{ element: SlideElement; zoom: number }> = ({ element, zoom }) => {
  const bounds = getElementBounds(element);
  const center = getElementCenter(element);
  const transform = element.rotation ? `rotate(${element.rotation}, ${center.x}, ${center.y})` : undefined;

  // Scale sizes inversely with zoom to keep them constant on screen
  const padding = 3 / zoom;
  const strokeW = 2 / zoom;
  const radius = 3 / zoom;
  const dashArray = `${6 / zoom} ${3 / zoom}`;

  return (
    <g transform={transform} style={{ pointerEvents: 'none' }}>
      <rect
        x={bounds.x - padding}
        y={bounds.y - padding}
        width={bounds.width + padding * 2}
        height={bounds.height + padding * 2}
        fill="none"
        stroke={HIGHLIGHT_COLOR}
        strokeWidth={strokeW}
        rx={radius}
        ry={radius}
        strokeDasharray={dashArray}
      />
    </g>
  );
};

export const SVGHoverOverlay: React.FC<Props> = ({ element, isVisibleOnSlide, zoom = 1 }) => {
  if (isVisibleOnSlide) {
    return <HighlightRect element={element} zoom={zoom} />;
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      <g opacity={GHOST_OPACITY}>
        <GhostElement element={element} />
      </g>
      <HighlightRect element={element} zoom={zoom} />
    </g>
  );
};
