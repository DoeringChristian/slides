import jsPDF from 'jspdf';
import type { Presentation, Slide, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';

// ── Canvas2D-based PDF export ──
// Renders directly to canvas — no html2canvas, no DOM cloning.

// Load an image from a data URI / URL and return the HTMLImageElement
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

// Pre-load all unique resources used across visible slides
async function preloadResources(
  slides: Slide[],
  resources: Record<string, Resource>,
): Promise<Map<string, HTMLImageElement>> {
  const usedIds = new Set<string>();
  for (const slide of slides) {
    // Background images
    if (slide.background.type === 'image' && slide.background.src) {
      usedIds.add('bg:' + slide.id);
    }
    for (const id of slide.elementOrder) {
      const el = slide.elements[id];
      if (el?.type === 'image' && (el as ImageElement).resourceId) {
        usedIds.add((el as ImageElement).resourceId!);
      }
    }
  }

  const map = new Map<string, HTMLImageElement>();
  const promises: Promise<void>[] = [];

  for (const slide of slides) {
    if (slide.background.type === 'image' && slide.background.src) {
      const key = 'bg:' + slide.id;
      if (!map.has(key)) {
        promises.push(
          loadImage(slide.background.src).then(img => { map.set(key, img); }).catch(() => {}),
        );
      }
    }
  }

  for (const rid of usedIds) {
    if (rid.startsWith('bg:')) continue;
    const r = resources[rid];
    if (r && r.type === 'image') {
      promises.push(
        loadImage(r.src).then(img => { map.set(rid, img); }).catch(() => {}),
      );
    }
  }

  await Promise.all(promises);
  return map;
}

// ── Background ──
function drawBackground(ctx: CanvasRenderingContext2D, slide: Slide, images: Map<string, HTMLImageElement>) {
  const bg = slide.background;
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  } else if (bg.type === 'gradient') {
    const rad = ((bg.direction || 0) - 90) * Math.PI / 180;
    const cx = SLIDE_WIDTH / 2, cy = SLIDE_HEIGHT / 2;
    const len = Math.max(SLIDE_WIDTH, SLIDE_HEIGHT);
    const grad = ctx.createLinearGradient(
      cx - Math.cos(rad) * len, cy - Math.sin(rad) * len,
      cx + Math.cos(rad) * len, cy + Math.sin(rad) * len,
    );
    grad.addColorStop(0, bg.from);
    grad.addColorStop(1, bg.to || bg.from);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  } else if (bg.type === 'image') {
    const img = images.get('bg:' + slide.id);
    if (img) {
      // Cover
      const scale = Math.max(SLIDE_WIDTH / img.naturalWidth, SLIDE_HEIGHT / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (SLIDE_WIDTH - w) / 2, (SLIDE_HEIGHT - h) / 2, w, h);
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);
  }
}

// ── Text rendering ──
interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color?: string;
}

function getTextRuns(displayContent: string, sourceStart: number, baseBold: boolean, baseItalic: boolean): TextRun[] {
  const segments = parseInlineSegments(displayContent, sourceStart);
  return segments.map(seg => {
    if (seg.type === 'latex') {
      return { text: seg.displayContent, bold: baseBold, italic: baseItalic, underline: false, strikethrough: false };
    }
    if (seg.type === 'link') {
      return { text: seg.displayContent, bold: baseBold, italic: baseItalic, underline: true, strikethrough: false, color: '#2563eb' };
    }
    if (seg.type === 'formatted') {
      return {
        text: seg.displayContent,
        bold: seg.bold || baseBold,
        italic: seg.italic || baseItalic,
        underline: seg.underline || false,
        strikethrough: seg.strikethrough || false,
      };
    }
    return { text: seg.displayContent, bold: baseBold, italic: baseItalic, underline: false, strikethrough: false };
  });
}

function buildFont(family: string, size: number, bold: boolean, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}`;
}

// Word-wrap text runs and draw them on canvas
function drawTextElement(ctx: CanvasRenderingContext2D, element: TextElement) {
  const { text, style, x, y, width, height, rotation, opacity } = element;
  if (!text || text.trim() === '') return;

  const padding = TEXT_BOX_PADDING;
  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;
  const lineHeightMul = style.lineHeight || 1.2;
  const blocks = parseBlocks(text);

  ctx.save();

  // Rotation around element center
  if (rotation) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha *= opacity;

  // First pass: measure all block heights to compute vertical offset
  interface WrappedLine {
    runs: { text: string; font: string; color: string; underline: boolean; strikethrough: boolean }[];
    height: number;
  }
  interface BlockLayout {
    lines: WrappedLine[];
    totalHeight: number;
  }

  const blockLayouts: BlockLayout[] = [];
  let totalTextHeight = 0;

  for (const block of blocks) {
    const multiplier = getBlockFontMultiplier(block.type);
    const fontSize = style.fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const baseBold = isHeader || style.fontWeight === 'bold';
    const baseItalic = style.fontStyle === 'italic';
    const lineH = fontSize * lineHeightMul;

    if (!block.displayContent) {
      // Empty line
      blockLayouts.push({ lines: [{ runs: [], height: lineH }], totalHeight: lineH });
      totalTextHeight += lineH;
      continue;
    }

    const runs = getTextRuns(block.displayContent, block.sourceStart + block.prefixLength, baseBold, baseItalic);

    // Word-wrap across runs
    const lines: WrappedLine[] = [];
    let currentLine: WrappedLine['runs'] = [];
    let currentLineWidth = 0;

    for (const run of runs) {
      const font = buildFont(style.fontFamily, fontSize, run.bold, run.italic);
      ctx.font = font;
      const runColor = run.color || style.color;

      // Split into words, preserving spaces
      const words = run.text.split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const wordWidth = ctx.measureText(word).width;

        if (currentLineWidth + wordWidth > contentWidth && currentLineWidth > 0 && word.trim()) {
          // Wrap
          lines.push({ runs: currentLine, height: lineH });
          currentLine = [];
          currentLineWidth = 0;
        }

        currentLine.push({ text: word, font, color: runColor, underline: run.underline, strikethrough: run.strikethrough });
        currentLineWidth += wordWidth;
      }
    }
    if (currentLine.length > 0) {
      lines.push({ runs: currentLine, height: lineH });
    }

    const blockH = lines.length * lineH;
    blockLayouts.push({ lines, totalHeight: blockH });
    totalTextHeight += blockH;
  }

  // Vertical alignment
  let startY = y + padding;
  if (style.verticalAlign === 'middle') {
    startY = y + padding + (contentHeight - totalTextHeight) / 2;
  } else if (style.verticalAlign === 'bottom') {
    startY = y + padding + contentHeight - totalTextHeight;
  }

  // Second pass: draw
  let curY = startY;
  for (const blockLayout of blockLayouts) {
    for (const line of blockLayout.lines) {
      // Measure total line width for alignment
      let lineWidth = 0;
      for (const r of line.runs) {
        ctx.font = r.font;
        lineWidth += ctx.measureText(r.text).width;
      }

      let lineX = x + padding;
      if (style.align === 'center') {
        lineX = x + padding + (contentWidth - lineWidth) / 2;
      } else if (style.align === 'right') {
        lineX = x + padding + contentWidth - lineWidth;
      }

      // Baseline offset: place text so ascent aligns to top of line
      const baselineY = curY + line.height * 0.8; // approximate ascent

      for (const r of line.runs) {
        ctx.font = r.font;
        ctx.fillStyle = r.color;
        ctx.fillText(r.text, lineX, baselineY);

        const w = ctx.measureText(r.text).width;
        if (r.underline) {
          ctx.beginPath();
          ctx.moveTo(lineX, baselineY + 2);
          ctx.lineTo(lineX + w, baselineY + 2);
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (r.strikethrough) {
          ctx.beginPath();
          const strikeY = baselineY - line.height * 0.25;
          ctx.moveTo(lineX, strikeY);
          ctx.lineTo(lineX + w, strikeY);
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        lineX += w;
      }

      curY += line.height;
    }
  }

  ctx.restore();
}

// ── Shape rendering ──
function drawShapeElement(ctx: CanvasRenderingContext2D, element: ShapeElement) {
  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, cornerRadius, points } = element;

  ctx.save();
  ctx.globalAlpha *= opacity;

  const cx = x + width / 2;
  const cy = y + height / 2;

  if (rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  const fillColor = fill || 'transparent';
  const strokeColor = stroke || 'none';
  const sw = strokeWidth || 0;

  switch (shapeType) {
    case 'rect': {
      const r = cornerRadius || 0;
      ctx.beginPath();
      if (r > 0) {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
      } else {
        ctx.rect(x, y, width, height);
      }
      ctx.closePath();
      if (fillColor !== 'transparent' && fillColor !== 'none') {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      if (strokeColor !== 'none' && sw > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        ctx.stroke();
      }
      break;
    }

    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(cx, cy, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      if (fillColor !== 'transparent' && fillColor !== 'none') {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      if (strokeColor !== 'none' && sw > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        ctx.stroke();
      }
      break;
    }

    case 'triangle': {
      const r = Math.min(width, height) / 2;
      const pts = [
        [cx, cy - r],
        [cx - r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
        [cx + r * Math.cos(Math.PI / 6), cy + r * Math.sin(Math.PI / 6)],
      ];
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.closePath();
      if (fillColor !== 'transparent' && fillColor !== 'none') {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      if (strokeColor !== 'none' && sw > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        ctx.stroke();
      }
      break;
    }

    case 'star': {
      const outerR = Math.min(width, height) / 2;
      const innerR = outerR / 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      if (fillColor !== 'transparent' && fillColor !== 'none') {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      if (strokeColor !== 'none' && sw > 0) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        ctx.stroke();
      }
      break;
    }

    case 'line': {
      const pts = points ?? [0, 0, width, 0];
      ctx.beginPath();
      ctx.moveTo(x + pts[0], y + pts[1]);
      ctx.lineTo(x + pts[2], y + pts[3]);
      ctx.strokeStyle = stroke || fill || '#000';
      ctx.lineWidth = strokeWidth || 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      break;
    }

    case 'arrow': {
      const pts = points ?? [0, 0, width, 0];
      const arrowStroke = stroke || fill || '#000';
      const arrowWidth = strokeWidth || 3;

      ctx.beginPath();
      ctx.moveTo(x + pts[0], y + pts[1]);
      ctx.lineTo(x + pts[2], y + pts[3]);
      ctx.strokeStyle = arrowStroke;
      ctx.lineWidth = arrowWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Arrowhead
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

      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.closePath();
      ctx.fillStyle = arrowStroke;
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

// ── Image rendering ──
function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  resources: Record<string, Resource>,
  images: Map<string, HTMLImageElement>,
) {
  const { x, y, width, height, rotation, opacity, resourceId, cropX, cropY, cropWidth, cropHeight } = element;
  const resource = resourceId ? resources[resourceId] : undefined;
  const img = resourceId ? images.get(resourceId) : undefined;

  ctx.save();
  ctx.globalAlpha *= opacity;

  const cx = x + width / 2;
  const cy = y + height / 2;
  if (rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  if (!img || !resource || resource.type === 'video') {
    // Placeholder
    ctx.fillStyle = resource?.type === 'video' ? '#1f2937' : '#f3f4f6';
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    return;
  }

  const hasCrop = cropWidth > 0 && cropHeight > 0;
  if (hasCrop) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const scaleX = width / cropWidth;
    const scaleY = height / cropHeight;
    ctx.drawImage(
      img,
      0, 0, resource.originalWidth, resource.originalHeight,
      x - cropX * scaleX, y - cropY * scaleY,
      resource.originalWidth * scaleX, resource.originalHeight * scaleY,
    );
    ctx.restore();
  } else {
    ctx.drawImage(img, x, y, width, height);
  }

  ctx.restore();
}

// ── Render a single slide onto a canvas ──
function renderSlide(
  slide: Slide,
  resources: Record<string, Resource>,
  images: Map<string, HTMLImageElement>,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH * scale;
  canvas.height = SLIDE_HEIGHT * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  drawBackground(ctx, slide, images);

  for (const id of slide.elementOrder) {
    const el = slide.elements[id];
    if (!el || !el.visible) continue;

    if (el.type === 'text') {
      drawTextElement(ctx, el as TextElement);
    } else if (el.type === 'shape') {
      drawShapeElement(ctx, el as ShapeElement);
    } else if (el.type === 'image') {
      drawImageElement(ctx, el as ImageElement, resources, images);
    }
  }

  return canvas;
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

  // Pre-load all images in parallel
  const images = await preloadResources(visibleSlides, presentation.resources);

  const scale = 2;

  for (let i = 0; i < visibleSlides.length; i++) {
    if (i > 0) pdf.addPage();

    const canvas = renderSlide(visibleSlides[i], presentation.resources, images, scale);
    pdf.addImage(canvas, 'JPEG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT, undefined, 'FAST');
  }

  const filename = `${presentation.title.replace(/\s+/g, '_')}.pdf`;
  pdf.save(filename);
}
