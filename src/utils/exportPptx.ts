import PptxGenJS from 'pptxgenjs';
import type { Presentation, Slide, TextElement, ShapeElement, ImageElement, SlideBackground } from '../types/presentation';
import { TEXT_BOX_PADDING } from './constants';
import { parseBlocks, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';

// Conversion: app px → inches (pptxgenjs uses inches)
const PX_TO_INCH = 1 / 96;

function hexWithoutHash(color: string): string {
  return color.replace(/^#/, '');
}

// pptxgenjs expects 'image/png;base64,...' (no 'data:' prefix)
function toImageData(dataUrl: string): string {
  return dataUrl.replace(/^data:/, '');
}

function setSlideBackground(slide: PptxGenJS.Slide, bg: SlideBackground, _resources: Presentation['resources']) {
  if (bg.type === 'solid') {
    slide.background = { color: hexWithoutHash(bg.color) };
  } else if (bg.type === 'gradient') {
    // pptxgenjs doesn't have native gradient background support, use fill color of first stop
    slide.background = { color: hexWithoutHash(bg.from) };
  } else if (bg.type === 'image') {
    // bg.src is a data URL
    if (bg.src) {
      slide.background = { data: toImageData(bg.src) };
    }
  }
}

function addTextElement(slide: PptxGenJS.Slide, el: TextElement) {
  if (!el.text || el.text.trim() === '') return;

  const blocks = parseBlocks(el.text);
  const textProps: PptxGenJS.TextProps[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const multiplier = getBlockFontMultiplier(block.type);
    const fontSize = el.style.fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const isBullet = block.type === 'bullet';

    if (!block.displayContent) {
      // Empty line
      textProps.push({
        text: '\n',
        options: { fontSize, breakLine: true },
      });
      continue;
    }

    // Strip basic inline markdown for PPTX (bold **text**, italic *text*)
    let content = block.displayContent;
    let bold = isHeader || el.style.fontWeight === 'bold';
    let italic = el.style.fontStyle === 'italic';

    // Simple bold/italic detection from markdown
    const boldMatch = content.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      content = boldMatch[1];
      bold = true;
    }
    const italicMatch = content.match(/^\*(.+)\*$/);
    if (italicMatch) {
      content = italicMatch[1];
      italic = true;
    }

    const opts: PptxGenJS.TextPropsOptions = {
      fontSize,
      fontFace: el.style.fontFamily,
      color: hexWithoutHash(el.style.color),
      bold,
      italic,
      underline: el.style.textDecoration === 'underline' ? { style: 'sng' } : undefined,
      strike: el.style.textDecoration === 'line-through' ? 'sngStrike' : undefined,
      breakLine: i < blocks.length - 1,
    };

    if (isBullet) {
      opts.bullet = true;
    }

    textProps.push({ text: content, options: opts });
  }

  const transparency = Math.round((1 - el.opacity) * 100);

  slide.addText(textProps, {
    x: el.x * PX_TO_INCH,
    y: el.y * PX_TO_INCH,
    w: el.width * PX_TO_INCH,
    h: el.height * PX_TO_INCH,
    margin: [TEXT_BOX_PADDING * PX_TO_INCH, TEXT_BOX_PADDING * PX_TO_INCH, TEXT_BOX_PADDING * PX_TO_INCH, TEXT_BOX_PADDING * PX_TO_INCH] as [number, number, number, number],
    align: el.style.align as PptxGenJS.HAlign,
    valign: el.style.verticalAlign as PptxGenJS.VAlign,
    rotate: el.rotation || 0,
    isTextBox: true,
    lineSpacingMultiple: el.style.lineHeight,
    fill: transparency > 0 ? { color: 'FFFFFF', transparency: 100 } : undefined,
  });
}

function addShapeElement(slide: PptxGenJS.Slide, el: ShapeElement) {
  const x = el.x * PX_TO_INCH;
  const y = el.y * PX_TO_INCH;
  const w = el.width * PX_TO_INCH;
  const h = el.height * PX_TO_INCH;
  const transparency = Math.round((1 - el.opacity) * 100);

  const hasFill = el.fill && el.fill !== 'transparent' && el.fill !== 'none' && el.fill !== '';
  const hasStroke = el.stroke && el.stroke !== 'none' && el.stroke !== '' && el.strokeWidth > 0;

  const fillProps: PptxGenJS.ShapeFillProps | undefined = hasFill
    ? { color: hexWithoutHash(el.fill), transparency }
    : undefined;
  const lineProps: PptxGenJS.ShapeLineProps | undefined = hasStroke
    ? { color: hexWithoutHash(el.stroke), width: el.strokeWidth }
    : undefined;

  switch (el.shapeType) {
    case 'rect': {
      slide.addShape('rect', {
        x, y, w, h,
        fill: fillProps,
        line: lineProps,
        rectRadius: el.cornerRadius > 0 ? el.cornerRadius * PX_TO_INCH : undefined,
        rotate: el.rotation || 0,
      });
      break;
    }
    case 'ellipse': {
      slide.addShape('ellipse', {
        x, y, w, h,
        fill: fillProps,
        line: lineProps,
        rotate: el.rotation || 0,
      });
      break;
    }
    case 'triangle': {
      slide.addShape('triangle', {
        x, y, w, h,
        fill: fillProps,
        line: lineProps,
        rotate: el.rotation || 0,
      });
      break;
    }
    case 'star': {
      slide.addShape('star5', {
        x, y, w, h,
        fill: fillProps,
        line: lineProps,
        rotate: el.rotation || 0,
      });
      break;
    }
    case 'line': {
      const strokeColor = el.stroke || el.fill || '#000000';
      slide.addShape('line', {
        x: x, y: y, w: w, h: h,
        line: { color: hexWithoutHash(strokeColor), width: el.strokeWidth || 3 },
        rotate: el.rotation || 0,
        flipV: el.points ? (el.points[3] - el.points[1]) < 0 : false,
      });
      break;
    }
    case 'arrow': {
      const strokeColor = el.stroke || el.fill || '#000000';
      slide.addShape('line', {
        x: x, y: y, w: w, h: h,
        line: {
          color: hexWithoutHash(strokeColor),
          width: el.strokeWidth || 3,
          endArrowType: 'triangle',
        },
        rotate: el.rotation || 0,
        flipV: el.points ? (el.points[3] - el.points[1]) < 0 : false,
      });
      break;
    }
  }
}

function addImageElement(slide: PptxGenJS.Slide, el: ImageElement, resources: Presentation['resources']) {
  const resource = el.resourceId ? resources[el.resourceId] : undefined;
  if (!resource || resource.type === 'video') return;

  slide.addImage({
    data: toImageData(resource.src),
    x: el.x * PX_TO_INCH,
    y: el.y * PX_TO_INCH,
    w: el.width * PX_TO_INCH,
    h: el.height * PX_TO_INCH,
    rotate: el.rotation || 0,
  });
}

export async function exportPptx(presentation: Presentation): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = presentation.title;

  const visibleSlides = presentation.slideOrder
    .map(id => presentation.slides[id])
    .filter((slide): slide is Slide => !!slide && !slide.hidden);

  for (const slideData of visibleSlides) {
    const slide = pptx.addSlide();

    // Background
    setSlideBackground(slide, slideData.background, presentation.resources);

    // Elements in order
    for (const elId of slideData.elementOrder) {
      const el = slideData.elements[elId];
      if (!el || !el.visible) continue;

      switch (el.type) {
        case 'text':
          addTextElement(slide, el);
          break;
        case 'shape':
          addShapeElement(slide, el);
          break;
        case 'image':
          addImageElement(slide, el, presentation.resources);
          break;
      }
    }

    // Speaker notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  const filename = `${presentation.title.replace(/\s+/g, '_')}.pptx`;
  await pptx.writeFile({ fileName: filename });
}
