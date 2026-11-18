import { generateId } from '../idGenerator';
import { DEFAULT_TEXT_STYLE, DEFAULT_SHAPE_PROPS, DEFAULT_RECT_RADIUS, SLIDE_WIDTH, SLIDE_HEIGHT } from '../constants';
import { addMedia, hashBlob, type MediaInfo } from '../../media/mediaStore';
import type { Slide, TextElement, ShapeElement, ImageElement, ShapeType, SlideElement, Presentation, Theme, ObjectMeta, Resource } from '../../types/presentation';

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
    textSizing: 'user-width',
    boundTextLayout: 'padded',
    style: { ...DEFAULT_TEXT_STYLE },
    ...overrides,
  };
}

export function createShapeElement(shapeType: ShapeType = 'rect', overrides?: Partial<ShapeElement>): ShapeElement {
  // New shapes share stroke-only defaults; explicit imports/templates win.
  return {
    id: generateId(),
    type: 'shape',
    shapeType,
    creationPreset: shapeType === 'vector' ? 'icon' : shapeType === 'path' ? 'line' : shapeType,
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    ...DEFAULT_SHAPE_PROPS,
    cornerRadius: shapeType === 'rect' ? DEFAULT_RECT_RADIUS : 0,
    ...overrides,
  };
}

export function createResource(
  name: string,
  media: MediaInfo,
  originalWidth: number,
  originalHeight: number,
  type: 'image' | 'video' = 'image',
  duration?: number,
): Resource {
  return {
    id: generateId(),
    name,
    type,
    hash: media.hash,
    mime: media.mime,
    size: media.size,
    originalWidth,
    originalHeight,
    ...(duration !== undefined ? { duration } : {}),
  };
}

/**
 * Find an existing resource by its content hash.
 */
export function findResourceByHash(resources: Record<string, Resource>, hash: string): Resource | undefined {
  return Object.values(resources).find(r => r.hash === hash);
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
    // Videos: keep playing across keyframes (see ImageElement.playback).
    muted: false,
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

/** Load an image or video from an object URL of its bytes (never a data URL:
 *  the bytes stay a blob). */
async function withObjectUrl<T>(blob: Blob, read: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(blob);
  try { return await read(url); } finally { URL.revokeObjectURL(url); }
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export async function loadImageFile(
  file: Blob,
  overrides?: Partial<ImageElement>,
  existingResources?: Record<string, Resource>
): Promise<{ resource: Resource; element: ImageElement; isExisting: boolean }> {
  const isSvg = file.type === 'image/svg+xml' || (file instanceof File && file.name.endsWith('.svg'));
  const fileName = file instanceof File ? file.name : 'Image';
  const mime = isSvg ? 'image/svg+xml' : file.type || 'application/octet-stream';

  // The same bytes already in the deck: reuse that resource.
  const hash = await hashBlob(file);
  const existing = existingResources ? findResourceByHash(existingResources, hash) : undefined;
  if (existing) {
    const element = createImageElement(existing.id, existing.originalWidth, existing.originalHeight, overrides);
    return { resource: existing, element, isExisting: true };
  }

  const typed = file.type === mime ? file : new Blob([file], { type: mime });
  let { width, height } = await withObjectUrl(typed, imageSize).catch((err) => {
    if (!isSvg) throw err;
    return { width: 0, height: 0 };
  });
  if (isSvg) {
    // An SVG's own size is more reliable than how a browser rasterises it.
    const dims = parseSvgDimensions(await file.text());
    width = dims?.width || width || SLIDE_WIDTH * 0.6;
    height = dims?.height || height || SLIDE_HEIGHT * 0.6;
  }
  const media = await addMedia(typed, mime);
  const resource = createResource(fileName, media, width, height, 'image');
  const element = createImageElement(resource.id, width, height, overrides);
  return { resource, element, isExisting: false };
}

export async function loadPdfFile(
  file: Blob,
  existingResources?: Record<string, Resource>
): Promise<{ resources: Resource[]; elements: ImageElement[]; isExisting: boolean }> {
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
  let reused = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 2; // render at 2x for quality
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Failed to render PDF page'))), 'image/png'));
    const w = viewport.width / scale;
    const h = viewport.height / scale;
    // A page rendered before has the same bytes: reuse its resource.
    const existing = existingResources ? findResourceByHash(existingResources, await hashBlob(png)) : undefined;
    if (existing) {
      reused++;
      resources.push(existing);
      elements.push(createImageElement(existing.id, existing.originalWidth, existing.originalHeight));
      continue;
    }
    const resource = createResource(`${fileName} - Page ${i}`, await addMedia(png, 'image/png'), w, h, 'image');
    resources.push(resource);
    elements.push(createImageElement(resource.id, w, h));
  }

  return { resources, elements, isExisting: reused === pdf.numPages };
}

function videoMetadata(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      video.removeAttribute('src');
      video.load();
    };
    video.onerror = () => reject(new Error('Failed to load video'));
    video.src = url;
  });
}

export async function loadVideoFile(
  file: Blob,
  overrides?: Partial<ImageElement>,
  existingResources?: Record<string, Resource>
): Promise<{ resource: Resource; element: ImageElement; isExisting: boolean }> {
  const fileName = file instanceof File ? file.name : 'Video';

  const hash = await hashBlob(file);
  const existing = existingResources ? findResourceByHash(existingResources, hash) : undefined;
  if (existing) {
    const element = createImageElement(existing.id, existing.originalWidth, existing.originalHeight, overrides);
    return { resource: existing, element, isExisting: true };
  }

  const meta = await withObjectUrl(file, videoMetadata);
  const media = await addMedia(file, file.type || 'video/mp4');
  const resource = createResource(fileName, media, meta.width, meta.height, 'video', meta.duration);
  const element = createImageElement(resource.id, meta.width, meta.height, overrides);
  return { resource, element, isExisting: false };
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
    objectGroupIds: undefined,
    x: element.x + 20,
    y: element.y + 20,
  };
}

/**
 * Duplicate a group of elements together, remapping bound-text `containerId`
 * refs: a label copied WITH its container points at the container's clone; a
 * label copied WITHOUT its container is promoted to free text. Used by copy/paste and the
 * canvas Duplicate action.
 */
export function duplicateElements(elements: SlideElement[]): SlideElement[] {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const el of elements) for (const group of el.objectGroupIds ?? []) {
    if (!groupMap.has(group)) groupMap.set(group, generateId());
  }
  for (const el of elements) idMap.set(el.id, generateId());
  return elements.map((el) => {
    const copy = {
      ...JSON.parse(JSON.stringify(el)),
      id: idMap.get(el.id)!,
      x: el.x + 20,
      y: el.y + 20,
    } as SlideElement;
    if (copy.objectGroupIds) copy.objectGroupIds = copy.objectGroupIds.map(id => groupMap.get(id)!);
    if (copy.type === 'shape' && copy.cropGroupId) copy.cropGroupId = groupMap.get(copy.cropGroupId);
    if (copy.type === 'text') {
      const label = copy as TextElement;
      if (label.containerId) {
        const mapped = idMap.get(label.containerId);
        if (mapped) label.containerId = mapped;
        else delete label.containerId;
      }
    }
    return copy;
  });
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
    // Keyframe copies inherit the slide group so a duplicate inserted next to
    // its source joins the timed chain (the run stays contiguous by
    // construction — the copy lands adjacent to the source).
    ...(sourceSlide.groupId !== undefined ? { groupId: sourceSlide.groupId } : {}),
  };
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  dot: 'Dot',
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
