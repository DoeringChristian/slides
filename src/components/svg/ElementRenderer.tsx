import { GroupCrop } from './GroupCrop';
import { groupCropPaint, type GroupCropElement } from '../../utils/model/groupCrop';
import { SVGStrokeCoverage } from './SVGStrokeCoverage';
import { resolveShapePaint, rectangleRadii } from '../../utils/paint/shapePaint';
import { resolveShapeGeometry } from '../../utils/geometry/vectorGeometry';
import { getRotationCenter } from '../../utils/geometry/geometry';
import React, { memo, useId } from 'react';
import { useMediaStill, useVideoPoster } from './mediaSources';
import { useMediaSource } from '../../media/useMediaSource';
import { ShapeFillPaint } from './ShapeFillPaint';
import { SVGStrokeClip } from './SVGStrokeClip';
import { SVGTextPaths } from './SVGTextPaths';
import { imageTintShape } from '../../utils/paint/imageTint';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { pathArrowGeometry, strokeDashFor, type ArrowheadGeometry } from '../../utils/paths/pathShapes';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Resource } from '../../types/presentation';

// ============================================================================
// Arrowhead renderer (shared leaf)
// ============================================================================

/** Draw one `arrowheadGeometry` result as SVG: fills painted in the shaft's
 *  stroke colour, strokes at the shaft's strokeWidth with round caps/joins.
 *  Shared by the editor/export path renderer below, the presenter's
 *  tip-draw animation, and the property-panel previews — the preview IS the
 *  production glyph. */
export const RenderArrowhead: React.FC<{
  geo: ArrowheadGeometry;
  color: string;
  strokeWidth: number;
  opacity?: number;
  transform?: string;
}> = ({ geo, color, strokeWidth, opacity, transform }) => (
  <g opacity={opacity} transform={transform}>
    {geo.fills.map((f, i) =>
      'points' in f ? (
        <polygon
          key={`f${i}`}
          points={Array.from({ length: f.points.length / 2 }, (_, k) => `${f.points[2 * k]},${f.points[2 * k + 1]}`).join(' ')}
          fill={color}
        />
      ) : (
        <path key={`f${i}`} d={f.d} fill={color} />
      ),
    )}
    {geo.strokes.map((s, i) => (
      <path
        key={`s${i}`}
        d={s.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ))}
  </g>
);

// ============================================================================
// Shape Renderer
// ============================================================================

interface ShapeProps {
  element: ShapeElement;
}

export const RenderShape: React.FC<ShapeProps> = memo(({ element }) => {
  const painted = groupCropPaint(element);
  return <GroupCrop element={element}><ShapeFillPaint element={painted}>{paint => <ShapeBody element={painted} fillPaint={paint} />}</ShapeFillPaint></GroupCrop>;
});

const ShapeBody: React.FC<ShapeProps & { fillPaint?: string }> = memo(({ element, fillPaint }) => {
  const coverageId = useId();
  if (!element.visible) return null;

  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, points } = element;

  const { x: cx, y: cy } = getRotationCenter(element);
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : undefined;

  const fillAttr = fillPaint ?? (fill || 'transparent');
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
    case 'vector': {
      const geometry = resolveShapeGeometry(element);
      return <g transform={transform} opacity={opacity} style={{ pointerEvents: 'none' }}>
        {geometry.fills.map((region, i) => <path key={`f${i}`} d={region.d} fill={fillAttr} fillRule={region.rule} stroke="none" />)}
        <path d={geometry.strokes.join(' ')} fill="none" stroke={strokeAttr} strokeWidth={strokeWidthAttr}
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray={strokeDashFor(element.strokeStyle, strokeWidthAttr)} />
      </g>;
    }
    case 'rect':
      return (
        <g transform={transform}>
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={rectangleRadii(element).rx}
            ry={rectangleRadii(element).ry}
            {...commonProps}
          />
        </g>
      );

    case 'dot':
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
      // Per-arrowhead alpha: defaults to head presence, but interpolation
      // can override with a `_startArrowAlpha` / `_endArrowAlpha` synthetic
      // field to fade the head during a slide transition (the head TYPE
      // itself snaps at t=0.5 in interpolation).
      // `_labelMask` is another synthetic hint (attachLabelMasks in
      // utils/syncDependents.ts): a background-coloured rect painted over
      // the shaft under a bound-text label, so arrow labels punch a gap in
      // the line (Excalidraw style). Computed by whoever has slide context
      // (editor canvas, presenter frame composition, exports) — the shared
      // renderer just draws it, so every consumer inherits the behaviour.
      const animFx = element as ShapeElement & {
        _startArrowAlpha?: number;
        _endArrowAlpha?: number;
        _labelMask?: { x: number; y: number; width: number; height: number; color: string };
      };
      const labelMask = animFx._labelMask;
      const startType = element.startHead ?? 'none';
      const endType = element.endHead ?? 'none';
      const startAlpha = animFx._startArrowAlpha ?? (startType !== 'none' ? 1 : 0);
      const endAlpha = animFx._endArrowAlpha ?? (endType !== 'none' ? 1 : 0);
      // Stroke colour falls back to fill or black so a freshly-drawn open
      // path always renders something visible (it has no fill by default).
      const { stroke: strokeCol, strokeWidth: strokeW, fill: fillCol, fillOpacity } = resolveShapePaint(element, fillAttr);
      const { startGeo, endGeo, d, fillD, shaftClipPaths, strokePlan } = pathArrowGeometry({ ...element,
        startHead: startAlpha > 0 ? startType : 'none', endHead: endAlpha > 0 ? endType : 'none',
      });
      const separateFill = !!strokePlan || shaftClipPaths.length > 0 || fillOpacity !== undefined;
      // One opacity for the arrow AND its label mask, applied to the group
      // that holds both. The mask used to sit outside it at full strength,
      // so a fading arrow left a solid background-coloured hole behind; and
      // fading the two separately would let the shaft show through the mask.
      return (
        <g opacity={opacity}>
          <g transform={transform}>
            <g transform={`translate(${x}, ${y})`}>
              {/* Head cuts affect only the shaft stroke, never the closed fill. */}
              {separateFill && fillCol !== 'none' && (
                <path d={fillD} fill={fillCol} fillOpacity={fillOpacity} stroke="none" style={{ pointerEvents: 'none' }} />
              )}
              <SVGStrokeClip paths={shaftClipPaths} idPrefix={element.id}>
              {strokePlan ? <SVGStrokeCoverage plan={strokePlan} color={strokeCol} width={strokeW}
                dash={strokeDashFor(element.strokeStyle, strokeW)} idPrefix={element.id} instanceId={coverageId} /> : <path
                d={d}
                fill={separateFill ? 'none' : fillCol}
                stroke={strokeCol}
                strokeWidth={strokeW}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={strokeDashFor(element.strokeStyle, strokeW)}
                style={{ pointerEvents: 'none' }}
              />}
              </SVGStrokeClip>
              {startGeo && (
                <RenderArrowhead geo={startGeo} color={strokeCol} strokeWidth={strokeW} opacity={startAlpha} />
              )}
              {endGeo && (
                <RenderArrowhead geo={endGeo} color={strokeCol} strokeWidth={strokeW} opacity={endAlpha} />
              )}
            </g>
          </g>
          {/* Bound-label mask: absolute slide coords (the label element is
              unrotated), so it sits outside the path's own transforms. */}
          {labelMask && (
            <rect
              x={labelMask.x}
              y={labelMask.y}
              width={labelMask.width}
              height={labelMask.height}
              fill={labelMask.color}
              style={{ pointerEvents: 'none' }}
            />
          )}
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
  /**
   * Let the video play on its own. Off by default: the presenter's media
   * controller drives videos (see presenter/mediaController).
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
/** An image's media, from the media store; a quiet box until it is here. */
function ImageMedia({ resource, style }: { resource: Resource; style: React.CSSProperties }) {
  const { url, status } = useMediaSource(resource);
  if (!url) return <div data-media-status={status} style={{ ...style, background: status === 'missing' ? '#fee2e2' : '#f3f4f6' }} />;
  return <img src={url} alt="" style={style} draggable={false} />;
}

/** A video's media: the live player (one shared blob URL per source — see
 *  mediaSources), or in a still render its poster frame at the segment start. */
function VideoMedia({ resource, element, style, autoPlay }: { resource: Resource; element: ImageElement; style: React.CSSProperties; autoPlay: boolean }) {
  const still = useMediaStill();
  const { url } = useMediaSource(still ? undefined : resource);
  const poster = useVideoPoster(still ? resource.hash : undefined, element.playFrom ?? 0);
  if (still) return poster ? <img src={poster} alt="" style={style} draggable={false} /> : null;
  if (!url) return null;
  return <video
    src={url}
    style={style}
    // Playback (seek, play, pause, loop) is driven by the media
    // controller by this id; it plays on its own only when asked.
    data-media-id={element.id}
    autoPlay={autoPlay}
    muted={element.muted ?? true}
    playsInline
    preload="metadata"
  />;
}

export const RenderImage: React.FC<ImageProps> = memo(({ element, resource, videoAutoplay }) => {
  if ((element as GroupCropElement)._groupClips?.length) {
    const plain = { ...element, _groupClips: undefined };
    return <GroupCrop element={element}><RenderImage element={plain} resource={resource} videoAutoplay={videoAutoplay} /></GroupCrop>;
  }
  if (!element.visible) return null;
  // A tint is part of the image: the shared shape fill over the media, inside
  // any crop (the GroupCrop above wraps both).
  const tint = imageTintShape(element);
  if (tint) {
    const untinted = { ...element, tint: undefined, tintStyle: undefined, tintTo: undefined, tintLine: undefined };
    return <g data-image-tint="">
      <RenderImage element={untinted} resource={resource} videoAutoplay={videoAutoplay} />
      <RenderShape element={tint} />
    </g>;
  }

  const { x, y, width, height, rotation, opacity } = element;

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

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg)`,
    transformOrigin: '50% 50%',
    opacity,
    willChange: 'transform',
    pointerEvents: 'none',
  };

  // The media fills its box; cropping is a crop group (GroupCrop above).
  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'fill',
    display: 'block',
    pointerEvents: 'none',
  };

  return (
    <foreignObject
      x={0}
      y={0}
      width={SLIDE_WIDTH}
      height={SLIDE_HEIGHT}
      style={{ pointerEvents: 'none', overflow: 'visible' }}
    >
      <div style={containerStyle}>
        {resource.type === 'video' ? (
          <VideoMedia resource={resource} element={element} style={mediaStyle} autoPlay={videoAutoplay ?? false} />
        ) : (
          <ImageMedia resource={resource} style={mediaStyle} />
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
      return <RenderImage element={element as ImageElement} resource={resource} />;
    default:
      return null;
  }
});
