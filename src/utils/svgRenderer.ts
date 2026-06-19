import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { renderMarkdownToHtml } from '../components/canvas/CustomMarkdownRenderer';
import { pathD, arrowheadPoints, insetEndpoints } from './pathShapes';

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

// Render shape element to SVG string
function renderShapeElement(element: ShapeElement): string {
  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, cornerRadius, points } = element;

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : '';

  const fillAttr = fill || 'transparent';
  const strokeAttr = stroke || 'none';
  const strokeWidthAttr = strokeWidth || 0;

  switch (shapeType) {
    case 'rect':
      return `
        <g transform="${transform}">
          <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${cornerRadius || 0}" ry="${cornerRadius || 0}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeWidthAttr}" opacity="${opacity}" />
        </g>
      `;

    case 'ellipse':
      return `
        <g transform="${transform}">
          <ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeWidthAttr}" opacity="${opacity}" />
        </g>
      `;

    case 'triangle': {
      const tcx = x + width / 2;
      const tcy = y + height / 2;
      const r = Math.min(width, height) / 2;
      const pts = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const d = `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} Z`;
      return `
        <g transform="${transform}">
          <path d="${d}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeWidthAttr}" opacity="${opacity}" />
        </g>
      `;
    }

    case 'star': {
      const scx = x + width / 2;
      const scy = y + height / 2;
      const outerR = Math.min(width, height) / 2;
      const innerR = outerR / 2;
      const starPoints: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        starPoints.push(`${scx + r * Math.cos(angle)},${scy + r * Math.sin(angle)}`);
      }
      return `
        <g transform="${transform}">
          <polygon points="${starPoints.join(' ')}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeWidthAttr}" opacity="${opacity}" />
        </g>
      `;
    }

    case 'path': {
      const pts = points ?? [];
      if (pts.length < 4) return '';
      const closed = element.closed ?? false;
      const curve = element.curve ?? 'linear';
      const shaftPts = insetEndpoints(pts, !!element.startArrow, !!element.endArrow);
      const d = pathD(shaftPts, curve, closed);
      const strokeCol = stroke || fill || '#000';
      const strokeW = strokeWidth || (closed ? 0 : 3);
      const fillCol = closed ? fillAttr : 'none';
      const last = pts.length - 2;
      const startHead = element.startArrow
        ? arrowheadPoints(pts[0], pts[1], pts[0] - pts[2], pts[1] - pts[3])
        : null;
      const endHead = element.endArrow
        ? arrowheadPoints(pts[last], pts[last + 1], pts[last] - pts[last - 2], pts[last + 1] - pts[last - 1])
        : null;
      const headSvg = (h: number[] | null) => h
        ? `<polygon points="${h[0]},${h[1]} ${h[2]},${h[3]} ${h[4]},${h[5]}" fill="${strokeCol}" opacity="${opacity}" />`
        : '';
      return `
        <g transform="${transform}">
          <g transform="translate(${x}, ${y})">
            <path d="${d}" fill="${fillCol}" stroke="${strokeCol}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />
            ${headSvg(startHead)}
            ${headSvg(endHead)}
          </g>
        </g>
      `;
    }

    default:
      return `
        <g transform="${transform}">
          <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${strokeWidthAttr}" opacity="${opacity}" />
        </g>
      `;
  }
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
export async function svgToPngDataURL(svgString: string, pixelRatio: number = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SLIDE_WIDTH * pixelRatio;
      canvas.height = SLIDE_HEIGHT * pixelRatio;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.scale(pixelRatio, pixelRatio);
      ctx.drawImage(img, 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = svgToDataURL(svgString);
  });
}
