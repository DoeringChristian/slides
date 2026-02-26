import JSZip from 'jszip';
import type { Presentation, SlideBackground, SlideElement } from '../types/presentation';
import { createPresentation, createSlide, createTextElement, createShapeElement, createImageElement, createResource } from './slideFactory';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';

// ODP uses cm; convert to px: 1 inch = 2.54 cm = 96 px
function cmToPx(cmStr: string): number {
  const val = parseFloat(cmStr);
  if (isNaN(val)) return 0;
  return val / 2.54 * 96;
}

function parseDimension(value: string | null): number {
  if (!value) return 0;
  // Handle cm, mm, in, pt, px
  if (value.endsWith('cm')) return cmToPx(value);
  if (value.endsWith('mm')) return parseFloat(value) / 25.4 * 96;
  if (value.endsWith('in')) return parseFloat(value) * 96;
  if (value.endsWith('pt')) return parseFloat(value) * 96 / 72;
  if (value.endsWith('px')) return parseFloat(value);
  return parseFloat(value) || 0;
}

// ODP rotation is in radians (negative), stored in draw:transform="rotate(...) translate(...)"
function parseTransform(transformStr: string | null): { x: number; y: number; rotation: number } | null {
  if (!transformStr) return null;

  let rotation = 0;
  let x = 0;
  let y = 0;

  const rotateMatch = transformStr.match(/rotate\(([^)]+)\)/);
  if (rotateMatch) {
    // ODP rotation is in radians, counter-clockwise negative
    rotation = -(parseFloat(rotateMatch[1]) * 180 / Math.PI);
  }

  const translateMatch = transformStr.match(/translate\(([^,)]+),?\s*([^)]*)\)/);
  if (translateMatch) {
    x = parseDimension(translateMatch[1].trim());
    y = parseDimension(translateMatch[2]?.trim() || '0');
  }

  return { x, y, rotation };
}

function getPosition(el: Element): { x: number; y: number; width: number; height: number; rotation: number } {
  let x = parseDimension(el.getAttribute('svg:x'));
  let y = parseDimension(el.getAttribute('svg:y'));
  const width = parseDimension(el.getAttribute('svg:width'));
  const height = parseDimension(el.getAttribute('svg:height'));
  let rotation = 0;

  const transform = el.getAttribute('draw:transform');
  if (transform) {
    const parsed = parseTransform(transform);
    if (parsed) {
      if (parsed.x) x = parsed.x;
      if (parsed.y) y = parsed.y;
      rotation = parsed.rotation;
    }
  }

  return { x, y, width, height, rotation };
}

function extractTextContent(textBox: Element): { text: string; fontSize: number; fontFamily: string; bold: boolean; italic: boolean; color: string; align: 'left' | 'center' | 'right' } {
  const result = { text: '', fontSize: 24, fontFamily: 'Arial', bold: false, italic: false, color: '#333333', align: 'left' as const };

  const paragraphs = textBox.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'p');
  if (paragraphs.length === 0) {
    // Try without namespace
    const pElements = textBox.querySelectorAll('text\\:p, p');
    if (pElements.length === 0) return result;
  }

  const lines: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    let lineText = '';

    // Get spans
    const spans = p.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'span');
    if (spans.length > 0) {
      for (let j = 0; j < spans.length; j++) {
        lineText += spans[j].textContent || '';
      }
    } else {
      lineText = p.textContent || '';
    }

    lines.push(lineText);
  }

  result.text = lines.join('\n');
  return result;
}

function parseDrawingPageBackground(styleEl: Element | null): SlideBackground {
  if (!styleEl) return { type: 'solid', color: '#ffffff' };

  // Look for drawing-page-properties
  const dpProps = styleEl.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:style:1.0', 'drawing-page-properties');
  if (dpProps.length === 0) return { type: 'solid', color: '#ffffff' };

  const props = dpProps[0];
  const fillType = props.getAttribute('draw:fill');
  const fillColor = props.getAttribute('draw:fill-color');

  if (fillType === 'solid' && fillColor) {
    return { type: 'solid', color: fillColor };
  }

  return { type: 'solid', color: '#ffffff' };
}

async function extractImageAsDataUrl(zip: JSZip, href: string): Promise<string | null> {
  const file = zip.file(href);
  if (!file) return null;

  const data = await file.async('base64');
  const ext = href.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'svg': 'image/svg+xml', 'bmp': 'image/bmp',
  };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${data}`;
}

export async function importOdp(file: File): Promise<Presentation> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const presentation = createPresentation();
  presentation.title = file.name.replace(/\.odp$/i, '');
  presentation.slides = {};
  presentation.slideOrder = [];

  // Parse content.xml
  const contentXml = await zip.file('content.xml')?.async('text');
  if (!contentXml) throw new Error('Invalid ODP: missing content.xml');

  const doc = new DOMParser().parseFromString(contentXml, 'application/xml');

  // Collect automatic styles for backgrounds
  const styleMap = new Map<string, Element>();
  const autoStyles = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:style:1.0', 'style');
  for (let i = 0; i < autoStyles.length; i++) {
    const name = autoStyles[i].getAttribute('style:name');
    if (name) styleMap.set(name, autoStyles[i]);
  }

  // Find all draw:page elements
  const pages = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'page');

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];

    // Parse background
    const dpStyleName = page.getAttribute('draw:style-name');
    const dpStyle = dpStyleName ? styleMap.get(dpStyleName) : null;
    const background = parseDrawingPageBackground(dpStyle || null);

    const slide = createSlide({ background });
    const elements: SlideElement[] = [];

    // Process child elements
    const children = page.children;
    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];
      const tagName = child.localName;

      // Skip notes and presentation:notes
      if (tagName === 'notes') {
        // Extract notes text
        const noteFrames = child.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'frame');
        for (let ni = 0; ni < noteFrames.length; ni++) {
          const cls = noteFrames[ni].getAttribute('presentation:class');
          if (cls === 'notes') {
            const textBoxes = noteFrames[ni].getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'text-box');
            if (textBoxes.length > 0) {
              const noteText = extractTextContent(textBoxes[0]);
              slide.notes = noteText.text;
            }
          }
        }
        continue;
      }

      const pos = getPosition(child);

      if (tagName === 'frame') {
        // Check for image first
        const drawImages = child.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'image');
        if (drawImages.length > 0) {
          const imgEl = drawImages[0];
          const href = imgEl.getAttribute('xlink:href');
          if (href) {
            const dataUrl = await extractImageAsDataUrl(zip, href);
            if (dataUrl) {
              const resource = createResource(
                href.split('/').pop() || 'image.png',
                dataUrl,
                Math.max(pos.width, 1),
                Math.max(pos.height, 1),
              );
              presentation.resources[resource.id] = resource;

              const el = createImageElement(resource.id, pos.width, pos.height, {
                x: pos.x,
                y: pos.y,
                width: Math.max(pos.width, 10),
                height: Math.max(pos.height, 10),
                rotation: pos.rotation,
              });
              elements.push(el);
              continue;
            }
          }
        }

        // Check for text box
        const textBoxes = child.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'text-box');
        if (textBoxes.length > 0) {
          // Skip placeholder frames (title/subtitle/notes without useful content)
          const presClass = child.getAttribute('presentation:class');
          if (presClass === 'notes') continue;

          const textData = extractTextContent(textBoxes[0]);
          if (textData.text.trim()) {
            const el = createTextElement({
              x: pos.x,
              y: pos.y,
              width: Math.max(pos.width, 50),
              height: Math.max(pos.height, 20),
              rotation: pos.rotation,
              text: textData.text,
              style: {
                fontFamily: textData.fontFamily,
                fontSize: textData.fontSize,
                fontWeight: textData.bold ? 'bold' : 'normal',
                fontStyle: textData.italic ? 'italic' : 'normal',
                textDecoration: 'none',
                color: textData.color,
                align: textData.align,
                verticalAlign: 'top',
                lineHeight: 1.2,
              },
            });
            elements.push(el);
          }
        }
      } else if (tagName === 'rect') {
        const fillColor = getGraphicPropFromStyle(child, styleMap, 'draw:fill-color') || '#4285f4';
        const strokeColor = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-color') || '#2962ff';
        const strokeWidthStr = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-width');
        const strokeWidth = strokeWidthStr ? parseDimension(strokeWidthStr) : 0;
        const noStroke = getGraphicPropFromStyle(child, styleMap, 'draw:stroke') === 'none';

        const el = createShapeElement('rect', {
          x: pos.x,
          y: pos.y,
          width: Math.max(pos.width, 10),
          height: Math.max(pos.height, 10),
          rotation: pos.rotation,
          fill: fillColor,
          stroke: noStroke ? '' : strokeColor,
          strokeWidth: noStroke ? 0 : strokeWidth,
        });
        elements.push(el);
      } else if (tagName === 'ellipse' || tagName === 'circle') {
        const fillColor = getGraphicPropFromStyle(child, styleMap, 'draw:fill-color') || '#4285f4';
        const strokeColor = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-color') || '#2962ff';
        const strokeWidthStr = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-width');
        const strokeWidth = strokeWidthStr ? parseDimension(strokeWidthStr) : 0;
        const noStroke = getGraphicPropFromStyle(child, styleMap, 'draw:stroke') === 'none';

        const el = createShapeElement('ellipse', {
          x: pos.x,
          y: pos.y,
          width: Math.max(pos.width, 10),
          height: Math.max(pos.height, 10),
          rotation: pos.rotation,
          fill: fillColor,
          stroke: noStroke ? '' : strokeColor,
          strokeWidth: noStroke ? 0 : strokeWidth,
        });
        elements.push(el);
      } else if (tagName === 'line') {
        const x1 = parseDimension(child.getAttribute('svg:x1'));
        const y1 = parseDimension(child.getAttribute('svg:y1'));
        const x2 = parseDimension(child.getAttribute('svg:x2'));
        const y2 = parseDimension(child.getAttribute('svg:y2'));

        const strokeColor = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-color') || '#000000';
        const strokeWidthStr = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-width');
        const strokeWidth = strokeWidthStr ? parseDimension(strokeWidthStr) : 3;

        // Check for arrow marker
        const markerEnd = getGraphicPropFromStyle(child, styleMap, 'draw:marker-end');
        const shapeType = markerEnd ? 'arrow' as const : 'line' as const;

        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);

        const el = createShapeElement(shapeType, {
          x: minX,
          y: minY,
          width: Math.max(Math.abs(x2 - x1), 1),
          height: Math.max(Math.abs(y2 - y1), 1),
          fill: '',
          stroke: strokeColor,
          strokeWidth,
          points: [x1 - minX, y1 - minY, x2 - minX, y2 - minY],
        });
        elements.push(el);
      } else if (tagName === 'custom-shape') {
        const enhancedGeoms = child.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'enhanced-geometry');
        const geomType = enhancedGeoms.length > 0 ? enhancedGeoms[0].getAttribute('draw:type') : null;

        const fillColor = getGraphicPropFromStyle(child, styleMap, 'draw:fill-color') || '#4285f4';
        const strokeColor = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-color') || '#2962ff';
        const strokeWidthStr = getGraphicPropFromStyle(child, styleMap, 'svg:stroke-width');
        const strokeWidth = strokeWidthStr ? parseDimension(strokeWidthStr) : 0;
        const noStroke = getGraphicPropFromStyle(child, styleMap, 'draw:stroke') === 'none';

        let shapeType: 'rect' | 'ellipse' | 'triangle' | 'star' = 'rect';
        if (geomType === 'isosceles-triangle' || geomType === 'right-triangle') shapeType = 'triangle';
        else if (geomType?.startsWith('star')) shapeType = 'star';
        else if (geomType === 'ellipse') shapeType = 'ellipse';
        else if (geomType === 'round-rectangle') shapeType = 'rect';

        const el = createShapeElement(shapeType, {
          x: pos.x,
          y: pos.y,
          width: Math.max(pos.width, 10),
          height: Math.max(pos.height, 10),
          rotation: pos.rotation,
          fill: fillColor,
          stroke: noStroke ? '' : strokeColor,
          strokeWidth: noStroke ? 0 : strokeWidth,
          cornerRadius: geomType === 'round-rectangle' ? 10 : 0,
        });
        elements.push(el);
      }
    }

    // Add elements to slide
    for (const el of elements) {
      slide.elements[el.id] = el;
      slide.elementOrder.push(el.id);
    }

    presentation.slides[slide.id] = slide;
    presentation.slideOrder.push(slide.id);
  }

  // If no slides imported, add an empty one
  if (presentation.slideOrder.length === 0) {
    const slide = createSlide();
    presentation.slides[slide.id] = slide;
    presentation.slideOrder.push(slide.id);
  }

  presentation.width = SLIDE_WIDTH;
  presentation.height = SLIDE_HEIGHT;

  return presentation;
}

function getGraphicPropFromStyle(el: Element, styleMap: Map<string, Element>, propName: string): string | null {
  const styleName = el.getAttribute('draw:style-name');
  if (!styleName) return null;
  const styleEl = styleMap.get(styleName);
  if (!styleEl) return null;

  const graphicProps = styleEl.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:style:1.0', 'graphic-properties');
  if (graphicProps.length === 0) return null;

  return graphicProps[0].getAttribute(propName);
}
