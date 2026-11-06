/**
 * Builds the example decks in `examples/`.
 *
 *   npm run build:examples
 *
 * The decks are generated rather than hand-written so they cannot drift from
 * the schema: every element comes out of the real factories in
 * `src/utils/slideFactory.ts`, so a required field added there shows up here on
 * the next run. `tests/examples.test.ts` regenerates them in memory and fails
 * if the committed files disagree, which keeps them honest.
 *
 * Ids are fixed strings, never `generateId()`, so the output is byte-stable.
 *
 * Together the decks are meant to cover every `EasingType`, `TransitionGroup`,
 * `ShapeType`, `ArrowheadType`, `PathCurve`, `StrokeStyle` and `FillStyle` in
 * `src/types/presentation.ts`. The coverage test asserts exactly that, so
 * adding a new value to one of those unions fails the suite until a deck
 * demonstrates it.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDefaultTheme,
  createImageElement,
  createShapeElement,
  createSlide,
  createTextElement,
} from '../src/utils/model/slideFactory';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../src/utils/constants';
import type {
  ArrowheadType, EasingType, FillStyle, ObjectMeta, PathCurve, Presentation,
  Resource, ShapeType, Slide, SlideElement, StrokeStyle, TextElement,
} from '../src/types/presentation';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');

// ── a real PNG, so the crop demos have something to crop ────────────────────

/** Minimal PNG encoder (RGB8, no filtering). Avoids committing a binary blob
 *  or depending on a canvas: the demo texture is generated from a function so
 *  the committed deck stays reviewable as text. */
function encodePng(width: number, height: number, rgb: (x: number, y: number) => [number, number, number]): string {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type 2 (truecolour)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const TEX_W = 320;
const TEX_H = 240;

/** A labelled grid: each 40px cell gets a distinct hue, with darker rules on
 *  the cell boundaries. Any crop rectangle is therefore readable at a glance —
 *  you can see exactly which part of the source is showing. */
const GRID = encodePng(TEX_W, TEX_H, (x, y) => {
  const cx = Math.floor(x / 40);
  const cy = Math.floor(y / 40);
  const edge = x % 40 < 2 || y % 40 < 2;
  const hue = ((cx * 3 + cy * 5) % 12) / 12;
  const [r, g, b] = hsv(hue, edge ? 0.75 : 0.45, edge ? 0.55 : 0.98);
  return [r, g, b];
});

/** A radial target, for the second resource in the dissolve/fade demos. */
const TARGET = encodePng(TEX_W, TEX_H, (x, y) => {
  const d = Math.hypot(x - TEX_W / 2, y - TEX_H / 2) / 24;
  const band = Math.floor(d) % 2 === 0;
  return band ? hsv(0.58, 0.55, 0.95) : hsv(0.05, 0.6, 0.98);
});

function hsv(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const [p, q, t] = [v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)];
  const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return rgb.map((c) => Math.round(c * 255)) as [number, number, number];
}

// ── deck assembly ───────────────────────────────────────────────────────────

type SlideSpec = { meta?: Partial<Slide>; els: SlideElement[] };

/** Assemble slides into a Presentation, deriving the object registry from the
 *  element ids actually present. Elements are laid out in the order given. */
function assemble(
  id: string, title: string, specs: SlideSpec[], resources: Resource[] = [],
): Presentation {
  const slides: Record<string, Slide> = {};
  const slideOrder: string[] = [];
  const objects: Record<string, ObjectMeta> = {};

  specs.forEach((spec, i) => {
    const slide = createSlide({ id: `${id}-s${i + 1}`, ...spec.meta });
    for (const el of spec.els) {
      slide.elements[el.id] = el;
      slide.elementOrder.push(el.id);
      objects[el.id] ??= { id: el.id, name: el.name ?? el.id, type: el.type };
    }
    slides[slide.id] = slide;
    slideOrder.push(slide.id);
  });

  return {
    id, title, width: SLIDE_WIDTH, height: SLIDE_HEIGHT,
    createdAt: 0, updatedAt: 0,
    slides, slideOrder, objects,
    resources: Object.fromEntries(resources.map((r) => [r.id, r])),
    templates: {},
    theme: createDefaultTheme(),
  };
}

/** Slide title, in the same place on every slide of every deck. */
const heading = (id: string, text: string, extra?: Partial<TextElement>) => createTextElement({
  id, text, x: 48, y: 36, width: SLIDE_WIDTH - 96, height: 44,
  textSizing: 'auto-content', style: { ...createTextElement().style, fontSize: 30, color: '#202124' },
  ...extra,
});

const caption = (id: string, text: string, x: number, y: number, width = 150) => createTextElement({
  id, text, x, y, width, height: 22, textSizing: 'auto-content',
  style: { ...createTextElement().style, fontSize: 14, color: '#5f6368', align: 'center' },
});

const resource = (id: string, name: string, src: string): Resource => ({
  id, name, type: 'image', src, originalWidth: TEX_W, originalHeight: TEX_H,
});

// ── 01 · shapes and paths ───────────────────────────────────────────────────

const SHAPE_TYPES: ShapeType[] = ['rect', 'ellipse', 'triangle', 'star', 'path', 'vector', 'dot'];
const CURVES: PathCurve[] = ['linear', 'smooth', 'bspline2', 'bspline3', 'bezier'];
const STROKE_STYLES: StrokeStyle[] = ['solid', 'dashed', 'dotted'];
const FILL_STYLES: FillStyle[] = ['solid', 'hachure', 'crosshatch'];
const ARROWHEADS: ArrowheadType[] = [
  'none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle',
  'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one',
  'crowfoot-many', 'crowfoot-one-many',
];

/** Evenly spaced cells across the slide body, for the gallery slides. */
function grid(n: number, cols: number, cellH: number, top = 110) {
  return Array.from({ length: n }, (_, i) => ({
    x: 60 + (i % cols) * ((SLIDE_WIDTH - 120) / cols),
    y: top + Math.floor(i / cols) * cellH,
    w: (SLIDE_WIDTH - 120) / cols - 24,
    h: cellH - 44,
  }));
}

function shapesDeck(): Presentation {
  const typeCells = grid(SHAPE_TYPES.length, 4, 150);
  const curveCells = grid(CURVES.length, 5, 180);
  const headCells = grid(ARROWHEADS.length, 5, 110);

  return assemble('example-shapes', 'Shapes & Paths', [
    {
      meta: { notes: 'Every ShapeType the editor can create.' },
      els: [
        heading('shapes-title', 'Shape types'),
        ...SHAPE_TYPES.flatMap((shapeType, i) => {
          const c = typeCells[i];
          return [
            createShapeElement(shapeType, {
              id: `shape-${shapeType}`, name: shapeType,
              x: c.x, y: c.y, width: c.w, height: c.h,
              fill: '#e8f0fe', stroke: '#1a73e8', strokeWidth: 2,
              ...(shapeType === 'path'
                ? { points: [0, c.h, c.w * 0.35, 0, c.w * 0.7, c.h * 0.7, c.w, c.h * 0.2], curve: 'smooth' as const }
                : {}),
            }),
            caption(`shape-${shapeType}-cap`, shapeType, c.x, c.y + c.h + 8, c.w),
          ];
        }),
      ],
    },
    {
      meta: { notes: 'The five curve modes through the same five vertices. Bezier carries editable per-vertex tangents.' },
      els: [
        heading('curves-title', 'Curve modes'),
        ...CURVES.flatMap((curve, i) => {
          const c = curveCells[i];
          const pts = [0, c.h * 0.8, c.w * 0.25, 0, c.w * 0.5, c.h, c.w * 0.75, c.h * 0.1, c.w, c.h * 0.6];
          return [
            createShapeElement('path', {
              id: `curve-${curve}`, name: curve,
              x: c.x, y: c.y, width: c.w, height: c.h,
              points: pts, curve, stroke: '#9334e6', strokeWidth: 3, fill: '',
              // Bezier reads tangents when present and estimates Catmull-Rom
              // handles when they are missing; give it real ones to show.
              ...(curve === 'bezier'
                ? { tangents: pts.length / 2 > 0
                    ? Array.from({ length: pts.length / 2 }, () => [-24, -12, 24, 12] as [number, number, number, number])
                    : [] }
                : {}),
            }),
            caption(`curve-${curve}-cap`, curve, c.x, c.y + c.h + 10, c.w),
          ];
        }),
      ],
    },
    {
      meta: { notes: 'Stroke dash patterns and fill hatching are derived from strokeWidth, so they scale with the line.' },
      els: [
        heading('styles-title', 'Stroke & fill styles'),
        ...STROKE_STYLES.flatMap((strokeStyle, i) => [
          createShapeElement('path', {
            id: `stroke-${strokeStyle}`, name: `${strokeStyle} stroke`,
            x: 80, y: 130 + i * 56, width: 330, height: 0,
            points: [0, 0, 330, 0], curve: 'linear', strokeStyle, strokeWidth: 4, stroke: '#188038', fill: '',
          }),
          caption(`stroke-${strokeStyle}-cap`, strokeStyle, 430, 120 + i * 56, 110),
        ]),
        ...FILL_STYLES.flatMap((fillStyle, i) => [
          createShapeElement('rect', {
            id: `fill-${fillStyle}`, name: `${fillStyle} fill`,
            x: 580 + i * 120, y: 130, width: 96, height: 96,
            fill: '#f9ab00', fillStyle, stroke: '#b06000', strokeWidth: 2, cornerRadius: 10,
          }),
          caption(`fill-${fillStyle}-cap`, fillStyle, 580 + i * 120, 234, 96),
        ]),
        createShapeElement('rect', {
          id: 'radius-demo', name: 'corner radius',
          x: 80, y: 330, width: 300, height: 130, cornerRadius: 48,
          fill: '#fce8e6', stroke: '#c5221f', strokeWidth: 2,
        }),
        caption('radius-demo-cap', 'cornerRadius 48', 80, 468, 300),
      ],
    },
    {
      meta: { notes: 'Every ArrowheadType, as an end head on a short shaft.' },
      els: [
        heading('heads-title', 'Arrowheads'),
        ...ARROWHEADS.flatMap((head, i) => {
          const c = headCells[i];
          return [
            createShapeElement('path', {
              id: `head-${head}`, name: head,
              x: c.x, y: c.y + 24, width: c.w, height: 0,
              points: [0, 0, c.w, 0], curve: 'linear',
              stroke: '#1a73e8', strokeWidth: 2.5, fill: '',
              startHead: 'none', endHead: head,
            }),
            caption(`head-${head}-cap`, head, c.x, c.y + 40, c.w),
          ];
        }),
      ],
    },
  ]);
}

// ── 02 · animation ──────────────────────────────────────────────────────────

/** Visibility easings get one row each: hidden on the first keyframe, visible
 *  on the second, with the easing on the appearing element. */
const VISIBILITY: EasingType[] = ['const', 'linear', 'ease', 'create', 'extend', 'wipe', 'slidein', 'grow', 'iris'];
const CROP: EasingType[] = ['cropfade', 'cropfadeease', 'croplift', 'cropliftease'];

function animationDeck(): Presentation {
  const grid5 = grid(VISIBILITY.length, 5, 170);
  const img = (id: string, over: Parameters<typeof createImageElement>[3]) =>
    createImageElement('res-grid', TEX_W, TEX_H, { id, ...over });

  // Pairs of keyframes. Each entry is [stateOnSlideA, stateOnSlideB].
  const scalars = [
    { id: 'tr-position', group: 'position' as const, a: { x: 80, y: 150 }, b: { x: 700, y: 150 } },
    { id: 'tr-size', group: 'size' as const, a: { width: 90, height: 90 }, b: { width: 220, height: 160 } },
    { id: 'tr-rotation', group: 'rotation' as const, a: { rotation: 0 }, b: { rotation: 135 } },
    { id: 'tr-opacity', group: 'opacity' as const, a: { opacity: 1 }, b: { opacity: 0.25 } },
    { id: 'tr-fill', group: 'fill' as const, a: { fill: '#e8f0fe' }, b: { fill: '#fce8e6' } },
    { id: 'tr-stroke', group: 'stroke' as const, a: { stroke: '#1a73e8' }, b: { stroke: '#c5221f' } },
    { id: 'tr-strokeWidth', group: 'strokeWidth' as const, a: { strokeWidth: 1 }, b: { strokeWidth: 10 } },
    { id: 'tr-cornerRadius', group: 'cornerRadius' as const, a: { cornerRadius: 0 }, b: { cornerRadius: 56 } },
  ];

  const scalarShape = (s: typeof scalars[number], side: 'a' | 'b', i: number) => createShapeElement('rect', {
    id: s.id, name: s.group,
    x: 90 + (i % 4) * 210, y: 130 + Math.floor(i / 4) * 190, width: 120, height: 110,
    fill: '#e8f0fe', stroke: '#1a73e8', strokeWidth: 2, cornerRadius: 8,
    ...(side === 'a' ? s.a : s.b),
    ...(side === 'b' ? { transitions: { [s.group]: 'ease' as EasingType } } : {}),
  });

  const textStyle = (over: Partial<TextElement['style']>) => ({ ...createTextElement().style, fontSize: 28, ...over });

  return assemble('example-animation', 'Animation Highlights', [
    {
      meta: { notes: 'Slides are keyframes: an element keeps its id across slides and playback interpolates between its states.' },
      els: [
        heading('anim-title', 'Animation highlights'),
        createTextElement({
          id: 'anim-lede',
          text: 'Each following slide pair demonstrates one family of transitions. Present this deck to watch them run.',
          x: 48, y: 110, width: SLIDE_WIDTH - 96, height: 80, textSizing: 'user-width',
          style: textStyle({ fontSize: 20, color: '#5f6368' }),
        }),
      ],
    },
    // Scalar property groups: same elements, different values, eased.
    {
      meta: { notes: 'Eight scalar transition groups, all on `ease`.' },
      els: [heading('scalars-title', 'Scalar properties — from'), ...scalars.map((s, i) => scalarShape(s, 'a', i))],
    },
    {
      meta: { notes: 'The transition is stored on the target keyframe.' },
      els: [heading('scalars-title', 'Scalar properties — to'), ...scalars.map((s, i) => scalarShape(s, 'b', i))],
    },
    // Visibility easings.
    {
      meta: { notes: 'Nothing is visible yet: every element below is hidden on this keyframe.' },
      els: [
        heading('vis-title', 'Visibility easings — before'),
        ...VISIBILITY.map((easing, i) => visibilityDemo(easing, grid5[i], false)),
        ...VISIBILITY.map((easing, i) => caption(`vis-${easing}-cap`, easing, grid5[i].x, grid5[i].y + grid5[i].h + 10, grid5[i].w)),
      ],
    },
    {
      meta: { notes: 'Each shape appears with its own visibility easing. `create` traces the outline; `extend` grows the path along its own route.' },
      els: [
        heading('vis-title', 'Visibility easings — after'),
        ...VISIBILITY.map((easing, i) => visibilityDemo(easing, grid5[i], true)),
        ...VISIBILITY.map((easing, i) => caption(`vis-${easing}-cap`, easing, grid5[i].x, grid5[i].y + grid5[i].h + 10, grid5[i].w)),
      ],
    },
    // controlPoints + arrowhead groups.
    {
      meta: { notes: 'controlPoints interpolates the vertex list; startArrow/endArrow fade heads in and out.' },
      els: [
        heading('cp-title', 'Control points & arrowheads — from'),
        createShapeElement('path', {
          id: 'cp-path', name: 'morphing path', x: 120, y: 160, width: 700, height: 240,
          points: [0, 240, 175, 60, 350, 240, 525, 60, 700, 240], curve: 'smooth',
          stroke: '#9334e6', strokeWidth: 4, fill: '', startHead: 'none', endHead: 'none',
        }),
      ],
    },
    {
      meta: { notes: 'Same element, different vertices and heads.' },
      els: [
        heading('cp-title', 'Control points & arrowheads — to'),
        createShapeElement('path', {
          id: 'cp-path', name: 'morphing path', x: 120, y: 160, width: 700, height: 240,
          points: [0, 60, 175, 240, 350, 60, 525, 240, 700, 60], curve: 'smooth',
          stroke: '#9334e6', strokeWidth: 4, fill: '',
          startHead: 'circle', endHead: 'triangle',
          transitions: { controlPoints: 'ease', startArrow: 'linear', endArrow: 'linear' },
        }),
      ],
    },
    // Crop easings (image). Four images, each with a different crop easing.
    {
      meta: { notes: 'Four copies of the same source image, fully framed.' },
      els: [
        heading('crop-title', 'Crop easings — from'),
        ...CROP.map((easing, i) => img(`crop-${easing}`, {
          name: easing, x: 60 + i * 225, y: 150, width: 200, height: 150,
          cropX: 0, cropY: 0, cropWidth: TEX_W, cropHeight: TEX_H,
        })),
        ...CROP.map((easing, i) => caption(`crop-${easing}-cap`, easing, 60 + i * 225, 320, 200)),
      ],
    },
    {
      meta: { notes: 'Each crop tightens onto a different cell of the grid, with a different crop easing.' },
      els: [
        heading('crop-title', 'Crop easings — to'),
        ...CROP.map((easing, i) => img(`crop-${easing}`, {
          name: easing, x: 60 + i * 225, y: 150, width: 200, height: 150,
          cropX: 40 + i * 20, cropY: 40, cropWidth: 120, cropHeight: 90,
          transitions: { crop: easing },
        })),
        ...CROP.map((easing, i) => caption(`crop-${easing}-cap`, easing, 60 + i * 225, 320, 200)),
      ],
    },
    // Resource swap easings.
    {
      meta: { notes: 'resource transitions cross-fade between two different images on the same element.' },
      els: [
        heading('res-title', 'Resource swap — from'),
        img('res-dissolve', { name: 'dissolve', x: 110, y: 160, width: 300, height: 225 }),
        img('res-fadeinout', { name: 'fadeinout', x: 540, y: 160, width: 300, height: 225 }),
        caption('res-dissolve-cap', 'dissolve', 110, 400, 300),
        caption('res-fadeinout-cap', 'fadeinout', 540, 400, 300),
      ],
    },
    {
      meta: { notes: '`dissolve` cross-fades; `fadeinout` fades out to nothing and back in.' },
      els: [
        heading('res-title', 'Resource swap — to'),
        createImageElement('res-target', TEX_W, TEX_H, {
          id: 'res-dissolve', name: 'dissolve', x: 110, y: 160, width: 300, height: 225,
          transitions: { resource: 'dissolve' },
        }),
        createImageElement('res-target', TEX_W, TEX_H, {
          id: 'res-fadeinout', name: 'fadeinout', x: 540, y: 160, width: 300, height: 225,
          transitions: { resource: 'fadeinout' },
        }),
        caption('res-dissolve-cap', 'dissolve', 110, 400, 300),
        caption('res-fadeinout-cap', 'fadeinout', 540, 400, 300),
      ],
    },
  ], [resource('res-grid', 'grid.png', GRID), resource('res-target', 'target.png', TARGET)]);
}

function visibilityDemo(easing: EasingType, c: { x: number; y: number; w: number; h: number }, visible: boolean): SlideElement {
  const common = {
    id: `vis-${easing}`, name: easing, x: c.x, y: c.y, width: c.w, height: c.h,
    visible, fill: '#e6f4ea', stroke: '#188038', strokeWidth: 2.5,
    ...(visible ? { transitions: { visibility: easing } } : {}),
  };
  // `extend` only has a route to grow along on a path shape with >= 4 points.
  if (easing === 'extend') {
    return createShapeElement('path', {
      ...common, fill: '',
      points: [0, c.h, c.w * 0.3, c.h * 0.2, c.w * 0.65, c.h * 0.85, c.w, 0],
      curve: 'smooth', endHead: 'triangle',
    });
  }
  return createShapeElement(easing === 'iris' ? 'ellipse' : 'rect', common);
}

// ── 03 · text ───────────────────────────────────────────────────────────────

const CONTENT: EasingType[] = ['const', 'dissolve', 'typewriter', 'write', 'fadebyglyph'];

function textDeck(): Presentation {
  const body = (over: Partial<TextElement['style']>) => ({ ...createTextElement().style, ...over });

  const contentRow = (easing: EasingType, i: number, text: string, extra?: Partial<TextElement>) => createTextElement({
    id: `content-${easing}`, name: easing, text,
    x: 260, y: 120 + i * 68, width: 620, height: 48, textSizing: 'user-width',
    style: body({ fontSize: 26, color: '#202124' }), ...extra,
  });

  return assemble('example-text', 'Text & Math', [
    {
      meta: { notes: 'Content easings reveal a text change. `write` traces the glyph outlines; `typewriter` reveals whole characters; `fadebyglyph` staggers a per-glyph fade.' },
      els: [
        heading('text-title', 'Content easings — before'),
        ...CONTENT.map((easing, i) => contentRow(easing, i, 'The quick brown fox')),
        ...CONTENT.map((easing, i) => caption(`content-${easing}-cap`, easing, 60, 128 + i * 68, 180)),
      ],
    },
    {
      meta: { notes: 'The same five elements with new text and a content transition each. `write` and `typewriter` also take an `undoFirst` option.' },
      els: [
        heading('text-title', 'Content easings — after'),
        ...CONTENT.map((easing, i) => contentRow(easing, i, 'jumps over the lazy dog', {
          transitions: {
            content: easing,
            ...(easing === 'write' ? { contentOptions: { write: { undoFirst: true } } } : {}),
            ...(easing === 'typewriter' ? { contentOptions: { typewriter: { undoFirst: false } } } : {}),
          },
        })),
        ...CONTENT.map((easing, i) => caption(`content-${easing}-cap`, easing, 60, 128 + i * 68, 180)),
      ],
    },
    {
      meta: { notes: 'Text style groups animate like any other property: fontSize, color and lineHeight each have their own transition.' },
      els: [
        heading('style-title', 'Text style transitions — from'),
        createTextElement({
          id: 'style-demo', name: 'styled paragraph',
          text: 'Slides are keyframes, and every property can carry its own easing.',
          x: 100, y: 150, width: 760, height: 200, textSizing: 'user-width',
          style: body({ fontSize: 20, color: '#5f6368', lineHeight: 1.2 }),
        }),
      ],
    },
    {
      meta: { notes: 'fontSize, color and lineHeight interpolate independently.' },
      els: [
        heading('style-title', 'Text style transitions — to'),
        createTextElement({
          id: 'style-demo', name: 'styled paragraph',
          text: 'Slides are keyframes, and every property can carry its own easing.',
          x: 100, y: 150, width: 760, height: 200, textSizing: 'user-width',
          style: body({ fontSize: 38, color: '#c5221f', lineHeight: 1.9 }),
          transitions: { fontSize: 'ease', color: 'linear', lineHeight: 'ease' },
        }),
      ],
    },
    {
      meta: { notes: 'LaTeX between $$ delimiters is typeset through the MathJax pipeline and rendered as outlines, so it animates and exports like any other text.' },
      els: [
        heading('math-title', 'Mathematical text'),
        createTextElement({
          id: 'math-inline', name: 'inline math',
          text: 'A Gaussian process prior $$p(f) = \\mathcal{GP}(m, k)$$ over the implicit surface.',
          x: 80, y: 130, width: 800, height: 60, textSizing: 'user-width',
          style: body({ fontSize: 24 }),
        }),
        createTextElement({
          id: 'math-display', name: 'display math',
          text: '$$\\int_{\\partial\\Omega} \\nabla f \\cdot \\mathbf{n}\\, dS = \\int_\\Omega \\Delta f\\, dV$$',
          x: 80, y: 220, width: 800, height: 90, textSizing: 'user-width',
          style: body({ fontSize: 30, align: 'center' }),
        }),
        createTextElement({
          id: 'math-written', name: 'written math',
          text: '$$e^{i\\pi} + 1 = 0$$',
          x: 80, y: 350, width: 800, height: 80, textSizing: 'user-width',
          style: body({ fontSize: 34, align: 'center', color: '#1a73e8' }),
          transitions: { visibility: 'write' },
        }),
        caption('math-written-cap', 'revealed with the `write` easing', 80, 440, 800),
      ],
    },
    {
      meta: { notes: 'Bound text lives inside a container element via containerId, and moves and resizes with it. Both layout modes are shown.' },
      els: [
        heading('bound-title', 'Bound text'),
        createShapeElement('rect', {
          id: 'bound-box', name: 'labelled box', x: 90, y: 150, width: 320, height: 180,
          fill: '#e8f0fe', stroke: '#1a73e8', strokeWidth: 2, cornerRadius: 12,
        }),
        createTextElement({
          id: 'bound-box-label', name: 'box label', containerId: 'bound-box',
          text: 'Text bound to a shape', boundTextLayout: 'padded',
          x: 106, y: 220, width: 288, height: 40, textSizing: 'auto-content',
          style: body({ fontSize: 22, align: 'center', verticalAlign: 'middle' }),
        }),
        createShapeElement('path', {
          id: 'bound-arrow', name: 'labelled arrow', x: 520, y: 180, width: 340, height: 120,
          points: [0, 120, 340, 0], curve: 'linear', stroke: '#188038', strokeWidth: 3,
          fill: '', endHead: 'triangle',
        }),
        createTextElement({
          id: 'bound-arrow-label', name: 'arrow label', containerId: 'bound-arrow',
          text: 'on an arrow', boundTextLayout: 'measured',
          x: 620, y: 222, width: 140, height: 28, textSizing: 'auto-content',
          style: body({ fontSize: 18, align: 'center' }),
        }),
        caption('bound-cap', 'containerId keeps the label attached through moves, resizes and keyframes', 90, 400, 770),
      ],
    },
  ]);
}

// ── 04 · structure: groups, morphs, slide groups ────────────────────────────

function structureDeck(): Presentation {
  const member = (id: string, shapeType: ShapeType, x: number, over?: Partial<SlideElement>) =>
    createShapeElement(shapeType, {
      id, name: id, x, y: 180, width: 140, height: 140,
      fill: '#fef7e0', stroke: '#f9ab00', strokeWidth: 2,
      objectGroupIds: ['grp-trio'], ...over,
    });

  return assemble('example-structure', 'Groups, Morphs & Slide Groups', [
    {
      meta: {
        notes: 'Three shapes share an objectGroupIds entry, so selecting one selects the group. Nested groups are supported by appending further ids.',
        background: { type: 'solid', color: '#fafafa' },
      },
      els: [
        heading('grp-title', 'Object groups'),
        member('grp-a', 'rect', 120),
        member('grp-b', 'ellipse', 300),
        member('grp-c', 'triangle', 480),
        caption('grp-cap', 'one group, three members — objectGroupIds: ["grp-trio"]', 120, 350, 500),
      ],
    },
    {
      meta: {
        notes: 'The group moves and scales as a unit; the transition is per-member, so each one can still carry its own easing.',
        background: { type: 'solid', color: '#fafafa' },
      },
      els: [
        heading('grp-title', 'Object groups'),
        member('grp-a', 'rect', 300, { y: 250, transitions: { position: 'ease', rotation: 'ease' }, rotation: 20 }),
        member('grp-b', 'ellipse', 460, { y: 250, transitions: { position: 'ease', rotation: 'ease' }, rotation: 20 }),
        member('grp-c', 'triangle', 620, { y: 250, transitions: { position: 'ease', rotation: 'ease' }, rotation: 20 }),
        caption('grp-cap', 'one group, three members — objectGroupIds: ["grp-trio"]', 120, 350, 500),
      ],
    },
    {
      meta: { notes: 'A shape and an image sharing a cropGroupId: the shape becomes the crop boundary for the image.' },
      els: [
        heading('gc-title', 'Group crop'),
        createImageElement('res-grid', TEX_W, TEX_H, {
          id: 'gc-image', name: 'cropped image', x: 300, y: 140, width: 360, height: 270,
          objectGroupIds: ['grp-crop'], cropGroupId: 'grp-crop',
        }),
        createShapeElement('ellipse', {
          id: 'gc-mask', name: 'crop boundary', x: 340, y: 160, width: 280, height: 230,
          fill: '', stroke: '#1a73e8', strokeWidth: 2,
          objectGroupIds: ['grp-crop'], cropGroupId: 'grp-crop',
        }),
        caption('gc-cap', 'cropGroupId — the ellipse clips the image', 300, 430, 360),
      ],
    },
    {
      meta: { notes: 'Morph animates between two different element types. The `morph` group controls the geometry correspondence; position and size keep their own easings.' },
      els: [
        heading('morph-title', 'Morph — from'),
        createShapeElement('star', {
          id: 'morph-geo', name: 'morphing shape', x: 180, y: 170, width: 220, height: 220,
          fill: '#e8f0fe', stroke: '#1a73e8', strokeWidth: 2,
        }),
        createTextElement({
          id: 'morph-text', name: 'morphing text', text: 'shape',
          x: 560, y: 230, width: 240, height: 90, textSizing: 'auto-content',
          style: { ...createTextElement().style, fontSize: 64, color: '#9334e6', align: 'center' },
        }),
      ],
    },
    {
      meta: { notes: 'star → ellipse is a shapeType morph; text → shape is a cross-type morph via the `morph` easing.' },
      els: [
        heading('morph-title', 'Morph — to'),
        createShapeElement('ellipse', {
          id: 'morph-geo', name: 'morphing shape', x: 180, y: 170, width: 220, height: 220,
          fill: '#fce8e6', stroke: '#c5221f', strokeWidth: 2,
          transitions: { morph: 'ease', controlPoints: 'ease', fill: 'linear', stroke: 'linear' },
        }),
        createShapeElement('triangle', {
          id: 'morph-text', name: 'morphing text', x: 560, y: 190, width: 240, height: 200,
          fill: '#f3e8fd', stroke: '#9334e6', strokeWidth: 2,
          transitions: { morph: 'linear' },
        }),
      ],
    },
    {
      meta: {
        notes: 'These last three slides share a groupId, so presenting them runs the group as a timed chain: each slide holds for its autoAdvanceDelay, then advances itself.',
        groupId: 'chain-demo', autoAdvanceDelay: 1.5,
        background: { type: 'gradient', from: '#e8f0fe', to: '#ffffff', angle: 160 },
      },
      els: [
        heading('chain-title', 'Slide groups — timed chain 1 / 3'),
        createShapeElement('dot', {
          id: 'chain-dot-1', name: 'step 1', x: 300, y: 260, width: 24, height: 24,
          fill: '#1a73e8', stroke: '#1a73e8', strokeWidth: 2,
        }),
        caption('chain-cap', 'groupId: "chain-demo", autoAdvanceDelay: 1.5s', 240, 380, 480),
      ],
    },
    {
      meta: {
        notes: 'Second link in the chain.',
        groupId: 'chain-demo', autoAdvanceDelay: 1.5,
        background: { type: 'gradient', from: '#e6f4ea', to: '#ffffff', angle: 160 },
      },
      els: [
        heading('chain-title', 'Slide groups — timed chain 2 / 3'),
        createShapeElement('dot', {
          id: 'chain-dot-1', name: 'step 1', x: 460, y: 260, width: 24, height: 24,
          fill: '#188038', stroke: '#188038', strokeWidth: 2,
          transitions: { position: 'ease', fill: 'linear' },
        }),
        caption('chain-cap', 'groupId: "chain-demo", autoAdvanceDelay: 1.5s', 240, 380, 480),
      ],
    },
    {
      meta: {
        notes: 'Last link. A hidden slide follows, to show that hidden slides are skipped in both the chain and manual navigation.',
        groupId: 'chain-demo', autoAdvanceDelay: 1.5,
        background: { type: 'gradient', from: '#fef7e0', to: '#ffffff', angle: 160 },
      },
      els: [
        heading('chain-title', 'Slide groups — timed chain 3 / 3'),
        createShapeElement('dot', {
          id: 'chain-dot-1', name: 'step 1', x: 620, y: 260, width: 24, height: 24,
          fill: '#f9ab00', stroke: '#f9ab00', strokeWidth: 2,
          transitions: { position: 'ease', fill: 'linear' },
        }),
        caption('chain-cap', 'groupId: "chain-demo", autoAdvanceDelay: 1.5s', 240, 380, 480),
      ],
    },
    {
      meta: { notes: 'This slide is hidden: it stays in the deck and in the object timeline but is skipped during playback.', hidden: true },
      els: [
        heading('hidden-title', 'A hidden slide'),
        caption('hidden-cap', 'hidden: true — skipped in playback, still editable', 240, 260, 480),
      ],
    },
  ], [resource('res-grid', 'grid.png', GRID)]);
}

// ── write them out ──────────────────────────────────────────────────────────

export const EXAMPLES: Array<{ file: string; deck: Presentation }> = [
  { file: '01-shapes-and-paths.json', deck: shapesDeck() },
  { file: '02-animation-highlights.json', deck: animationDeck() },
  { file: '03-text-and-math.json', deck: textDeck() },
  { file: '04-groups-and-morphs.json', deck: structureDeck() },
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const { file, deck } of EXAMPLES) {
    writeFileSync(join(OUT, file), `${JSON.stringify(deck, null, 2)}\n`);
    const slides = deck.slideOrder.length;
    const els = deck.slideOrder.reduce((n, id) => n + Object.keys(deck.slides[id].elements).length, 0);
    console.log(`${file.padEnd(32)} ${String(slides).padStart(2)} slides, ${String(els).padStart(3)} elements`);
  }
}
