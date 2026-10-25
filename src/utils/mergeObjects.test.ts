import { describe, expect, test } from 'vitest';
import {
  canMergeObjects,
  mergeObjectConflictSlideIds,
  mergeObjectInSlides,
} from './mergeObjects';
import type {
  GroupElement,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
  TextStyle,
} from '../types/presentation';

// =============================================================================
// Fixture helpers
// =============================================================================

const style: TextStyle = {
  fontFamily: 'Inter', fontSize: 32, fontWeight: 'normal', fontStyle: 'normal',
  textDecoration: 'none', color: '#222222', align: 'left', verticalAlign: 'top',
  lineHeight: 1.3,
};

function shape(id: string, overrides?: Partial<ShapeElement>): ShapeElement {
  return {
    id, type: 'shape', creationPreset: 'rect', shapeType: 'rect',
    x: 10, y: 20, width: 100, height: 50,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#3b82f6', stroke: '#1e40af', strokeWidth: 2, cornerRadius: 0,
    ...overrides,
  };
}

function text(id: string, overrides?: Partial<TextElement>): TextElement {
  return {
    id, type: 'text', textSizing: 'user-width', boundTextLayout: 'padded', text: `Text ${id}`,
    x: 0, y: 0, width: 200, height: 40,
    rotation: 0, opacity: 1, locked: false, visible: true,
    style: { ...style },
    ...overrides,
  };
}

function group(id: string): GroupElement {
  return {
    id, type: 'group', childIds: [],
    x: 0, y: 0, width: 10, height: 10,
    rotation: 0, opacity: 1, locked: false, visible: true,
  };
}

function slide(id: string, els: SlideElement[]): Slide {
  return {
    id,
    elements: Object.fromEntries(els.map((el) => [el.id, el])),
    elementOrder: els.map((el) => el.id),
    background: { type: 'solid', color: '#ffffff' },
    transition: { duration: 300 },
    notes: '',
  };
}

// =============================================================================
// mergeObjectInSlides
// =============================================================================

describe('mergeObjectInSlides', () => {
  test('disjoint slides: source moves under the target id, embedded id rewritten, z-position preserved', () => {
    const slides = {
      s1: slide('s1', [shape('other'), shape('src', { x: 999, fill: '#ff0000' }), shape('other2')]),
      s2: slide('s2', [shape('tgt', { x: 1 })]),
    };
    const { slides: out, droppedOnSlides } = mergeObjectInSlides(slides, 'tgt', 'src', ['s1', 's2']);

    expect(droppedOnSlides).toEqual([]);
    // Moved: former source keyframe now lives under the target id …
    expect(out.s1.elements['src']).toBeUndefined();
    const moved = out.s1.elements['tgt'] as ShapeElement;
    // … with the embedded id rewritten and all other props kept.
    expect(moved.id).toBe('tgt');
    expect(moved.x).toBe(999);
    expect(moved.fill).toBe('#ff0000');
    // elementOrder entry replaced IN PLACE (same index, not appended).
    expect(out.s1.elementOrder).toEqual(['other', 'tgt', 'other2']);
    // Target's own keyframe untouched.
    expect(out.s2.elements['tgt']).toBe(slides.s2.elements['tgt']);
    expect(out.s2.elementOrder).toEqual(['tgt']);
    // Input not mutated.
    expect(slides.s1.elements['src']).toBeDefined();
    expect(slides.s1.elementOrder).toEqual(['other', 'src', 'other2']);
  });

  test('conflict slide: target wins — source element + order entry dropped, slide id recorded', () => {
    const slides = {
      s1: slide('s1', [shape('src', { x: 500 }), shape('tgt', { x: 1 }), shape('other')]),
      s2: slide('s2', [shape('src', { x: 600 })]),
    };
    const { slides: out, droppedOnSlides } = mergeObjectInSlides(slides, 'tgt', 'src', ['s1', 's2']);

    // Conflict on s1: the target's element survives unchanged, source is gone.
    expect(droppedOnSlides).toEqual(['s1']);
    expect(out.s1.elements['src']).toBeUndefined();
    expect((out.s1.elements['tgt'] as ShapeElement).x).toBe(1);
    expect(out.s1.elementOrder).toEqual(['tgt', 'other']);
    // Non-conflict s2: source moved under the target id as usual.
    expect((out.s2.elements['tgt'] as ShapeElement).x).toBe(600);
    expect(out.s2.elementOrder).toEqual(['tgt']);
  });

  test('droppedOnSlides follows the given slideOrder', () => {
    const slides = {
      a: slide('a', [shape('src'), shape('tgt')]),
      b: slide('b', [shape('src'), shape('tgt')]),
    };
    expect(mergeObjectInSlides(slides, 'tgt', 'src', ['b', 'a']).droppedOnSlides).toEqual(['b', 'a']);
    expect(mergeObjectInSlides(slides, 'tgt', 'src', ['a', 'b']).droppedOnSlides).toEqual(['a', 'b']);
  });

  test('connector bindings pointing at the source are remapped deck-wide, other fields preserved', () => {
    const conn = shape('conn', {
      shapeType: 'path', points: [0, 0, 100, 0], curve: 'linear',
      startBinding: { elementId: 'src', mode: 'aim', fixedPoint: [.5, .5], gap: 2 },
      endBinding: { elementId: 'other', mode: 'pinned', fixedPoint: [0.5, 1] },
    });
    const slides = {
      s1: slide('s1', [shape('src'), shape('other'), conn]),
      s2: slide('s2', [shape('tgt')]),
    };
    const { slides: out } = mergeObjectInSlides(slides, 'tgt', 'src', ['s1', 's2']);

    const outConn = out.s1.elements['conn'] as ShapeElement;
    // Source binding re-points at the target; mode/focus/gap survive.
    expect(outConn.startBinding).toEqual({ elementId: 'tgt', mode: 'aim', fixedPoint: [.5, .5], gap: 2 });
    // Unrelated binding untouched (same reference).
    expect(outConn.endBinding).toBe(conn.endBinding);
  });

  test('bindings are remapped on conflict slides too (the connector follows the surviving target)', () => {
    const conn = shape('conn', {
      shapeType: 'path', points: [0, 0, 100, 0],
      startBinding: { elementId: 'src', mode: 'pinned', fixedPoint: [0, 0.5] },
      endBinding: null,
    });
    const slides = { s1: slide('s1', [shape('src'), shape('tgt'), conn]) };
    const { slides: out, droppedOnSlides } = mergeObjectInSlides(slides, 'tgt', 'src', ['s1']);

    expect(droppedOnSlides).toEqual(['s1']);
    const outConn = out.s1.elements['conn'] as ShapeElement;
    expect(outConn.startBinding?.elementId).toBe('tgt');
    expect(outConn.endBinding).toBeNull();
  });

  test('bound-text containerIds pointing at the source are remapped, including on conflict slides', () => {
    const slides = {
      s1: slide('s1', [shape('src'), shape('tgt'), text('lbl', { containerId: 'src' })]),
      s2: slide('s2', [shape('src'), text('lbl', { containerId: 'src' }), text('free')]),
    };
    const { slides: out } = mergeObjectInSlides(slides, 'tgt', 'src', ['s1', 's2']);

    // Conflict slide s1: source dropped, its former label re-points at the target.
    expect((out.s1.elements['lbl'] as TextElement).containerId).toBe('tgt');
    // Move slide s2: label follows the re-identified container.
    expect((out.s2.elements['lbl'] as TextElement).containerId).toBe('tgt');
    // Free-standing text untouched (same reference).
    expect(out.s2.elements['free']).toBe(slides.s2.elements['free']);
  });

  test('guard: source === target is a no-op returning the same slides reference', () => {
    const slides = { s1: slide('s1', [shape('a')]) };
    const res = mergeObjectInSlides(slides, 'a', 'a');
    expect(res.slides).toBe(slides);
    expect(res.droppedOnSlides).toEqual([]);
  });

  test('guard: source existing on no slide is a no-op', () => {
    const slides = { s1: slide('s1', [shape('tgt')]) };
    const res = mergeObjectInSlides(slides, 'tgt', 'ghost');
    expect(res.slides).toBe(slides);
    expect(res.droppedOnSlides).toEqual([]);
  });

  test('guard: group elements (either side, on any slide) block the merge', () => {
    const srcGroup = {
      s1: slide('s1', [group('src')]),
      s2: slide('s2', [shape('tgt')]),
    };
    expect(mergeObjectInSlides(srcGroup, 'tgt', 'src').slides).toBe(srcGroup);

    const tgtGroup = {
      s1: slide('s1', [shape('src')]),
      s2: slide('s2', [group('tgt')]),
    };
    expect(mergeObjectInSlides(tgtGroup, 'tgt', 'src').slides).toBe(tgtGroup);
  });
});

// =============================================================================
// mergeObjectConflictSlideIds / canMergeObjects
// =============================================================================

describe('mergeObjectConflictSlideIds', () => {
  test('lists exactly the slides where both objects exist, in the given order', () => {
    const slides = {
      s1: slide('s1', [shape('src'), shape('tgt')]),
      s2: slide('s2', [shape('src')]),
      s3: slide('s3', [shape('tgt')]),
      s4: slide('s4', [shape('src'), shape('tgt')]),
    };
    expect(mergeObjectConflictSlideIds(slides, 'tgt', 'src')).toEqual(['s1', 's4']);
    expect(mergeObjectConflictSlideIds(slides, 'tgt', 'src', ['s4', 's3', 's2', 's1'])).toEqual(['s4', 's1']);
  });
});

describe('canMergeObjects', () => {
  test('true only for distinct, non-group ids with the source present somewhere', () => {
    const slides = {
      s1: slide('s1', [shape('src')]),
      s2: slide('s2', [shape('tgt')]),
    };
    expect(canMergeObjects(slides, 'tgt', 'src')).toBe(true);
    expect(canMergeObjects(slides, 'src', 'src')).toBe(false);
    expect(canMergeObjects(slides, 'tgt', 'ghost')).toBe(false);
    // Merging into a target with no keyframes is still a plain re-identify.
    expect(canMergeObjects(slides, 'ghost-target', 'src')).toBe(true);
    expect(canMergeObjects({ s1: slide('s1', [group('src')]) }, 'tgt', 'src')).toBe(false);
    expect(
      canMergeObjects({ s1: slide('s1', [shape('src'), group('tgt')]) }, 'tgt', 'src'),
    ).toBe(false);
  });
});
