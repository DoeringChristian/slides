import React from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { SVGBackground } from './SVGBackground';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import type { Slide, SlideElement, ShapeElement, ImageElement, TextElement } from '../../types/presentation';

interface Props {
  slide: Slide;
  width: number;
  height: number;
  selectedElementIds?: string[];
  showHighlights?: boolean;
}

const StaticShapeElement: React.FC<{ element: ShapeElement }> = ({ element }) => {
  if (!element.visible) return null;

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const commonProps = {
    opacity: element.opacity,
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
      return (
        <g transform={transform}>
          <line
            x1={element.x + pts[0]}
            y1={element.y + pts[1]}
            x2={element.x + pts[2]}
            y2={element.y + pts[3]}
            stroke={element.stroke || element.fill || '#000'}
            strokeWidth={element.strokeWidth || 3}
            strokeLinecap="round"
            opacity={element.opacity}
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
        </g>
      );
    }

    default:
      return null;
  }
};

const StaticImageElement: React.FC<{ element: ImageElement; slideId: string }> = ({ element, slideId }) => {
  const resource = usePresentationStore((s) =>
    element.resourceId ? s.presentation.resources[element.resourceId] : undefined
  );

  if (!element.visible) return null;

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  if (!resource) {
    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#f3f4f6"
          stroke="#9ca3af"
          strokeWidth={2}
          strokeDasharray="8 4"
          opacity={element.opacity}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  // Video - show placeholder
  if (resource.type === 'video') {
    return (
      <g transform={transform}>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          fill="#1f2937"
          opacity={element.opacity}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  }

  // Image
  const hasCrop = element.cropWidth > 0 && element.cropHeight > 0;

  if (hasCrop) {
    const clipId = `clip-static-${slideId}-${element.id}`;
    const scaleX = element.width / element.cropWidth;
    const scaleY = element.height / element.cropHeight;

    return (
      <g transform={transform}>
        <defs>
          <clipPath id={clipId}>
            <rect x={element.x} y={element.y} width={element.width} height={element.height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <image
            href={resource.src}
            x={element.x - element.cropX * scaleX}
            y={element.y - element.cropY * scaleY}
            width={resource.originalWidth * scaleX}
            height={resource.originalHeight * scaleY}
            opacity={element.opacity}
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
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        opacity={element.opacity}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const StaticTextElement: React.FC<{ element: TextElement; scale: number }> = ({ element }) => {
  if (!element.visible) return null;

  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  const alignItems = element.style.verticalAlign === 'middle' ? 'center' :
                     element.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';

  return (
    <g transform={transform}>
      <foreignObject
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        style={{ pointerEvents: 'none', overflow: 'hidden' }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems,
            opacity: element.opacity,
            overflow: 'hidden',
          }}
        >
          <div style={{ width: '100%', padding: TEXT_BOX_PADDING }}>
            <CustomMarkdownRenderer
              text={element.text}
              style={element.style}
              zoom={1}
            />
          </div>
        </div>
      </foreignObject>
    </g>
  );
};

const HighlightRect: React.FC<{ element: SlideElement; scale: number }> = ({ element, scale }) => {
  const pad = 4 / scale;
  // Rotate around the center of the element
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const transform = element.rotation ? `rotate(${element.rotation}, ${cx}, ${cy})` : undefined;

  return (
    <g transform={transform}>
      <rect
        x={element.x - pad}
        y={element.y - pad}
        width={element.width + pad * 2}
        height={element.height + pad * 2}
        fill="rgba(59, 130, 246, 0.08)"
        stroke="#3b82f6"
        strokeWidth={3 / scale}
        strokeDasharray={`${6 / scale} ${3 / scale}`}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
};

const StaticElement: React.FC<{ element: SlideElement; isSelected?: boolean; scale: number; slideId: string }> = ({ element, isSelected, scale, slideId }) => {
  if (!element.visible) return null;

  const rendered = (() => {
    if (element.type === 'text') {
      return <StaticTextElement element={element as TextElement} scale={scale} />;
    }
    if (element.type === 'shape') {
      return <StaticShapeElement element={element as ShapeElement} />;
    }
    if (element.type === 'image') {
      return <StaticImageElement element={element as ImageElement} slideId={slideId} />;
    }
    return null;
  })();

  if (!rendered) return null;

  return isSelected ? (
    <>
      {rendered}
      <HighlightRect element={element} scale={scale} />
    </>
  ) : rendered;
};

export const SVGStaticSlide: React.FC<Props> = ({
  slide,
  width,
  height,
  selectedElementIds,
  showHighlights = false,
}) => {
  const scale = width / SLIDE_WIDTH;
  const selectedSet = selectedElementIds && selectedElementIds.length > 0 ? new Set(selectedElementIds) : null;

  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
      style={{ display: 'block' }}
    >
      <SVGBackground
        background={slide.background}
        width={SLIDE_WIDTH}
        height={SLIDE_HEIGHT}
      />
      {elements.map((el) => (
        <StaticElement
          key={el.id}
          element={el}
          isSelected={showHighlights && selectedSet?.has(el.id)}
          scale={scale}
          slideId={slide.id}
        />
      ))}
    </svg>
  );
};
