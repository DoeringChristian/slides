import { describe, expect, test } from 'vitest';
import { migratePresentation, migrateElement } from './migrations';
import type {
  Presentation,
  SlideElement,
  ShapeElement,
  TextElement,
} from '../types/presentation';

// =============================================================================
// Fixtures — legacy shapeType values ('line' | 'arrow' | 'polygon' | 'bspline')
// are no longer part of the ShapeType union, so legacy elements are built via
// a cast, exactly like data deserialised from an old deck would arrive.
// =============================================================================

function legacyShape(overrides: Record<string, unknown>): ShapeElement {
  return {
    id: 'el',
    type: 'shape',
    shapeType: 'rect',
    x: 10, y: 20, width: 100, height: 50,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2, cornerRadius: 0,
    ...overrides,
  } as unknown as ShapeElement;
}

function makeText(): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    x: 0, y: 0, width: 100, height: 40,
    rotation: 0, opacity: 1, locked: false, visible: true,
    text: 'hello',
    style: {
      fontFamily: 'Inter', fontSize: 24,
      fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
      color: '#000000', align: 'left', verticalAlign: 'top', lineHeight: 1.2,
    },
  };
}

function makeDeck(elements: Record<string, SlideElement>): Presentation {
  return {
    id: 'deck',
    title: 'Legacy deck',
    width: 1920,
    height: 1080,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    theme: {
      name: 'Default',
      colors: {
        primary: '#3b82f6', secondary: '#1e40af', accent: '#f97316',
        background: '#ffffff', text: '#111111', heading: '#000000',
      },
      fonts: { heading: 'Inter', body: 'system-ui' },
    },
    objects: {},
    resources: {
      'res-1': {
        id: 'res-1', name: 'pic.png', type: 'image',
        src: 'data:image/png;base64,AAAA', originalWidth: 10, originalHeight: 10,
      },
    },
    templates: {},
    slides: {
      's1': {
        id: 's1',
        elements,
        elementOrder: Object.keys(elements),
        background: { type: 'solid', color: '#ffffff' },
        transition: { duration: 400 },
        notes: 'note text',
      },
    },
    slideOrder: ['s1'],
  };
}

// =============================================================================
// migrateElement — per-kind conversion
// =============================================================================

describe('migrateElement: legacy line', () => {
  test("'line' becomes an open linear path with no arrowheads", () => {
    const out = migrateElement(legacyShape({
      shapeType: 'line', points: [0, 0, 100, 0],
    })) as ShapeElement;
    expect(out.shapeType).toBe('path');
    expect(out.curve).toBe('linear');
    expect(out.closed).toBe(false);
    expect(out.startArrow).toBe(false);
    expect(out.endArrow).toBe(false);
    expect(out.points).toEqual([0, 0, 100, 0]);
  });

  test('existing arrow flags on a line are preserved, not overwritten', () => {
    const out = migrateElement(legacyShape({
      shapeType: 'line', points: [0, 0, 100, 0], startArrow: true,
    })) as ShapeElement;
    expect(out.startArrow).toBe(true);
    expect(out.endArrow).toBe(false);
  });
});

describe('migrateElement: legacy arrow', () => {
  test("'arrow' becomes an open linear path with endArrow defaulting to true", () => {
    const out = migrateElement(legacyShape({
      shapeType: 'arrow', points: [0, 0, 300, 50],
    })) as ShapeElement;
    expect(out.shapeType).toBe('path');
    expect(out.curve).toBe('linear');
    expect(out.closed).toBe(false);
    expect(out.startArrow).toBe(false);
    expect(out.endArrow).toBe(true); // the defining difference vs 'line'
    expect(out.points).toEqual([0, 0, 300, 50]);
  });

  test('an arrow that explicitly disabled its head keeps endArrow=false', () => {
    const out = migrateElement(legacyShape({
      shapeType: 'arrow', points: [0, 0, 300, 50], endArrow: false,
    })) as ShapeElement;
    expect(out.endArrow).toBe(false);
  });
});

describe('migrateElement: legacy polygon', () => {
  test("'polygon' with an explicit closed flag keeps it", () => {
    const out = migrateElement(legacyShape({
      shapeType: 'polygon', points: [0, 0, 100, 0, 50, 80], closed: true,
    })) as ShapeElement;
    expect(out.shapeType).toBe('path');
    expect(out.curve).toBe('linear');
    expect(out.closed).toBe(true);
    expect(out.points).toEqual([0, 0, 100, 0, 50, 80]);
  });

  // Pins CURRENT behaviour: `closed ?? false`. A shape named "polygon" is
  // arguably closed by definition, so a legacy polygon that never wrote a
  // `closed` field silently migrates to an OPEN path (renders without its
  // closing edge and loses its fill on open-path rendering rules).
  test("'polygon' without a closed flag currently migrates to an OPEN path", () => {
    const out = migrateElement(legacyShape({
      shapeType: 'polygon', points: [0, 0, 100, 0, 50, 80],
    })) as ShapeElement;
    expect(out.shapeType).toBe('path');
    expect(out.closed).toBe(false);
  });
  test.todo("suspected bug: should a legacy 'polygon' default to closed: true?");
});

describe('migrateElement: legacy bspline', () => {
  test('bsplineDegree 3 maps to bspline3 and the degree field is stripped', () => {
    const out = migrateElement(legacyShape({
      shapeType: 'bspline', points: [0, 0, 50, 100, 100, 0, 150, 100], bsplineDegree: 3,
    })) as ShapeElement & { bsplineDegree?: number };
    expect(out.shapeType).toBe('path');
    expect(out.curve).toBe('bspline3');
    expect(out.closed).toBe(false);
    expect('bsplineDegree' in out).toBe(false);
    expect(out.points).toEqual([0, 0, 50, 100, 100, 0, 150, 100]);
  });

  test('bsplineDegree 2 maps to bspline2', () => {
    const out = migrateElement(legacyShape({
      shapeType: 'bspline', points: [0, 0, 50, 100, 100, 0], bsplineDegree: 2,
    })) as ShapeElement;
    expect(out.curve).toBe('bspline2');
  });

  test('missing bsplineDegree defaults to cubic (bspline3)', () => {
    const out = migrateElement(legacyShape({
      shapeType: 'bspline', points: [0, 0, 50, 100, 100, 0],
    })) as ShapeElement;
    expect(out.curve).toBe('bspline3');
  });

  test('an existing curve field wins over the legacy degree', () => {
    const out = migrateElement(legacyShape({
      shapeType: 'bspline', points: [0, 0, 50, 100, 100, 0], bsplineDegree: 3, curve: 'bspline2',
    })) as ShapeElement;
    expect(out.curve).toBe('bspline2');
  });
});

describe('migrateElement: pass-through', () => {
  test('modern shapes are returned as the SAME object (no copy, no change)', () => {
    const rect = legacyShape({ shapeType: 'rect' });
    expect(migrateElement(rect)).toBe(rect);
    const path = legacyShape({ shapeType: 'path', points: [0, 0, 1, 1], curve: 'linear', closed: false });
    expect(migrateElement(path)).toBe(path);
  });

  test('non-shape elements are returned untouched', () => {
    const text = makeText();
    expect(migrateElement(text)).toBe(text);
  });

  test('migration preserves unrelated fields on a converted element', () => {
    const el = legacyShape({
      shapeType: 'arrow',
      points: [0, 0, 300, 50],
      id: 'my-arrow',
      rotation: 33,
      opacity: 0.4,
      strokeWidth: 7,
      transitions: { position: 'ease', visibility: 'create' },
      startBinding: { elementId: 'other', anchor: 'right' },
      endBinding: null,
    });
    const out = migrateElement(el) as ShapeElement;
    expect(out.id).toBe('my-arrow');
    expect(out.rotation).toBe(33);
    expect(out.opacity).toBe(0.4);
    expect(out.strokeWidth).toBe(7);
    expect(out.transitions).toEqual({ position: 'ease', visibility: 'create' });
    expect(out.startBinding).toEqual({ elementId: 'other', anchor: 'right' });
    expect(out.endBinding).toBeNull();
    expect(out.fill).toBe('#ff0000');
    expect(out.stroke).toBe('#0000ff');
  });
});

// =============================================================================
// migratePresentation — whole-deck behaviour
// =============================================================================

describe('migratePresentation', () => {
  const legacyDeck = () => makeDeck({
    'el-line': legacyShape({ id: 'el-line', shapeType: 'line', points: [0, 0, 100, 0] }),
    'el-arrow': legacyShape({ id: 'el-arrow', shapeType: 'arrow', points: [0, 0, 50, 50] }),
    'el-spline': legacyShape({ id: 'el-spline', shapeType: 'bspline', points: [0, 0, 10, 20, 20, 0], bsplineDegree: 2 }),
    'el-text': makeText(),
  });

  test('migrates every element on every slide', () => {
    const out = migratePresentation(legacyDeck());
    const els = out.slides['s1'].elements;
    expect((els['el-line'] as ShapeElement).shapeType).toBe('path');
    expect((els['el-arrow'] as ShapeElement).shapeType).toBe('path');
    expect((els['el-arrow'] as ShapeElement).endArrow).toBe(true);
    expect((els['el-spline'] as ShapeElement).curve).toBe('bspline2');
    expect(els['el-text']).toEqual(makeText());
  });

  test('is idempotent: migrate(migrate(x)) deep-equals migrate(x)', () => {
    const once = migratePresentation(legacyDeck());
    const twice = migratePresentation(once);
    expect(twice).toEqual(once);
  });

  test('does not mutate the input presentation', () => {
    const input = legacyDeck();
    const before = structuredClone(input);
    migratePresentation(input);
    expect(input).toEqual(before);
  });

  test('preserves deck-level fields and carries non-slide subtrees by reference', () => {
    const input = legacyDeck();
    const out = migratePresentation(input);
    expect(out.id).toBe('deck');
    expect(out.title).toBe('Legacy deck');
    expect(out.slideOrder).toEqual(['s1']);
    // Only `slides` is rebuilt; everything else is the same object.
    expect(out.resources).toBe(input.resources);
    expect(out.theme).toBe(input.theme);
    expect(out.templates).toBe(input.templates);
  });

  test('preserves slide-level fields (order, background, notes, transition)', () => {
    const out = migratePresentation(legacyDeck());
    const slide = out.slides['s1'];
    expect(slide.elementOrder).toEqual(['el-line', 'el-arrow', 'el-spline', 'el-text']);
    expect(slide.background).toEqual({ type: 'solid', color: '#ffffff' });
    expect(slide.notes).toBe('note text');
    expect(slide.transition).toEqual({ duration: 400 });
  });

  test('an already-migrated deck round-trips unchanged (deep equality)', () => {
    const modern = migratePresentation(legacyDeck());
    expect(migratePresentation(modern)).toEqual(modern);
  });
});
