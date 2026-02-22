import Konva from 'konva';
import type { Slide, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = (SLIDE_HEIGHT / SLIDE_WIDTH) * THUMBNAIL_WIDTH;

interface ThumbnailOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
}

export async function generateThumbnail(
  slide: Slide,
  resources: Record<string, Resource>,
  options: ThumbnailOptions = {}
): Promise<string> {
  const width = options.width || THUMBNAIL_WIDTH;
  const height = options.height || THUMBNAIL_HEIGHT;
  const pixelRatio = options.pixelRatio || 1;
  const scale = width / SLIDE_WIDTH;

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const stage = new Konva.Stage({
    container,
    width,
    height,
  });
  const layer = new Konva.Layer();
  stage.add(layer);

  // Draw background
  const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';
  layer.add(
    new Konva.Rect({
      x: 0,
      y: 0,
      width: SLIDE_WIDTH,
      height: SLIDE_HEIGHT,
      fill: bgColor,
      scaleX: scale,
      scaleY: scale,
    })
  );

  // Create a group with scale applied
  const scaledGroup = new Konva.Group({
    scaleX: scale,
    scaleY: scale,
  });
  layer.add(scaledGroup);

  // Draw elements
  const elements = slide.elementOrder.map((id) => slide.elements[id]).filter(Boolean);

  // Pre-load images
  const imagePromises: Promise<void>[] = [];
  const loadedImages: Map<string, HTMLImageElement> = new Map();

  for (const el of elements) {
    if (!el.visible) continue;
    if (el.type === 'image') {
      const imgEl = el as ImageElement;
      const resource = imgEl.resourceId ? resources[imgEl.resourceId] : undefined;
      if (resource?.type === 'image' && resource.src) {
        const promise = new Promise<void>((resolve) => {
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            loadedImages.set(imgEl.id, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = resource.src;
        });
        imagePromises.push(promise);
      }
    }
  }

  await Promise.all(imagePromises);

  // Now draw elements
  for (const el of elements) {
    if (!el.visible) continue;

    if (el.type === 'text') {
      const t = el as TextElement;
      scaledGroup.add(
        new Konva.Text({
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          text: t.text,
          fontSize: t.style.fontSize,
          fontFamily: t.style.fontFamily,
          fill: t.style.color,
          align: t.style.align,
          rotation: t.rotation,
          opacity: t.opacity,
          fontStyle:
            `${t.style.fontWeight === 'bold' ? 'bold' : ''} ${t.style.fontStyle === 'italic' ? 'italic' : ''}`.trim() ||
            'normal',
        })
      );
    } else if (el.type === 'shape') {
      const s = el as ShapeElement;
      const common = { rotation: s.rotation, opacity: s.opacity };
      switch (s.shapeType) {
        case 'rect':
          scaledGroup.add(
            new Konva.Rect({
              x: s.x,
              y: s.y,
              width: s.width,
              height: s.height,
              fill: s.fill,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              cornerRadius: s.cornerRadius,
              ...common,
            })
          );
          break;
        case 'ellipse':
          scaledGroup.add(
            new Konva.Ellipse({
              x: s.x + s.width / 2,
              y: s.y + s.height / 2,
              radiusX: s.width / 2,
              radiusY: s.height / 2,
              fill: s.fill,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              ...common,
            })
          );
          break;
        case 'triangle':
          scaledGroup.add(
            new Konva.RegularPolygon({
              x: s.x + s.width / 2,
              y: s.y + s.height / 2,
              sides: 3,
              radius: Math.min(s.width, s.height) / 2,
              fill: s.fill,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              ...common,
            })
          );
          break;
        case 'star':
          scaledGroup.add(
            new Konva.Star({
              x: s.x + s.width / 2,
              y: s.y + s.height / 2,
              numPoints: 5,
              innerRadius: Math.min(s.width, s.height) / 4,
              outerRadius: Math.min(s.width, s.height) / 2,
              fill: s.fill,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              ...common,
            })
          );
          break;
        case 'line':
          scaledGroup.add(
            new Konva.Line({
              x: s.x,
              y: s.y,
              points: s.points ?? [0, 0, s.width, 0],
              stroke: s.stroke || s.fill,
              strokeWidth: s.strokeWidth || 3,
              ...common,
            })
          );
          break;
        case 'arrow':
          scaledGroup.add(
            new Konva.Arrow({
              x: s.x,
              y: s.y,
              points: s.points ?? [0, 0, s.width, 0],
              stroke: s.stroke || s.fill,
              strokeWidth: s.strokeWidth || 3,
              fill: s.stroke || s.fill,
              pointerLength: 10,
              pointerWidth: 10,
              ...common,
            })
          );
          break;
        default:
          scaledGroup.add(
            new Konva.Rect({
              x: s.x,
              y: s.y,
              width: s.width,
              height: s.height,
              fill: s.fill,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              ...common,
            })
          );
      }
    } else if (el.type === 'image') {
      const imgEl = el as ImageElement;
      const loadedImg = loadedImages.get(imgEl.id);
      if (loadedImg) {
        const hasCrop = imgEl.cropWidth > 0 && imgEl.cropHeight > 0;
        scaledGroup.add(
          new Konva.Image({
            image: loadedImg,
            x: imgEl.x,
            y: imgEl.y,
            width: imgEl.width,
            height: imgEl.height,
            rotation: imgEl.rotation,
            opacity: imgEl.opacity,
            crop: hasCrop
              ? {
                  x: imgEl.cropX,
                  y: imgEl.cropY,
                  width: imgEl.cropWidth,
                  height: imgEl.cropHeight,
                }
              : undefined,
          })
        );
      } else {
        // Placeholder for images that couldn't load
        scaledGroup.add(
          new Konva.Rect({
            x: imgEl.x,
            y: imgEl.y,
            width: imgEl.width,
            height: imgEl.height,
            fill: '#e5e7eb',
            rotation: imgEl.rotation,
            opacity: imgEl.opacity,
          })
        );
      }
    }
  }

  layer.draw();

  const dataUrl = stage.toDataURL({ pixelRatio });

  stage.destroy();
  container.remove();

  return dataUrl;
}
