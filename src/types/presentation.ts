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
  | 'extend'        // path grows along its own route, arrowhead riding the tip
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
  | 'controlPoints' | 'startArrow' | 'endArrow' | 'morph';

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
  /** Cross-TYPE geometry morph (text ↔ shape). Opt-in: unset (or 'const')
   *  keeps the historical hard cut at t=0.5; 'linear'/'ease' morph the two
   *  elements' outlines into each other (interpolation attaches `_morphFx`,
   *  resolved by the shared RenderMorph leaf). Governs ONLY the geometry
   *  correspondence — position/size/rotation/opacity keep their own group
   *  easings. shape↔shape morphs are automatic and eased by `controlPoints`
   *  instead. */
  morph?: EasingType;

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
  /** Free text uses zero inset and explicit content sizing. */
  textSizing: 'auto-content' | 'user-width';
  style: TextStyle;
  /** Bound text (Excalidraw-style label): id of the container element this
   *  text is attached to (a shape or an arrow/path on the same slide). The
   *  container drives the label's geometry via the mutation-time sync pass
   *  (`utils/syncDependents.ts`); there is NO persisted reverse index — use
   *  `findBoundText` to scan a slide. Absent / null = free-standing text.
   *  References must resolve on the same slide. */
  containerId?: string | null;
  /** Rect/ellipse labels use measured layout; other bound labels use padding. */
  boundTextLayout: 'measured' | 'padded';
  /** Overflow shrink gate, reset by explicit box resize; persisted for undo/reopen. */
  boundTextBaselineHeight?: number;
}

/** `path` covers lines, arrows, polylines, polygons and curves. */
export type ShapeType = 'rect' | 'ellipse' | 'triangle' | 'star' | 'path' | 'vector';

/** Typed endpoint heads share geometry across all renderers. Absent means none. */
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
 *    smooth   — Catmull-Rom curve through every vertex (automatic tangents)
 *    bspline2 — uniform quadratic B-spline controlled by the points
 *    bspline3 — uniform cubic B-spline controlled by the points
 *    bezier   — cubic Bézier chain through the vertices with editable
 *               per-vertex tangent handles (`ShapeElement.tangents`)
 *  Both B-spline modes interpolate the endpoints (clamped) when the path is
 *  open and wrap smoothly when closed. Bézier always passes through every
 *  vertex; missing tangents fall back to Catmull-Rom estimates. */
export type PathCurve = 'linear' | 'smooth' | 'bspline2' | 'bspline3' | 'bezier';

/** Stroke dash pattern for path shapes (lines, arrows, polylines, polygons).
 *  `solid` (default) = no dash. `dashed` = medium dashes. `dotted` = short
 *  dots with round caps. The exact pixel pattern is derived from
 *  `strokeWidth` in the renderer so it scales with the line. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

/** Absent means solid for existing decks. No-colour fills stay transparent. */
export type FillStyle = 'solid' | 'hachure' | 'crosshatch';

/** Aim tracks the silhouette toward a local focus; pinned tracks the local point. */
export type BindingMode = 'pinned' | 'aim';

export interface ConnectorBinding {
  elementId: string;
  mode: BindingMode;
  /** Aim-mode distance from the silhouette, in slide units. */
  gap?: number;
  /** Object-local normalized point, rotated with the target. */
  fixedPoint: [number, number];
}

/** Normalized design-box geometry, independent of element position/size.
 * Arcs are axis-aligned SVG endpoint arcs; zero radii become lines, coincident
 * endpoints are empty. Paint regions may close open stroke contours explicitly.
 * Icons bind and label against their design BOX, not their interior details. */
export type VectorPoint = [number, number];
export type VectorSegment =
  | { kind: 'line'; to: VectorPoint }
  | { kind: 'cubic'; c1: VectorPoint; c2: VectorPoint; to: VectorPoint }
  | { kind: 'arc'; radii: VectorPoint; largeArc: boolean; sweep: boolean; to: VectorPoint };
export interface VectorContour {
  id: string;
  start: VectorPoint;
  segments: VectorSegment[];
  closed: boolean;
}
export interface VectorGeometry {
  kind: 'vector';
  version: 1;
  contours: VectorContour[];
  fills: { contourIds: string[]; rule: 'evenodd' | 'nonzero' }[];
  strokes: string[];
  provenance?: { library: string; version: string; icon: string; license: string; licenseNotice?: string };
}

export interface ShapeElement extends BaseElement {
  geometry?: VectorGeometry;
  /** User drawing family; preserves line/arrow/curve defaults after style edits. */
  creationPreset: 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'curve' | 'polygon' | 'icon';
  type: 'shape';
  shapeType: ShapeType;
  fill: string;
  fillStyle?: FillStyle;
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

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'polygon' | 'bspline' | 'icon' | 'image';

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
