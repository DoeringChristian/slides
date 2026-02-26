import JSZip from 'jszip';
import type { Presentation, Slide, TextElement, ShapeElement, ImageElement, SlideBackground } from '../types/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './constants';
import { parseBlocks, getBlockFontMultiplier } from '../components/canvas/CustomMarkdownRenderer';

// px to cm: 1 inch = 96 px = 2.54 cm
const PX_TO_CM = 2.54 / 96;

function cm(px: number): string {
  return (px * PX_TO_CM).toFixed(4) + 'cm';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface ImageRef {
  path: string; // e.g. "Pictures/image1.png"
  data: string; // base64 data (without prefix)
  mime: string;
}

function dataUrlToBase64(dataUrl: string): { data: string; mime: string; ext: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { data: '', mime: 'image/png', ext: 'png' };
  const mime = match[1];
  const extMap: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  };
  return { data: match[2], mime, ext: extMap[mime] || 'png' };
}

function buildBackgroundStyle(bg: SlideBackground, _images: ImageRef[]): string {
  if (bg.type === 'solid') {
    return `draw:fill="solid" draw:fill-color="${bg.color}"`;
  } else if (bg.type === 'gradient') {
    return `draw:fill="solid" draw:fill-color="${bg.from}"`;
  } else if (bg.type === 'image') {
    // Image backgrounds need special handling, fall back to white
    return `draw:fill="solid" draw:fill-color="#ffffff"`;
  }
  return `draw:fill="solid" draw:fill-color="#ffffff"`;
}

function buildTextXml(el: TextElement): string {
  const blocks = parseBlocks(el.text || '');
  let xml = '';

  for (const block of blocks) {
    const textStyleName = `T_${el.id}_${block.type}`;
    const content = escapeXml(block.displayContent || '');

    // Build paragraph
    xml += `<text:p text:style-name="P_${el.id}">`;
    if (content) {
      xml += `<text:span text:style-name="${textStyleName}">`;
      xml += content;
      xml += `</text:span>`;
    }
    xml += `</text:p>`;
  }

  return xml;
}

function buildTextStyles(el: TextElement): string {
  const blocks = parseBlocks(el.text || '');
  let styles = '';

  // Paragraph style
  styles += `<style:style style:name="P_${el.id}" style:family="paragraph">`;
  styles += `<style:paragraph-properties fo:text-align="${el.style.align === 'center' ? 'center' : el.style.align === 'right' ? 'end' : 'start'}"/>`;
  styles += `</style:style>`;

  const seen = new Set<string>();
  for (const block of blocks) {
    const styleName = `T_${el.id}_${block.type}`;
    if (seen.has(styleName)) continue;
    seen.add(styleName);

    const multiplier = getBlockFontMultiplier(block.type);
    const fontSize = el.style.fontSize * multiplier;
    const isHeader = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
    const bold = isHeader || el.style.fontWeight === 'bold';
    const italic = el.style.fontStyle === 'italic';

    styles += `<style:style style:name="${styleName}" style:family="text">`;
    styles += `<style:text-properties `;
    styles += `fo:font-size="${fontSize}pt" `;
    styles += `fo:font-family="${escapeXml(el.style.fontFamily)}" `;
    styles += `fo:color="${el.style.color}" `;
    if (bold) styles += `fo:font-weight="bold" `;
    if (italic) styles += `fo:font-style="italic" `;
    if (el.style.textDecoration === 'underline') styles += `style:text-underline-style="solid" `;
    if (el.style.textDecoration === 'line-through') styles += `style:text-line-through-style="solid" `;
    styles += `/>`;
    styles += `</style:style>`;
  }

  return styles;
}

function buildShapeXml(el: ShapeElement, slideIndex: number, elIndex: number): string {
  const x = cm(el.x);
  const y = cm(el.y);
  const w = cm(el.width);
  const h = cm(el.height);
  const styleName = `gr_s${slideIndex}_e${elIndex}`;
  const transform = el.rotation ? ` draw:transform="rotate(${(-el.rotation * Math.PI / 180).toFixed(6)}) translate(${x}, ${y})"` : '';
  const posAttrs = el.rotation ? '' : ` svg:x="${x}" svg:y="${y}"`;

  switch (el.shapeType) {
    case 'rect':
      if (el.cornerRadius > 0) {
        return `<draw:custom-shape draw:style-name="${styleName}"${posAttrs} svg:width="${w}" svg:height="${h}"${transform} draw:layer="layout">` +
          `<draw:enhanced-geometry svg:viewBox="0 0 ${el.width} ${el.height}" draw:type="round-rectangle" draw:corner-radius="${cm(el.cornerRadius)}"/>` +
          `</draw:custom-shape>`;
      }
      return `<draw:rect draw:style-name="${styleName}"${posAttrs} svg:width="${w}" svg:height="${h}"${transform} draw:layer="layout"/>`;

    case 'ellipse':
      return `<draw:ellipse draw:style-name="${styleName}"${posAttrs} svg:width="${w}" svg:height="${h}"${transform} draw:layer="layout"/>`;

    case 'triangle':
      return `<draw:custom-shape draw:style-name="${styleName}"${posAttrs} svg:width="${w}" svg:height="${h}"${transform} draw:layer="layout">` +
        `<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="isosceles-triangle"/>` +
        `</draw:custom-shape>`;

    case 'star':
      return `<draw:custom-shape draw:style-name="${styleName}"${posAttrs} svg:width="${w}" svg:height="${h}"${transform} draw:layer="layout">` +
        `<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="star5"/>` +
        `</draw:custom-shape>`;

    case 'line': {
      const pts = el.points ?? [0, 0, el.width, 0];
      return `<draw:line draw:style-name="${styleName}" svg:x1="${cm(el.x + pts[0])}" svg:y1="${cm(el.y + pts[1])}" svg:x2="${cm(el.x + pts[2])}" svg:y2="${cm(el.y + pts[3])}" draw:layer="layout"/>`;
    }

    case 'arrow': {
      const pts = el.points ?? [0, 0, el.width, 0];
      return `<draw:line draw:style-name="${styleName}" svg:x1="${cm(el.x + pts[0])}" svg:y1="${cm(el.y + pts[1])}" svg:x2="${cm(el.x + pts[2])}" svg:y2="${cm(el.y + pts[3])}" draw:layer="layout"/>`;
    }

    default:
      return '';
  }
}

function buildShapeStyle(el: ShapeElement, slideIndex: number, elIndex: number): string {
  const styleName = `gr_s${slideIndex}_e${elIndex}`;
  const hasFill = el.fill && el.fill !== 'transparent' && el.fill !== 'none' && el.fill !== '';
  const hasStroke = el.stroke && el.stroke !== 'none' && el.stroke !== '' && el.strokeWidth > 0;
  const isLine = el.shapeType === 'line' || el.shapeType === 'arrow';

  let style = `<style:style style:name="${styleName}" style:family="graphic">`;
  style += `<style:graphic-properties `;

  if (!isLine) {
    if (hasFill) {
      style += `draw:fill="solid" draw:fill-color="${el.fill}" `;
    } else {
      style += `draw:fill="none" `;
    }
  }

  if (hasStroke || isLine) {
    const strokeColor = el.stroke || el.fill || '#000000';
    style += `draw:stroke="solid" svg:stroke-color="${strokeColor}" svg:stroke-width="${cm(el.strokeWidth || 3)}" `;
  } else if (!isLine) {
    style += `draw:stroke="none" `;
  }

  if (el.opacity < 1) {
    style += `draw:opacity="${Math.round(el.opacity * 100)}%" `;
  }

  // Arrow marker for arrow shape
  if (el.shapeType === 'arrow') {
    style += `draw:marker-end="Arrow" draw:marker-end-width="0.3cm" `;
  }

  style += `/>`;
  style += `</style:style>`;

  return style;
}

function buildImageXml(el: ImageElement, imagePath: string, slideIndex: number, elIndex: number): string {
  const x = cm(el.x);
  const y = cm(el.y);
  const w = cm(el.width);
  const h = cm(el.height);
  const styleName = `gr_s${slideIndex}_e${elIndex}`;

  return `<draw:frame draw:style-name="${styleName}" svg:x="${x}" svg:y="${y}" svg:width="${w}" svg:height="${h}" draw:layer="layout">` +
    `<draw:image xlink:href="${imagePath}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
    `</draw:frame>`;
}

export async function exportOdp(presentation: Presentation): Promise<void> {
  const zip = new JSZip();

  const visibleSlides = presentation.slideOrder
    .map(id => presentation.slides[id])
    .filter((slide): slide is Slide => !!slide && !slide.hidden);

  // Collect images
  const images: ImageRef[] = [];
  let imageCounter = 0;

  const resourceImageMap = new Map<string, string>(); // resourceId -> Pictures/imageN.ext

  for (const slideData of visibleSlides) {
    for (const elId of slideData.elementOrder) {
      const el = slideData.elements[elId];
      if (el?.type === 'image' && (el as ImageElement).resourceId) {
        const imgEl = el as ImageElement;
        if (imgEl.resourceId && !resourceImageMap.has(imgEl.resourceId)) {
          const resource = presentation.resources[imgEl.resourceId];
          if (resource && resource.type === 'image') {
            const { data, mime, ext } = dataUrlToBase64(resource.src);
            if (data) {
              imageCounter++;
              const path = `Pictures/image${imageCounter}.${ext}`;
              images.push({ path, data, mime });
              resourceImageMap.set(imgEl.resourceId, path);
            }
          }
        }
      }
    }
  }

  // Build content.xml
  let autoStyles = '';
  let bodyContent = '';

  for (let si = 0; si < visibleSlides.length; si++) {
    const slideData = visibleSlides[si];
    const dpStyleName = `dp_${si}`;

    // Drawing page style (background)
    autoStyles += `<style:style style:name="${dpStyleName}" style:family="drawing-page">`;
    autoStyles += `<style:drawing-page-properties ${buildBackgroundStyle(slideData.background, images)}/>`;
    autoStyles += `</style:style>`;

    bodyContent += `<draw:page draw:name="Slide ${si + 1}" draw:style-name="${dpStyleName}" draw:master-page-name="Default">`;

    let elIndex = 0;
    for (const elId of slideData.elementOrder) {
      const el = slideData.elements[elId];
      if (!el || !el.visible) continue;

      if (el.type === 'text') {
        const textEl = el as TextElement;
        const styleName = `gr_s${si}_e${elIndex}`;
        const x = cm(textEl.x);
        const y = cm(textEl.y);
        const w = cm(textEl.width);
        const h = cm(textEl.height);

        // Text frame graphic style
        autoStyles += `<style:style style:name="${styleName}" style:family="graphic">`;
        autoStyles += `<style:graphic-properties draw:fill="none" draw:stroke="none"`;
        if (textEl.opacity < 1) {
          autoStyles += ` draw:opacity="${Math.round(textEl.opacity * 100)}%"`;
        }
        autoStyles += `/>`;
        autoStyles += `</style:style>`;

        // Text styles
        autoStyles += buildTextStyles(textEl);

        const transform = textEl.rotation ? ` draw:transform="rotate(${(-textEl.rotation * Math.PI / 180).toFixed(6)}) translate(${x}, ${y})"` : '';
        const posAttrs = textEl.rotation ? '' : ` svg:x="${x}" svg:y="${y}"`;

        bodyContent += `<draw:frame draw:style-name="${styleName}"${posAttrs} svg:width="${w}" svg:height="${h}"${transform} draw:layer="layout">`;
        bodyContent += `<draw:text-box>`;
        bodyContent += buildTextXml(textEl);
        bodyContent += `</draw:text-box>`;
        bodyContent += `</draw:frame>`;
      } else if (el.type === 'shape') {
        const shapeEl = el as ShapeElement;
        autoStyles += buildShapeStyle(shapeEl, si, elIndex);
        bodyContent += buildShapeXml(shapeEl, si, elIndex);
      } else if (el.type === 'image') {
        const imgEl = el as ImageElement;
        if (imgEl.resourceId && resourceImageMap.has(imgEl.resourceId)) {
          const imgPath = resourceImageMap.get(imgEl.resourceId)!;

          autoStyles += `<style:style style:name="gr_s${si}_e${elIndex}" style:family="graphic">`;
          autoStyles += `<style:graphic-properties draw:fill="none" draw:stroke="none"`;
          if (imgEl.opacity < 1) {
            autoStyles += ` draw:opacity="${Math.round(imgEl.opacity * 100)}%"`;
          }
          autoStyles += `/>`;
          autoStyles += `</style:style>`;

          bodyContent += buildImageXml(imgEl, imgPath, si, elIndex);
        }
      }
      elIndex++;
    }

    // Notes
    if (slideData.notes) {
      bodyContent += `<presentation:notes>`;
      bodyContent += `<draw:frame presentation:class="notes" svg:x="0cm" svg:y="0cm" svg:width="${cm(SLIDE_WIDTH)}" svg:height="10cm">`;
      bodyContent += `<draw:text-box><text:p>${escapeXml(slideData.notes)}</text:p></draw:text-box>`;
      bodyContent += `</draw:frame>`;
      bodyContent += `</presentation:notes>`;
    }

    bodyContent += `</draw:page>`;
  }

  const slideW = cm(SLIDE_WIDTH);
  const slideH = cm(SLIDE_HEIGHT);

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
  office:version="1.2">
  <office:automatic-styles>
    ${autoStyles}
  </office:automatic-styles>
  <office:body>
    <office:presentation>
      ${bodyContent}
    </office:presentation>
  </office:body>
</office:document-content>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.2">
  <office:styles>
    <draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0l10 30h-20z"/>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="PM0">
      <style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${slideW}" fo:page-height="${slideH}" style:print-orientation="landscape"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Default" style:page-layout-name="PM0" draw:style-name="dp_master"/>
  </office:master-styles>
</office:document-styles>`;

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
${images.map(img => `  <manifest:file-entry manifest:full-path="${img.path}" manifest:media-type="${img.mime}"/>`).join('\n')}
</manifest:manifest>`;

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  office:version="1.2">
  <office:meta>
    <dc:title>${escapeXml(presentation.title)}</dc:title>
  </office:meta>
</office:document-meta>`;

  // Mimetype must be first entry, stored uncompressed
  zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifestXml);
  zip.file('content.xml', contentXml);
  zip.file('styles.xml', stylesXml);
  zip.file('meta.xml', metaXml);

  // Add images
  for (const img of images) {
    zip.file(img.path, img.data, { base64: true });
  }

  // Generate and download
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.presentation' });
  const filename = `${presentation.title.replace(/\s+/g, '_')}.odp`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
