import React from 'react';
import { CustomMarkdownRenderer } from '../canvas/CustomMarkdownRenderer';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from '../../utils/constants';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';

// Get slide background color
export function getSlideBackground(slide: Slide): string {
  return slide.background.type === 'solid' ? slide.background.color : '#ffffff';
}

// Merge element orders from two slides for animation
// isForward: true = navigating to next slide, false = navigating to previous slide
//
// For forward animation: use target's order, fading-out elements at end
//   - Elements appearing (in target) are at their correct z-position
//   - Elements disappearing (source-only) fade out on top
//
// For backward animation: use source's order, fading-in elements at end
//   - Elements disappearing (source-only) stay at their original z-position
//   - Elements appearing (target-only) fade in from below
export function mergeElementOrders(sourceSlide: Slide | null, targetSlide: Slide | null, isForward: boolean = true): string[] {
  if (!targetSlide && !sourceSlide) return [];
  if (!targetSlide) return sourceSlide!.elementOrder;
  if (!sourceSlide) return targetSlide.elementOrder;

  if (isForward) {
    // Use target's order as base, add source-only elements at end
    const baseOrder = [...targetSlide.elementOrder];
    const baseSet = new Set(baseOrder);

    for (const id of sourceSlide.elementOrder) {
      if (!baseSet.has(id)) {
        baseOrder.push(id);
      }
    }

    return baseOrder;
  } else {
    // Use source's order as base, add target-only elements at end
    const baseOrder = [...sourceSlide.elementOrder];
    const baseSet = new Set(baseOrder);

    for (const id of targetSlide.elementOrder) {
      if (!baseSet.has(id)) {
        baseOrder.push(id);
      }
    }

    return baseOrder;
  }
}

// SVG Shape Element renderer
export const PresenterShapeElement: React.FC<{ element: ShapeElement }> = ({ element }) => {
  if (!element.visible) return null;

  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, cornerRadius, points } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const fillAttr = fill || 'transparent';
  const strokeAttr = stroke || 'none';
  const strokeWidthAttr = strokeWidth || 0;

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
            fill={fillAttr}
            stroke={strokeAttr}
            strokeWidth={strokeWidthAttr}
            opacity={opacity}
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
            fill={fillAttr}
            stroke={strokeAttr}
            strokeWidth={strokeWidthAttr}
            opacity={opacity}
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
          <path d={d} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWidthAttr} opacity={opacity} />
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
          <polygon points={starPoints.join(' ')} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWidthAttr} opacity={opacity} />
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
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };
      return (
        <g transform={transform}>
          <line
            x1={x + pts[0]}
            y1={y + pts[1]}
            x2={x + pts[2]}
            y2={y + pts[3]}
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
      return (
        <g transform={transform}>
          <rect x={x} y={y} width={width} height={height} fill={fillAttr} stroke={strokeAttr} strokeWidth={strokeWidthAttr} opacity={opacity} />
        </g>
      );
  }
};

// SVG Image Element renderer
export const PresenterImageElement: React.FC<{ element: ImageElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  const resource = element.resourceId ? resources[element.resourceId] : undefined;

  if (!element.visible) return null;

  // Skip videos - they're rendered as HTML overlay
  if (resource?.type === 'video') return null;

  // No resource - render placeholder
  if (!resource) {
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
          fill="#f3f4f6"
          stroke="#9ca3af"
          strokeWidth={2}
          strokeDasharray="8 4"
          opacity={element.opacity}
        />
      </g>
    );
  }

  const { x, y, width, height, rotation, opacity, cropX, cropY, cropWidth, cropHeight } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const hasCrop = cropWidth > 0 && cropHeight > 0;

  if (hasCrop) {
    const clipId = `clip-presenter-${element.id}`;
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
      />
    </g>
  );
};

// SVG Element renderer (dispatches to shape/image)
export const PresenterSlideElement: React.FC<{ element: SlideElement; resources: Record<string, Resource> }> = ({ element, resources }) => {
  if (!element.visible) return null;

  // Text is rendered as HTML overlay for markdown support
  if (element.type === 'text') return null;

  if (element.type === 'shape') {
    return <PresenterShapeElement element={element as ShapeElement} />;
  }

  if (element.type === 'image') {
    return <PresenterImageElement element={element as ImageElement} resources={resources} />;
  }

  return null;
};

// Render a single element with correct positioning and z-order
export function renderPresenterElement(
  element: SlideElement,
  index: number,
  scale: number,
  stageW: number,
  stageH: number,
  resources: Record<string, Resource>
): React.ReactNode {
  if (!element.visible) return null;

  // Text elements use HTML for markdown support
  if (element.type === 'text') {
    const textEl = element as TextElement;
    return (
      <div
        key={element.id}
        style={{
          position: 'absolute',
          left: `${element.x * scale}px`,
          top: `${element.y * scale}px`,
          width: `${element.width * scale}px`,
          height: `${element.height * scale}px`,
          transform: `rotate(${element.rotation}deg)`,
          transformOrigin: 'top left',
          opacity: element.opacity,
          overflow: 'hidden',
          display: 'flex',
          alignItems: textEl.style.verticalAlign === 'middle' ? 'center' :
                     textEl.style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
          zIndex: index,
        }}
      >
        <div style={{ width: '100%', padding: `${TEXT_BOX_PADDING * scale}px` }}>
          <CustomMarkdownRenderer
            text={textEl.text}
            style={textEl.style}
            zoom={scale}
          />
        </div>
      </div>
    );
  }

  // Video elements use HTML video
  if (element.type === 'image') {
    const imgEl = element as ImageElement;
    const resource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;

    if (resource?.type === 'video') {
      const hasCrop = imgEl.cropWidth > 0 && imgEl.cropHeight > 0;

      if (hasCrop) {
        const scaleX = resource.originalWidth / imgEl.cropWidth;
        const scaleY = resource.originalHeight / imgEl.cropHeight;

        return (
          <div
            key={element.id}
            style={{
              position: 'absolute',
              left: `${element.x * scale}px`,
              top: `${element.y * scale}px`,
              width: `${element.width * scale}px`,
              height: `${element.height * scale}px`,
              transform: `rotate(${element.rotation}deg)`,
              transformOrigin: 'top left',
              opacity: element.opacity,
              overflow: 'hidden',
              zIndex: index,
            }}
          >
            <video
              src={resource.src}
              autoPlay={imgEl.playing ?? true}
              loop={imgEl.loop ?? false}
              muted={imgEl.muted ?? false}
              playsInline
              style={{
                width: `${element.width * scale * scaleX}px`,
                height: `${element.height * scale * scaleY}px`,
                marginLeft: `${-imgEl.cropX * (element.width / imgEl.cropWidth) * scale}px`,
                marginTop: `${-imgEl.cropY * (element.height / imgEl.cropHeight) * scale}px`,
              }}
            />
          </div>
        );
      }

      return (
        <video
          key={element.id}
          src={resource.src}
          autoPlay={imgEl.playing ?? true}
          loop={imgEl.loop ?? false}
          muted={imgEl.muted ?? false}
          playsInline
          style={{
            position: 'absolute',
            left: `${element.x * scale}px`,
            top: `${element.y * scale}px`,
            width: `${element.width * scale}px`,
            height: `${element.height * scale}px`,
            transform: `rotate(${element.rotation}deg)`,
            transformOrigin: 'top left',
            opacity: element.opacity,
            objectFit: 'cover',
            zIndex: index,
          }}
        />
      );
    }
  }

  // Shapes and images use inline SVG
  return (
    <svg
      key={element.id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: stageW,
        height: stageH,
        pointerEvents: 'none',
        zIndex: index,
      }}
      viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
    >
      <PresenterSlideElement element={element} resources={resources} />
    </svg>
  );
}
