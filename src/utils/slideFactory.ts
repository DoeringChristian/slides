import { generateId } from './idGenerator';
import { DEFAULT_TEXT_STYLE, DEFAULT_SHAPE_PROPS, SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import type { Slide, TextElement, ShapeElement, ImageElement, ShapeType, SlideElement, Presentation, Theme, ObjectMeta, Resource } from '../types/presentation';

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
    transition: { duration: 300 },
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

export function createResource(
  name: string,
  src: string,
  originalWidth: number,
  originalHeight: number,
  type: 'image' | 'video' = 'image',
  duration?: number
): Resource {
  return {
    id: generateId(),
    name,
    type,
    src,
    originalWidth,
    originalHeight,
    ...(duration !== undefined ? { duration } : {}),
  };
}

export function createImageElement(resourceId: string | null, originalWidth: number, originalHeight: number, overrides?: Partial<ImageElement>): ImageElement {
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
    resourceId,
    // Image crop properties
    cropX: 0,
    cropY: 0,
    cropWidth: originalWidth,
    cropHeight: originalHeight,
    // Video playback properties (used when resource is a video)
    playing: true,
    loop: false,
    muted: false,
    startTime: 0,
    ...overrides,
  };
}

function parseSvgDimensions(svgText: string): { width: number; height: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const w = parseFloat(svg.getAttribute('width') || '');
  const h = parseFloat(svg.getAttribute('height') || '');
  if (w > 0 && h > 0) return { width: w, height: h };
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const vw = parseFloat(parts[2]);
      const vh = parseFloat(parts[3]);
      if (vw > 0 && vh > 0) return { width: vw, height: vh };
    }
  }
  return null;
}

export function loadImageFile(file: Blob, overrides?: Partial<ImageElement>): Promise<{ resource: Resource; element: ImageElement }> {
  const isSvg = file.type === 'image/svg+xml' || (file instanceof File && file.name.endsWith('.svg'));
  const fileName = file instanceof File ? file.name : 'Image';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (isSvg) {
        // Decode SVG text to get reliable dimensions
        const svgText = atob(src.split(',')[1] || '');
        const dims = parseSvgDimensions(svgText);
        const img = new window.Image();
        img.onload = () => {
          const w = dims?.width || img.width || SLIDE_WIDTH * 0.6;
          const h = dims?.height || img.height || SLIDE_HEIGHT * 0.6;
          const resource = createResource(fileName, src, w, h);
          const element = createImageElement(resource.id, w, h, overrides);
          resolve({ resource, element });
        };
        img.onerror = () => reject(new Error('Failed to load SVG'));
        img.src = src;
      } else {
        const img = new window.Image();
        img.onload = () => {
          const resource = createResource(fileName, src, img.width, img.height);
          const element = createImageElement(resource.id, img.width, img.height, overrides);
          resolve({ resource, element });
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function loadPdfFile(file: Blob): Promise<{ resources: Resource[]; elements: ImageElement[] }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;

  const fileName = file instanceof File ? file.name : 'PDF';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const resources: Resource[] = [];
  const elements: ImageElement[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 2; // render at 2x for quality
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const src = canvas.toDataURL('image/png');
    const w = viewport.width / scale;
    const h = viewport.height / scale;
    const resource = createResource(`${fileName} - Page ${i}`, src, w, h, 'image');
    resources.push(resource);
    elements.push(createImageElement(resource.id, w, h));
  }

  return { resources, elements };
}

export function loadVideoFile(
  file: Blob,
  overrides?: Partial<ImageElement>
): Promise<{ resource: Resource; element: ImageElement }> {
  const fileName = file instanceof File ? file.name : 'Video';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const resource = createResource(
          fileName,
          src,
          video.videoWidth,
          video.videoHeight,
          'video',
          video.duration
        );
        const element = createImageElement(
          resource.id,
          video.videoWidth,
          video.videoHeight,
          overrides
        );
        resolve({ resource, element });
      };
      video.onerror = () => reject(new Error('Failed to load video'));
      video.src = src;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function createPresentation(): Presentation {
  const firstSlide = createSlide();
  return {
    id: generateId(),
    title: 'Untitled Presentation',
    slides: { [firstSlide.id]: firstSlide },
    slideOrder: [firstSlide.id],
    objects: {},
    resources: {},
    templates: {},
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

export function copySlideAsKeyframe(sourceSlide: Slide): Slide {
  const newSlideId = generateId();
  const elements: Record<string, SlideElement> = {};
  for (const elId of sourceSlide.elementOrder) {
    const el = sourceSlide.elements[elId];
    if (el) {
      elements[elId] = JSON.parse(JSON.stringify(el));
    }
  }
  return {
    id: newSlideId,
    elements,
    elementOrder: [...sourceSlide.elementOrder],
    background: JSON.parse(JSON.stringify(sourceSlide.background)),
    transition: { duration: sourceSlide.transition.duration },
    notes: '',
  };
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
  shape: 'Shape',
  image: 'Image',
  video: 'Video',
};

export function generateObjectName(type: string, existingObjects: Record<string, ObjectMeta>): string {
  const label = TYPE_LABELS[type] || 'Object';
  const existing = Object.values(existingObjects);
  let maxNum = 0;
  for (const obj of existing) {
    const match = obj.name.match(new RegExp(`^${label}\\s+(\\d+)$`));
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return `${label} ${maxNum + 1}`;
}
