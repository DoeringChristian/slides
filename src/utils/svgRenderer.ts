import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';
import { renderLatex } from './latexUtils';
import { getElementCenter } from './geometry';

// Render text block as HTML
function renderBlockAsHtml(displayContent: string, sourceStart: number): string {
  const segments = parseInlineSegments(displayContent, sourceStart);
  return segments.map((segment) => {
    if (segment.type === 'latex') {
      return renderLatex(segment.displayContent, segment.isBlock);
    }
    if (segment.type === 'link') {
      const escaped = segment.displayContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span style="color:#2563eb;text-decoration:underline">${escaped}</span>`;
    }
    if (segment.type === 'formatted') {
      let style = '';
      if (segment.bold) style += 'font-weight:bold;';
      if (segment.italic) style += 'font-style:italic;';
      if (segment.strikethrough) style += 'text-decoration:line-through;';
      if (segment.underline) style += 'text-decoration:underline;';
      const escaped = segment.displayContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span style="${style}">${escaped}</span>`;
    }
    return segment.displayContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }).join('');
}

// Render text element to SVG string
function renderTextElement(element: TextElement): string {
  const { text, style, x, y, width, height, rotation, opacity } = element;
  const padding = TEXT_BOX_PADDING;

  const blocks = parseBlocks(text || '');
  const lineHeight = style.lineHeight || 1.2;

  const htmlContent = blocks.map(block => {
    const multiplier = getBlockFontMultiplier(block.type);
    const fontSize = style.fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const fontWeight = isHeader ? 'bold' : style.fontWeight;
    const html = renderBlockAsHtml(block.displayContent, block.sourceStart + block.prefixLength);
    return `<div style="font-size:${fontSize}px;font-weight:${fontWeight};line-height:${lineHeight};min-height:${fontSize * lineHeight}px;margin:0;padding:0;">${html || '&nbsp;'}</div>`;
  }).join('');

  let verticalAlignStyle = '';
  if (style.verticalAlign === 'middle') {
    verticalAlignStyle = 'display:flex;flex-direction:column;justify-content:center;';
  } else if (style.verticalAlign === 'bottom') {
    verticalAlignStyle = 'display:flex;flex-direction:column;justify-content:flex-end;';
  }

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = rotation ? `rotate(${rotation}, ${cx}, ${cy})` : '';

  return `
    <g transform="${transform}" opacity="${opacity}">
      <foreignObject x="${x + padding}" y="${y + padding}" width="${width - padding * 2}" height="${height - padding * 2}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;font-family:${style.fontFamily};font-style:${style.fontStyle};color:${style.color};text-align:${style.align};word-wrap:break-word;overflow-wrap:break-word;white-space:pre-wrap;overflow:hidden;${verticalAlignStyle}">
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

    case 'line': {
      const pts = points ?? [0, 0, width, 0];
      const lineStroke = stroke || fill || '#000';
      const lineWidth = strokeWidth || 3;
      // Use line center for rotation, not bounding box center
      const lineCenter = getElementCenter(element);
      const lineTransform = rotation ? `rotate(${rotation}, ${lineCenter.x}, ${lineCenter.y})` : '';
      return `
        <g transform="${lineTransform}">
          <line x1="${x + pts[0]}" y1="${y + pts[1]}" x2="${x + pts[2]}" y2="${y + pts[3]}" stroke="${lineStroke}" stroke-width="${lineWidth}" stroke-linecap="round" opacity="${opacity}" />
        </g>
      `;
    }

    case 'arrow': {
      const pts = points ?? [0, 0, width, 0];
      const arrowStroke = stroke || fill || '#000';
      const arrowWidth = strokeWidth || 3;
      const dx = pts[2] - pts[0];
      const dy = pts[3] - pts[1];
      const angle = Math.atan2(dy, dx);
      const headLength = 10;
      const headWidth = 10;
      const tip = { x: x + pts[2], y: y + pts[3] };
      const left = {
        x: tip.x - headLength * Math.cos(angle) + headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) - headWidth / 2 * Math.cos(angle),
      };
      const right = {
        x: tip.x - headLength * Math.cos(angle) - headWidth / 2 * Math.sin(angle),
        y: tip.y - headLength * Math.sin(angle) + headWidth / 2 * Math.cos(angle),
      };
      // Use line center for rotation, not bounding box center
      const arrowCenter = getElementCenter(element);
      const arrowTransform = rotation ? `rotate(${rotation}, ${arrowCenter.x}, ${arrowCenter.y})` : '';
      return `
        <g transform="${arrowTransform}">
          <line x1="${x + pts[0]}" y1="${y + pts[1]}" x2="${x + pts[2]}" y2="${y + pts[3]}" stroke="${arrowStroke}" stroke-width="${arrowWidth}" stroke-linecap="round" opacity="${opacity}" />
          <polygon points="${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}" fill="${arrowStroke}" opacity="${opacity}" />
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
