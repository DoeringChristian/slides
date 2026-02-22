export interface ObjectMeta {
  id: string;
  name: string;
  type: 'text' | 'shape' | 'image' | 'video';
}

export interface Resource {
  id: string;
  name: string;
  type: 'image' | 'video';
  src: string;
  originalWidth: number;
  originalHeight: number;
  duration?: number; // For videos, duration in seconds
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

export type SlideElement = TextElement | ShapeElement | ImageElement | VideoElement | GroupElement;

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
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export interface VideoElement extends BaseElement {
  type: 'video';
  resourceId?: string | null;
  playing: boolean;  // Whether video should be playing (can be toggled per keyframe)
  loop: boolean;
  muted: boolean;
  startTime: number; // Start position in seconds
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
