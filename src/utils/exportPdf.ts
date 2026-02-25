import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { Presentation, Slide, SlideElement, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';
import katex from 'katex';

// Render LaTeX to HTML
function renderLatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return latex;
  }
}

// Render inline segments as HTML
function renderInlineAsHtml(displayContent: string, sourceStart: number): string {
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

// Render text element as HTML div
function createTextElementHtml(element: TextElement): HTMLDivElement {
  const { text, style, x, y, width, height, rotation, opacity } = element;
  const padding = TEXT_BOX_PADDING;

  const blocks = parseBlocks(text || '');
  const lineHeight = style.lineHeight || 1.2;

  // Base style that applies to all blocks (matching CustomMarkdownRenderer)
  const baseStyleStr = `
    font-family: ${style.fontFamily};
    font-weight: ${style.fontWeight};
    font-style: ${style.fontStyle};
    color: ${style.color};
    text-align: ${style.align};
    line-height: ${lineHeight};
  `;

  const htmlContent = blocks.map(block => {
    const multiplier = getBlockFontMultiplier(block.type);
    const fontSize = style.fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const isList = block.type === 'bullet' || block.type === 'numbered';
    const fontWeight = isHeader ? 'bold' : style.fontWeight;
    const html = renderInlineAsHtml(block.displayContent, block.sourceStart + block.prefixLength);

    // Match BlockRenderer exactly
    const blockStyle = `
      ${baseStyleStr}
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      min-height: ${fontSize * lineHeight}px;
      ${isList ? 'display: flex;' : ''}
    `;

    // Empty content uses <br> like CustomMarkdownRenderer
    const content = block.displayContent ? html : '<br>';
    return `<div style="${blockStyle}">${content}</div>`;
  }).join('');

  // Match presenter rendering exactly
  const alignItems = style.verticalAlign === 'middle' ? 'center' :
                     style.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';

  const container = document.createElement('div');
  container.style.cssText = `
    position: absolute;
    left: ${x}px;
    top: ${y}px;
    width: ${width}px;
    height: ${height}px;
    transform: rotate(${rotation}deg);
    transform-origin: center center;
    opacity: ${opacity};
    overflow: visible;
    display: flex;
    align-items: ${alignItems};
  `;

  // Inner padding div (matches presenter structure)
  const paddingDiv = document.createElement('div');
  paddingDiv.style.cssText = `width: 100%; padding: ${padding}px;`;

  // Content wrapper (matches CustomMarkdownRenderer wrapper)
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = htmlContent;

  paddingDiv.appendChild(contentDiv);
  container.appendChild(paddingDiv);
  return container;
}

// Create shape element as SVG
function createShapeElementSvg(element: ShapeElement): SVGSVGElement {
  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, cornerRadius, points } = element;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${SLIDE_WIDTH}px;
    height: ${SLIDE_HEIGHT}px;
    pointer-events: none;
  `;
  svg.setAttribute('viewBox', `0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`);

  const cx = x + width / 2;
  const cy = y + height / 2;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  if (rotation) {
    g.setAttribute('transform', `rotate(${rotation}, ${cx}, ${cy})`);
  }

  const fillAttr = fill || 'transparent';
  const strokeAttr = stroke || 'none';
  const strokeWidthAttr = strokeWidth || 0;

  let shapeEl: SVGElement | null = null;

  switch (shapeType) {
    case 'rect': {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('rx', String(cornerRadius || 0));
      rect.setAttribute('ry', String(cornerRadius || 0));
      rect.setAttribute('fill', fillAttr);
      rect.setAttribute('stroke', strokeAttr);
      rect.setAttribute('stroke-width', String(strokeWidthAttr));
      rect.setAttribute('opacity', String(opacity));
      shapeEl = rect;
      break;
    }

    case 'ellipse': {
      const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ellipse.setAttribute('cx', String(x + width / 2));
      ellipse.setAttribute('cy', String(y + height / 2));
      ellipse.setAttribute('rx', String(width / 2));
      ellipse.setAttribute('ry', String(height / 2));
      ellipse.setAttribute('fill', fillAttr);
      ellipse.setAttribute('stroke', strokeAttr);
      ellipse.setAttribute('stroke-width', String(strokeWidthAttr));
      ellipse.setAttribute('opacity', String(opacity));
      shapeEl = ellipse;
      break;
    }

    case 'triangle': {
      const tcx = x + width / 2;
      const tcy = y + height / 2;
      const r = Math.min(width, height) / 2;
      const pts = [
        [tcx, tcy - r],
        [tcx - r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
        [tcx + r * Math.cos(Math.PI / 6), tcy + r * Math.sin(Math.PI / 6)],
      ];
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} Z`);
      path.setAttribute('fill', fillAttr);
      path.setAttribute('stroke', strokeAttr);
      path.setAttribute('stroke-width', String(strokeWidthAttr));
      path.setAttribute('opacity', String(opacity));
      shapeEl = path;
      break;
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
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', starPoints.join(' '));
      polygon.setAttribute('fill', fillAttr);
      polygon.setAttribute('stroke', strokeAttr);
      polygon.setAttribute('stroke-width', String(strokeWidthAttr));
      polygon.setAttribute('opacity', String(opacity));
      shapeEl = polygon;
      break;
    }

    case 'line': {
      const pts = points ?? [0, 0, width, 0];
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x + pts[0]));
      line.setAttribute('y1', String(y + pts[1]));
      line.setAttribute('x2', String(x + pts[2]));
      line.setAttribute('y2', String(y + pts[3]));
      line.setAttribute('stroke', stroke || fill || '#000');
      line.setAttribute('stroke-width', String(strokeWidth || 3));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', String(opacity));
      shapeEl = line;
      break;
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

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x + pts[0]));
      line.setAttribute('y1', String(y + pts[1]));
      line.setAttribute('x2', String(x + pts[2]));
      line.setAttribute('y2', String(y + pts[3]));
      line.setAttribute('stroke', arrowStroke);
      line.setAttribute('stroke-width', String(arrowWidth));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', String(opacity));
      g.appendChild(line);

      const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      arrowHead.setAttribute('points', `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`);
      arrowHead.setAttribute('fill', arrowStroke);
      arrowHead.setAttribute('opacity', String(opacity));
      g.appendChild(arrowHead);
      break;
    }

    default: {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', fillAttr);
      rect.setAttribute('stroke', strokeAttr);
      rect.setAttribute('stroke-width', String(strokeWidthAttr));
      rect.setAttribute('opacity', String(opacity));
      shapeEl = rect;
    }
  }

  if (shapeEl) {
    g.appendChild(shapeEl);
  }
  svg.appendChild(g);

  return svg;
}

// Create image element as HTML img or div
function createImageElementHtml(element: ImageElement, resources: Record<string, Resource>): HTMLElement {
  const { x, y, width, height, rotation, opacity, resourceId, cropX, cropY, cropWidth, cropHeight } = element;
  const resource = resourceId ? resources[resourceId] : undefined;

  if (!resource || resource.type === 'video') {
    const div = document.createElement('div');
    div.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      background: ${resource?.type === 'video' ? '#1f2937' : '#f3f4f6'};
      opacity: ${opacity};
      transform: rotate(${rotation}deg);
      transform-origin: top left;
    `;
    return div;
  }

  const hasCrop = cropWidth > 0 && cropHeight > 0;

  if (hasCrop) {
    const container = document.createElement('div');
    container.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      opacity: ${opacity};
      transform: rotate(${rotation}deg);
      transform-origin: top left;
    `;

    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    const scaleX = width / cropWidth;
    const scaleY = height / cropHeight;
    img.src = resource.src;
    img.style.cssText = `
      width: ${resource.originalWidth * scaleX}px;
      height: ${resource.originalHeight * scaleY}px;
      margin-left: ${-cropX * scaleX}px;
      margin-top: ${-cropY * scaleY}px;
    `;
    container.appendChild(img);
    return container;
  }

  const img = document.createElement('img');
  img.crossOrigin = 'anonymous';
  img.src = resource.src;
  img.style.cssText = `
    position: absolute;
    left: ${x}px;
    top: ${y}px;
    width: ${width}px;
    height: ${height}px;
    opacity: ${opacity};
    transform: rotate(${rotation}deg);
    transform-origin: top left;
    object-fit: cover;
  `;
  return img;
}

// Create element DOM node
function createElementDom(element: SlideElement, resources: Record<string, Resource>): HTMLElement | SVGSVGElement | null {
  if (!element.visible) return null;

  if (element.type === 'text') {
    return createTextElementHtml(element as TextElement);
  }
  if (element.type === 'shape') {
    return createShapeElementSvg(element as ShapeElement);
  }
  if (element.type === 'image') {
    return createImageElementHtml(element as ImageElement, resources);
  }
  return null;
}

// Create slide container DOM
function createSlideContainer(slide: Slide, resources: Record<string, Resource>): HTMLDivElement {
  const container = document.createElement('div');

  // Get background color
  let bgStyle = 'background: #ffffff;';
  if (slide.background.type === 'solid') {
    bgStyle = `background: ${slide.background.color};`;
  } else if (slide.background.type === 'gradient') {
    const angle = slide.background.direction || 0;
    bgStyle = `background: linear-gradient(${angle}deg, ${slide.background.from}, ${slide.background.to || slide.background.from});`;
  } else if (slide.background.type === 'image' && slide.background.src) {
    bgStyle = `background: url('${slide.background.src}') center center / cover no-repeat;`;
  }

  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: -9999px;
    width: ${SLIDE_WIDTH}px;
    height: ${SLIDE_HEIGHT}px;
    ${bgStyle}
    overflow: hidden;
  `;

  // Add elements in z-order
  for (const id of slide.elementOrder) {
    const element = slide.elements[id];
    if (!element) continue;
    const dom = createElementDom(element, resources);
    if (dom) {
      container.appendChild(dom);
    }
  }

  return container;
}

// Wait for all images to load
function waitForImages(container: HTMLElement): Promise<void> {
  const images = container.querySelectorAll('img');
  if (images.length === 0) return Promise.resolve();

  return Promise.all(
    Array.from(images).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve(); // Continue even if image fails
      });
    })
  ).then(() => {});
}

export async function exportPdf(presentation: Presentation): Promise<void> {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [SLIDE_WIDTH, SLIDE_HEIGHT],
  });

  const visibleSlides = presentation.slideOrder
    .map(id => presentation.slides[id])
    .filter(slide => slide && !slide.hidden);

  for (let i = 0; i < visibleSlides.length; i++) {
    const slide = visibleSlides[i];
    if (!slide) continue;

    if (i > 0) pdf.addPage();

    // Create slide container and add to DOM
    const container = createSlideContainer(slide, presentation.resources);
    document.body.appendChild(container);

    try {
      // Wait for images to load
      await waitForImages(container);

      // Small delay to ensure rendering is complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Capture with html2canvas
      const canvas = await html2canvas(container, {
        width: SLIDE_WIDTH,
        height: SLIDE_HEIGHT,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
      });

      // Add to PDF
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
    } finally {
      // Clean up
      document.body.removeChild(container);
    }
  }

  // Save the PDF
  const filename = `${presentation.title.replace(/\s+/g, '_')}.pdf`;
  pdf.save(filename);
}
