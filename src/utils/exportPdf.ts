import jsPDF from 'jspdf';
import type { Presentation, Slide, TextElement, ShapeElement, ImageElement, Resource } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, TEXT_BOX_PADDING } from './constants';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';
import { pathD, arrowheadPoints, insetEndpoints, strokeDashFor } from './pathShapes';
import { shapeToPathD } from './shapeToPath';

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
  const map = new Map<string, HTMLImageElement>();
  const promises: Promise<void>[] = [];

  for (const slide of slides) {
    // Background images
    if (slide.background.type === 'image' && slide.background.src) {
      promises.push(
        loadImage(slide.background.src).then(img => { map.set('bg:' + slide.id, img); }).catch(() => {}),
      );
    }
    for (const id of slide.elementOrder) {
      const el = slide.elements[id];
      if (el?.type === 'image' && (el as ImageElement).resourceId) {
        usedIds.add((el as ImageElement).resourceId!);
      }
    }
  }

  for (const rid of usedIds) {
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
//
// GEOMETRY IS NOT DEFINED HERE. All shape outlines come from the same
// sources the editor renderer uses — `shapeToPathD` (rect / ellipse /
// triangle / star) and `pathD` + `insetEndpoints` + `arrowheadPoints`
// (path shapes) — consumed on the canvas via `new Path2D(d)`. Canvas2D
// accepts full SVG path syntax in the Path2D constructor, and this file
// draws into a plain HTMLCanvasElement (jsPDF only receives the finished
// canvas raster via addImage), so Path2D support is the browser's, not
// jsPDF's. Never re-derive shape math here.
function fillAndStroke(ctx: CanvasRenderingContext2D, path: Path2D, fillColor: string, strokeColor: string, sw: number) {
  if (fillColor !== 'transparent' && fillColor !== 'none') {
    ctx.fillStyle = fillColor;
    ctx.fill(path);
  }
  if (strokeColor !== 'none' && sw > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = sw;
    ctx.stroke(path);
  }
}

function drawShapeElement(ctx: CanvasRenderingContext2D, element: ShapeElement) {
  const { x, y, width, height, rotation, opacity, fill, stroke, strokeWidth, shapeType, points } = element;

  ctx.save();
  ctx.globalAlpha *= opacity;

  const cx = x + width / 2;
  const cy = y + height / 2;

  if (rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  if (shapeType === 'path') {
    // Path shapes are handled apart from shapeToPathD because its 'path'
    // branch appends arrowhead PEN strokes (for the Create animation's
    // outline trace); the export needs the shaft stroked/dash-patterned and
    // the arrowheads as separately FILLED triangles — exactly what the
    // shared RenderShape does in SVG.
    const pts = points ?? [];
    if (pts.length >= 4) {
      const closed = element.closed ?? false;
      const curve = element.curve ?? 'linear';
      const strokeCol = stroke || fill || '#000';
      const sw = strokeWidth || (closed ? 0 : 3);
      const shaftPts = insetEndpoints(pts, !!element.startArrow, !!element.endArrow);
      const cornerR = curve === 'linear' ? (element.cornerRadius ?? 0) : 0;
      // Same d-string RenderShape puts into the editor SVG. Points are
      // relative to (x, y), so translate the canvas like the SVG's
      // translate(x, y) group.
      const shaft = new Path2D(pathD(shaftPts, curve, closed, cornerR));
      ctx.translate(x, y);
      if (closed && fill) {
        ctx.fillStyle = fill;
        ctx.fill(shaft);
      }
      if (sw > 0) {
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const dashStr = strokeDashFor(element.strokeStyle, sw);
        ctx.setLineDash(dashStr ? dashStr.split(' ').map(Number) : []);
        ctx.stroke(shaft);
        ctx.setLineDash([]);
      }
      // Arrowheads at the ORIGINAL (un-inset) endpoints.
      const last = pts.length - 2;
      const drawHead = (tipX: number, tipY: number, dirX: number, dirY: number) => {
        const h = arrowheadPoints(tipX, tipY, dirX, dirY);
        ctx.fillStyle = strokeCol;
        ctx.fill(new Path2D(`M ${h[0]} ${h[1]} L ${h[2]} ${h[3]} L ${h[4]} ${h[5]} Z`));
      };
      if (element.startArrow) drawHead(pts[0], pts[1], pts[0] - pts[2], pts[1] - pts[3]);
      if (element.endArrow) drawHead(pts[last], pts[last + 1], pts[last] - pts[last - 2], pts[last + 1] - pts[last - 1]);
    }
  } else {
    // rect / ellipse / triangle / star: one Path2D from the shared
    // d-string builder (absolute slide coordinates, no extra transform).
    const d = shapeToPathD(element);
    if (d) {
      fillAndStroke(ctx, new Path2D(d), fill || 'transparent', stroke || 'none', strokeWidth || 0);
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
