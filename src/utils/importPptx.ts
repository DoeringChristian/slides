import JSZip from 'jszip';
import type { Presentation, SlideBackground, SlideElement } from '../types/presentation';
import { createPresentation, createSlide, createTextElement, createShapeElement, createResource } from './slideFactory';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import { generateId } from './idGenerator';
import type { ImageElement } from '../types/presentation';

// EMU to px: 1 inch = 914400 EMU, 1 inch = 96 px
const EMU_TO_PX = 96 / 914400;

function emuToPx(emu: number): number {
  return emu * EMU_TO_PX;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

// Get DIRECT child elements by namespace+localName (non-recursive)
function directChildren(parent: Element, ns: string, localName: string): Element[] {
  const results: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.namespaceURI === ns && child.localName === localName) {
      results.push(child);
    }
  }
  return results;
}

function directChild(parent: Element, ns: string, localName: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.namespaceURI === ns && child.localName === localName) {
      return child;
    }
  }
  return null;
}

// Recursive search (only used where nesting is OK, e.g. finding elements deep in doc)
function getElementsByTag(parent: Element | Document, ns: string, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(ns, localName));
}

function getElementByTag(parent: Element | Document, ns: string, localName: string): Element | null {
  const els = parent.getElementsByTagNameNS(ns, localName);
  return els.length > 0 ? els[0] : null;
}

function parseColor(solidFillEl: Element | null): string | null {
  if (!solidFillEl) return null;

  const srgb = getElementByTag(solidFillEl, NS.a, 'srgbClr');
  if (srgb) {
    const val = srgb.getAttribute('val');
    if (val) return '#' + val;
  }

  const scheme = getElementByTag(solidFillEl, NS.a, 'schemeClr');
  if (scheme) {
    const val = scheme.getAttribute('val');
    const themeMap: Record<string, string> = {
      'bg1': '#ffffff', 'bg2': '#e7e6e6', 'tx1': '#000000', 'tx2': '#44546a',
      'accent1': '#4472c4', 'accent2': '#ed7d31', 'accent3': '#a5a5a5',
      'accent4': '#ffc000', 'accent5': '#5b9bd5', 'accent6': '#70ad47',
      'lt1': '#ffffff', 'dk1': '#000000', 'lt2': '#e7e6e6', 'dk2': '#44546a',
    };
    if (val && themeMap[val]) return themeMap[val];
  }

  return null;
}

function parseBackground(bgEl: Element | null): SlideBackground {
  if (!bgEl) return { type: 'solid', color: '#ffffff' };

  const bgPr = getElementByTag(bgEl, NS.p, 'bgPr');
  if (bgPr) {
    const solidFill = getElementByTag(bgPr, NS.a, 'solidFill');
    if (solidFill) {
      const color = parseColor(solidFill);
      if (color) return { type: 'solid', color };
    }

    const gradFill = getElementByTag(bgPr, NS.a, 'gradFill');
    if (gradFill) {
      const stops = getElementsByTag(gradFill, NS.a, 'gs');
      if (stops.length >= 2) {
        const fromColor = parseColor(stops[0]) || '#ffffff';
        const toColor = parseColor(stops[stops.length - 1]) || '#000000';
        return { type: 'gradient', from: fromColor, to: toColor, direction: 90 };
      }
    }
  }

  const bgRef = getElementByTag(bgEl, NS.p, 'bgRef');
  if (bgRef) {
    const solidFill = getElementByTag(bgRef, NS.a, 'solidFill');
    if (solidFill) {
      const color = parseColor(solidFill);
      if (color) return { type: 'solid', color };
    }
  }

  return { type: 'solid', color: '#ffffff' };
}

interface Extent {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

// Parse xfrm from a spPr element. Returns null if no xfrm found (placeholder without explicit position).
function parseXfrm(spPr: Element | null): Extent | null {
  if (!spPr) return null;

  const xfrm = directChild(spPr, NS.a, 'xfrm');
  if (!xfrm) return null;

  const off = directChild(xfrm, NS.a, 'off');
  const ext = directChild(xfrm, NS.a, 'ext');
  if (!off || !ext) return null;

  const x = emuToPx(parseInt(off.getAttribute('x') || '0', 10));
  const y = emuToPx(parseInt(off.getAttribute('y') || '0', 10));
  const width = emuToPx(parseInt(ext.getAttribute('cx') || '0', 10));
  const height = emuToPx(parseInt(ext.getAttribute('cy') || '0', 10));

  let rotation = 0;
  const rot = xfrm.getAttribute('rot');
  if (rot) {
    rotation = parseInt(rot, 10) / 60000;
  }

  return { x, y, width, height, rotation };
}

// Placeholder types and their default positions (approximations for standard 10"×5.625" slides)
const PLACEHOLDER_DEFAULTS: Record<string, Extent> = {
  'title':    { x: 50, y: 22, width: 860, height: 65, rotation: 0 },
  'ctrTitle': { x: 130, y: 140, width: 700, height: 90, rotation: 0 },
  'subTitle': { x: 180, y: 260, width: 600, height: 70, rotation: 0 },
  'body':     { x: 50, y: 100, width: 860, height: 380, rotation: 0 },
  'obj':      { x: 50, y: 100, width: 860, height: 380, rotation: 0 },
  'dt':       { x: 50, y: 500, width: 200, height: 30, rotation: 0 },
  'ftr':      { x: 330, y: 500, width: 300, height: 30, rotation: 0 },
  'sldNum':   { x: 700, y: 500, width: 200, height: 30, rotation: 0 },
};

// Check if a shape is a placeholder and return its type
function getPlaceholderType(sp: Element): string | null {
  const nvSpPr = directChild(sp, NS.p, 'nvSpPr');
  if (!nvSpPr) return null;
  const nvPr = directChild(nvSpPr, NS.p, 'nvPr');
  if (!nvPr) return null;
  const ph = directChild(nvPr, NS.p, 'ph');
  if (!ph) return null;
  return ph.getAttribute('type') || 'body'; // default placeholder type is body
}

function parseTextBody(txBody: Element | null): { text: string; fontSize: number; fontFamily: string; bold: boolean; italic: boolean; color: string; align: 'left' | 'center' | 'right' } {
  const result: { text: string; fontSize: number; fontFamily: string; bold: boolean; italic: boolean; color: string; align: 'left' | 'center' | 'right' } = { text: '', fontSize: 24, fontFamily: 'Arial', bold: false, italic: false, color: '#333333', align: 'left' };

  if (!txBody) return result;

  const paragraphs = directChildren(txBody, NS.a, 'p');
  const lines: string[] = [];

  for (const p of paragraphs) {
    const pPr = directChild(p, NS.a, 'pPr');
    if (pPr) {
      const algn = pPr.getAttribute('algn');
      if (algn === 'ctr') result.align = 'center';
      else if (algn === 'r') result.align = 'right';
    }

    const runs = directChildren(p, NS.a, 'r');
    let lineText = '';
    let isBullet = false;

    if (pPr) {
      const buChar = directChild(pPr, NS.a, 'buChar');
      const buAutoNum = directChild(pPr, NS.a, 'buAutoNum');
      if (buChar || buAutoNum) isBullet = true;
    }

    for (const run of runs) {
      const rPr = directChild(run, NS.a, 'rPr');
      if (rPr) {
        const sz = rPr.getAttribute('sz');
        if (sz) result.fontSize = parseInt(sz, 10) / 100;

        const b = rPr.getAttribute('b');
        if (b === '1' || b === 'true') result.bold = true;

        const i = rPr.getAttribute('i');
        if (i === '1' || i === 'true') result.italic = true;

        const solidFill = directChild(rPr, NS.a, 'solidFill');
        if (solidFill) {
          const color = parseColor(solidFill);
          if (color) result.color = color;
        }

        const latin = directChild(rPr, NS.a, 'latin');
        if (latin) {
          const typeface = latin.getAttribute('typeface');
          if (typeface && !typeface.startsWith('+')) result.fontFamily = typeface;
        }
      }

      const t = directChild(run, NS.a, 't');
      if (t) {
        lineText += t.textContent || '';
      }
    }

    // Also capture field elements (e.g., slide numbers)
    const fields = directChildren(p, NS.a, 'fld');
    for (const fld of fields) {
      const t = directChild(fld, NS.a, 't');
      if (t) lineText += t.textContent || '';
    }

    if (isBullet && lineText) {
      lineText = '- ' + lineText;
    }

    lines.push(lineText);
  }

  result.text = lines.join('\n');
  return result;
}

function getShapeType(spPr: Element | null): string | null {
  if (!spPr) return null;
  const prstGeom = directChild(spPr, NS.a, 'prstGeom');
  if (prstGeom) {
    return prstGeom.getAttribute('prst');
  }
  return null;
}

interface ParsedRelationship {
  id: string;
  target: string;
  type: string;
}

function parseRels(relsXml: string): ParsedRelationship[] {
  const doc = parseXml(relsXml);
  const rels: ParsedRelationship[] = [];
  const relEls = doc.getElementsByTagName('Relationship');
  for (let i = 0; i < relEls.length; i++) {
    const el = relEls[i];
    rels.push({
      id: el.getAttribute('Id') || '',
      target: el.getAttribute('Target') || '',
      type: el.getAttribute('Type') || '',
    });
  }
  return rels;
}

async function extractMediaAsDataUrl(zip: JSZip, mediaPath: string): Promise<string | null> {
  const file = zip.file(mediaPath);
  if (!file) return null;

  const data = await file.async('base64');
  const ext = mediaPath.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'svg': 'image/svg+xml', 'bmp': 'image/bmp',
    'tiff': 'image/tiff', 'tif': 'image/tiff', 'wmf': 'image/wmf',
    'emf': 'image/emf',
  };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${data}`;
}

// Get actual image dimensions from a data URL
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 100, height: 100 });
    img.src = dataUrl;
  });
}

// Read the actual slide size from presentation.xml (if present)
function parseSlideSize(presDoc: Document): { width: number; height: number } {
  const sldSz = getElementByTag(presDoc, NS.p, 'sldSz');
  if (sldSz) {
    const cx = parseInt(sldSz.getAttribute('cx') || '0', 10);
    const cy = parseInt(sldSz.getAttribute('cy') || '0', 10);
    if (cx > 0 && cy > 0) {
      return { width: emuToPx(cx), height: emuToPx(cy) };
    }
  }
  // Default: standard 16:9
  return { width: 960, height: 540 };
}

const SHAPE_MAPPING: Record<string, string> = {
  'rect': 'rect', 'roundRect': 'rect', 'snip1Rect': 'rect', 'snip2DiagRect': 'rect',
  'ellipse': 'ellipse', 'oval': 'ellipse',
  'triangle': 'triangle', 'rtTriangle': 'triangle',
  'star5': 'star', 'star4': 'star', 'star6': 'star', 'star8': 'star', 'star10': 'star',
  'line': 'line', 'straightConnector1': 'line',
};

// Process a group shape (p:grpSp) — flatten children into slide-level coordinates
function processGroupShape(
  grpSp: Element,
  parentScaleX: number,
  parentScaleY: number,
  parentOffsetX: number,
  parentOffsetY: number,
): SlideElement[] {
  const results: SlideElement[] = [];

  // Read the group's xfrm
  const grpSpPr = directChild(grpSp, NS.p, 'grpSpPr');
  if (!grpSpPr) return results;

  const xfrm = directChild(grpSpPr, NS.a, 'xfrm');
  if (!xfrm) return results;

  // Group's position on the slide (or parent group)
  const off = directChild(xfrm, NS.a, 'off');
  const ext = directChild(xfrm, NS.a, 'ext');
  // Child coordinate space
  const chOff = directChild(xfrm, NS.a, 'chOff');
  const chExt = directChild(xfrm, NS.a, 'chExt');

  if (!off || !ext || !chOff || !chExt) return results;

  const grpX = emuToPx(parseInt(off.getAttribute('x') || '0', 10));
  const grpY = emuToPx(parseInt(off.getAttribute('y') || '0', 10));
  const grpW = emuToPx(parseInt(ext.getAttribute('cx') || '1', 10));
  const grpH = emuToPx(parseInt(ext.getAttribute('cy') || '1', 10));

  const chOffX = emuToPx(parseInt(chOff.getAttribute('x') || '0', 10));
  const chOffY = emuToPx(parseInt(chOff.getAttribute('y') || '0', 10));
  const chExtW = emuToPx(parseInt(chExt.getAttribute('cx') || '1', 10));
  const chExtH = emuToPx(parseInt(chExt.getAttribute('cy') || '1', 10));

  // Transform: child coords → slide coords
  // slideX = (childX - chOffX) * (grpW / chExtW) + grpX
  const localScaleX = chExtW > 0 ? grpW / chExtW : 1;
  const localScaleY = chExtH > 0 ? grpH / chExtH : 1;
  const localOffsetX = grpX - chOffX * localScaleX;
  const localOffsetY = grpY - chOffY * localScaleY;

  // Combine with parent transform
  const combinedScaleX = parentScaleX * localScaleX;
  const combinedScaleY = parentScaleY * localScaleY;
  const combinedOffsetX = parentOffsetX + localOffsetX * parentScaleX;
  const combinedOffsetY = parentOffsetY + localOffsetY * parentScaleY;

  // Process direct child shapes
  const childShapes = directChildren(grpSp, NS.p, 'sp');
  for (const sp of childShapes) {
    const spPr = directChild(sp, NS.p, 'spPr');
    const xfrmData = parseXfrm(spPr);
    if (!xfrmData) continue;

    // Transform child position to slide coordinates
    const slideX = xfrmData.x * combinedScaleX + combinedOffsetX;
    const slideY = xfrmData.y * combinedScaleY + combinedOffsetY;
    const slideW = xfrmData.width * combinedScaleX;
    const slideH = xfrmData.height * combinedScaleY;

    // Create a temporary "sp" view with overridden extent for processShape
    // We'll directly create the element instead
    const txBody = directChild(sp, NS.p, 'txBody');
    const prstType = getShapeType(spPr);
    const textData = parseTextBody(txBody);
    const hasText = textData.text.trim().length > 0;
    const mappedShape = prstType ? SHAPE_MAPPING[prstType] : null;

    if (hasText && (!prstType || prstType === 'rect' || prstType === 'roundRect')) {
      results.push(createTextElement({
        x: slideX, y: slideY,
        width: Math.max(slideW, 50), height: Math.max(slideH, 20),
        rotation: xfrmData.rotation,
        text: textData.text,
        style: {
          fontFamily: textData.fontFamily, fontSize: textData.fontSize,
          fontWeight: textData.bold ? 'bold' : 'normal',
          fontStyle: textData.italic ? 'italic' : 'normal',
          textDecoration: 'none', color: textData.color, align: textData.align,
          verticalAlign: 'top', lineHeight: 1.2,
        },
      }));
    } else if (mappedShape) {
      const solidFill = spPr ? directChild(spPr, NS.a, 'solidFill') : null;
      const fillColor = parseColor(solidFill) || '#4285f4';
      const ln = spPr ? directChild(spPr, NS.a, 'ln') : null;
      let strokeColor = '#2962ff';
      let strokeWidth = 0;
      if (ln) {
        const w = ln.getAttribute('w');
        if (w) strokeWidth = emuToPx(parseInt(w, 10));
        const lnFill = directChild(ln, NS.a, 'solidFill');
        if (lnFill) { const c = parseColor(lnFill); if (c) strokeColor = c; }
      }
      results.push(createShapeElement(mappedShape as any, {
        x: slideX, y: slideY,
        width: Math.max(slideW, 10), height: Math.max(slideH, 10),
        rotation: xfrmData.rotation,
        fill: fillColor, stroke: strokeColor, strokeWidth,
        cornerRadius: prstType === 'roundRect' ? 10 : 0,
      }));
    } else if (hasText) {
      results.push(createTextElement({
        x: slideX, y: slideY,
        width: Math.max(slideW, 50), height: Math.max(slideH, 20),
        rotation: xfrmData.rotation,
        text: textData.text,
        style: {
          fontFamily: textData.fontFamily, fontSize: textData.fontSize,
          fontWeight: textData.bold ? 'bold' : 'normal',
          fontStyle: textData.italic ? 'italic' : 'normal',
          textDecoration: 'none', color: textData.color, align: textData.align,
          verticalAlign: 'top', lineHeight: 1.2,
        },
      }));
    }
  }

  // Recurse into nested groups
  const childGroups = directChildren(grpSp, NS.p, 'grpSp');
  for (const childGrp of childGroups) {
    results.push(...processGroupShape(childGrp, combinedScaleX, combinedScaleY, combinedOffsetX, combinedOffsetY));
  }

  return results;
}

export async function importPptx(file: File): Promise<Presentation> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const presentation = createPresentation();
  presentation.title = file.name.replace(/\.pptx$/i, '');
  presentation.slides = {};
  presentation.slideOrder = [];

  // Parse presentation.xml
  const presXml = await zip.file('ppt/presentation.xml')?.async('text');
  if (!presXml) throw new Error('Invalid PPTX: missing presentation.xml');
  const presDoc = parseXml(presXml);

  // Get slide dimensions from presentation.xml and compute scale factors
  const srcSize = parseSlideSize(presDoc);
  const scaleX = SLIDE_WIDTH / srcSize.width;
  const scaleY = SLIDE_HEIGHT / srcSize.height;

  // Parse presentation relationships
  const presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
  if (!presRelsXml) throw new Error('Invalid PPTX: missing presentation relationships');
  const presRels = parseRels(presRelsXml);

  // Get slide list
  const sldIdLst = getElementByTag(presDoc, NS.p, 'sldIdLst');
  if (!sldIdLst) throw new Error('Invalid PPTX: no slides found');
  const sldIds = getElementsByTag(sldIdLst, NS.p, 'sldId');

  // Pre-parse slide layouts for placeholder positions
  const layoutPositions = await parseSlideLayouts(zip, presRels, scaleX, scaleY);

  for (const sldId of sldIds) {
    const rId = sldId.getAttributeNS(NS.r, 'id') || sldId.getAttribute('r:id') || '';
    const rel = presRels.find(r => r.id === rId);
    if (!rel) continue;

    const slidePath = 'ppt/' + rel.target.replace(/^\.\//, '');
    const slideXml = await zip.file(slidePath)?.async('text');
    if (!slideXml) continue;

    const slideDoc = parseXml(slideXml);
    const slideNum = rel.target.match(/slide(\d+)/)?.[1] || '1';

    // Parse slide relationships
    const slideRelsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const slideRelsXml = await zip.file(slideRelsPath)?.async('text');
    const slideRels = slideRelsXml ? parseRels(slideRelsXml) : [];

    // Find which layout this slide uses (for placeholder defaults)
    const layoutRel = slideRels.find(r => r.type.includes('slideLayout'));
    const layoutId = layoutRel?.target.match(/slideLayout(\d+)/)?.[1];
    const layoutExtents = layoutId ? layoutPositions.get(layoutId) : undefined;

    // Parse background
    const bgEl = getElementByTag(slideDoc, NS.p, 'bg');
    const background = parseBackground(bgEl);

    const slide = createSlide({ background });
    const elements: SlideElement[] = [];

    const cSld = getElementByTag(slideDoc, NS.p, 'cSld');
    if (!cSld) continue;

    const spTree = getElementByTag(cSld, NS.p, 'spTree');
    if (!spTree) continue;

    // Process direct child shapes only (not nested in groups)
    const shapes = directChildren(spTree, NS.p, 'sp');
    for (const sp of shapes) {
      // Check if placeholder has position from layout
      const phType = getPlaceholderType(sp);
      const spPr = directChild(sp, NS.p, 'spPr');
      const xfrmData = parseXfrm(spPr);

      let extent: Extent;
      if (xfrmData && xfrmData.width > 0 && xfrmData.height > 0) {
        // Shape has its own explicit position
        extent = {
          x: xfrmData.x * scaleX,
          y: xfrmData.y * scaleY,
          width: xfrmData.width * scaleX,
          height: xfrmData.height * scaleY,
          rotation: xfrmData.rotation,
        };
      } else if (phType && layoutExtents?.has(phType)) {
        // Use layout placeholder position (already scaled)
        extent = { ...layoutExtents.get(phType)! };
      } else if (phType && PLACEHOLDER_DEFAULTS[phType]) {
        // Fall back to our defaults
        extent = { ...PLACEHOLDER_DEFAULTS[phType] };
      } else {
        // No position info at all — skip this shape
        continue;
      }

      const txBody = directChild(sp, NS.p, 'txBody');
      const prstType = getShapeType(spPr);
      const textData = parseTextBody(txBody);
      const hasText = textData.text.trim().length > 0;
      const mappedShape = prstType ? SHAPE_MAPPING[prstType] : null;

      if (hasText && (!prstType || prstType === 'rect' || prstType === 'roundRect')) {
        elements.push(createTextElement({
          x: extent.x, y: extent.y,
          width: Math.max(extent.width, 50), height: Math.max(extent.height, 20),
          rotation: extent.rotation,
          text: textData.text,
          style: {
            fontFamily: textData.fontFamily, fontSize: textData.fontSize,
            fontWeight: textData.bold ? 'bold' : 'normal',
            fontStyle: textData.italic ? 'italic' : 'normal',
            textDecoration: 'none', color: textData.color, align: textData.align,
            verticalAlign: 'top', lineHeight: 1.2,
          },
        }));
      } else if (mappedShape) {
        const solidFill = spPr ? directChild(spPr, NS.a, 'solidFill') : null;
        const fillColor = parseColor(solidFill) || '#4285f4';
        const ln = spPr ? directChild(spPr, NS.a, 'ln') : null;
        let strokeColor = '#2962ff';
        let strokeWidth = 0;
        if (ln) {
          const w = ln.getAttribute('w');
          if (w) strokeWidth = emuToPx(parseInt(w, 10));
          const lnFill = directChild(ln, NS.a, 'solidFill');
          if (lnFill) { const c = parseColor(lnFill); if (c) strokeColor = c; }
        }
        elements.push(createShapeElement(mappedShape as any, {
          x: extent.x, y: extent.y,
          width: Math.max(extent.width, 10), height: Math.max(extent.height, 10),
          rotation: extent.rotation,
          fill: fillColor, stroke: strokeColor, strokeWidth,
          cornerRadius: prstType === 'roundRect' ? 10 : 0,
        }));
      } else if (hasText) {
        elements.push(createTextElement({
          x: extent.x, y: extent.y,
          width: Math.max(extent.width, 50), height: Math.max(extent.height, 20),
          rotation: extent.rotation,
          text: textData.text,
          style: {
            fontFamily: textData.fontFamily, fontSize: textData.fontSize,
            fontWeight: textData.bold ? 'bold' : 'normal',
            fontStyle: textData.italic ? 'italic' : 'normal',
            textDecoration: 'none', color: textData.color, align: textData.align,
            verticalAlign: 'top', lineHeight: 1.2,
          },
        }));
      }
    }

    // Process group shapes — flatten into slide coordinates
    const groups = directChildren(spTree, NS.p, 'grpSp');
    for (const grpSp of groups) {
      const groupElements = processGroupShape(grpSp, scaleX, scaleY, 0, 0);
      elements.push(...groupElements);
    }

    // Process pictures (p:pic)
    const pics = directChildren(spTree, NS.p, 'pic');
    for (const pic of pics) {
      const spPr = directChild(pic, NS.p, 'spPr');
      const xfrmData = parseXfrm(spPr);
      if (!xfrmData) continue;

      const ex = {
        x: xfrmData.x * scaleX,
        y: xfrmData.y * scaleY,
        width: xfrmData.width * scaleX,
        height: xfrmData.height * scaleY,
        rotation: xfrmData.rotation,
      };

      const blipFill = directChild(pic, NS.p, 'blipFill');
      if (!blipFill) continue;

      const blip = getElementByTag(blipFill, NS.a, 'blip');
      if (!blip) continue;

      const embedId = blip.getAttributeNS(NS.r, 'embed') || blip.getAttribute('r:embed') || '';
      const imgRel = slideRels.find(r => r.id === embedId);
      if (!imgRel) continue;

      const mediaPath = 'ppt/slides/' + imgRel.target.replace(/^\.\//, '');
      const normalizedPath = normalizePath(mediaPath);

      const dataUrl = await extractMediaAsDataUrl(zip, normalizedPath);
      if (!dataUrl) continue;

      // Get actual image dimensions for correct crop values
      const imgDims = await getImageDimensions(dataUrl);

      const resource = createResource(
        imgRel.target.split('/').pop() || 'image.png',
        dataUrl,
        imgDims.width,
        imgDims.height,
      );
      presentation.resources[resource.id] = resource;

      const el: ImageElement = {
        id: generateId(),
        type: 'image',
        x: ex.x,
        y: ex.y,
        width: Math.max(ex.width, 10),
        height: Math.max(ex.height, 10),
        rotation: ex.rotation,
        opacity: 1,
        locked: false,
        visible: true,
        resourceId: resource.id,
        cropX: 0,
        cropY: 0,
        cropWidth: imgDims.width,
        cropHeight: imgDims.height,
      };
      elements.push(el);
    }

    // Process connection shapes (p:cxnSp)
    const cxnSps = directChildren(spTree, NS.p, 'cxnSp');
    for (const cxn of cxnSps) {
      const spPr = directChild(cxn, NS.p, 'spPr');
      const xfrmData = parseXfrm(spPr);
      if (!xfrmData) continue;

      const ex = {
        x: xfrmData.x * scaleX,
        y: xfrmData.y * scaleY,
        width: xfrmData.width * scaleX,
        height: xfrmData.height * scaleY,
        rotation: xfrmData.rotation,
      };

      const ln = spPr ? directChild(spPr, NS.a, 'ln') : null;
      let strokeColor = '#000000';
      let strokeWidth = 3;
      if (ln) {
        const w = ln.getAttribute('w');
        if (w) strokeWidth = emuToPx(parseInt(w, 10));
        const lnFill = directChild(ln, NS.a, 'solidFill');
        if (lnFill) {
          const c = parseColor(lnFill);
          if (c) strokeColor = c;
        }
      }

      let shapeType: 'line' | 'arrow' = 'line';
      if (ln) {
        const tailEnd = directChild(ln, NS.a, 'tailEnd');
        if (tailEnd) {
          const type = tailEnd.getAttribute('type');
          if (type && type !== 'none') shapeType = 'arrow';
        }
      }

      elements.push(createShapeElement(shapeType, {
        x: ex.x,
        y: ex.y,
        width: Math.max(ex.width, 1),
        height: Math.max(ex.height, 1),
        rotation: ex.rotation,
        stroke: strokeColor,
        strokeWidth,
        fill: '',
        points: [0, 0, ex.width, ex.height],
      }));
    }

    // Add elements to slide
    for (const el of elements) {
      slide.elements[el.id] = el;
      slide.elementOrder.push(el.id);
    }

    // Parse speaker notes
    const notesRel = slideRels.find(r => r.type.includes('notesSlide'));
    if (notesRel) {
      const notesPath = 'ppt/slides/' + notesRel.target.replace(/^\.\//, '');
      const normalizedNotesPath = normalizePath(notesPath);
      const notesXml = await zip.file(normalizedNotesPath)?.async('text');
      if (notesXml) {
        const notesDoc = parseXml(notesXml);
        // Notes slides have multiple sp elements; find the one with body text
        const notesSps = getElementsByTag(notesDoc, NS.p, 'sp');
        for (const notesSp of notesSps) {
          const phType = getPlaceholderType(notesSp);
          if (phType === 'body') {
            const txBody = directChild(notesSp, NS.p, 'txBody');
            const notesData = parseTextBody(txBody);
            if (notesData.text.trim()) {
              slide.notes = notesData.text;
            }
            break;
          }
        }
      }
    }

    presentation.slides[slide.id] = slide;
    presentation.slideOrder.push(slide.id);
  }

  if (presentation.slideOrder.length === 0) {
    const slide = createSlide();
    presentation.slides[slide.id] = slide;
    presentation.slideOrder.push(slide.id);
  }

  presentation.width = SLIDE_WIDTH;
  presentation.height = SLIDE_HEIGHT;

  return presentation;
}

// Parse slide layouts to get placeholder positions
async function parseSlideLayouts(
  zip: JSZip,
  presRels: ParsedRelationship[],
  scaleX: number,
  scaleY: number,
): Promise<Map<string, Map<string, Extent>>> {
  const result = new Map<string, Map<string, Extent>>();

  // Find all slideLayout relationships
  const layoutRels = presRels.filter(r => r.type.includes('slideLayout'));

  for (const layoutRel of layoutRels) {
    const layoutNum = layoutRel.target.match(/slideLayout(\d+)/)?.[1];
    if (!layoutNum) continue;

    const layoutPath = 'ppt/' + layoutRel.target.replace(/^\.\//, '');
    const layoutXml = await zip.file(layoutPath)?.async('text');
    if (!layoutXml) continue;

    const layoutDoc = parseXml(layoutXml);
    const extents = new Map<string, Extent>();

    const cSld = getElementByTag(layoutDoc, NS.p, 'cSld');
    if (!cSld) continue;

    const spTree = getElementByTag(cSld, NS.p, 'spTree');
    if (!spTree) continue;

    const shapes = directChildren(spTree, NS.p, 'sp');
    for (const sp of shapes) {
      const phType = getPlaceholderType(sp);
      if (!phType) continue;

      const spPr = directChild(sp, NS.p, 'spPr');
      const xfrmData = parseXfrm(spPr);
      if (xfrmData && xfrmData.width > 0 && xfrmData.height > 0) {
        extents.set(phType, {
          x: xfrmData.x * scaleX,
          y: xfrmData.y * scaleY,
          width: xfrmData.width * scaleX,
          height: xfrmData.height * scaleY,
          rotation: xfrmData.rotation,
        });
      }
    }

    result.set(layoutNum, extents);
  }

  return result;
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      normalized.pop();
    } else if (part !== '.' && part !== '') {
      normalized.push(part);
    }
  }
  return normalized.join('/');
}
