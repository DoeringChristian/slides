import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { renderMarkdownToHtml } from '../components/canvas/CustomMarkdownRenderer';
import { RenderShape } from '../components/svg/ElementRenderer';

// ── String-assembled SVG for raster export (PNG download, thumbnails) ──
//
// The assembled <svg> is loaded into an <img> and drawn onto a canvas
// (see exportImage.ts / thumbnailGenerator.ts / svgToPngDataURL below).
// That "SVG as image" rasterization path constrains what we can emit:
//
//   * SHAPES delegate to the shared React leaf renderer `RenderShape`
//     (the same component the editor canvas, presenter, and previews use)
//     via renderToStaticMarkup — pure SVG markup, drops straight into the
//     string. Shape features can no longer drift between editor and export.
//   * TEXT stays a <foreignObject> with the markdown-rendered HTML: the
//     shared `SVGTextPaths` lays out glyphs asynchronously in effects
//     (font fetch + measurement), which a static, synchronous string render
//     can't wait for. foreignObject HTML does rasterize in the SVG→<img>
//     path, so this produces correct output.
//   * IMAGES stay SVG <image> tags: `RenderImage` emits HTML <img>/<video>
//     inside a foreignObject, and external media inside a foreignObject
//     does NOT load when the SVG is rasterized through an <img>. Videos
//     can't rasterize at all and become a placeholder rect.

// Render text element to SVG string
function renderTextElement(element: TextElement): string {
  const { text, style, x, y, width, height, rotation, opacity } = element;
  const padding = TEXT_BOX_PADDING;

  const htmlContent = renderMarkdownToHtml(text || '', style, 1);

  let verticalAlignStyle = '';
  if (style.verticalAlign === 'middle') {
    verticalAlignStyle = 'display:flex;flex-direction:column;justify-content:center;';
  } else if (style.verticalAlign === 'bottom') {
    verticalAlignStyle = 'display:flex;flex-direction:column;justify-content:flex-end;';
  }

  const textDecoration = style.textDecoration && style.textDecoration !== 'none'
    ? `text-decoration:${style.textDecoration};` : '';

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : '';

  return `
    <g transform="${transform}" opacity="${opacity}">
      <foreignObject x="${x + padding}" y="${y + padding}" width="${width - padding * 2}" height="${height - padding * 2}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;font-family:${style.fontFamily};font-style:${style.fontStyle};color:${style.color};text-align:${style.align};${textDecoration}word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap;overflow:hidden;${verticalAlignStyle}">
          ${htmlContent}
        </div>
      </foreignObject>
    </g>
  `;
}

// Render shape element to SVG string — DELEGATED to the shared editor
// renderer. RenderShape is pure SVG (no foreignObject, no effects), so its
// static markup drops straight into the assembled string. Do NOT re-add
// hand-rolled shape branches here; that fork is how dashed strokes once
// exported as solid.
function renderShapeElement(element: ShapeElement): string {
  return renderToStaticMarkup(createElement(RenderShape, { element }));
}

// Render image element to SVG string
function renderImageElement(element: ImageElement, resources: Record<string, Resource>): string {
  const { x, y, width, height, rotation, opacity, resourceId, cropX, cropY, cropWidth, cropHeight } = element;
  const resource = resourceId ? resources[resourceId] : undefined;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : '';

  if (!resource || resource.type === 'video') {
    // Placeholder for missing images or videos
    const fillColor = resource?.type === 'video' ? '#1f2937' : '#f3f4f6';
    return `
      <g transform="${transform}">
        <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fillColor}" opacity="${opacity}" />
      </g>
    `;
  }

  const hasCrop = cropWidth > 0 && cropHeight > 0;

  if (hasCrop) {
    const clipId = `clip-export-${element.id}`;
    const scaleX = width / cropWidth;
    const scaleY = height / cropHeight;

    return `
      <g transform="${transform}">
        <defs>
          <clipPath id="${clipId}">
            <rect x="${x}" y="${y}" width="${width}" height="${height}" />
          </clipPath>
        </defs>
        <g clip-path="url(#${clipId})">
          <image href="${resource.src}" x="${x - cropX * scaleX}" y="${y - cropY * scaleY}" width="${resource.originalWidth * scaleX}" height="${resource.originalHeight * scaleY}" opacity="${opacity}" preserveAspectRatio="none" />
        </g>
      </g>
    `;
  }

  return `
    <g transform="${transform}">
      <image href="${resource.src}" x="${x}" y="${y}" width="${width}" height="${height}" opacity="${opacity}" preserveAspectRatio="none" />
    </g>
  `;
}

// Render element to SVG string
function renderElement(element: SlideElement, resources: Record<string, Resource>): string {
  if (!element.visible) return '';

  switch (element.type) {
    case 'text':
      return renderTextElement(element as TextElement);
    case 'shape':
      return renderShapeElement(element as ShapeElement);
    case 'image':
      return renderImageElement(element as ImageElement, resources);
    default:
      return '';
  }
}

// Render background to SVG string
function renderBackground(background: Slide['background']): string {
  if (background.type === 'solid') {
    return `<rect x="0" y="0" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="${background.color}" />`;
  }
  if (background.type === 'gradient') {
    const gradientId = 'bg-gradient';
    const angle = background.direction || 0;
    const radians = (angle * Math.PI) / 180;
    const x1 = 50 - Math.cos(radians) * 50;
    const y1 = 50 - Math.sin(radians) * 50;
    const x2 = 50 + Math.cos(radians) * 50;
    const y2 = 50 + Math.sin(radians) * 50;
    return `
      <defs>
        <linearGradient id="${gradientId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
          <stop offset="0%" stop-color="${background.from}" />
          <stop offset="100%" stop-color="${background.to || background.from}" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="url(#${gradientId})" />
    `;
  }
  if (background.type === 'image' && background.src) {
    return `<image href="${background.src}" x="0" y="0" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" preserveAspectRatio="xMidYMid slice" />`;
  }
  return `<rect x="0" y="0" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="#ffffff" />`;
}

// Render slide to SVG string
export function renderSlideToSVG(slide: Slide, resources: Record<string, Resource>): string {
  const elements = slide.elementOrder.map(id => slide.elements[id]).filter(Boolean);

  const elementsSVG = elements.map(el => renderElement(el, resources)).join('\n');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}">
      ${renderBackground(slide.background)}
      ${elementsSVG}
    </svg>
  `;
}

// Convert SVG string to data URL
export function svgToDataURL(svgString: string): string {
  const encoded = encodeURIComponent(svgString);
  return `data:image/svg+xml,${encoded}`;
}

// Convert SVG to PNG data URL via canvas
export async function svgToPngDataURL(
  svgString: string,
  options: { width?: number; height?: number; pixelRatio?: number } = {},
): Promise<string> {
  const width = options.width ?? SLIDE_WIDTH;
  const height = options.height ?? SLIDE_HEIGHT;
  const pixelRatio = options.pixelRatio ?? 2;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.scale(pixelRatio, pixelRatio);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = svgToDataURL(svgString);
  });
}
