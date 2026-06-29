import React, { memo } from 'react';
import { SVGTextPaths } from './SVGTextPaths';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { pathD, arrowheadPoints, insetEndpoints, strokeDashFor } from '../../utils/pathShapes';
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

    case 'path': {
      const pts = points ?? [];
      if (pts.length < 4) return null;
      const closed = element.closed ?? false;
      const curve = element.curve ?? 'linear';
      // Per-arrow alpha: defaults to the boolean's binary value, but
      // interpolation can override with a `_startArrowAlpha` / `_endArrowAlpha`
      // synthetic field to fade the arrow during a slide transition.
      const animFx = element as ShapeElement & {
        _startArrowAlpha?: number;
        _endArrowAlpha?: number;
      };
      const startAlpha = animFx._startArrowAlpha ?? (element.startArrow ? 1 : 0);
      const endAlpha = animFx._endArrowAlpha ?? (element.endArrow ? 1 : 0);
      const hasStartArrow = startAlpha > 0;
      const hasEndArrow = endAlpha > 0;
      // Pull the shaft back from any arrowhead end so it stops at the
      // triangle base instead of poking through to the tip vertex.
      const shaftPts = insetEndpoints(pts, hasStartArrow, hasEndArrow);
      const cornerR = curve === 'linear' ? (element.cornerRadius ?? 0) : 0;
      const d = pathD(shaftPts, curve, closed, cornerR);
      // Stroke colour falls back to fill or black so a freshly-drawn open
      // path always renders something visible (it has no fill by default).
      const strokeCol = strokeAttr === 'none'
        ? (fillAttr === 'transparent' ? '#000' : fillAttr)
        : strokeAttr;
      const strokeW = strokeWidthAttr || (closed ? 0 : 3);
      const fillCol = closed ? fillAttr : 'none';
      const last = pts.length - 2;
      const startHead = hasStartArrow
        ? arrowheadPoints(pts[0], pts[1], pts[0] - pts[2], pts[1] - pts[3])
        : null;
      const endHead = hasEndArrow
        ? arrowheadPoints(pts[last], pts[last + 1], pts[last] - pts[last - 2], pts[last + 1] - pts[last - 1])
        : null;
      return (
        <g transform={transform}>
          <g transform={`translate(${x}, ${y})`}>
            <path
              d={d}
              fill={fillCol}
              stroke={strokeCol}
              strokeWidth={strokeW}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={strokeDashFor(element.strokeStyle, strokeW)}
              opacity={opacity}
              style={{ pointerEvents: 'none' }}
            />
            {startHead && (
              <polygon
                points={`${startHead[0]},${startHead[1]} ${startHead[2]},${startHead[3]} ${startHead[4]},${startHead[5]}`}
                fill={strokeCol}
                opacity={opacity * startAlpha}
              />
            )}
            {endHead && (
              <polygon
                points={`${endHead[0]},${endHead[1]} ${endHead[2]},${endHead[3]} ${endHead[4]},${endHead[5]}`}
                fill={strokeCol}
                opacity={opacity * endAlpha}
              />
            )}
          </g>
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
  /** Reserved for legacy callers; the new HTML rendering doesn't need it. */
  clipIdPrefix?: string;
  /**
   * Override video autoplay. Defaults to `element.playing ?? true`.
   * Editor passes `false` (paused preview); cross-fade source passes `false`
   * so the transition doesn't pop a video into playback.
   */
  videoAutoplay?: boolean;
}

// We render image/video content as HTML inside a single full-slide
// <foreignObject>. Movement during transitions / drag is a CSS transform on
// the inner <div>, which the browser GPU-composites — no SVG layout per
// frame, no raster refit. Compare the old path: SVG <image> with x/y/width/
// height attributes that re-fit the raster on every frame change.
//
// The foreignObject is sized to (0, 0, SLIDE_WIDTH, SLIDE_HEIGHT) so the
// inner CSS coordinates align directly with the element's slide coordinates,
// and the same renderer works inside any parent SVG whose viewBox contains
// the slide region (editor canvas with padded viewBox, static thumbnail with
// exact viewBox, presenter SVG composition).
//
// `pointer-events: none` on the foreignObject lets clicks pass through to
// elements behind/in front in the same SVG document; the editor adds its own
// transparent hit <rect> at the element layer.
export const RenderImage: React.FC<ImageProps> = memo(({ element, resource, videoAutoplay }) => {
  if (!element.visible) return null;

  const { x, y, width, height, rotation, opacity, cropX, cropY, cropWidth, cropHeight } = element;

  // No resource - render placeholder. Vector, doesn't move much, stays SVG.
  if (!resource) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const placeholderTransform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;
    return (
      <g transform={placeholderTransform}>
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

  const hasCrop = cropWidth > 0 && cropHeight > 0;
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg)`,
    transformOrigin: '50% 50%',
    opacity,
    overflow: hasCrop ? 'hidden' : 'visible',
    willChange: 'transform',
    pointerEvents: 'none',
  };

  const isVideo = resource.type === 'video';

  return (
    <foreignObject
      x={0}
      y={0}
      width={SLIDE_WIDTH}
      height={SLIDE_HEIGHT}
      style={{ pointerEvents: 'none', overflow: 'visible' }}
    >
      <div style={containerStyle}>
        {hasCrop ? (
          // Crop: oversize the media and offset it so the crop region fills the box.
          (() => {
            const scaleX = width / cropWidth;
            const scaleY = height / cropHeight;
            const mediaStyle: React.CSSProperties = {
              position: 'absolute',
              left: `${-cropX * scaleX}px`,
              top: `${-cropY * scaleY}px`,
              width: `${resource.originalWidth * scaleX}px`,
              height: `${resource.originalHeight * scaleY}px`,
              display: 'block',
              pointerEvents: 'none',
            };
            return isVideo ? (
              <video
                src={resource.src}
                style={mediaStyle}
                autoPlay={videoAutoplay ?? element.playing ?? true}
                loop={element.loop ?? false}
                muted={element.muted ?? true}
                playsInline
                preload="metadata"
              />
            ) : (
              <img src={resource.src} alt="" style={mediaStyle} draggable={false} />
            );
          })()
        ) : (
          (() => {
            const mediaStyle: React.CSSProperties = {
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              display: 'block',
              pointerEvents: 'none',
            };
            return isVideo ? (
              <video
                src={resource.src}
                style={mediaStyle}
                autoPlay={videoAutoplay ?? element.playing ?? true}
                loop={element.loop ?? false}
                muted={element.muted ?? true}
                playsInline
                preload="metadata"
              />
            ) : (
              <img src={resource.src} alt="" style={mediaStyle} draggable={false} />
            );
          })()
        )}
      </div>
    </foreignObject>
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
      return <SVGTextPaths element={element as TextElement} isEditing={isEditing} opacity={element.opacity} clipIdPrefix={clipIdPrefix ? `text-clip-${clipIdPrefix}` : 'text-clip'} />;
    case 'shape':
      return <RenderShape element={element as ShapeElement} />;
    case 'image':
      return <RenderImage element={element as ImageElement} resource={resource} clipIdPrefix={clipIdPrefix} />;
    default:
      return null;
  }
});
