import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EXAMPLES } from '../scripts/build-examples';
import { assertPresentation } from '../src/utils/model/currentPresentation';
import { interpolateWithVisibility } from '../src/utils/animation/interpolation';
import type {
  ArrowheadType, EasingType, FillStyle, ImageElement, PathCurve, Presentation,
  ShapeElement, ShapeType, StrokeStyle, TransitionGroup,
} from '../src/types/presentation';

/**
 * The example decks in `examples/` are the feature highlight reel: between
 * them they are supposed to demonstrate every easing, transition group, shape
 * type, arrowhead, curve mode and style the schema allows.
 *
 * Two gates here:
 *
 *  1. **Exhaustiveness, at compile time.** Each `ALL_*` list below is checked
 *     against its union with an `Exclude<>` assertion, so adding a value to
 *     e.g. `EasingType` without listing it is a type error.
 *  2. **Demonstration, at run time.** Every listed value must actually appear
 *     in one of the decks. So a new easing has to be demoed, not just named.
 *
 * Plus the usual structural checks, and a staleness gate: the committed JSON
 * must match what `scripts/build-examples.ts` produces today.
 */

/** Fails to compile when `List` does not cover all of `Union`. */
type Exhaustive<Union, List extends readonly Union[]> =
  Exclude<Union, List[number]> extends never ? true
    : ['missing from the list:', Exclude<Union, List[number]>];

const ALL_EASINGS = [
  'const', 'linear', 'ease', 'dissolve', 'fadeinout', 'typewriter', 'write',
  'create', 'extend', 'wipe', 'slidein', 'grow', 'iris',
  'fadebyglyph',
] as const satisfies readonly EasingType[];

const ALL_GROUPS = [
  'position', 'size', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth',
  'cornerRadius', 'fontSize', 'color', 'lineHeight', 'resource',
  'visibility', 'content', 'controlPoints', 'startArrow', 'endArrow', 'morph',
] as const satisfies readonly TransitionGroup[];

const ALL_SHAPES = [
  'dot', 'rect', 'ellipse', 'triangle', 'star', 'path', 'vector',
] as const satisfies readonly ShapeType[];

const ALL_HEADS = [
  'none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle',
  'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one',
  'crowfoot-many', 'crowfoot-one-many',
] as const satisfies readonly ArrowheadType[];

const ALL_CURVES = ['linear', 'smooth', 'bspline2', 'bspline3', 'bezier'] as const satisfies readonly PathCurve[];
const ALL_STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const satisfies readonly StrokeStyle[];
const ALL_FILL_STYLES = ['solid', 'hachure', 'crosshatch', 'linear', 'radial'] as const satisfies readonly FillStyle[];

// Compile-time exhaustiveness. Each must be `true`; a missing union member
// turns the type into a tuple and fails `tsc -b`.
const _easings: Exhaustive<EasingType, typeof ALL_EASINGS> = true;
const _groups: Exhaustive<TransitionGroup, typeof ALL_GROUPS> = true;
const _shapes: Exhaustive<ShapeType, typeof ALL_SHAPES> = true;
const _heads: Exhaustive<ArrowheadType, typeof ALL_HEADS> = true;
const _curves: Exhaustive<PathCurve, typeof ALL_CURVES> = true;
const _strokes: Exhaustive<StrokeStyle, typeof ALL_STROKE_STYLES> = true;
const _fills: Exhaustive<FillStyle, typeof ALL_FILL_STYLES> = true;
void [_easings, _groups, _shapes, _heads, _curves, _strokes, _fills];

const decks = EXAMPLES.map(({ file, deck }) => ({ file, deck }));
const everyElement = () => decks.flatMap(({ deck }) =>
  deck.slideOrder.flatMap((id) => Object.values(deck.slides[id].elements)));
const everySlide = () => decks.flatMap(({ deck }) => deck.slideOrder.map((id) => deck.slides[id]));

describe('example decks', () => {
  it.each(decks)('$file is valid under the current schema', ({ deck }) => {
    const { media: _media, ...presentation } = deck;
    expect(() => assertPresentation(structuredClone(presentation) as unknown)).not.toThrow();
  });

  it.each(decks)('$file carries exactly the media its resources reference', ({ deck }) => {
    const media = deck.media ?? {};
    for (const r of Object.values(deck.resources)) {
      const entry = media[r.hash];
      expect(entry, `media of ${r.id}`).toBeDefined();
      const bytes = Buffer.from(entry.data, 'base64');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(r.hash);
      expect(bytes.length).toBe(r.size);
    }
    expect(Object.keys(media).sort()).toEqual([...new Set(Object.values(deck.resources).map(r => r.hash))].sort());
  });

  it.each(decks)('$file matches the committed file', ({ file, deck }) => {
    const onDisk = readFileSync(join(__dirname, '..', 'examples', file), 'utf8');
    expect(onDisk, `examples/${file} is stale — run \`npm run build:examples\``)
      .toBe(`${JSON.stringify(deck, null, 2)}\n`);
  });

  it.each(decks)('$file keeps elements, order and the object registry consistent', ({ deck }) => {
    for (const slideId of deck.slideOrder) {
      const slide = deck.slides[slideId];
      expect([...slide.elementOrder].sort()).toEqual([...Object.keys(slide.elements)].sort());
      expect(new Set(slide.elementOrder).size).toBe(slide.elementOrder.length);
      for (const [id, el] of Object.entries(slide.elements)) expect(el.id).toBe(id);
    }
    const seen = new Set(deck.slideOrder.flatMap((id) => Object.keys(deck.slides[id].elements)));
    expect([...Object.keys(deck.objects)].filter((id) => !seen.has(id))).toEqual([]);
    expect([...seen].filter((id) => !deck.objects[id])).toEqual([]);
  });

  it.each(decks)('$file resolves every resource and container reference', ({ deck }) => {
    for (const slideId of deck.slideOrder) {
      const slide = deck.slides[slideId];
      for (const el of Object.values(slide.elements)) {
        if (el.type === 'image') {
          expect(deck.resources[(el as ImageElement).resourceId!], `${slideId}/${el.id}`).toBeDefined();
        }
        if (el.containerId) expect(slide.elements[el.containerId], `${slideId}/${el.id}`).toBeDefined();
      }
    }
  });

  // ── the highlight-reel contract ──────────────────────────────────────────

  it('demonstrates every easing', () => {
    const used = new Set(everyElement().flatMap((el) =>
      Object.values(el.transitions ?? {}).filter((v): v is EasingType => typeof v === 'string')));
    expect([...new Set(ALL_EASINGS)].filter((e) => !used.has(e))).toEqual([]);
  });

  it('demonstrates every transition group', () => {
    const used = new Set(everyElement().flatMap((el) =>
      Object.entries(el.transitions ?? {})
        .filter(([, v]) => typeof v === 'string')
        .map(([g]) => g as TransitionGroup)));
    expect(ALL_GROUPS.filter((g) => !used.has(g))).toEqual([]);
  });

  it('demonstrates every shape type', () => {
    const used = new Set(everyElement()
      .filter((el): el is ShapeElement => el.type === 'shape')
      .map((el) => el.shapeType));
    expect(ALL_SHAPES.filter((s) => !used.has(s))).toEqual([]);
  });

  it('demonstrates every arrowhead, curve mode and style', () => {
    const shapes = everyElement().filter((el): el is ShapeElement => el.type === 'shape');
    const heads = new Set(shapes.flatMap((s) => [s.startHead, s.endHead]).filter(Boolean));
    const curves = new Set(shapes.map((s) => s.curve).filter(Boolean));
    const strokes = new Set(shapes.map((s) => s.strokeStyle ?? 'solid'));
    const fills = new Set(shapes.map((s) => s.fillStyle ?? 'solid'));

    expect(ALL_HEADS.filter((h) => !heads.has(h))).toEqual([]);
    expect(ALL_CURVES.filter((c) => !curves.has(c))).toEqual([]);
    expect(ALL_STROKE_STYLES.filter((s) => !strokes.has(s))).toEqual([]);
    expect(ALL_FILL_STYLES.filter((f) => !fills.has(f))).toEqual([]);
  });

  it('demonstrates the structural features that have no easing', () => {
    const els = everyElement();
    const slides = everySlide();

    expect(els.some((el) => el.objectGroupIds?.length), 'object groups').toBe(true);
    expect(els.some((el) => el.cropGroupId), 'group crop').toBe(true);
    expect(els.some((el) => el.containerId), 'bound text').toBe(true);
    expect(els.some((el) => (el as ShapeElement).tangents?.length), 'bezier tangents').toBe(true);
    expect(els.some((el) => el.type === 'text' && el.text.includes('$$')), 'LaTeX math').toBe(true);
    expect(els.some((el) => el.visible === false), 'per-keyframe hidden elements').toBe(true);
    expect(els.some((el) => el.rotation !== 0), 'rotation').toBe(true);

    expect(slides.some((s) => s.groupId), 'slide groups').toBe(true);
    expect(slides.some((s) => s.autoAdvanceDelay), 'auto-advance hold').toBe(true);
    expect(slides.some((s) => s.hidden), 'hidden slides').toBe(true);
    expect(slides.some((s) => s.background.type === 'gradient'), 'gradient background').toBe(true);
    expect(slides.every((s) => s.notes !== undefined), 'presenter notes').toBe(true);
  });

  it.each(decks)('$file interpolates every keyframe pair without producing NaN', ({ deck }) => {
    const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
    let frames = 0;

    for (let i = 0; i < deck.slideOrder.length - 1; i++) {
      const a = deck.slides[deck.slideOrder[i]];
      const b = deck.slides[deck.slideOrder[i + 1]];
      for (const id of new Set([...Object.keys(a.elements), ...Object.keys(b.elements)])) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          for (const forward of [true, false]) {
            const frame = interpolateWithVisibility(a.elements[id], b.elements[id], t, forward);
            if (!frame) continue;
            frames++;
            const where = `${a.id}->${b.id}/${id} t=${t} ${forward ? 'fwd' : 'back'}`;
            for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const) {
              expect(finite(frame[key]), `${where} .${key} = ${frame[key]}`).toBe(true);
            }
            if (frame.type === 'shape') {
              expect(((frame as ShapeElement).points ?? []).every(finite), `${where} .points`).toBe(true);
            }
          }
        }
      }
    }
    expect(frames).toBeGreaterThan(0);
  });
});

// Keeps the `Presentation` import meaningful to readers of the type above.
export type ExampleDeck = Presentation;
