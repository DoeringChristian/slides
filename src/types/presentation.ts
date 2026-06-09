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
  autoAdvance?: boolean;        // Automatically advance to next slide
  autoAdvanceDelay?: number;    // Delay in seconds before auto-advancing
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
export type EasingType = 'const' | 'linear' | 'ease' | 'dissolve' | 'fadeinout' | 'typewriter' | 'write';

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

export interface TransitionOptions {
  write?: GlyphRevealOptions;
  typewriter?: GlyphRevealOptions;
}

/** Keys of `PropertyTransitions` that hold an `EasingType` (i.e. the property
 *  groups that have a transition setting). Excludes the per-easing options
 *  fields. UI code uses this as its `group` discriminator. */
export type TransitionGroup =
  | 'position' | 'size' | 'rotation' | 'opacity'
  | 'fill' | 'stroke' | 'strokeWidth' | 'cornerRadius'
  | 'fontSize' | 'color' | 'lineHeight'
  | 'crop' | 'resource' | 'visibility' | 'content';

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

export type ShapeType = 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow';

export interface ConnectorBinding {
  elementId: string;
  anchor: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  points?: number[];
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

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'image';

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
