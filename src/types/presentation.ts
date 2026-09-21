export interface ObjectMeta {
  id: string;
  name: string;
  type: 'text' | 'shape' | 'image';
}

export interface Resource {
  id: string;
  name: string;
  type: 'image' | 'video';
  src: string;
  originalWidth: number;
  originalHeight: number;
  duration?: number; // For videos, duration in seconds
  hash?: string; // Content hash for deduplication

}

export interface SlideTemplate {
  id: string;
  name: string;
  elements: Record<string, SlideElement>;
  elementOrder: string[];
  background: SlideBackground;
}

export interface Presentation {
  id: string;
  title: string;
  slides: Record<string, Slide>;
  slideOrder: string[];
  objects: Record<string, ObjectMeta>;
  resources: Record<string, Resource>;
  templates: Record<string, SlideTemplate>;
  theme: Theme;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface Slide {
  id: string;
  elements: Record<string, SlideElement>;
  elementOrder: string[];
  background: SlideBackground;
  transition: SlideTransition;
  notes: string;
  hidden?: boolean;
  /** LEGACY: replaced by slide groups (`groupId`). Still read by the collab
   *  shim (live Y docs are never migrated) and deleted by migration. */
  autoAdvance?: boolean;
  /** Hold in seconds before the timed chain advances past this slide. */
  autoAdvanceDelay?: number;
  /** Slide-group membership: maximal CONTIGUOUS runs (length ≥ 2) of equal
   *  groupId auto-play as a timed chain in the presenter. */
  groupId?: string;
}

export type SlideBackground = {
  type: 'solid';
  color: string;
} | {
  type: 'gradient';
  from: string;
  to: string;
  direction: number;
} | {
  type: 'image';
  src: string;
};

export interface SlideTransition {
  duration: number;
}

// Animation easing types for property transitions
export type EasingType =
  | 'const' | 'linear' | 'ease' | 'dissolve' | 'fadeinout' | 'typewriter' | 'write'
  // Visibility / content reveal easings added in the "all animations" pass:
  | 'create'        // shape outline trace + fill (Write for shapes)
  | 'wipe'          // directional clip-path reveal
  | 'slidein'       // translate from off-screen edge
  | 'grow'          // scale from anchor point
  | 'iris'          // circular clip-path reveal
  | 'fadebyglyph';  // staggered per-glyph fade (text)

/** Per-easing settings. Each top-level key targets one easing's behaviour;
 *  callers read e.g. `transitions.contentOptions?.write?.undoFirst` only when
 *  `transitions.content === 'write'`. Schema is open-ended so adding options
 *  later (stagger ratio, stroke colour, …) doesn't require a migration. */
/** Content-change behaviour for glyph-reveal easings ('write' and 'typewriter'
 *  share this shape). When true, the source text un-reveals across the first
 *  half then the target reveals across the second; when false/undefined, the
 *  source snaps off at t=0 and the full duration is spent revealing the
 *  target. */
export interface GlyphRevealOptions {
  undoFirst?: boolean;
}

/** Compatibility alias — `WriteOptions` was the original name, kept so older
 *  call sites don't break. */
export type WriteOptions = GlyphRevealOptions;

export type WipeDirection = 'left' | 'right' | 'top' | 'bottom';
export type GrowAnchor =
  | 'center'
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export interface DirectionalOptions {
  /** Direction the reveal advances FROM. e.g. `from: 'left'` for slide-in
   *  means the element flies in starting off-screen to the left. */
  from?: WipeDirection;
}
export type WipeOptions = DirectionalOptions;
export type SlideInOptions = DirectionalOptions;

export interface GrowOptions {
  /** Anchor point that stays fixed while the element grows from 0 → 1. */
  anchor?: GrowAnchor;
}

export interface IrisOptions {
  /** Optional centre of the circular reveal in element-local coordinates
   *  (0..1). Defaults to centre of element. */
  cx?: number;
  cy?: number;
}

/** Options for the `create` (outline-trace) easing. */
export interface CreateOptions {
  /** When true, an arrowhead at the path's end rides along the growing tip
   *  of the line instead of being traced last. Has no effect on shapes
   *  without an end-arrow or on filled shapes (rect / ellipse / triangle /
   *  star). */
  tipDraw?: boolean;
}

/** lagRatio: 0 = all children animate simultaneously; 1 = strict sequence
 *  (each finishes before next starts). Default 0.1 — gentle stagger. */
export interface StaggerOptions {
  lagRatio?: number;
}

export interface TransitionOptions {
  write?: GlyphRevealOptions;
  typewriter?: GlyphRevealOptions;
  wipe?: WipeOptions;
  slidein?: SlideInOptions;
  grow?: GrowOptions;
  iris?: IrisOptions;
  create?: CreateOptions;
  /** Group-level stagger applies to whichever child-level easing fires. */
  stagger?: StaggerOptions;
}

/** Keys of `PropertyTransitions` that hold an `EasingType` (i.e. the property
 *  groups that have a transition setting). Excludes the per-easing options
 *  fields. UI code uses this as its `group` discriminator. */
export type TransitionGroup =
  | 'position' | 'size' | 'rotation' | 'opacity'
  | 'fill' | 'stroke' | 'strokeWidth' | 'cornerRadius'
  | 'fontSize' | 'color' | 'lineHeight'
  | 'crop' | 'resource' | 'visibility' | 'content'
  | 'controlPoints' | 'startArrow' | 'endArrow';

// Per-property-group transition settings
export interface PropertyTransitions {
  position?: EasingType;      // x, y
  size?: EasingType;          // width, height
  rotation?: EasingType;
  opacity?: EasingType;
  fill?: EasingType;
  stroke?: EasingType;
  strokeWidth?: EasingType;
  cornerRadius?: EasingType;
  fontSize?: EasingType;
  color?: EasingType;         // text color
  lineHeight?: EasingType;
  crop?: EasingType;          // cropX, cropY, cropWidth, cropHeight
  resource?: EasingType;      // resourceId (supports dissolve)
  visibility?: EasingType;    // fade-in/fade-out animation
  content?: EasingType;       // text content (typewriter effect)
  /** Path-shape control points (vertex list). Per-vertex lerp when the
   *  list shapes match; arc-length resampling falls in when they don't. */
  controlPoints?: EasingType;
  /** Per-arrowhead fade easing. When set and one keyframe has a head where
   *  the other has none, the head's alpha is interpolated 0 ↔ 1 across the
   *  slide transition instead of snapping. (Historical names — these drive
   *  the typed `startHead`/`endHead` fields.) */
  startArrow?: EasingType;
  endArrow?: EasingType;

  /** Optional per-easing settings, per group. Read only when the matching
   *  easing field above is set. Unset → all options take their defaults. */
  contentOptions?: TransitionOptions;
  visibilityOptions?: TransitionOptions;
}

export type SlideElement = TextElement | ShapeElement | ImageElement | GroupElement;

export interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  transitions?: PropertyTransitions;  // How to animate FROM previous slide TO this one
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  color: string;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  style: TextStyle;
}

/** Shape kinds. `path` covers every vertex-driven shape — line, arrow,
 *  polyline, polygon, B-spline curve — and is configured by `points`,
 *  `closed`, `curve`, `startHead`, `endHead`. Older decks with the
 *  individual `line`/`arrow`/`polygon`/`bspline` values are migrated to
 *  `path` on load (see `utils/migrations.ts`). */
export type ShapeType = 'rect' | 'ellipse' | 'triangle' | 'star' | 'path';

/** Typed arrowhead at a path endpoint (Excalidraw's option set). Geometry
 *  for every variant comes from ONE helper — `arrowheadGeometry` in
 *  `utils/pathShapes.ts` — consumed by all renderers and by the property
 *  panel previews. `'none'` and an absent field are equivalent; legacy
 *  `startArrow`/`endArrow` booleans migrate to `'triangle'`
 *  (see `utils/migrations.ts`). */
export type ArrowheadType =
  | 'none'
  | 'arrow'
  | 'triangle' | 'triangle-outline'
  | 'bar'
  | 'dot' | 'circle' | 'circle-outline'
  | 'diamond' | 'diamond-outline'
  | 'crowfoot-one' | 'crowfoot-many' | 'crowfoot-one-many';

/** Curve mode for a path shape:
 *    linear   — straight segments between vertices
 *    bspline2 — uniform quadratic B-spline through the control points
 *    bspline3 — uniform cubic B-spline through the control points
 *    bezier   — cubic Bézier chain through the vertices with editable
 *               per-vertex tangent handles (`ShapeElement.tangents`)
 *  Both B-spline modes interpolate the endpoints (clamped) when the path is
 *  open and wrap smoothly when closed. Bézier always passes through every
 *  vertex; missing tangents fall back to Catmull-Rom estimates. */
export type PathCurve = 'linear' | 'bspline2' | 'bspline3' | 'bezier';

/** Stroke dash pattern for path shapes (lines, arrows, polylines, polygons).
 *  `solid` (default) = no dash. `dashed` = medium dashes. `dotted` = short
 *  dots with round caps. The exact pixel pattern is derived from
 *  `strokeWidth` in the renderer so it scales with the line. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

/** How a connector endpoint tracks its bound element:
 *    edge   — Excalidraw-style: the endpoint aims at a focus point inside the
 *             target (focus 0 = center, ±1 = grazing the silhouette) and sits
 *             `gap` slide units short of the silhouette along the ray from
 *             the adjacent vertex. Re-solved whenever either side moves.
 *    pinned — the endpoint sticks to a fixed point of the target's bounding
 *             box (`fixedPoint` [u,v] ∈ [0,1]², rotated with the target). */
export type BindingMode = 'edge' | 'pinned';

/** Legacy 5-anchor payload — decks written before binding v2 carry `anchor`;
 *  `utils/migrations.ts` rewrites it to `mode: 'pinned'` + `fixedPoint`. */
export type BindingAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface ConnectorBinding {
  elementId: string;
  /** Defaults to 'edge' when absent (unless a legacy `anchor` is present,
   *  which implies 'pinned'). */
  mode?: BindingMode;
  /** Edge mode: signed focus in [-1, 1]. 0 aims at the center; ±1 grazes
   *  the silhouette on either side of the center axis. */
  focus?: number;
  /** Edge mode: distance (≥ 0, slide units) the endpoint keeps from the
   *  target's silhouette. */
  gap?: number;
  /** Pinned mode: [u, v] ∈ [0,1]² in the target's local (unrotated)
   *  bounding-box coordinates. */
  fixedPoint?: [number, number];
  /** Legacy (pre-v2) anchor. Kept optional so unmigrated in-memory decks
   *  still resolve; new bindings never set it. */
  anchor?: BindingAnchor;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  /** Path control points: flat [x0,y0,...,xn,yn] (N ≥ 2). All coords are
   *  RELATIVE to (x,y) so a translation just moves the element. */
  points?: number[];
  /** Path only: close back to the first vertex (so a closed linear path is a
   *  polygon, a closed bspline is a smooth loop). */
  closed?: boolean;
  /** Path only: smoothing mode through the vertices. Defaults to 'linear'. */
  curve?: PathCurve;
  /** Bézier only: per-vertex tangent handles, flat
   *  [inDx0,inDy0,outDx0,outDy0, inDx1,…] — 4 entries PER VERTEX, each
   *  RELATIVE to its vertex (same coordinate space as `points`, so they
   *  translate with the element and ride along when a vertex moves).
   *  A segment whose adjoining out/in handles are all zero renders
   *  straight. Missing or length-mismatched arrays fall back to
   *  Catmull-Rom-estimated tangents (`catmullTangents`), so a bare
   *  curve switch still looks smooth. Ignored for non-bezier curves. */
  tangents?: number[];
  /** Path only: typed arrowhead at the first / last vertex. Absent means
   *  `'none'`. (The matching TransitionGroups keep their historical
   *  `'startArrow'`/`'endArrow'` names — they're persisted in decks.) */
  startHead?: ArrowheadType;
  endHead?: ArrowheadType;
  /** Path only: solid / dashed / dotted stroke. Defaults to 'solid'. */
  strokeStyle?: StrokeStyle;
  startBinding?: ConnectorBinding | null;
  endBinding?: ConnectorBinding | null;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  resourceId?: string | null;  // null = empty placeholder
  // Image crop properties
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  // Video playback properties (used when resource is a video)
  playing?: boolean;  // Whether video should be playing (can be toggled per keyframe)
  loop?: boolean;
  muted?: boolean;
  startTime?: number; // Start position in seconds
}

export interface GroupElement extends BaseElement {
  type: 'group';
  childIds: string[];
}

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    heading: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'polygon' | 'bspline' | 'image';

export interface EditorState {
  activeSlideId: string;
  selectedElementIds: string[];
  zoom: number;
  tool: Tool;
  isPresenting: boolean;
  presentingSlideIndex: number;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  clipboard: SlideElement[];
  editingTextId: string | null;
  isPanning: boolean;
}
