/**
 * Dual-path equivalence suite for presentationStore.
 *
 * Every mutating action is dual-path: with a registered collab Y.Doc
 * (getActiveDoc()) it writes through Yjs; otherwise it mutates plain JSON in
 * Zustand. This suite runs each action once in local mode and once in collab
 * mode (fresh Y.Doc initialized from the same fixture via jsonToYDoc) and
 * asserts the final Presentation JSON is deep-equal, modulo `updatedAt`
 * timestamps which are normalized out.
 *
 * ID generation (nanoid) is mocked with a deterministic counter that is reset
 * to the same base before each run, so actions that mint new slide/template
 * ids produce identical ids on both paths.
 *
 * Known intentional asymmetries are NOT asserted equal — they are encoded in
 * the "known divergences" describe block at the bottom, which pins the actual
 * current behavior of each path.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Deterministic id source. vi.hoisted so the mock factory can reference it
// even though the module-under-test (which calls nanoid at import time via
// createPresentation) is imported before this file's body runs.
const idState = vi.hoisted(() => ({ next: 0 }));
vi.mock('nanoid', () => ({
  nanoid: () => `nid-${idState.next++}`,
}));

import { usePresentationStore } from './presentationStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import type {
  Presentation,
  Slide,
  SlideElement,
  TextElement,
  ShapeElement,
  ImageElement,
  TextStyle,
} from '../types/presentation';

// =============================================================================
// Fixture
// =============================================================================

const baseStyle: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 32,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  color: '#222222',
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.3,
};

function textEl(id: string, overrides?: Partial<TextElement>): TextElement {
  return {
    id,
    type: 'text',
    x: 100, y: 100, width: 300, height: 60,
    rotation: 0, opacity: 1, locked: false, visible: true,
    text: `Text ${id}`,
    style: { ...baseStyle },
    ...overrides,
  };
}

function shapeEl(id: string, overrides?: Partial<ShapeElement>): ShapeElement {
  return {
    id,
    type: 'shape',
    shapeType: 'rect',
    x: 200, y: 200, width: 160, height: 120,
    rotation: 0, opacity: 1, locked: false, visible: true,
    fill: '#3b82f6', stroke: '#1e40af', strokeWidth: 2, cornerRadius: 4,
    ...overrides,
  };
}

function imageEl(id: string, overrides?: Partial<ImageElement>): ImageElement {
  return {
    id,
    type: 'image',
    resourceId: 'res-1',
    x: 500, y: 300, width: 320, height: 180,
    rotation: 0, opacity: 1, locked: false, visible: true,
    cropX: 0, cropY: 0, cropWidth: 640, cropHeight: 360,
    ...overrides,
  };
}

/**
 * Three slides. Keyframe semantics: the same element id may exist on several
 * slides.
 *  - el-text  : s1 (visible) + s2 (visible)          — cross-slide keyframes
 *  - el-rect  : s1 only (visible)                    — terminal-delete case
 *  - el-extra : s1 only (visible)                    — z-order shuffling
 *  - el-box   : s2 (visible)                         — connector anchor
 *  - el-conn  : s2, path bound to el-box             — rebind parity
 *  - el-img   : s2 (hidden) + s3 (visible), res-1    — hide/unhide + resource
 *  - el-solo  : s3 only (visible)
 * Resources: res-1 (referenced by el-img), res-2 (unreferenced video).
 * One template (tpl-1) with a text element.
 */
function makeFixture(): Presentation {
  const s1: Slide = {
    id: 's1',
    elements: {
      'el-text': textEl('el-text', {
        transitions: { position: 'ease', content: 'typewriter' },
      }),
      'el-rect': shapeEl('el-rect'),
      'el-extra': shapeEl('el-extra', { shapeType: 'ellipse', x: 400, y: 80 }),
    },
    elementOrder: ['el-text', 'el-rect', 'el-extra'],
    background: { type: 'solid', color: '#ffffff' },
    transition: { duration: 300 },
    notes: 'First slide notes',
  };
  const s2: Slide = {
    id: 's2',
    elements: {
      'el-text': textEl('el-text', { x: 140, y: 160, text: 'Text el-text' }),
      'el-box': shapeEl('el-box', { x: 600, y: 400, width: 200, height: 100 }),
      'el-conn': shapeEl('el-conn', {
        shapeType: 'path',
        x: 300, y: 450, width: 300, height: 0,
        fill: '', strokeWidth: 3, cornerRadius: 0,
        points: [0, 0, 150, 0, 300, 0],
        curve: 'linear',
        endArrow: true,
        startBinding: { elementId: 'el-box', anchor: 'left' },
        endBinding: null,
      }),
      'el-img': imageEl('el-img', { visible: false }),
    },
    elementOrder: ['el-text', 'el-box', 'el-conn', 'el-img'],
    background: { type: 'gradient', from: '#3b82f6', to: '#0b0f19', direction: 180 },
    transition: { duration: 500 },
    notes: '',
  };
  const s3: Slide = {
    id: 's3',
    elements: {
      'el-img': imageEl('el-img'),
      'el-solo': shapeEl('el-solo', { shapeType: 'star', x: 50, y: 50 }),
    },
    elementOrder: ['el-img', 'el-solo'],
    background: { type: 'solid', color: '#fafafa' },
    transition: { duration: 200 },
    notes: 'Third',
    autoAdvance: true,
    autoAdvanceDelay: 3,
  };

  return {
    id: 'fixture-deck',
    title: 'Dual-path fixture',
    slides: { s1, s2, s3 },
    slideOrder: ['s1', 's2', 's3'],
    objects: {
      'el-text': { id: 'el-text', name: 'Text 1', type: 'text' },
      'el-rect': { id: 'el-rect', name: 'Rectangle 1', type: 'shape' },
      'el-extra': { id: 'el-extra', name: 'Ellipse 1', type: 'shape' },
      'el-box': { id: 'el-box', name: 'Rectangle 2', type: 'shape' },
      'el-conn': { id: 'el-conn', name: 'Line 1', type: 'shape' },
      'el-img': { id: 'el-img', name: 'Image 1', type: 'image' },
      'el-solo': { id: 'el-solo', name: 'Star 1', type: 'shape' },
    },
    resources: {
      'res-1': {
        id: 'res-1', name: 'photo.png', type: 'image',
        src: 'data:image/png;base64,AAAA', originalWidth: 640, originalHeight: 360,
        hash: 'sha256:res1',
      },
      'res-2': {
        id: 'res-2', name: 'clip.mp4', type: 'video',
        src: 'https://example.com/clip.mp4',
        originalWidth: 1920, originalHeight: 1080, duration: 8,
      },
    },
    templates: {
      'tpl-1': {
        id: 'tpl-1',
        name: 'Section header',
        elements: { 'tpl-el': textEl('tpl-el', { x: 200, y: 400, width: 800 }) },
        elementOrder: ['tpl-el'],
        background: { type: 'solid', color: '#000000' },
      },
    },
    theme: {
      name: 'Light',
      colors: {
        primary: '#4285f4', secondary: '#5f6368', accent: '#ea4335',
        background: '#ffffff', text: '#333333', heading: '#202124',
      },
      fonts: { heading: 'Arial', body: 'Arial' },
    },
    width: 1920,
    height: 1080,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
  };
}

// =============================================================================
// Harness
// =============================================================================

type Store = ReturnType<typeof usePresentationStore.getState>;
type Action = (store: Store) => void;

/** Base the deterministic id counter is reset to before each run so both
 *  paths mint identical ids for freshly-created slides/templates. */
const ID_BASE = 1000;

function runLocal(action: Action): Presentation {
  setActiveDoc(null);
  usePresentationStore.setState({ presentation: makeFixture() });
  idState.next = ID_BASE;
  action(usePresentationStore.getState());
  // Snapshot: deep-clone so later store mutations can't alias into the result.
  return JSON.parse(JSON.stringify(usePresentationStore.getState().presentation));
}

function runCollab(action: Action): Presentation {
  const doc = jsonToYDoc(makeFixture());
  // Also load the fixture into Zustand so any incidental reads see the same
  // world (collab-mode actions must not consult it for writes, but mirroring
  // helpers read store state).
  usePresentationStore.setState({ presentation: makeFixture() });
  setActiveDoc(doc);
  idState.next = ID_BASE;
  try {
    action(usePresentationStore.getState());
  } finally {
    setActiveDoc(null);
  }
  return yDocToJson(doc);
}

/** Strip fields that legitimately differ between the two paths. */
function normalize(p: Presentation): Omit<Presentation, 'updatedAt'> {
  const { updatedAt: _updatedAt, ...rest } = JSON.parse(JSON.stringify(p)) as Presentation;
  return rest;
}

function expectEquivalent(action: Action) {
  const local = runLocal(action);
  const collab = runCollab(action);
  expect(normalize(collab)).toEqual(normalize(local));
}

beforeEach(() => {
  setActiveDoc(null);
});

afterEach(() => {
  // A leaked active doc would silently flip every later test into collab mode.
  setActiveDoc(null);
  usePresentationStore.setState({ presentation: makeFixture() });
});

// =============================================================================
// Equivalence table — one case per mutating action (variants where the code
// branches meaningfully).
// =============================================================================

const cases: Array<{ name: string; action: Action }> = [
  // --- element actions ---
  {
    name: 'addElement (text)',
    action: (s) => s.addElement('s1', textEl('el-new-text', { x: 10, y: 20 })),
  },
  {
    name: 'addElement (path shape with points/arrows/bindings)',
    action: (s) =>
      s.addElement('s2', shapeEl('el-new-path', {
        shapeType: 'path', fill: '', strokeWidth: 3,
        points: [0, 0, 50, 80, 120, 10],
        curve: 'bspline2', closed: false, startArrow: false, endArrow: true,
        startBinding: { elementId: 'el-box', anchor: 'top' }, endBinding: null,
      })),
  },
  {
    name: 'addElement (image)',
    action: (s) => s.addElement('s3', imageEl('el-new-img', {
      playing: true, loop: false, muted: true, startTime: 1.5,
    })),
  },
  {
    name: 'addElements (batch text + shape)',
    action: (s) => s.addElements('s1', [
      textEl('el-batch-a', { x: 1, y: 2 }),
      shapeEl('el-batch-b', { shapeType: 'triangle' }),
    ]),
  },
  {
    name: 'updateElement (scalar geometry)',
    action: (s) => s.updateElement('s1', 'el-text', { x: 555, y: 44, rotation: 30 }),
  },
  {
    name: 'updateElement (full style replacement on text)',
    action: (s) => s.updateElement('s1', 'el-text', {
      style: { ...baseStyle, color: '#ff0000', fontSize: 48 },
    } as Partial<SlideElement>),
  },
  {
    name: 'updateElement (move connector anchor rebinds bound path)',
    action: (s) => s.updateElement('s2', 'el-box', { x: 700, y: 500 }),
  },
  {
    name: 'updateElements (batch scalars, no connectors involved)',
    action: (s) => s.updateElements('s1', [
      { elementId: 'el-text', changes: { x: 11 } },
      { elementId: 'el-rect', changes: { opacity: 0.5, rotation: 45 } },
    ]),
  },
  {
    name: 'deleteElements (terminal — element only on this slide, full purge)',
    action: (s) => s.deleteElements('s1', ['el-rect']),
  },
  {
    name: 'deleteElements (non-terminal — element stays visible on earlier slide)',
    action: (s) => s.deleteElements('s2', ['el-text']),
  },
  {
    name: 'deleteElements (image purge cascades resource cleanup)',
    action: (s) => s.deleteElements('s3', ['el-img']),
  },
  {
    name: 'hideElement (non-terminal — element still visible elsewhere)',
    action: (s) => s.hideElement('s1', 'el-text'),
  },
  {
    name: 'moveElementForward',
    action: (s) => s.moveElementForward('s1', 'el-text'),
  },
  {
    name: 'moveElementBackward',
    action: (s) => s.moveElementBackward('s1', 'el-extra'),
  },
  {
    name: 'moveElementToFront',
    action: (s) => s.moveElementToFront('s1', 'el-text'),
  },
  {
    name: 'moveElementToBack',
    action: (s) => s.moveElementToBack('s1', 'el-extra'),
  },
  // --- slide actions ---
  {
    name: 'addSlide (default index — copies previous as keyframe)',
    action: (s) => s.addSlide(),
  },
  {
    name: 'addSlide (index 0 — copies following slide)',
    action: (s) => s.addSlide(0),
  },
  {
    name: 'addSlide (middle index)',
    action: (s) => s.addSlide(1),
  },
  {
    name: 'addEmptySlide',
    action: (s) => s.addEmptySlide(1),
  },
  {
    name: 'addSlideWithMode (previous)',
    action: (s) => s.addSlideWithMode(0, 'previous'),
  },
  {
    name: 'addSlideWithMode (next)',
    action: (s) => s.addSlideWithMode(0, 'next'),
  },
  {
    name: 'addSlideWithMode (interpolate — shared element lerped)',
    action: (s) => s.addSlideWithMode(0, 'interpolate'),
  },
  {
    name: 'addSlideWithMode (interpolate at end falls back to previous)',
    action: (s) => s.addSlideWithMode(2, 'interpolate'),
  },
  {
    name: 'deleteSlide',
    action: (s) => s.deleteSlide('s2'),
  },
  {
    name: 'deleteSlide (refuses to delete the last slide)',
    action: (s) => {
      s.deleteSlide('s1');
      s.deleteSlide('s2');
      s.deleteSlide('s3'); // only one left — must be a no-op on both paths
    },
  },
  {
    name: 'duplicateSlide',
    action: (s) => s.duplicateSlide('s2'),
  },
  {
    name: 'reorderSlides',
    action: (s) => s.reorderSlides(['s3', 's1', 's2']),
  },
  {
    name: 'updateSlideBackground (gradient -> solid replaces whole variant)',
    action: (s) => s.updateSlideBackground('s2', { type: 'solid', color: '#00ff00' }),
  },
  {
    name: 'updateSlideBackground (solid -> gradient)',
    action: (s) => s.updateSlideBackground('s1', {
      type: 'gradient', from: '#111111', to: '#999999', direction: 90,
    }),
  },
  {
    name: 'updateSlideTransition',
    action: (s) => s.updateSlideTransition('s1', { duration: 750 }),
  },
  {
    name: 'updateSlideAutoAdvance (with explicit delay)',
    action: (s) => s.updateSlideAutoAdvance('s1', true, 5),
  },
  {
    name: 'updateSlideNotes',
    action: (s) => s.updateSlideNotes('s2', 'New *notes* here'),
  },
  {
    name: 'toggleSlideHidden (absent -> true)',
    action: (s) => s.toggleSlideHidden('s1'),
  },
  // --- keyframe / object actions ---
  {
    name: 'unhideElement (present but hidden, with position)',
    action: (s) => s.unhideElement('s2', 'el-img', { x: 42, y: 24 }),
  },
  {
    name: 'unhideElement (absent on slide — copied from nearest slide)',
    action: (s) => s.unhideElement('s3', 'el-rect'),
  },
  {
    name: 'resetElementToKeyframe',
    action: (s) => s.resetElementToKeyframe('s2', 'el-text'),
  },
  {
    name: 'resetElementToNextKeyframe',
    action: (s) => s.resetElementToNextKeyframe('s1', 'el-text'),
  },
  {
    name: 'renameObject',
    action: (s) => s.renameObject('el-text', 'Hero headline'),
  },
  {
    name: 'removeObject (purges element everywhere + orphaned resource)',
    action: (s) => s.removeObject('el-img'),
  },
  {
    name: 'syncElementToSlides (scalars + text across slides)',
    action: (s) =>
      // 'text' is a TextElement-only key; the action's signature is keyed on
      // the SlideElement union so it needs a cast, but the implementation
      // handles per-variant keys (and converts Y.Text to a string).
      s.syncElementToSlides('s1', 'el-text', ['s2'], ['x', 'y', 'width', 'text'] as unknown as Array<keyof SlideElement>),
  },
  // --- resource actions ---
  {
    name: 'addResource',
    action: (s) => s.addResource({
      id: 'res-new', name: 'added.png', type: 'image',
      src: 'data:image/png;base64,BBBB', originalWidth: 10, originalHeight: 10,
    }),
  },
  // --- template actions ---
  {
    name: 'saveAsTemplate',
    action: (s) => s.saveAsTemplate('s1', 'Snapshot of s1'),
  },
  {
    name: 'addSlideFromTemplate (registers template objects)',
    action: (s) => s.addSlideFromTemplate('tpl-1', 1),
  },
  {
    name: 'deleteTemplate',
    action: (s) => s.deleteTemplate('tpl-1'),
  },
  // --- presentation actions ---
  {
    name: 'updateTitle',
    action: (s) => s.updateTitle('Renamed deck'),
  },
];

describe('dual-path equivalence (local JSON vs collab Y.Doc)', () => {
  test.each(cases)('$name', ({ action }) => {
    expectEquivalent(action);
  });
});

// =============================================================================
// Known divergences.
//
// These tests pin the CURRENT observable behavior of each path where the two
// genuinely differ. They are documentation, not endorsement: each one is a
// place where local mode and collab mode end up with different state after the
// same call. If one of these starts failing, a path's behavior changed —
// decide deliberately whether the divergence was closed (then promote the case
// into the equivalence table) or a new one was introduced.
// =============================================================================

describe('known dual-path divergences (documented, intentional or pending fix)', () => {
  test('hideElement (terminal): Y path only deletes the object-registry entry; JSON path fully purges', () => {
    // el-img is hidden on s2 and visible only on s3. Hiding it on s3 makes it
    // invisible everywhere. The JSON path then removes the element from every
    // slide and drops its now-unreferenced resource; the Y path — per the
    // comment in the store ("hideElement ... hides only this slide") —
    // deliberately performs only the object-registry deletion and leaves the
    // per-slide element entries (visible:false) and the resource in place.
    const action: Action = (s) => s.hideElement('s3', 'el-img');
    const local = runLocal(action);
    const collab = runCollab(action);

    // Both paths agree the object registry entry is gone.
    expect(local.objects['el-img']).toBeUndefined();
    expect(collab.objects['el-img']).toBeUndefined();

    // JSON path: full purge.
    expect(local.slides.s2.elements['el-img']).toBeUndefined();
    expect(local.slides.s3.elements['el-img']).toBeUndefined();
    expect(local.slides.s3.elementOrder).not.toContain('el-img');
    expect(local.resources['res-1']).toBeUndefined();

    // Y path: elements stay (hidden), resource stays.
    expect(collab.slides.s2.elements['el-img']).toBeDefined();
    expect(collab.slides.s3.elements['el-img']).toMatchObject({ visible: false });
    expect(collab.slides.s3.elementOrder).toContain('el-img');
    expect(collab.resources['res-1']).toBeDefined();
  });

  test('updateElement with a partial nested object (style): Y path merges keys, JSON path replaces the object', () => {
    // applyChangesToYElement overlays keys onto an existing nested Y.Map, so
    // omitted style fields survive; the JSON path spreads `changes` over the
    // element, replacing `style` wholesale. Callers currently always pass the
    // full style object, which is why this hasn't bitten in the app.
    const action: Action = (s) =>
      s.updateElement('s1', 'el-text', { style: { color: '#123456' } } as unknown as Partial<SlideElement>);
    const local = runLocal(action);
    const collab = runCollab(action);

    const localStyle = (local.slides.s1.elements['el-text'] as TextElement).style;
    const collabStyle = (collab.slides.s1.elements['el-text'] as TextElement).style;

    // JSON path: style is now ONLY what the partial contained.
    expect(localStyle).toEqual({ color: '#123456' });
    // Y path: partial merged over the existing style.
    expect(collabStyle).toEqual({ ...baseStyle, color: '#123456' });
  });

  test('updateElements moving a connector anchor: JSON path rebinds bound paths, Y path does not', () => {
    // updateElement's Y branch replays the connector rebinding, but
    // updateElements' Y branch only applies the raw changes — bound paths are
    // left stale in collab mode.
    const fixture = makeFixture();
    const action: Action = (s) =>
      s.updateElements('s2', [{ elementId: 'el-box', changes: { x: 660, y: 460 } }]);
    const local = runLocal(action);
    const collab = runCollab(action);

    const fixtureConn = fixture.slides.s2.elements['el-conn'] as ShapeElement;
    const localConn = local.slides.s2.elements['el-conn'] as ShapeElement;
    const collabConn = collab.slides.s2.elements['el-conn'] as ShapeElement;

    // JSON path rebound the connector (geometry changed).
    expect({
      x: localConn.x, y: localConn.y,
      width: localConn.width, height: localConn.height,
      points: localConn.points,
    }).not.toEqual({
      x: fixtureConn.x, y: fixtureConn.y,
      width: fixtureConn.width, height: fixtureConn.height,
      points: fixtureConn.points,
    });
    // Y path left the connector untouched.
    expect({
      x: collabConn.x, y: collabConn.y,
      width: collabConn.width, height: collabConn.height,
      points: collabConn.points,
    }).toEqual({
      x: fixtureConn.x, y: fixtureConn.y,
      width: fixtureConn.width, height: fixtureConn.height,
      points: fixtureConn.points,
    });
  });

  test('updateSlideAutoAdvance without a delay: JSON path defaults autoAdvanceDelay to 0, Y path leaves it absent', () => {
    // s1 has no autoAdvanceDelay. The JSON branch writes
    // `autoAdvanceDelay ?? slide.autoAdvanceDelay ?? 0`; the Y branch skips
    // the key entirely when the argument is undefined.
    const action: Action = (s) => s.updateSlideAutoAdvance('s1', true);
    const local = runLocal(action);
    const collab = runCollab(action);

    expect(local.slides.s1.autoAdvance).toBe(true);
    expect(collab.slides.s1.autoAdvance).toBe(true);
    expect(local.slides.s1.autoAdvanceDelay).toBe(0);
    expect('autoAdvanceDelay' in collab.slides.s1).toBe(false);
  });

  test('addElement with strokeStyle: Y path silently drops the field (elementToYMap omission)', () => {
    // ShapeElement.strokeStyle ('solid' | 'dashed' | 'dotted') exists in the
    // TypeScript type but elementToYMap never serializes it, so any element
    // inserted through the Y path (and any deck round-tripped through
    // jsonToYDoc) loses its dash style.
    const dashed = shapeEl('el-dashed', {
      shapeType: 'path', fill: '', strokeWidth: 3,
      points: [0, 0, 100, 0], curve: 'linear',
      strokeStyle: 'dashed',
    });
    const action: Action = (s) => s.addElement('s1', dashed);
    const local = runLocal(action);
    const collab = runCollab(action);

    expect((local.slides.s1.elements['el-dashed'] as ShapeElement).strokeStyle).toBe('dashed');
    expect('strokeStyle' in (collab.slides.s1.elements['el-dashed'] as ShapeElement)).toBe(false);
  });

  // syncElementToSlides with a nested-object property (e.g. 'style'): the Y
  // branch reads the source value with srcEl.get('style'), which yields a
  // live Y.Map (only Y.Text is converted to a plain value). Feeding that
  // Y.Map into applyChangesToYElement iterates Object.entries() over the
  // Y.Map INSTANCE (its internal fields, not its entries), so the target's
  // style is not updated the way the JSON path updates it. The app currently
  // only syncs scalar/text properties through this action. Left as a todo
  // rather than executed because the misbehavior writes Yjs internals into
  // the doc and its exact output is not a contract worth pinning.
  test.todo('syncElementToSlides with nested object properties (style) diverges in collab mode');
});
