import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPresentation } from '../src/utils/model/currentPresentation';
import { interpolateWithVisibility } from '../src/utils/animation/interpolation';
import type { ImageElement, Presentation, ShapeElement, SlideElement } from '../src/types/presentation';

/**
 * Regression deck: a real 53-slide talk ("GPIS", 1330 elements, 134 objects)
 * exported from the editor on 2026-11-05. Image and video pixels are replaced
 * with 1x1 placeholders — `originalWidth`/`originalHeight` are kept verbatim,
 * so every coordinate, crop rect and animation in the deck is unchanged.
 *
 * **The fixture is deliberately not in git** (`.gitignore`): it is the content
 * of an unpublished talk and this repo is public. The whole suite therefore
 * skips when the file is absent — a fresh clone is green without it, and the
 * check only runs where the deck exists. To restore it, re-export the deck and
 * rebuild the fixture (strip resource `src` to a 1x1 PNG, set
 * `placeholder: true`, drop `thumbnailDataUrl`/`poster`/`previewDataUrl`, and
 * keep `originalWidth`/`originalHeight` untouched).
 *
 * This is the broadest "did I break the data model" check in the suite. It
 * exercises combinations no hand-written fixture covers: bezier paths with
 * persisted tangents, smooth curves, `write` content reveals, `cropfade`
 * transitions, nested object groups, group crops, and 976 per-slide-hidden
 * elements (the keyframe model's normal state).
 *
 * If the schema changes, this test fails first. Re-export the deck from the
 * editor and rebuild the fixture rather than loosening the assertions — a
 * fixture that no longer round-trips is the signal, not the problem.
 */
const FIXTURE = join(__dirname, 'fixtures', 'gpis-53-slides.json');
const present = existsSync(FIXTURE);

// Non-null only when `present`; every use is inside the skipped-when-absent
// describe block, so the assertion never runs against a missing fixture.
const deck = (present
  ? JSON.parse(readFileSync(FIXTURE, 'utf8'))
  : null) as Presentation;

const slides = () => deck.slideOrder.map((id) => deck.slides[id]);
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

describe.skipIf(!present)('GPIS regression deck', () => {
  it('is valid under the current schema', () => {
    expect(() => assertPresentation(structuredClone(deck))).not.toThrow();
  });

  it('has the shape we recorded it with', () => {
    expect(deck.slideOrder).toHaveLength(53);
    expect(Object.keys(deck.objects)).toHaveLength(134);
    expect(slides().reduce((n, s) => n + Object.keys(s.elements).length, 0)).toBe(1330);
    expect(Object.keys(deck.resources)).toHaveLength(24);
  });

  it('covers the feature combinations it is here to protect', () => {
    const all = slides().flatMap((s) => Object.values(s.elements));
    const shapes = all.filter((el): el is ShapeElement => el.type === 'shape');
    const curves = new Set(shapes.map((s) => s.curve).filter(Boolean));
    const easings = new Set(
      all.flatMap((el) => Object.values(el.transitions ?? {}).filter((v) => typeof v === 'string')),
    );

    expect(curves).toContain('bezier');
    expect(curves).toContain('smooth');
    expect(shapes.some((s) => s.tangents?.length)).toBe(true);
    expect(easings).toContain('write');
    expect(easings).toContain('cropfade');
    expect(all.some((el) => el.objectGroupIds?.length)).toBe(true);
    expect(all.some((el) => el.cropGroupId)).toBe(true);
    expect(all.some((el) => el.visible === false)).toBe(true);
  });

  it('keeps elements, element order and the object registry consistent', () => {
    for (const slide of slides()) {
      const ids = Object.keys(slide.elements);
      expect(new Set(slide.elementOrder).size, `${slide.id} has duplicate order entries`)
        .toBe(slide.elementOrder.length);
      expect([...slide.elementOrder].sort(), `${slide.id} order/elements mismatch`)
        .toEqual([...ids].sort());
      for (const [id, el] of Object.entries(slide.elements)) {
        expect(el.id, `${slide.id}/${id} embedded id disagrees with its key`).toBe(id);
      }
    }
    // Every registry entry is backed by at least one element somewhere, and
    // every element is registered. Both directions matter: the first catches
    // the "ghost object" class, the second catches unregistered elements.
    const seen = new Set(slides().flatMap((s) => Object.keys(s.elements)));
    expect([...Object.keys(deck.objects)].filter((id) => !seen.has(id))).toEqual([]);
    expect([...seen].filter((id) => !deck.objects[id])).toEqual([]);
  });

  it('resolves every resource and binding reference', () => {
    for (const slide of slides()) {
      for (const el of Object.values(slide.elements)) {
        if (el.type === 'image') {
          expect(deck.resources[(el as ImageElement).resourceId], `${slide.id}/${el.id}`)
            .toBeDefined();
        }
        if (el.type === 'shape') {
          for (const end of ['startBinding', 'endBinding'] as const) {
            const binding = (el as ShapeElement)[end];
            if (binding) {
              expect(slide.elements[binding.elementId], `${slide.id}/${el.id}.${end} dangles`)
                .toBeDefined();
            }
          }
        }
        if (el.containerId) {
          expect(slide.elements[el.containerId], `${slide.id}/${el.id}.containerId dangles`)
            .toBeDefined();
        }
      }
    }
  });

  it('has finite geometry on every element of every slide', () => {
    for (const slide of slides()) {
      for (const el of Object.values(slide.elements)) {
        const where = `${slide.id}/${el.id}`;
        for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const) {
          expect(finite(el[key]), `${where}.${key} = ${el[key]}`).toBe(true);
        }
        if (el.type === 'shape') {
          const shape = el as ShapeElement;
          expect((shape.points ?? []).every(finite), `${where}.points`).toBe(true);
          expect((shape.tangents ?? []).flat().every(finite), `${where}.tangents`).toBe(true);
        }
        if (el.type === 'image') {
          const image = el as ImageElement;
          for (const key of ['cropX', 'cropY', 'cropWidth', 'cropHeight'] as const) {
            expect(finite(image[key]), `${where}.${key} = ${image[key]}`).toBe(true);
          }
          expect(image.cropWidth > 0 && image.cropHeight > 0, `${where} has an empty crop`).toBe(true);
        }
      }
    }
  });

  // The real playback check: walk every keyframe pair the way the presenter
  // does and assert the interpolator never emits NaN. This is what catches an
  // easing or morph change that only misbehaves on geometry a hand-written
  // fixture doesn't have.
  it('interpolates every adjacent keyframe pair without producing NaN', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1];
    let interpolated = 0;

    for (let i = 0; i < deck.slideOrder.length - 1; i++) {
      const a = deck.slides[deck.slideOrder[i]];
      const b = deck.slides[deck.slideOrder[i + 1]];
      const ids = new Set([...Object.keys(a.elements), ...Object.keys(b.elements)]);

      for (const id of ids) {
        for (const t of samples) {
          for (const forward of [true, false]) {
            const where = `${a.id}->${b.id}/${id} t=${t} ${forward ? 'fwd' : 'back'}`;
            let frame: SlideElement | null;
            expect(() => {
              frame = interpolateWithVisibility(a.elements[id], b.elements[id], t, forward);
            }, where).not.toThrow();
            frame = interpolateWithVisibility(a.elements[id], b.elements[id], t, forward);
            if (!frame) continue;
            interpolated++;
            for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const) {
              expect(finite(frame[key]), `${where} .${key} = ${frame[key]}`).toBe(true);
            }
            if (frame.type === 'shape') {
              expect(((frame as ShapeElement).points ?? []).every(finite), `${where} .points`)
                .toBe(true);
            }
            if (frame.type === 'image') {
              const image = frame as ImageElement;
              for (const key of ['cropX', 'cropY', 'cropWidth', 'cropHeight'] as const) {
                expect(finite(image[key]), `${where} .${key} = ${image[key]}`).toBe(true);
              }
            }
          }
        }
      }
    }

    // Guards against the assertions above silently passing on an empty walk.
    // The deck yields ~3900 non-null frames at five samples per direction.
    expect(interpolated).toBeGreaterThan(3000);
  });
});
