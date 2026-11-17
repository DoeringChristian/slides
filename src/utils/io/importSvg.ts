import type { ImageElement, Resource, ShapeElement, SlideElement, TextElement, VectorContour, VectorGeometry } from '../../types/presentation';
import { pathBoundsFor } from '../paths/pathShapes';
import { createShapeElement, createTextElement, loadImageFile } from '../model/slideFactory';
import { formatPaintColor, parsePaintColor } from '../paint/paintColor';
import { DEFAULT_TEXT_STYLE, SLIDE_HEIGHT, SLIDE_WIDTH } from '../constants';
import { generateId } from '../idGenerator';
import {
  applyMatrix, contoursBounds, ellipseContour, matrixScale, parsePathData, pointsContour, rectContour,
  type Contour, type Matrix, type Pt,
} from './svgPathData';

/**
 * Import an SVG as editable presentation objects rather than one picture.
 *
 * Each drawn shape becomes a `vector` shape (its outline as lines and cubics,
 * with its fill, stroke, width, dashes and opacity); `<text>` becomes a text
 * object; embedded `<image>`s become images; SVG groups become object groups
 * and the whole import is one group. The browser does the hard parts of
 * SVG: the SVG is mounted off-screen so every element's final transform
 * (getScreenCTM, viewBox included) and computed style (CSS, inheritance) are
 * exactly what the browser would draw. `<use>` references are expanded first
 * — matplotlib, for one, draws text as reused glyph outlines.
 *
 * Clip paths become crop groups (the clipped object, or a whole clipped
 * group, plus an invisible boundary shape — the editor's crop-to-shape), and
 * open paths with arrow markers become editable lines/curves with
 * arrowheads. Only what lies on the SVG's page (its viewport) is imported,
 * and the page is what gets fitted onto the slide: drawing tools keep scratch
 * objects off the page, and the browser never shows them either.
 *
 * Not carried over: gradients and patterns (flattened to their first colour),
 * masks, filters, and markers other than arrowheads on open paths. They are
 * reported as warnings.
 */

export interface SvgImport {
  elements: SlideElement[];
  /** New resources the image elements refer to. */
  resources: Resource[];
  warnings: string[];
}

/** Beyond this many objects, an SVG is better inserted as an image. */
export const MAX_SVG_OBJECTS = 2000;

const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'linearGradient', 'radialGradient', 'pattern',
  'style', 'title', 'desc', 'metadata', 'filter', 'script', 'foreignObject']);
const CONTAINERS = new Set(['g', 'svg', 'a', 'switch']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

type Paint = { color: string } | null;
type Raw =
  | { kind: 'shape'; contours: Contour[]; fill: Paint; stroke: Paint; strokeWidth: number; dashed: boolean; evenOdd: boolean; opacity: number; groups: string[]; name?: string;
      /** Arrowheads from SVG markers (open paths only). */
      markerStart?: MarkerInfo; markerEnd?: MarkerInfo;
      /** Set on a crop boundary: the clip group it crops. */
      cropFor?: string }
  | { kind: 'text'; text: string; box: { x: number; y: number; width: number; height: number }; anchor: 'left' | 'center' | 'right'; fontSize: number; color: string; serif: boolean; bold: boolean; italic: boolean; opacity: number; groups: string[] }
  | { kind: 'image'; href: string; corners: Pt[]; opacity: number; groups: string[] };

const hrefOf = (el: Element) => el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href') ?? '';

/** Replace every <use> with a group holding a copy of what it references. */
function expandUses(root: SVGSVGElement, warnings: Set<string>) {
  for (let pass = 0; pass < 8; pass++) {
    const uses = [...root.querySelectorAll('use')];
    if (!uses.length) return;
    for (const use of uses) {
      const id = hrefOf(use).replace(/^#/, '');
      const target = id ? root.querySelector(`[id="${CSS.escape(id)}"]`) : null;
      const g = document.createElementNS(SVG_NS, 'g');
      for (const attr of [...use.attributes]) {
        if (['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id'].includes(attr.name)) continue;
        g.setAttribute(attr.name, attr.value);
      }
      const x = parseFloat(use.getAttribute('x') ?? '0') || 0, y = parseFloat(use.getAttribute('y') ?? '0') || 0;
      g.setAttribute('transform', `${use.getAttribute('transform') ?? ''} translate(${x} ${y})`.trim());
      if (target) {
        const copy = target.cloneNode(true) as Element;
        if (copy.localName === 'symbol') {
          for (const child of [...copy.childNodes]) g.appendChild(child);
        } else {
          g.appendChild(copy);
        }
        for (const el of [g, ...g.querySelectorAll('[id]')]) el.removeAttribute('id');
      } else {
        warnings.add('Some <use> references point at nothing and were skipped.');
      }
      use.replaceWith(g);
    }
  }
  warnings.add('Deeply nested <use> references were not fully expanded.');
}

function paintOf(value: string, alpha: number, root: SVGSVGElement, warnings: Set<string>): Paint {
  if (!value || value === 'none') return null;
  let color = value;
  const url = /url\(["']?#([^"')]+)["']?\)/.exec(value);
  if (url) {
    const ref = root.querySelector(`[id="${CSS.escape(url[1])}"]`);
    const stop = ref?.querySelector('stop');
    if (ref?.localName.endsWith('Gradient')) warnings.add('Gradients were flattened to their first colour.');
    else warnings.add('Patterns were replaced by a plain colour.');
    color = stop ? getComputedStyle(stop).stopColor : '#888888';
  }
  const parsed = parsePaintColor(color);
  if (!parsed) return null;
  const a = parsed.a * alpha;
  return a <= 0 ? null : { color: formatPaintColor({ ...parsed, a }) };
}

function geometryOf(el: SVGGraphicsElement): Contour[] {
  const len = (v: SVGAnimatedLength) => v.baseVal.value;
  switch (el.localName) {
    case 'path': return parsePathData(el.getAttribute('d') ?? '');
    case 'rect': {
      const r = el as SVGRectElement;
      const rx = r.getAttribute('rx') !== null ? len(r.rx) : 0, ry = r.getAttribute('ry') !== null ? len(r.ry) : 0;
      return len(r.width) > 0 && len(r.height) > 0 ? [rectContour(len(r.x), len(r.y), len(r.width), len(r.height), rx, ry)] : [];
    }
    case 'circle': {
      const c = el as SVGCircleElement;
      return len(c.r) > 0 ? [ellipseContour(len(c.cx), len(c.cy), len(c.r), len(c.r))] : [];
    }
    case 'ellipse': {
      const e = el as SVGEllipseElement;
      return len(e.rx) > 0 && len(e.ry) > 0 ? [ellipseContour(len(e.cx), len(e.cy), len(e.rx), len(e.ry))] : [];
    }
    case 'line': {
      const l = el as SVGLineElement;
      return [{ start: [len(l.x1), len(l.y1)], segments: [{ kind: 'line', to: [len(l.x2), len(l.y2)] }], closed: false }];
    }
    case 'polyline':
    case 'polygon': {
      const c = pointsContour(el.getAttribute('points') ?? '', el.localName === 'polygon');
      return c ? [c] : [];
    }
    default: return [];
  }
}

/** A data: URL as a Blob, without the network. Inkscape wraps the base64 in
 *  line breaks, which `fetch` of a data URL may reject. */
export function dataUrlToBlob(href: string): Blob {
  const m = /^data:([^;,]+)?((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(href);
  if (!m) throw new Error('Not a data URL');
  const type = m[1] || 'application/octet-stream';
  const payload = m[4];
  if (!m[3]) return new Blob([decodeURIComponent(payload)], { type });
  const bin = atob(payload.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const matrixOf = (m: DOMMatrix | SVGMatrix): Matrix => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
const compose = (outer: Matrix, inner: Matrix): Matrix => ({
  a: outer.a * inner.a + outer.c * inner.b, b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d, d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e, f: outer.b * inner.e + outer.d * inner.f + outer.f,
});
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const ownTransform = (el: Element): Matrix => {
  const list = (el as SVGGraphicsElement).transform?.baseVal;
  const m = list && list.numberOfItems ? list.consolidate()?.matrix : null;
  return m ? matrixOf(m) : IDENTITY;
};

/** The outline an element is clipped to, in root coordinates, or null. */
function clipOf(el: SVGGraphicsElement, toRoot: (el: SVGGraphicsElement) => Matrix, root: SVGSVGElement, attr: 'clip-path' | 'mask'): { contours: Contour[]; evenOdd: boolean } | null {
  const ref = /url\(["']?#([^"')]+)["']?\)/.exec(el.getAttribute(attr) ?? '');
  if (!ref) return null;
  const clip = root.querySelector(`[id="${CSS.escape(ref[1])}"]`);
  if (!clip || clip.localName !== (attr === 'mask' ? 'mask' : 'clipPath')) return null;
  // userSpaceOnUse (default for clips and mask content): in the user space
  // of the element it applies to; objectBoundingBox: in units of its bbox.
  let base = compose(toRoot(el), ownTransform(clip));
  if (clip.getAttribute(attr === 'mask' ? 'maskContentUnits' : 'clipPathUnits') === 'objectBoundingBox') {
    const b = el.getBBox();
    base = compose(base, { a: b.width, b: 0, c: 0, d: b.height, e: b.x, f: b.y });
  }
  const contours: Contour[] = [];
  let evenOdd = false;
  for (const child of clip.children) {
    const geometry = geometryOf(child as SVGGraphicsElement);
    if (!geometry.length) continue;
    contours.push(...applyMatrix(geometry, compose(base, ownTransform(child))));
    if (getComputedStyle(child).clipRule === 'evenodd') evenOdd = true;
  }
  return contours.length ? { contours, evenOdd } : null;
}

function collect(svg: SVGSVGElement, warnings: Set<string>): Raw[] {
  const rootInverse = svg.getScreenCTM()?.inverse();
  if (!rootInverse) throw new Error('This SVG could not be laid out.');
  const toRoot = (el: SVGGraphicsElement): Matrix => {
    const m = el.getScreenCTM();
    return m ? rootInverse.multiply(m) : rootInverse;
  };
  const raws: Raw[] = [];
  let groupSeq = 0;

  const walk = (el: Element, groups: string[], opacity: number) => {
    if (SKIP.has(el.localName)) {
      if (['clipPath', 'mask', 'filter', 'marker'].includes(el.localName)) warnings.add(`${el.localName} effects were not imported.`);
      return;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const op = opacity * (parseFloat(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
    if (op <= 0) return;
    if (el !== svg && el.hasAttribute('filter')) warnings.add('Filters were ignored.');
    // A clip path (or a mask, by its shapes — soft edges become hard) becomes
    // a crop group: everything this element draws is grouped with an
    // invisible boundary shape that crops it.
    for (const attr of ['clip-path', 'mask'] as const) {
      if (el === svg || !el.hasAttribute(attr)) continue;
      const clip = clipOf(el as SVGGraphicsElement, toRoot, svg, attr);
      if (clip) {
        const key = `clip${groupSeq++}`;
        groups = [...groups, key];
        raws.push({ kind: 'shape', contours: clip.contours, fill: null, stroke: null, strokeWidth: 0, dashed: false, evenOdd: clip.evenOdd, opacity: 1, groups, cropFor: key, name: 'crop' });
        if (attr === 'mask') warnings.add('Masks became crops by their shape (soft or partial masking is not kept).');
      } else {
        warnings.add(`Some ${attr === 'mask' ? 'masks' : 'clip paths'} could not be read and were ignored.`);
      }
    }
    if (CONTAINERS.has(el.localName)) {
      const next = el === svg ? groups : [...groups, `g${groupSeq++}`];
      for (const child of el.children) walk(child, next, op);
      return;
    }
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return;
    const g = el as SVGGraphicsElement;
    if (el.localName === 'text') {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const m = toRoot(g), b = g.getBBox();
      const corners = applyMatrix([{ start: [b.x, b.y], segments: [{ kind: 'line', to: [b.x + b.width, b.y + b.height] }], closed: false }], m);
      const box = contoursBounds(corners)!;
      const fill = paintOf(cs.fill, parseFloat(cs.fillOpacity) || 1, svg, warnings);
      raws.push({
        kind: 'text', text, box, anchor: cs.textAnchor === 'middle' ? 'center' : cs.textAnchor === 'end' ? 'right' : 'left',
        fontSize: (parseFloat(cs.fontSize) || 16) * matrixScale(m),
        color: fill?.color ?? '#000000', serif: /serif/i.test(cs.fontFamily) && !/sans/i.test(cs.fontFamily),
        bold: (parseInt(cs.fontWeight, 10) || 400) >= 600, italic: cs.fontStyle === 'italic', opacity: op, groups,
      });
      return;
    }
    if (el.localName === 'image') {
      const href = hrefOf(el);
      const im = el as SVGImageElement;
      const x = im.x.baseVal.value, y = im.y.baseVal.value, w = im.width.baseVal.value, h = im.height.baseVal.value;
      if (!href || !w || !h) return;
      const [c] = applyMatrix([{ start: [x, y], segments: [{ kind: 'line', to: [x + w, y] }, { kind: 'line', to: [x + w, y + h] }, { kind: 'line', to: [x, y + h] }], closed: true }], toRoot(g));
      raws.push({ kind: 'image', href, corners: [c.start, ...c.segments.map(s => s.to)], opacity: op, groups });
      return;
    }
    const local = geometryOf(g);
    if (!local.length) return;
    const m = toRoot(g);
    const fill = paintOf(cs.fill, parseFloat(cs.fillOpacity) || (cs.fillOpacity === '0' ? 0 : 1), svg, warnings);
    const stroke = paintOf(cs.stroke, parseFloat(cs.strokeOpacity) || (cs.strokeOpacity === '0' ? 0 : 1), svg, warnings);
    if (!fill && !stroke) return;
    raws.push({
      kind: 'shape', contours: applyMatrix(local, m), fill, stroke,
      strokeWidth: (parseFloat(cs.strokeWidth) || 1) * matrixScale(m),
      dashed: !!cs.strokeDasharray && cs.strokeDasharray !== 'none',
      evenOdd: cs.fillRule === 'evenodd', opacity: op, groups,
      name: el.getAttribute('id') ?? undefined,
      markerStart: markerInfo(cs.markerStart, svg),
      markerEnd: markerInfo(cs.markerEnd, svg),
    });
  };
  walk(svg, [], 1);
  return raws;
}

/** Bounds of everything imported, in the SVG's root coordinates. */
function rawBounds(raw: Raw) {
  if (raw.kind === 'shape') {
    const b = contoursBounds(raw.contours);
    if (!b) return null;
    const pad = raw.stroke ? raw.strokeWidth / 2 : 0;
    return { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  }
  if (raw.kind === 'text') return raw.box;
  return contoursBounds([{ start: raw.corners[0], segments: raw.corners.slice(1).map(to => ({ kind: 'line', to })), closed: true }]);
}

/** Signed area a contour's fill would cover (control points included, which
 *  is exact for straight runs and conservative for curves). */
function enclosedArea(c: Contour): number {
  const pts: Pt[] = [c.start, ...c.segments.flatMap(s => (s.kind === 'line' ? [s.to] : [s.c1, s.c2, s.to]))];
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** An arrow marker's size and where its tip sits, in stroke widths (what
 *  `arrowScale` measures): `length` along the path, `overhang` past the
 *  path's end (a marker's refX need not be its tip). */
interface MarkerInfo { length: number; overhang: number }
function markerInfo(ref: string, root: SVGSVGElement): MarkerInfo | undefined {
  if (!ref || ref === 'none') return undefined;
  const id = /url\(["']?#([^"')]+)["']?\)/.exec(ref)?.[1];
  const marker = id ? root.querySelector(`[id="${CSS.escape(id)}"]`) : null;
  // A referenced marker that cannot be read still marks an arrowhead.
  const fallback = { length: 10 / 3, overhang: 0 };
  if (!marker || marker.localName !== 'marker') return fallback;
  const contours: Contour[] = [];
  for (const child of marker.children) {
    const geometry = geometryOf(child as SVGGraphicsElement);
    if (geometry.length) contours.push(...applyMatrix(geometry, ownTransform(child)));
  }
  const b = contoursBounds(contours);
  if (!b || b.width <= 0) return fallback;
  // Marker content units → marker units (viewBox mapped onto markerWidth),
  // which are stroke widths unless markerUnits="userSpaceOnUse".
  const vb = (marker as SVGMarkerElement).viewBox?.baseVal;
  const mw = (marker as SVGMarkerElement).markerWidth?.baseVal.value || 3;
  const k = vb && vb.width > 0 ? mw / vb.width : 1;
  if (marker.getAttribute('markerUnits') === 'userSpaceOnUse') return fallback;
  const refX = (marker as SVGMarkerElement).refX?.baseVal.value ?? 0;
  return { length: b.width * k, overhang: Math.max(0, (b.x + b.width - refX) * k) };
}

/** An open path with arrow markers, as an editable line/curve shape with
 *  arrowheads (the editor's own path model: vertices, Bézier handles). */
function arrowShape(contour: Contour, raw: Extract<Raw, { kind: 'shape' }>, scale: number): ShapeElement {
  const vertices: Pt[] = [contour.start, ...contour.segments.map(s => s.to)];
  // The editor's head tip sits at the path's end; a marker's tip may sit
  // past it. Extend the ends so the tips land where the SVG draws them.
  const strokeWidth = Math.max(0.1, raw.strokeWidth * scale);
  const extend = (at: number, from: number, info: MarkerInfo | undefined) => {
    if (!info?.overhang || vertices.length < 2) return;
    const [x, y] = vertices[at], [px, py] = vertices[from];
    const len = Math.hypot(x - px, y - py) || 1;
    vertices[at] = [x + (x - px) / len * info.overhang * strokeWidth, y + (y - py) / len * info.overhang * strokeWidth];
  };
  extend(vertices.length - 1, vertices.length - 2, raw.markerEnd);
  extend(0, 1, raw.markerStart);
  const bezier = contour.segments.some(s => s.kind === 'cubic');
  // Handles per vertex, relative to it: [inDx, inDy, outDx, outDy].
  const tangents: number[] = [];
  vertices.forEach((v, i) => {
    const before = contour.segments[i - 1], after = contour.segments[i];
    const inH = before?.kind === 'cubic' ? [before.c2[0] - v[0], before.c2[1] - v[1]] : [0, 0];
    const outH = after?.kind === 'cubic' ? [after.c1[0] - v[0], after.c1[1] - v[1]] : [0, 0];
    tangents.push(inH[0], inH[1], outH[0], outH[1]);
  });
  const absolute = vertices.flat();
  const box = pathBoundsFor(absolute, bezier ? 'bezier' : 'linear', false, bezier ? tangents : undefined);
  return createShapeElement('path', {
    creationPreset: 'arrow',
    x: box.x, y: box.y, width: Math.max(box.width, 0.5), height: Math.max(box.height, 0.5),
    points: box.points, curve: bezier ? 'bezier' : 'linear', ...(bezier ? { tangents } : {}), closed: false,
    startHead: raw.markerStart ? 'triangle' : 'none', endHead: raw.markerEnd ? 'triangle' : 'none',
    fill: '', stroke: raw.stroke?.color ?? '#000000',
    strokeWidth,
    // The head length the SVG's own marker has (both ends share one size).
    arrowScale: Math.max(0.5, Math.min(20, (raw.markerEnd ?? raw.markerStart)?.length ?? 10 / 3)),
    ...(raw.dashed ? { strokeStyle: 'dashed' as const } : {}),
    opacity: raw.opacity,
  });
}

/** A shape's outline normalised into its own box (the `vector` model). */
function vectorShape(contours: Contour[], raw: Extract<Raw, { kind: 'shape' }>, scale: number): ShapeElement | null {
  const b = contoursBounds(contours);
  if (!b) return null;
  // A perfectly straight line has no width (or height): give it a hair so
  // the normalised coordinates stay finite.
  const width = Math.max(b.width, 0.5), height = Math.max(b.height, 0.5);
  const x = b.x - (width - b.width) / 2, y = b.y - (height - b.height) / 2;
  const n = ([px, py]: Pt): Pt => [(px - x) / width, (py - y) / height];
  const vectorContours: VectorContour[] = contours.map((c, i) => ({
    id: `c${i}`,
    start: n(c.start),
    closed: c.closed,
    segments: c.segments.map(s => (s.kind === 'line' ? { kind: 'line' as const, to: n(s.to) } : { kind: 'cubic' as const, c1: n(s.c1), c2: n(s.c2), to: n(s.to) })),
  }));
  const ids = vectorContours.map(c => c.id);
  const geometry: VectorGeometry = {
    kind: 'vector', version: 1, contours: vectorContours,
    fills: raw.fill || raw.cropFor ? [{ contourIds: ids, rule: raw.evenOdd ? 'evenodd' : 'nonzero' }] : [],
    strokes: raw.stroke ? ids : [],
  };
  return createShapeElement('vector', {
    x, y, width, height, geometry,
    fill: raw.fill?.color ?? '',
    stroke: raw.stroke?.color ?? '',
    strokeWidth: raw.stroke ? Math.max(0.1, raw.strokeWidth * scale) : 0,
    ...(raw.dashed ? { strokeStyle: 'dashed' as const } : {}),
    opacity: raw.opacity,
  });
}

/**
 * Parse `svgText` into slide elements, scaled to fit within `fit` (default:
 * 70% of the slide) and centred on `center` (default: the slide's centre).
 * `existing` lets embedded images reuse resources already in the deck.
 */
export async function importSvg(
  svgText: string,
  options: { center?: Pt; fit?: { width: number; height: number }; existing?: Record<string, Resource> } = {},
): Promise<SvgImport> {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('This file is not a valid SVG.');
  const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:2000px;height:2000px;overflow:hidden;opacity:0;pointer-events:none';
  host.appendChild(svg);
  document.body.appendChild(host);
  const warnings = new Set<string>();
  try {
    expandUses(svg, warnings);
    const raws = collect(svg, warnings);
    if (!raws.length) throw new Error('This SVG has nothing to import.');
    if (raws.length > MAX_SVG_OBJECTS) {
      throw new Error(`This SVG has ${raws.length} shapes — too many to edit one by one. Insert it as an image instead.`);
    }

    // Only what is on the page: the viewport is what the SVG shows, and
    // drawing tools keep scratch objects off it.
    const vb = svg.viewBox?.baseVal;
    const page = vb && vb.width > 0 && vb.height > 0
      ? { x: vb.x, y: vb.y, width: vb.width, height: vb.height }
      : { x: 0, y: 0, width: svg.width.baseVal.value, height: svg.height.baseVal.value };
    const onPage = (b: { x: number; y: number; width: number; height: number } | null) => !!b && page.width > 0
      && b.x + b.width >= page.x && b.y + b.height >= page.y && b.x <= page.x + page.width && b.y <= page.y + page.height;
    // Clipped content counts only where its crops let it show: content whose
    // clip lies off the page is invisible in the SVG and stays out.
    const cropBoxes = new Map<string, ReturnType<typeof rawBounds>>();
    for (const r of raws) if (r.kind === 'shape' && r.cropFor) cropBoxes.set(r.cropFor, rawBounds(r));
    const visibleBox = (r: Raw) => {
      let b = rawBounds(r);
      for (const g of r.groups) {
        if (!b || !cropBoxes.has(g) || (r.kind === 'shape' && r.cropFor === g)) continue;
        const c = cropBoxes.get(g);
        if (!c) return null;
        const x = Math.max(b.x, c.x), y = Math.max(b.y, c.y);
        const w = Math.min(b.x + b.width, c.x + c.width) - x, h = Math.min(b.y + b.height, c.y + c.height) - y;
        b = w >= 0 && h >= 0 ? { x, y, width: w, height: h } : null;
      }
      return b;
    };
    let kept = page.width > 0 && page.height > 0 ? raws.filter(r => onPage(visibleBox(r))) : raws;
    if (kept.length < raws.length) warnings.add(`${raws.length - kept.length} objects outside the page were left out.`);
    // A crop boundary without anything left to crop is dropped too.
    kept = kept.filter(r => r.kind !== 'shape' || !r.cropFor || kept.some(o => o !== r && o.groups.includes(r.cropFor!)));
    if (!kept.length) throw new Error('Nothing on this SVG’s page to import.');

    // Fit the page (what the SVG shows) into the target box on the slide.
    const boxes = page.width > 0 && page.height > 0 ? [page] : kept.map(rawBounds).filter((b): b is NonNullable<typeof b> => !!b);
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
    const x1 = Math.max(...boxes.map(b => b.x + b.width)), y1 = Math.max(...boxes.map(b => b.y + b.height));
    const fit = options.fit ?? { width: SLIDE_WIDTH * 0.7, height: SLIDE_HEIGHT * 0.7 };
    const scale = Math.min(fit.width / Math.max(x1 - x0, 1e-6), fit.height / Math.max(y1 - y0, 1e-6));
    const [cx, cy] = options.center ?? [SLIDE_WIDTH / 2, SLIDE_HEIGHT / 2];
    const ox = cx - (x1 - x0) * scale / 2, oy = cy - (y1 - y0) * scale / 2;
    const fitMatrix: Matrix = { a: scale, b: 0, c: 0, d: scale, e: ox - x0 * scale, f: oy - y0 * scale };
    const fitPt = ([x, y]: Pt): Pt => [x * scale + fitMatrix.e, y * scale + fitMatrix.f];

    const made: Array<{ element: SlideElement; groups: string[]; cropFor?: string }> = [];
    const resources: Resource[] = [];
    const known = { ...(options.existing ?? {}) };
    for (const raw of kept) {
      if (raw.kind === 'shape') {
        const contours = applyMatrix(raw.contours, fitMatrix);
        // A fill that encloses no area (lines inherit SVG's default black
        // fill) draws nothing; dropping it lets such a line become an arrow.
        const fillsNothing = raw.fill && contours.every(c => Math.abs(enclosedArea(c)) < 1e-6 * Math.max(1, ...c.segments.map(s => Math.abs(s.to[0]) + Math.abs(s.to[1]))));
        if (fillsNothing) raw.fill = null;
        const arrow = (raw.markerStart || raw.markerEnd) && raw.stroke && !raw.fill && contours.length === 1 && !contours[0].closed;
        if ((raw.markerStart || raw.markerEnd) && !arrow) warnings.add('Markers other than arrowheads on open paths were dropped.');
        const el = arrow ? arrowShape(contours[0], raw, scale) : vectorShape(contours, raw, scale);
        if (el) made.push({ element: el, groups: raw.groups, cropFor: raw.cropFor });
      } else if (raw.kind === 'text') {
        // Centre the text on the original's box: glyph metrics differ from
        // the SVG's font, so anchoring the top edge would shift it. A little
        // slack keeps a slightly wider face from wrapping.
        const [x, y] = fitPt([raw.box.x, raw.box.y]);
        const width = raw.box.width * scale, height = raw.box.height * scale, slack = width * 0.3 + 4;
        const el: TextElement = createTextElement({
          text: raw.text, x: x - slack / 2, y, width: width + slack, height: Math.max(1, height),
          textSizing: 'user-width', opacity: raw.opacity,
          style: {
            ...DEFAULT_TEXT_STYLE, align: raw.anchor === 'left' ? 'left' : raw.anchor, verticalAlign: 'middle',
            fontFamily: raw.serif ? 'Libertinus Serif' : 'Inter',
            fontSize: Math.max(4, raw.fontSize * scale), color: raw.color,
            fontWeight: raw.bold ? 'bold' : 'normal', fontStyle: raw.italic ? 'italic' : 'normal',
          },
        });
        made.push({ element: el, groups: raw.groups });
      } else {
        try {
          const blob = raw.href.startsWith('data:') ? dataUrlToBlob(raw.href) : await (await fetch(raw.href)).blob();
          const corners = raw.corners.map(fitPt);
          const b = contoursBounds([{ start: corners[0], segments: corners.slice(1).map(to => ({ kind: 'line', to })), closed: true }])!;
          const { resource, element, isExisting } = await loadImageFile(blob, { x: b.x, y: b.y, width: b.width, height: b.height, opacity: raw.opacity }, known);
          if (!isExisting) { resources.push(resource); known[resource.id] = resource; }
          made.push({ element: element as ImageElement, groups: raw.groups });
        } catch {
          warnings.add('An embedded image could not be loaded and was skipped.');
        }
      }
    }

    // Object groups: an SVG group that holds at least two imported objects
    // becomes an object group (outermost first); the whole import is one.
    const members = new Map<string, number>();
    for (const { groups } of made) for (const g of groups) members.set(g, (members.get(g) ?? 0) + 1);
    const ids = new Map<string, string>();
    const idFor = (g: string) => { if (!ids.has(g)) ids.set(g, generateId()); return ids.get(g)!; };
    const all = made.length > 1 ? generateId() : null;
    const crop = new Set(made.flatMap(m => (m.cropFor ? [m.cropFor] : [])));
    const elements = made.map(({ element, groups, cropFor }) => {
      // Crop groups always stay groups: the boundary crops its group's members.
      const path = [...(all ? [all] : []), ...groups.filter(g => (members.get(g) ?? 0) >= 2 && ((members.get(g) ?? 0) < made.length || crop.has(g))).map(idFor)];
      const withGroups = path.length ? { ...element, objectGroupIds: [...new Set(path)] } as SlideElement : element;
      return cropFor && element.type === 'shape' ? { ...withGroups, cropGroupId: idFor(cropFor) } as SlideElement : withGroups;
    });
    return { elements, resources, warnings: [...warnings] };
  } finally {
    host.remove();
  }
}
