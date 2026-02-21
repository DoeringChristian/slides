import { generateId } from './idGenerator';
import { DEFAULT_TEXT_STYLE, DEFAULT_SHAPE_PROPS, SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import type { Slide, TextElement, ShapeElement, ImageElement, ShapeType, SlideElement, Presentation, Theme } from '../types/presentation';

export function createDefaultTheme(): Theme {
  return {
    name: 'Light',
    colors: {
      primary: '#4285f4',
      secondary: '#5f6368',
      accent: '#ea4335',
      background: '#ffffff',
      text: '#333333',
      heading: '#202124',
    },
    fonts: {
      heading: 'Arial',
      body: 'Arial',
    },
  };
}

export function createSlide(overrides?: Partial<Slide>): Slide {
  return {
    id: generateId(),
    elements: {},
    elementOrder: [],
    background: { type: 'solid', color: '#ffffff' },
    transition: { type: 'none', duration: 300 },
    notes: '',
    ...overrides,
  };
}

export function createTextElement(overrides?: Partial<TextElement>): TextElement {
  return {
    id: generateId(),
    type: 'text',
    x: 100,
    y: 100,
    width: 300,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    text: 'Double-click to edit',
    style: { ...DEFAULT_TEXT_STYLE },
    ...overrides,
  };
}

export function createShapeElement(shapeType: ShapeType = 'rect', overrides?: Partial<ShapeElement>): ShapeElement {
  const isLineType = shapeType === 'line' || shapeType === 'arrow';
  return {
    id: generateId(),
    type: 'shape',
    shapeType,
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    ...DEFAULT_SHAPE_PROPS,
    ...(isLineType ? { strokeWidth: 3, fill: '' } : {}),
    ...overrides,
  };
}

export function createImageElement(src: string, originalWidth: number, originalHeight: number, overrides?: Partial<ImageElement>): ImageElement {
  const maxW = SLIDE_WIDTH * 0.6;
  const maxH = SLIDE_HEIGHT * 0.6;
  const scale = Math.min(maxW / originalWidth, maxH / originalHeight, 1);
  const width = originalWidth * scale;
  const height = originalHeight * scale;

  return {
    id: generateId(),
    type: 'image',
    x: (SLIDE_WIDTH - width) / 2,
    y: (SLIDE_HEIGHT - height) / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    src,
    originalWidth,
    originalHeight,
    cropX: 0,
    cropY: 0,
    cropWidth: originalWidth,
    cropHeight: originalHeight,
    ...overrides,
  };
}

export function createPresentation(): Presentation {
  const firstSlide = createSlide();
  return {
    id: generateId(),
    title: 'Untitled Presentation',
    slides: { [firstSlide.id]: firstSlide },
    slideOrder: [firstSlide.id],
    theme: createDefaultTheme(),
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function duplicateElement(element: SlideElement): SlideElement {
  const newId = generateId();
  return {
    ...JSON.parse(JSON.stringify(element)),
    id: newId,
    x: element.x + 20,
    y: element.y + 20,
  };
}
