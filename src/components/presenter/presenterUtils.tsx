import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { RenderShape, RenderImage } from '../svg/ElementRenderer';
import { SVGTextPaths } from '../svg/SVGTextPaths';
import { RenderPaths } from '../svg/RenderPaths';
import { shapeToSvgPaths } from '../../utils/shapeToPath';
import { pathD, insetEndpoints, arrowheadPoints, pathArcLength, pointAtArcLength } from '../../utils/pathShapes';
import { pathLengthFor } from '../../utils/glyphPaths';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../utils/constants';
import { interpolateWithVisibility, lerpColor } from '../../utils/interpolation';
import type { SlideElement, TextElement, ShapeElement, ImageElement, Slide, Resource } from '../../types/presentation';
import type { CrossfadeSource, TextDissolveSource, WriteEffect } from '../../utils/interpolation';

// ---------------------------------------------------------------------------
// Visual-transform wrapper for animation modes that aren't element-internal.
// `wipe`, `slidein`, `grow`, `iris` apply identically to text/shape/image —
// we render the element as usual and wrap the result in a <g> with a
// transform or clipPath driven by the animation's t. The element renderers
// themselves never see these modes (only the glyph/shape-internal ones).
// ---------------------------------------------------------------------------

type WrapperMode = 'wipe' | 'slidein' | 'grow' | 'iris';

const WRAPPER_MODES = new Set<WrapperMode>(['wipe', 'slidein', 'grow', 'iris']);

function isWrapperMode(fx: WriteEffect | undefined): fx is WriteEffect & { mode: WrapperMode } {
  return !!fx && WRAPPER_MODES.has(fx.mode as WrapperMode);
}

function anchorPoint(element: SlideElement, anchor: NonNullable<WriteEffect['anchor']>): { ax: number; ay: number } {
  const { x, y, width, height } = element;
  switch (anchor) {
    case 'top-left':     return { ax: x, ay: y };
    case 'top':          return { ax: x + width / 2, ay: y };
    case 'top-right':    return { ax: x + width, ay: y };
    case 'left':         return { ax: x, ay: y + height / 2 };
    case 'right':        return { ax: x + width, ay: y + height / 2 };
    case 'bottom-left':  return { ax: x, ay: y + height };
    case 'bottom':       return { ax: x + width / 2, ay: y + height };
    case 'bottom-right': return { ax: x + width, ay: y + height };
    case 'center':
    default:             return { ax: x + width / 2, ay: y + height / 2 };
  }
}

function wrapVisualFx(
  node: React.ReactNode,
  element: SlideElement,
  fx: WriteEffect,
): React.ReactNode {
  const { id, x, y, width: w, height: h } = element;
  const t = fx.t;

  if (fx.mode === 'wipe') {
    const from = fx.from ?? 'left';
    let rx = x, ry = y, rw = w, rh = h;
    switch (from) {
      case 'left':   rw = w * t; break;
      case 'right':  rx = x + w * (1 - t); rw = w * t; break;
      case 'top':    rh = h * t; break;
      case 'bottom': ry = y + h * (1 - t); rh = h * t; break;
    }
    const clipId = `wipe-${id}`;
    return (
      <g key={id}>
        <defs>
          <clipPath id={clipId}>
            <rect x={rx} y={ry} width={Math.max(0, rw)} height={Math.max(0, rh)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{node}</g>
      </g>
    );
  }

  if (fx.mode === 'slidein') {
    const from = fx.from ?? 'left';
    const off = 1 - t;
    let dx = 0, dy = 0;
    switch (from) {
      case 'left':   dx = -(x + w) * off; break;
      case 'right':  dx = (SLIDE_WIDTH - x) * off; break;
      case 'top':    dy = -(y + h) * off; break;
      case 'bottom': dy = (SLIDE_HEIGHT - y) * off; break;
    }
    return <g key={id} transform={`translate(${dx} ${dy})`}>{node}</g>;
  }

  if (fx.mode === 'grow') {
    const { ax, ay } = anchorPoint(element, fx.anchor ?? 'center');
    return (
      <g
        key={id}
        transform={`translate(${ax} ${ay}) scale(${t}) translate(${-ax} ${-ay})`}
      >
        {node}
      </g>
    );
  }

  if (fx.mode === 'iris') {
    const cxFrac = fx.cx ?? 0.5;
    const cyFrac = fx.cy ?? 0.5;
    const cx = x + cxFrac * w;
    const cy = y + cyFrac * h;
    const maxR = Math.hypot(
      Math.max(cx - x, x + w - cx),
      Math.max(cy - y, y + h - cy),
    );
    const clipId = `iris-${id}`;
    return (
      <g key={id}>
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={Math.max(0, maxR * t)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{node}</g>
      </g>
    );
  }

  return node;
}

// Extended ImageElement type that may include dissolve source during transitions
type ImageElementWithDissolve = ImageElement & { _dissolveSource?: CrossfadeSource };

// Get slide background color
export function getSlideBackground(slide: Slide): string {
  return slide.background.type === 'solid' ? slide.background.color : '#ffffff';
}

/** Produce the (bgColor, renderedElements) pair for one frame — either a steady
 *  slide or the in-flight interpolation between two. PresenterView and
 *  AudienceView both feed slides through this so transitions, z-order merging,
 *  and dissolve behavior stay identical across editor + remote views. */
export function composeSlideFrame(args: {
  slideA: Slide;
  slideB: Slide | null;
  isForward: boolean;
  animProgress: number;
  isAnimating: boolean;
}): { renderedElements: SlideElement[]; bgColor: string } {
  const { slideA, slideB, isForward, animProgress, isAnimating } = args;

  if (!isAnimating) {
    return {
      bgColor: getSlideBackground(slideA),
      renderedElements: slideA.elementOrder
        .map((id) => slideA.elements[id])
        .filter((el): el is SlideElement => Boolean(el)),
    };
  }

  const bgA = getSlideBackground(slideA);
  const bgB = slideB ? getSlideBackground(slideB) : bgA;
  const bgColor = lerpColor(bgA, bgB, animProgress);

  const orderedIds = mergeElementOrders(slideA, slideB, isForward);
  const renderedElements: SlideElement[] = [];
  for (const id of orderedIds) {
    const elA = slideA.elements[id];
    const elB = slideB?.elements[id];
    const interpolated = interpolateWithVisibility(elA, elB, animProgress, isForward);
    if (interpolated) renderedElements.push(interpolated);
  }
  return { renderedElements, bgColor };
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

// ============================================================================
// PresenterTextElement - Wraps SVGTextContent in a stage-sized SVG so the
// same foreignObject+HTML renderer used by the editor and thumbnails drives
// presenter text too. The old absolute-positioned-HTML implementation was a
// separate path that diverged from SVGTextContent over time.
// ============================================================================

interface PresenterTextElementProps {
  element: TextElement;
  scale: number;
  zIndex: number;
  dissolveText?: TextDissolveSource;
}

export const PresenterTextElement: React.FC<PresenterTextElementProps> = ({ element, scale, zIndex, dissolveText }) => {
  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SLIDE_WIDTH * scale,
    height: SLIDE_HEIGHT * scale,
    pointerEvents: 'none',
    zIndex,
  };

  if (dissolveText) {
    // Render two text layers cross-fading. Distinct clipIdPrefix values
    // keep their internal clipPath IDs from colliding inside one SVG.
    return (
      <svg style={wrapperStyle} viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}>
        <SVGTextPaths
          element={{ ...element, text: dissolveText.text }}
          opacity={dissolveText.opacity}
          clipIdPrefix="presenter-src"
        />
        <SVGTextPaths
          element={element}
          opacity={element.opacity}
          clipIdPrefix="presenter-tgt"
        />
      </svg>
    );
  }

  return (
    <svg style={wrapperStyle} viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}>
      <SVGTextPaths element={element} opacity={element.opacity} clipIdPrefix="presenter" />
    </svg>
  );
};

// Render a single element as SVG fragments (group / foreignObject) suitable
// for embedding in a single SVG composition root. The caller (PresenterView /
// AudienceView) wraps all elements in one <svg viewBox="0 0 SLIDE_WIDTH
// SLIDE_HEIGHT">. Z-order is document order; no per-element wrapper.
export function renderPresenterElement(
  element: SlideElement,
  resources: Record<string, Resource>,
): React.ReactNode {
  if (!element.visible) return null;

  // Pull the animation effect off the element. Wrapper modes (wipe/slidein/
  // grow/iris) are applied AROUND the type-specific render; element-internal
  // modes (write/typewriter/fadebyglyph/create) flow into the renderer.
  const fx = (element as SlideElement & { _writeFx?: WriteEffect })._writeFx;
  const useWrapper = isWrapperMode(fx);
  const innerFx = useWrapper ? undefined : fx;

  const inner = renderElementInner(element, resources, innerFx);
  return useWrapper && fx ? wrapVisualFx(inner, element, fx) : inner;
}

function renderElementInner(
  element: SlideElement,
  resources: Record<string, Resource>,
  fx: WriteEffect | undefined,
): React.ReactNode {
  if (element.type === 'text') {
    const textEl = element as (TextElement & {
      _dissolveText?: TextDissolveSource;
    });
    // Glyph-internal anim has priority over dissolve — interpolator ensures
    // they're mutually exclusive, but be defensive.
    if (fx) {
      return (
        <SVGTextPaths
          key={element.id}
          element={textEl}
          opacity={textEl.opacity}
          clipIdPrefix="presenter"
          writeFx={fx}
        />
      );
    }
    const dissolveText = textEl._dissolveText;
    if (dissolveText) {
      // Cross-fade: render source on top of target, each with its own opacity.
      // Distinct clipIdPrefix values keep their internal <clipPath> IDs from
      // colliding inside the parent SVG.
      return (
        <React.Fragment key={element.id}>
          <SVGTextPaths
            element={{ ...textEl, text: dissolveText.text }}
            opacity={dissolveText.opacity}
            clipIdPrefix="presenter-src"
          />
          <SVGTextPaths
            element={textEl}
            opacity={textEl.opacity}
            clipIdPrefix="presenter-tgt"
          />
        </React.Fragment>
      );
    }
    return (
      <SVGTextPaths
        key={element.id}
        element={textEl}
        opacity={textEl.opacity}
        clipIdPrefix="presenter"
      />
    );
  }

  if (element.type === 'image') {
    const imgEl = element as ImageElementWithDissolve;
    const dissolveSource = imgEl._dissolveSource;
    const targetResource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;
    const sourceResource = dissolveSource?.resourceId ? resources[dissolveSource.resourceId] : undefined;

    const renderMedia = (
      resourceToRender: typeof targetResource,
      opacity: number,
      cropX: number,
      cropY: number,
      cropWidth: number,
      cropHeight: number,
      keySuffix: string,
      autoPlay: boolean = true,
    ) => {
      if (!resourceToRender) return null;
      // Overlay dissolve/animation values without mutating the live element.
      const tempElement: ImageElement = {
        ...imgEl,
        resourceId: resourceToRender.id,
        opacity,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      };
      return (
        <RenderImage
          key={`${element.id}${keySuffix}`}
          element={tempElement}
          resource={resourceToRender}
          videoAutoplay={autoPlay && (imgEl.playing ?? true)}
        />
      );
    };

    if (dissolveSource && sourceResource) {
      // Freeze both videos during cross-fade so the transition reads as a
      // visual blend rather than two competing playbacks.
      return (
        <React.Fragment key={element.id}>
          {renderMedia(sourceResource, dissolveSource.opacity, dissolveSource.cropX, dissolveSource.cropY, dissolveSource.cropWidth, dissolveSource.cropHeight, '-src', false)}
          {renderMedia(targetResource, element.opacity, imgEl.cropX, imgEl.cropY, imgEl.cropWidth, imgEl.cropHeight, '-tgt', false)}
        </React.Fragment>
      );
    }

    return renderMedia(targetResource, element.opacity, imgEl.cropX, imgEl.cropY, imgEl.cropWidth, imgEl.cropHeight, '');
  }

  // Shape: native SVG primitive via the shared RenderShape. If a Create
  // animation is in flight, route through the outline-path renderer so the
  // perimeter strokes in and the fill ramps via the shared RenderPaths.
  const shapeEl = element as ShapeElement;
  if (fx?.mode === 'create') {
    const strokeWidth = Math.max(1, shapeEl.strokeWidth || 2);
    const cx = shapeEl.x + shapeEl.width / 2;
    const cy = shapeEl.y + shapeEl.height / 2;
    const transform = shapeEl.rotation ? `rotate(${shapeEl.rotation}, ${cx}, ${cy})` : undefined;
    // Tip-draw branch: an end-arrowed path with `tipDraw: true` draws the
    // shaft progressively (RenderPaths with no head in the d-string) AND
    // sticks the arrowhead onto the current tip — so the head appears to
    // ride along with the growing line instead of materializing last.
    if (fx.tipDraw && shapeEl.shapeType === 'path' && shapeEl.endArrow) {
      return (
        <g key={shapeEl.id} transform={transform} opacity={shapeEl.opacity}>
          <TipDrawArrow element={shapeEl} fx={fx} strokeWidth={strokeWidth} />
        </g>
      );
    }
    const paths = shapeToSvgPaths(shapeEl);
    return (
      <g key={shapeEl.id} transform={transform} opacity={shapeEl.opacity}>
        <RenderPaths paths={paths} writeFx={fx} strokeWidth={strokeWidth} />
      </g>
    );
  }
  return <RenderShape key={element.id} element={shapeEl} />;
}

/** d-string → measured length. TipDrawArrow renders every animation frame;
 *  without this, each frame calls pathLengthFor which forces an SVG layout
 *  via getTotalLength() (same trade-off as geomCache in shapeToPath). */
const tipDrawLengthCache = new Map<string, number>();

/** Specialised renderer for `create` + `tipDraw`. Builds a shaft-only
 *  path (no arrowhead L-segments folded in), reveals it through the
 *  shared writeGlyphFrame timing via RenderPaths, then positions the
 *  arrowhead at the point along the shaft that matches the current
 *  reveal progress. Direction comes from the tangent at that point so
 *  the head's orientation tracks the curve as it rides the tip. */
const TipDrawArrow: React.FC<{
  element: ShapeElement;
  fx: WriteEffect;
  strokeWidth: number;
}> = ({ element, fx, strokeWidth }) => {
  const pts = element.points ?? [];
  if (pts.length < 4) return null;
  const closed = element.closed ?? false;
  const curve = element.curve ?? 'linear';
  // Inset the end vertex so the shaft stops where the arrowhead's base
  // will sit. The arrowhead's tip then extends back out to the original
  // endpoint at the end of the animation — same final geometry as the
  // steady-state render in ElementRenderer.
  const shaftPts = insetEndpoints(pts, !!element.startArrow, true);
  const cornerR = curve === 'linear' ? (element.cornerRadius ?? 0) : 0;
  const d = pathD(shaftPts, curve, closed, cornerR);
  const arc = pathArcLength(shaftPts, curve, closed);
  const strokeColor = element.stroke || element.fill || '#000';

  // Map the WriteEffect's t to the reveal phase exactly like writeGlyphFrame
  // does so the arrowhead and the dashoffset stay in lockstep.
  // RenderPaths scales fx.t through `glyphSpan` (0.5) before applying
  // REVEAL_END (0.7): localT = fx.t / glyphSpan. So the stroke actually
  // finishes revealing at fx.t = REVEAL_END * glyphSpan = 0.35. Using
  // fx.t / REVEAL_END here would put the head on a slower clock and it
  // would visibly trail the growing tip of the shaft.
  const REVEAL_END = 0.7;
  const GLYPH_SPAN = 0.5;
  const localT = Math.max(0, Math.min(1, fx.t / GLYPH_SPAN));
  const revealPh = Math.max(0, Math.min(1, localT / REVEAL_END));
  // Where to place the arrowhead. While the reveal is in flight, ride the
  // tip; once we hit FILL phase, lock the head at the final endpoint so
  // it doesn't jitter while the stroke fades to fill.
  const targetLen = revealPh >= 1 ? arc : arc * revealPh;
  const tip = pointAtArcLength(shaftPts, curve, closed, targetLen);
  // Final endpoint of the original (un-inset) path — that's where the
  // arrowhead tip lands at completion.
  const last = pts.length - 2;
  let tipX: number, tipY: number, dirX: number, dirY: number;
  if (revealPh >= 1) {
    tipX = pts[last]; tipY = pts[last + 1];
    dirX = pts[last] - pts[last - 2]; dirY = pts[last + 1] - pts[last - 1];
  } else if (tip) {
    // Push the tip forward by the head length so the triangle's tip lands
    // at the position the user expects ("the arrow is HERE"), not its base.
    const tLen = Math.hypot(tip.dx, tip.dy) || 1;
    const HEAD = 10;
    tipX = tip.x + (tip.dx / tLen) * HEAD;
    tipY = tip.y + (tip.dy / tLen) * HEAD;
    dirX = tip.dx; dirY = tip.dy;
  } else {
    // Degenerate path — bail out, no arrow to draw.
    return null;
  }
  const head = arrowheadPoints(tipX, tipY, dirX, dirY);

  // Cached path length for stroke-dasharray. pathLengthFor measures via a
  // hidden <path>; ours is just the shaft so it matches `arc` closely
  // (modulo browser float precision).
  let length = tipDrawLengthCache.get(d);
  if (length === undefined) {
    length = pathLengthFor(d);
    tipDrawLengthCache.set(d, length);
  }
  const svgPath = {
    d,
    transform: `translate(${element.x}, ${element.y})`,
    length,
    fillColor: element.closed ? (element.fill || 'transparent') : 'none',
    strokeColor,
    nonScalingStroke: false,
  };
  return (
    <>
      <RenderPaths paths={[svgPath]} writeFx={fx} strokeWidth={strokeWidth} />
      {/* Arrowhead. Fades in over the first ~5% of the reveal so it
          doesn't pop into existence at t=0. */}
      <polygon
        points={`${head[0]},${head[1]} ${head[2]},${head[3]} ${head[4]},${head[5]}`}
        transform={`translate(${element.x}, ${element.y})`}
        fill={strokeColor}
        // Fade in over the first ~5% of the reveal so the head doesn't
        // pop in fully formed at t=0; full opacity once it's tracking.
        opacity={Math.min(1, revealPh * 20)}
      />
    </>
  );
};

// ============================================================================
// VideoWithControls - Video element with play/pause button and progress bar
// ============================================================================

interface VideoWithControlsProps {
  src: string;
  autoPlay: boolean;
  loop: boolean;
  muted: boolean;
  videoStyle: React.CSSProperties;
  containerStyle?: React.CSSProperties;
  /** If true, wrap video in a container div (for cropped videos) */
  cropped?: boolean;
  /** Callback to send video commands to audience view */
  onVideoCommand?: (action: 'play' | 'pause' | 'seek', currentTime?: number) => void;
}

const VideoWithControls: React.FC<VideoWithControlsProps> = ({
  src,
  autoPlay,
  loop,
  muted,
  videoStyle,
  containerStyle,
  cropped,
  onVideoCommand,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [progress, setProgress] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const rafRef = useRef<number>(0);

  // Update progress via rAF
  useEffect(() => {
    const update = () => {
      const v = videoRef.current;
      if (v && v.duration) {
        setProgress(v.currentTime / v.duration);
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Sync play state with video events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { if (!loop) setIsPlaying(false); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
    };
  }, [loop]);

  const togglePlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
      onVideoCommand?.('play', v.currentTime);
    } else {
      v.pause();
      onVideoCommand?.('pause', v.currentTime);
    }
  }, [onVideoCommand]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    setProgress(ratio);
    onVideoCommand?.('seek', v.currentTime);
  }, [onVideoCommand]);

  // Outer wrapper uses containerStyle positioning (absolute pos, z-index, etc.)
  const outerStyle: React.CSSProperties = containerStyle || videoStyle;

  return (
    <div
      style={{
        ...outerStyle,
        position: outerStyle.position || 'absolute',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline
        preload="metadata"
        style={cropped ? videoStyle : {
          width: '100%',
          height: '100%',
          objectFit: (videoStyle.objectFit as React.CSSProperties['objectFit']) || 'cover',
        }}
      />

      {/* Controls overlay */}
      {isHovered && (
        <>
          {/* Play/Pause button */}
          <button
            onClick={togglePlayPause}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'white',
              zIndex: 10,
            }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          {/* Progress bar */}
          <div
            onClick={handleSeek}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 6,
              background: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                background: 'rgba(59,130,246,0.9)',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// SlideRenderer - Reusable component for rendering slides with video support
// ============================================================================

interface SlideRendererProps {
  slide: Slide;
  width: number;
  height: number;
  resources: Record<string, Resource>;
  autoPlayVideos?: boolean;
  onVideoCommand?: (action: 'play' | 'pause' | 'seek', currentTime?: number) => void;
}

export const SlideRenderer: React.FC<SlideRendererProps> = ({
  slide,
  width,
  height,
  resources,
  autoPlayVideos = false,
  onVideoCommand,
}) => {
  const scale = width / SLIDE_WIDTH;
  const bgColor = getSlideBackground(slide);
  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);

  return (
    <div
      className="relative overflow-hidden"
      style={{ width, height, background: bgColor }}
    >
      {elements.map((element, index) => {
        if (!element.visible) return null;

        // Text elements
        if (element.type === 'text') {
          return (
            <PresenterTextElement
              key={element.id}
              element={element as TextElement}
              scale={scale}
              zIndex={index}
            />
          );
        }

        // Image/Video elements
        if (element.type === 'image') {
          const imgEl = element as ImageElement;
          const resource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;

          if (resource?.type === 'video') {
            const hasCrop = imgEl.cropWidth > 0 && imgEl.cropHeight > 0;
            const shouldAutoPlay = autoPlayVideos && (imgEl.playing ?? true);

            if (hasCrop) {
              const scaleX = resource.originalWidth / imgEl.cropWidth;
              const scaleY = resource.originalHeight / imgEl.cropHeight;
              return (
                <VideoWithControls
                  key={element.id}
                  src={resource.src}
                  autoPlay={shouldAutoPlay}
                  loop={imgEl.loop ?? false}
                  muted={imgEl.muted ?? true}
                  cropped
                  onVideoCommand={onVideoCommand}
                  containerStyle={{
                    position: 'absolute',
                    left: `${element.x * scale}px`,
                    top: `${element.y * scale}px`,
                    width: `${element.width * scale}px`,
                    height: `${element.height * scale}px`,
                    transform: `rotate(${element.rotation}deg)`,
                    transformOrigin: 'center center',
                    opacity: element.opacity,
                    overflow: 'hidden',
                    zIndex: index,
                  }}
                  videoStyle={{
                    width: `${element.width * scale * scaleX}px`,
                    height: `${element.height * scale * scaleY}px`,
                    marginLeft: `${-imgEl.cropX * (element.width / imgEl.cropWidth) * scale}px`,
                    marginTop: `${-imgEl.cropY * (element.height / imgEl.cropHeight) * scale}px`,
                  }}
                />
              );
            }

            return (
              <VideoWithControls
                key={element.id}
                src={resource.src}
                autoPlay={shouldAutoPlay}
                loop={imgEl.loop ?? false}
                muted={imgEl.muted ?? true}
                onVideoCommand={onVideoCommand}
                videoStyle={{
                  position: 'absolute',
                  left: `${element.x * scale}px`,
                  top: `${element.y * scale}px`,
                  width: `${element.width * scale}px`,
                  height: `${element.height * scale}px`,
                  transform: `rotate(${element.rotation}deg)`,
                  transformOrigin: 'center center',
                  opacity: element.opacity,
                  objectFit: 'cover',
                  zIndex: index,
                }}
              />
            );
          }
        }

        // Shapes and static images use inline SVG. Each element gets a
        // stage-sized SVG layer; this matches the per-element wrapper that
        // PresenterView used to use before its single-SVG consolidation.
        // (SlideRenderer keeps the per-element wrapper for now because it
        // composes VideoWithControls — an HTML overlay — at the same z-stack
        // level, which is awkward inside a single SVG composition.)
        if (element.type === 'shape' || element.type === 'image') {
          const imgResource =
            element.type === 'image' && element.resourceId
              ? resources[element.resourceId]
              : undefined;
          return (
            <svg
              key={element.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width,
                height,
                pointerEvents: 'none',
                zIndex: index,
              }}
              viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
            >
              {element.type === 'shape' ? (
                <RenderShape element={element as ShapeElement} />
              ) : (
                <RenderImage element={element as ImageElement} resource={imgResource} />
              )}
            </svg>
          );
        }
        return null;
      })}
    </div>
  );
};
