import { attachGroupCrops, cropSteps, ensureCropLayouts, groupCropClips, groupCropPaint, groupCropRegions } from '../model/groupCrop';
import { drawCanvasStrokeCoverage } from '../paint/canvasStrokeCoverage';
import { textInsets } from '../text/boundTextLayout';
import { resolveShapePaint } from '../paint/shapePaint';
import { resolveShapeGeometry } from '../geometry/vectorGeometry';
import jsPDF from 'jspdf';
import { drawShapeFill } from '../paint/shapeFill';
import { imageTintShape } from '../paint/imageTint';
import type { Presentation, Slide, TextElement, ShapeElement, ImageElement, Resource } from '../../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../constants';
import { parseBlocks, parseInlineSegments, getBlockFontMultiplier } from '../../components/canvas/CustomMarkdownRenderer';
import { pathArrowGeometry, strokeDashFor } from '../paths/pathShapes';
import { shapeToPathD } from '../paths/shapeToPath';

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
/**
 * A video's first frame as a still. A PDF cannot play video, so the page
 * shows the frame the audience first sees — not a placeholder box. Resolves
 * null when the video cannot be decoded (the placeholder is used then).
 */
export function loadVideoFrame(src: string, time = 0, timeoutMs = 10000): Promise<HTMLCanvasElement | null> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (frame: HTMLCanvasElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(frame);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const grab = () => {
      if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { finish(null); return; }
      try {
        ctx.drawImage(video, 0, 0);
        finish(canvas);
      } catch {
        // A cross-origin video without CORS taints the canvas.
        finish(null);
      }
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.onerror = () => finish(null);
    // Seek explicitly: some browsers do not paint a frame for drawImage until
    // a seek has completed, even at time 0.
    video.onloadeddata = () => {
      video.onseeked = grab;
      video.currentTime = Math.max(0, time);
    };
    video.src = src;
  });
}

export async function preloadResources(
  slides: Slide[],
  resources: Record<string, Resource>,
): Promise<Map<string, CanvasImageSource>> {
  const usedIds = new Set<string>();
  const map = new Map<string, CanvasImageSource>();
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
    } else if (r && r.type === 'video') {
      promises.push(loadVideoFrame(r.src).then(frame => { if (frame) map.set(rid, frame); }));
    }
  }

  await Promise.all(promises);
  return map;
}

// ── Background ──
function drawBackground(ctx: CanvasRenderingContext2D, slide: Slide, images: Map<string, CanvasImageSource>) {
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
    // Background entries are always images (videos are element resources).
    const img = images.get('bg:' + slide.id) as HTMLImageElement | undefined;
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

  const padding = textInsets(element);
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
// triangle / star) and `pathD` + `insetEndpoints` + `arrowheadGeometry`
// (path shapes) — consumed on the canvas via `new Path2D(d)`. Canvas2D
// accepts full SVG path syntax in the Path2D constructor, and this file
// draws into a plain HTMLCanvasElement (jsPDF only receives the finished
// canvas raster via addImage), so Path2D support is the browser's, not
// jsPDF's. Never re-derive shape math here.
function fillAndStroke(ctx: CanvasRenderingContext2D, path: Path2D, element: ShapeElement, strokeColor: string, sw: number) {
  drawShapeFill(ctx, path, element);
  if (strokeColor !== 'none' && sw > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = sw;
    ctx.stroke(path);
  }
}

export function drawShapeElement(ctx: CanvasRenderingContext2D, element: ShapeElement) {
  const { x, y, width, height, rotation, opacity, stroke, strokeWidth, shapeType, points } = element;

  // Composite the element once: SVG applies opacity after fill + stroke,
  // not separately to their overlap. Keep the caller's export transform.
  if (opacity < 1) {
    const layer = document.createElement('canvas');
    layer.width = ctx.canvas.width; layer.height = ctx.canvas.height;
    const layerCtx = layer.getContext('2d')!;
    layerCtx.setTransform(ctx.getTransform());
    drawShapeElement(layerCtx, { ...element, opacity: 1 });
    ctx.save();
    ctx.resetTransform();
    ctx.globalAlpha *= opacity;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha *= opacity;

  const cx = x + width / 2;
  const cy = y + height / 2;

  if (rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  if (shapeType === 'vector') {
    const geometry = resolveShapeGeometry(element);
    for (const region of geometry.fills) drawShapeFill(ctx, new Path2D(region.d), element, false, region.rule);
    if (stroke && strokeWidth > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const dash = strokeDashFor(element.strokeStyle, strokeWidth);
      ctx.setLineDash(dash ? dash.split(' ').map(Number) : []);
      ctx.stroke(new Path2D(geometry.strokes.join(' ')));
    }
  } else if (shapeType === 'path') {
    // Path shapes are handled apart from shapeToPathD because its 'path'
    // branch appends arrowhead PEN strokes (for the Create animation's
    // outline trace); the export needs the shaft stroked/dash-patterned and
    // the arrowheads as separately FILLED triangles — exactly what the
    // shared RenderShape does in SVG.
    const pts = points ?? [];
    if (pts.length >= 4) {
      const { stroke: strokeCol, strokeWidth: sw, fill: fillCol, fillOpacity } = resolveShapePaint(element);
      const { startGeo, endGeo, d, fillD, shaftClipPaths, strokePlan } = pathArrowGeometry(element);
      const shaft = new Path2D(d);
      ctx.translate(x, y);
      if (fillCol !== 'none') {
        ctx.save();
        ctx.globalAlpha *= fillOpacity ?? 1;
        drawShapeFill(ctx, new Path2D(fillD), element, true);
        ctx.restore();
      }
      if (sw > 0) {
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const dashStr = strokeDashFor(element.strokeStyle, sw);
        ctx.setLineDash(dashStr ? dashStr.split(' ').map(Number) : []);
        ctx.save();
        for (const clip of shaftClipPaths) ctx.clip(new Path2D(clip), 'evenodd');
        if (strokePlan) drawCanvasStrokeCoverage(ctx, strokePlan, strokeCol, sw, ctx.getLineDash());
        else ctx.stroke(shaft);
        ctx.restore();
        ctx.setLineDash([]);
      }
      // Arrowheads at the ORIGINAL (un-inset) endpoints — fills painted in
      // the stroke colour, stroked primitives at the shaft width with round
      // caps/joins, mirroring RenderArrowhead exactly.
      const drawHead = (geo: NonNullable<typeof startGeo>) => {
        ctx.fillStyle = strokeCol;
        for (const f of geo.fills) {
          if ('points' in f) {
            const p = new Path2D();
            p.moveTo(f.points[0], f.points[1]);
            for (let i = 2; i < f.points.length; i += 2) p.lineTo(f.points[i], f.points[i + 1]);
            p.closePath();
            ctx.fill(p);
          } else {
            ctx.fill(new Path2D(f.d));
          }
        }
        if (geo.strokes.length > 0) {
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = sw;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const s of geo.strokes) ctx.stroke(new Path2D(s.d));
        }
      };
      if (startGeo) drawHead(startGeo);
      if (endGeo) drawHead(endGeo);
    }
  } else {
    // rect / ellipse / triangle / star: one Path2D from the shared
    // d-string builder (absolute slide coordinates, no extra transform).
    const d = shapeToPathD(element);
    if (d) {
      fillAndStroke(ctx, new Path2D(d), element, stroke || 'none', strokeWidth || 0);
    }
  }

  ctx.restore();
}

// ── Image rendering ──
function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  resources: Record<string, Resource>,
  images: Map<string, CanvasImageSource>,
) {
  const { x, y, width, height, rotation, opacity, resourceId } = element;
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

  if (!img || !resource) {
    // Placeholder: no resource, or media that could not be loaded (a video
    // whose first frame could not be decoded stays dark).
    ctx.fillStyle = resource?.type === 'video' ? '#1f2937' : '#f3f4f6';
    ctx.fillRect(x, y, width, height);
    drawImageTint(ctx, element);
    ctx.restore();
    return;
  }

  ctx.drawImage(img, x, y, width, height);
  drawImageTint(ctx, element);

  ctx.restore();
}

/** The tint over an image (the context is already rotated about the image's
 *  centre, with its opacity applied): the shared shape fill over its box. */
function drawImageTint(ctx: CanvasRenderingContext2D, element: ImageElement) {
  const tint = imageTintShape(element);
  if (!tint) return;
  const box = new Path2D();
  box.rect(element.x, element.y, element.width, element.height);
  drawShapeFill(ctx, box, tint);
}

/** A transparent slide-sized canvas at the export scale, in slide units. */
function slideLayer(scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH * scale;
  canvas.height = SLIDE_HEIGHT * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

// ── Render a single slide onto a canvas ──
export function renderSlide(
  slide: Slide,
  resources: Record<string, Resource>,
  images: Map<string, CanvasImageSource>,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH * scale;
  canvas.height = SLIDE_HEIGHT * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  drawBackground(ctx, slide, images);

  for (const source of attachGroupCrops(slide.elementOrder.map(id => slide.elements[id]).filter(Boolean))) {
    const el = groupCropPaint(source);
    if (!el.visible) continue;
    const draw = (target: CanvasRenderingContext2D) => {
      if (el.type === 'text') drawTextElement(target, el as TextElement);
      else if (el.type === 'shape') drawShapeElement(target, el as ShapeElement);
      else if (el.type === 'image') drawImageElement(target, el as ImageElement, resources, images);
    };
    const clips = groupCropClips(source);
    if (!clips.length) {
      ctx.save(); draw(ctx); ctx.restore();
      continue;
    }
    // Each crop group is evaluated as the editor does (`cropSteps`): its
    // shapes, each filled with its own winding rule, add / subtract /
    // intersect in layer order. A clip path cannot do that (nor union mixed
    // rules), so the element is drawn on a layer and masked by each crop
    // group in turn (nested groups intersect).
    const layer = slideLayer(scale);
    draw(layer.ctx);
    for (const clip of clips) {
      const mask = slideLayer(scale);
      const { full, steps } = cropSteps(clip.shapes);
      if (full) { mask.ctx.fillStyle = '#000'; mask.ctx.fillRect(-SLIDE_WIDTH, -SLIDE_HEIGHT, SLIDE_WIDTH * 3, SLIDE_HEIGHT * 3); }
      for (const { op, shape } of steps) {
        const piece = slideLayer(scale);
        piece.ctx.fillStyle = '#000';
        for (const region of groupCropRegions(shape)) {
          const [ma, mb, mc, md, me, mf] = region.matrix;
          const path = new Path2D();
          path.addPath(new Path2D(region.d), new DOMMatrix([ma, mb, mc, md, me, mf]));
          piece.ctx.fill(path, region.rule);
        }
        mask.ctx.save();
        mask.ctx.setTransform(1, 0, 0, 1, 0, 0);
        mask.ctx.globalCompositeOperation = op === 'subtract' ? 'destination-out' : op === 'intersect' ? 'destination-in' : 'source-over';
        mask.ctx.drawImage(piece.canvas, 0, 0);
        mask.ctx.restore();
      }
      layer.ctx.save();
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.globalCompositeOperation = 'destination-in';
      layer.ctx.drawImage(mask.canvas, 0, 0);
      layer.ctx.restore();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
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
  await ensureCropLayouts(visibleSlides);

  const scale = 2;

  for (let i = 0; i < visibleSlides.length; i++) {
    if (i > 0) pdf.addPage();

    const canvas = renderSlide(visibleSlides[i], presentation.resources, images, scale);
    pdf.addImage(canvas, 'JPEG', 0, 0, SLIDE_WIDTH, SLIDE_HEIGHT, undefined, 'FAST');
  }

  const filename = `${presentation.title.replace(/\s+/g, '_')}.pdf`;
  pdf.save(filename);
}
