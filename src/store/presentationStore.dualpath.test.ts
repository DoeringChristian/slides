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
import { pathLabelCenter } from '../utils/syncDependents';
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
    type: 'text', textSizing: 'user-width', boundTextLayout: 'padded',
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
    type: 'shape', creationPreset: 'rect',
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
        endHead: 'triangle',
        startBinding: { elementId: 'el-box', mode: 'pinned', fixedPoint: [0, .5] },
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
        curve: 'bspline2', closed: false, endHead: 'triangle',
        startBinding: { elementId: 'el-box', mode: 'pinned', fixedPoint: [.5, 0] }, endBinding: null,
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
    // Promoted from the "known divergences" block: the Y branch used to skip
    // the connector rebind pass entirely (the main collab pinning bug).
    name: 'updateElements moves bound target → connector rebinds identically both paths',
    action: (s) => s.updateElements('s2', [{ elementId: 'el-box', changes: { x: 660, y: 460 } }]),
  },
  {
    name: 'updateElements (stale elementOrder id + moved anchor — missing element tolerated)',
    action: (s) => s.updateElements('s2', [
      { elementId: 'el-box', changes: { x: 610, y: 410 } },
      { elementId: 'el-gone', changes: { x: 1, y: 2 } },
    ]),
  },
  {
    name: 'updateElements (whole-arrow drag clears stale bindings)',
    action: (s) => s.updateElements('s2', [
      { elementId: 'el-conn', changes: { x: 320, y: 470, startBinding: null, endBinding: null } as Partial<SlideElement> },
    ]),
  },
  // --- binding v2 (edge focus/gap + pinned fixedPoint) ---
  {
    name: 'binding v2: edge-mode binding re-solves identically when the target moves',
    action: (s) => {
      s.updateElement('s2', 'el-conn', {
        startBinding: { elementId: 'el-box', mode: 'aim', fixedPoint: [.5, .5], gap: 6 },
      } as Partial<SlideElement>);
      s.updateElements('s2', [{ elementId: 'el-box', changes: { x: 640, y: 420 } }]);
    },
  },
  {
    name: 'binding v2: pinned fixedPoint binding tracks the moved target identically',
    action: (s) => {
      s.updateElement('s2', 'el-conn', {
        endBinding: { elementId: 'el-box', mode: 'pinned', fixedPoint: [0.25, 1] },
      } as Partial<SlideElement>);
      s.updateElement('s2', 'el-box', { x: 700, y: 480 });
    },
  },
  {
    name: "binding v2: a path's own points edit re-solves its edge-mode ends on both paths",
    action: (s) => {
      s.updateElement('s2', 'el-conn', {
        startBinding: { elementId: 'el-box', mode: 'aim', fixedPoint: [.5, .5], gap: 0 },
      } as Partial<SlideElement>);
      s.updateElement('s2', 'el-conn', { points: [0, 0, 150, 40, 300, 0] } as Partial<SlideElement>);
    },
  },
  {
    name: 'binding v2: binding replaced wholesale — pinned → edge drops fixedPoint on both paths',
    action: (s) => {
      s.updateElement('s2', 'el-conn', {
        startBinding: { elementId: 'el-box', mode: 'pinned', fixedPoint: [0.5, 0] },
      } as Partial<SlideElement>);
      s.updateElement('s2', 'el-conn', {
        startBinding: { elementId: 'el-box', mode: 'aim', fixedPoint: [.5, .5], gap: 3 },
      } as Partial<SlideElement>);
    },
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
    name: 'hideElement (terminal — invisible everywhere → full purge incl. resource)',
    action: (s) => s.hideElement('s3', 'el-img'),
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
    name: 'deleteSlide (GC — slide-only objects leave the registry, orphaned resource dropped)',
    action: (s) => {
      s.deleteSlide('s2'); // el-box/el-conn only lived here; el-img keyframe 1 of 2
      s.deleteSlide('s3'); // el-img's last keyframe (res-1) + el-solo
    },
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
    name: 'updateSlideAutoAdvanceDelay',
    action: (s) => s.updateSlideAutoAdvanceDelay('s1', 5),
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
// deleteSlide object/resource GC (the "ghost objects" fix) — the equivalence
// table already pins Y ≡ JSON; these tests pin the actual GC outcome on each
// path so the equivalence can't be satisfied by both paths leaking alike.
// =============================================================================

describe('deleteSlide object/resource GC', () => {
  const action: Action = (s) => {
    s.deleteSlide('s2');
    s.deleteSlide('s3');
  };

  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s drops ghost registry entries and the orphaned image resource', (_name, run) => {
    const result = run(action);
    expect(Object.keys(result.slides)).toEqual(['s1']);
    // Objects whose only keyframes lived on the deleted slides are GC'd…
    for (const id of ['el-box', 'el-conn', 'el-img', 'el-solo']) {
      expect(result.objects[id]).toBeUndefined();
    }
    // …while objects still present on s1 survive.
    for (const id of ['el-text', 'el-rect', 'el-extra']) {
      expect(result.objects[id]).toBeDefined();
    }
    // res-1 was only referenced by el-img (s2 + s3) — orphaned, dropped.
    expect(result.resources['res-1']).toBeUndefined();
    // res-2 was never referenced by a deleted slide; deleteSlide only audits
    // resources the removed slide referenced, so it stays (load-time repair
    // is the pass that sweeps fully-unreferenced resources).
    expect(result.resources['res-2']).toBeDefined();
  });
});

// =============================================================================
// Load-time repair pass — loadPresentation heals decks corrupted before
// deleteSlide learned to GC (ghost registry entries, unreferenced resources).
// =============================================================================

describe('loadPresentation repair pass', () => {
  test('a synthetic ghost registry entry and an unreferenced resource are dropped on load', () => {
    setActiveDoc(null);
    const corrupted = makeFixture();
    // Ghost: in the registry, present on no slide (pre-fix deleteSlide relic).
    corrupted.objects['el-ghost'] = { id: 'el-ghost', name: 'Ghost', type: 'shape' };

    usePresentationStore.getState().loadPresentation(corrupted);
    const loaded = usePresentationStore.getState().presentation;

    expect(loaded.objects['el-ghost']).toBeUndefined();
    // res-2 is referenced by no slide in the fixture — the repair sweeps it.
    expect(loaded.resources['res-2']).toBeUndefined();
    // Real objects and referenced resources survive.
    for (const id of ['el-text', 'el-rect', 'el-extra', 'el-box', 'el-conn', 'el-img', 'el-solo']) {
      expect(loaded.objects[id]).toBeDefined();
    }
    expect(loaded.resources['res-1']).toBeDefined();

    // Idempotent: re-loading the repaired deck changes nothing.
    usePresentationStore.getState().loadPresentation(JSON.parse(JSON.stringify(loaded)));
    const reloaded = usePresentationStore.getState().presentation;
    expect(reloaded).toEqual(loaded);
  });
});

// =============================================================================
// updateElements connector rebind (the collab pinning fix) — the equivalence
// table already pins Y ≡ JSON for this action; these tests pin the actual
// rebind outcome on each path so the equivalence can't be satisfied by both
// paths skipping the rebind alike.
// =============================================================================

describe('updateElements connector rebind', () => {
  const action: Action = (s) =>
    s.updateElements('s2', [{ elementId: 'el-box', changes: { x: 660, y: 460 } }]);

  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s re-pins the bound connector to the moved anchor', (_name, run) => {
    const result = run(action);
    const conn = result.slides.s2.elements['el-conn'] as ShapeElement;
    // el-conn: x=300 y=450, points [0,0,150,0,300,0] → absolute vertices
    // (300,450), (450,450), (600,450); startBinding → el-box 'left'.
    // el-box moved to (660,460), w=200 h=100 → left anchor = (660, 510).
    const abs = (conn.points ?? []).map((v, i) => v + (i % 2 === 0 ? conn.x : conn.y));
    // Start vertex tracks the anchor…
    expect(abs.slice(0, 2)).toEqual([660, 510]);
    // …and the interior + end vertices keep their absolute positions (the
    // multi-vertex path is preserved, not truncated to a 2-point line).
    expect(abs.slice(2)).toEqual([450, 450, 600, 450]);
    // Bindings themselves are untouched by the rebind pass.
    expect(conn.startBinding).toEqual({ elementId: 'el-box', mode: 'pinned', fixedPoint: [0, .5] });
    expect(conn.endBinding).toBeNull();
  });
});

// =============================================================================
// Binding v2 rebind outcomes — the equivalence table pins Y ≡ JSON; these pin
// the actual geometry on each path so the equivalence can't be satisfied by
// both paths skipping the re-solve alike.
// =============================================================================

describe('binding v2 rebind outcomes (edge + pinned)', () => {
  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s: pinned fixedPoint end tracks the moved target exactly', (_name, run) => {
    const result = run((s) => {
      s.updateElement('s2', 'el-conn', {
        endBinding: { elementId: 'el-box', mode: 'pinned', fixedPoint: [0.25, 1] },
      } as Partial<SlideElement>);
      s.updateElement('s2', 'el-box', { x: 700, y: 480 });
    });
    const conn = result.slides.s2.elements['el-conn'] as ShapeElement;
    const abs = (conn.points ?? []).map((v, i) => v + (i % 2 === 0 ? conn.x : conn.y));
    // el-box at (700,480), 200×100 → fixedPoint [0.25,1] = (750, 580).
    expect(abs.slice(4)).toEqual([750, 580]);
    // The fixture's LEGACY start binding (anchor 'left') re-solves too, via
    // the pinned fallback: left anchor of the moved box = (700, 530). The
    // interior vertex keeps its absolute position.
    expect(abs.slice(0, 4)).toEqual([700, 530, 450, 450]);
    expect(conn.endBinding).toEqual({ elementId: 'el-box', mode: 'pinned', fixedPoint: [0.25, 1] });
  });

  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s: edge-mode end re-solves against the silhouette toward the adjacent vertex', (_name, run) => {
    const result = run((s) => {
      s.updateElement('s2', 'el-conn', {
        startBinding: { elementId: 'el-box', mode: 'aim', fixedPoint: [.5, .5], gap: 0 },
      } as Partial<SlideElement>);
      s.updateElements('s2', [{ elementId: 'el-box', changes: { x: 660, y: 460 } }]);
    });
    const conn = result.slides.s2.elements['el-conn'] as ShapeElement;
    const abs = (conn.points ?? []).map((v, i) => v + (i % 2 === 0 ? conn.x : conn.y));
    // el-box at (660,460), 200×100 → center (760,510). Ray from the adjacent
    // vertex (450,450) toward the center enters the left edge x=660 at
    // y = 450 + 60·(210/310) ≈ 490.645.
    expect(abs[0]).toBeCloseTo(660, 6);
    expect(abs[1]).toBeCloseTo(450 + 60 * (210 / 310), 6);
    // Interior + end vertices untouched.
    expect(abs.slice(2)).toEqual([450, 450, 600, 450]);
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
  // (hideElement's terminal-purge divergence was closed — the Y branch now
  // calls purgeObjectInY like deleteElements does — and the case was promoted
  // into the equivalence table above.)

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

  test.each(['dashed', 'dotted'] as const)('fixed omission: addElement retains %s strokeStyle on both paths', strokeStyle => {
    // Regression: elementToYMap previously omitted this optional scalar.
    const dashed = shapeEl('el-dashed', {
      shapeType: 'path', fill: '', strokeWidth: 3,
      points: [0, 0, 100, 0], curve: 'linear',
      strokeStyle,
    });
    const action: Action = (s) => s.addElement('s1', dashed);
    const local = runLocal(action);
    const collab = runCollab(action);

    expect((local.slides.s1.elements['el-dashed'] as ShapeElement).strokeStyle).toBe(strokeStyle);
    expect((collab.slides.s1.elements['el-dashed'] as ShapeElement).strokeStyle).toBe(strokeStyle);
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

// =============================================================================
// WS-4 slide groups (timed chain): groupSlides / ungroupSlides / reorder
// dissolve / keyframe-copy inheritance / hold updates.
// =============================================================================

describe('WS-4 slide groups (dual-path)', () => {
  const groupCases: Array<{ name: string; action: Action }> = [
    {
      name: 'groupSlides (contiguous pair)',
      action: (s) => { s.groupSlides(['s1', 's2']); },
    },
    {
      name: 'groupSlides (whole deck)',
      action: (s) => { s.groupSlides(['s1', 's2', 's3']); },
    },
    {
      name: 'groupSlides (non-contiguous — rejected, no-op)',
      action: (s) => { s.groupSlides(['s1', 's3']); },
    },
    {
      name: 'groupSlides (single slide — rejected, no-op)',
      action: (s) => { s.groupSlides(['s2']); },
    },
    {
      name: 'groupSlides overwrites members’ existing groupIds',
      action: (s) => { s.groupSlides(['s1', 's2']); s.groupSlides(['s2', 's3']); },
    },
    {
      name: 'ungroupSlides (one member id strips the whole group)',
      action: (s) => { s.groupSlides(['s1', 's2', 's3']); s.ungroupSlides(['s2']); },
    },
    {
      name: 'ungroupSlides (ungrouped slide — no-op)',
      action: (s) => { s.ungroupSlides(['s1']); },
    },
    {
      name: 'reorderSlides dissolves a group it splits',
      action: (s) => { s.groupSlides(['s1', 's2']); s.reorderSlides(['s1', 's3', 's2']); },
    },
    {
      name: 'reorderSlides keeps a group that stays contiguous',
      action: (s) => { s.groupSlides(['s1', 's2']); s.reorderSlides(['s3', 's1', 's2']); },
    },
    {
      name: 'duplicateSlide inherits the source groupId (copy joins the group)',
      action: (s) => { s.groupSlides(['s1', 's2']); s.duplicateSlide('s1'); },
    },
    {
      name: 'addSlideWithMode(previous) inside a group inherits the groupId',
      action: (s) => { s.groupSlides(['s1', 's2']); s.addSlideWithMode(0, 'previous'); },
    },
    {
      name: 'updateSlideAutoAdvanceDelay (per-slide hold)',
      action: (s) => { s.updateSlideAutoAdvanceDelay('s2', 2.5); },
    },
  ];

  test.each(groupCases)('$name', ({ action }) => {
    expectEquivalent(action);
  });

  // Equivalence alone could be satisfied by both paths doing nothing —
  // pin the actual outcome on each path.
  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s: members share one fresh id; a splitting reorder strips it', (_name, run) => {
    const grouped = run((s) => { s.groupSlides(['s1', 's2']); });
    const gid = grouped.slides['s1'].groupId;
    expect(gid).toBeTruthy();
    expect(grouped.slides['s2'].groupId).toBe(gid);
    expect(grouped.slides['s3'].groupId).toBeUndefined();

    const split = run((s) => { s.groupSlides(['s1', 's2']); s.reorderSlides(['s1', 's3', 's2']); });
    expect(split.slides['s1'].groupId).toBeUndefined();
    expect(split.slides['s2'].groupId).toBeUndefined();

    const rejected = run((s) => { s.groupSlides(['s1', 's3']); });
    expect(rejected.slides['s1'].groupId).toBeUndefined();
    expect(rejected.slides['s3'].groupId).toBeUndefined();
  });

  test('groupSlides returns the fresh groupId, or null when rejected (both paths)', () => {
    // Local path.
    setActiveDoc(null);
    usePresentationStore.setState({ presentation: makeFixture() });
    let store = usePresentationStore.getState();
    expect(store.groupSlides(['s1', 's3'])).toBeNull();
    expect(store.groupSlides(['s2'])).toBeNull();
    const localGid = store.groupSlides(['s2', 's3']);
    expect(localGid).toBeTruthy();
    expect(usePresentationStore.getState().presentation.slides['s2'].groupId).toBe(localGid);

    // Collab path.
    const doc = jsonToYDoc(makeFixture());
    usePresentationStore.setState({ presentation: makeFixture() });
    setActiveDoc(doc);
    try {
      store = usePresentationStore.getState();
      expect(store.groupSlides(['s1', 's3'])).toBeNull();
      const collabGid = store.groupSlides(['s2', 's3']);
      expect(collabGid).toBeTruthy();
      expect(yDocToJson(doc).slides['s2'].groupId).toBe(collabGid);
    } finally {
      setActiveDoc(null);
    }
  });
});

// =============================================================================
// WS-2 Phase 3: typed arrowheads (startHead/endHead) — dual-path equivalence.
// Appended as a separate block; the main `cases` table above belongs to the
// original suite.
// =============================================================================

describe('WS-2 Phase 3 typed arrowheads (dual-path)', () => {
  const headCases: Array<{ name: string; action: Action }> = [
    {
      name: 'updateElement writes startHead → equal on both paths',
      action: (s) => s.updateElement('s2', 'el-conn', {
        startHead: 'crowfoot-one-many',
      } as Partial<SlideElement>),
    },
    {
      name: 'updateElement switches endHead type (triangle → diamond-outline)',
      action: (s) => s.updateElement('s2', 'el-conn', {
        endHead: 'diamond-outline',
      } as Partial<SlideElement>),
    },
    {
      name: "updateElement clears a head with the explicit 'none' value",
      action: (s) => s.updateElement('s2', 'el-conn', {
        endHead: 'none',
      } as Partial<SlideElement>),
    },
    {
      name: 'addElement with typed heads round-trips both paths',
      action: (s) => s.addElement('s1', shapeEl('el-new-headed', {
        shapeType: 'path', fill: '', strokeWidth: 3, cornerRadius: 0,
        points: [0, 0, 120, 40],
        curve: 'linear', closed: false,
        startHead: 'dot', endHead: 'bar',
      })),
    },
  ];

  test.each(headCases)('$name', ({ action }) => {
    expectEquivalent(action);
  });
});

// =============================================================================
// WS-2 Phase 4 bound text (dual-path) — labels follow containers via the
// shared syncDependentsAfterMutation pass; lifecycle cascades (delete / hide /
// unhide / removeObject) keep label and container chained on both paths.
// =============================================================================

describe('WS-2 Phase 4 bound text (dual-path)', () => {
  const boundLabel = (id: string, containerId: string, overrides?: Partial<TextElement>): TextElement =>
    textEl(id, {
      containerId,
      text: 'Label',
      width: 144,
      height: 40,
      x: 0,
      y: 0,
      style: { ...baseStyle, align: 'center', verticalAlign: 'middle' },
      ...overrides,
    });

  const boundCases: Array<{ name: string; action: Action }> = [
    {
      name: 'addElement with containerId round-trips both paths',
      action: (s) => s.addElement('s2', boundLabel('el-lbl', 'el-box')),
    },
    {
      name: 'move container → label follows identically on both paths',
      action: (s) => {
        s.addElement('s2', boundLabel('el-lbl', 'el-box'));
        s.updateElement('s2', 'el-box', { x: 700, y: 480 });
      },
    },
    {
      name: 'resize container → label recentred/width-capped identically on both paths',
      action: (s) => {
        s.addElement('s2', boundLabel('el-lbl', 'el-box'));
        s.updateElements('s2', [{ elementId: 'el-box', changes: { width: 320, height: 140 } }]);
      },
    },
    {
      name: 'arrow label follows the POST-rebind arrow when its bound target moves',
      action: (s) => {
        s.addElement('s2', boundLabel('el-lbl', 'el-conn'));
        s.updateElement('s2', 'el-box', { x: 700, y: 500 }); // rebinds el-conn, label rides along
      },
    },
    {
      name: 'deleteElements cascades to the bound label (terminal purge, both paths)',
      action: (s) => {
        s.addElement('s2', boundLabel('el-lbl', 'el-box'));
        s.deleteElements('s2', ['el-box']);
      },
    },
    {
      name: 'hideElement cascades visibility to the bound label',
      action: (s) => {
        s.addElement('s2', boundLabel('el-lbl', 'el-box'));
        s.hideElement('s2', 'el-box');
      },
    },
    {
      name: 'unhideElement copies container AND label to the slide, label re-anchored',
      action: (s) => {
        s.addElement('s1', boundLabel('el-lbl', 'el-rect'));
        s.unhideElement('s3', 'el-rect', { x: 100, y: 200 });
      },
    },
    {
      name: 'removeObject purges orphaned bound labels from slides and registry',
      action: (s) => {
        s.addElement('s2', boundLabel('el-lbl', 'el-box'));
        s.removeObject('el-box');
      },
    },
  ];

  test.each(boundCases)('$name', ({ action }) => {
    expectEquivalent(action);
  });

  // Pinned outcomes — equivalence alone could be satisfied by both paths
  // doing nothing; these tests pin the actual follow/cascade behaviour.

  test('label recenters on the container, keeps its own hugged width under the cap', () => {
    const out = runLocal((s) => {
      s.addElement('s2', boundLabel('el-lbl', 'el-box'));
      s.updateElement('s2', 'el-box', { x: 700, y: 480 });
    });
    const box = out.slides['s2'].elements['el-box'];
    const lbl = out.slides['s2'].elements['el-lbl'] as TextElement;
    // Hug model: the label's measured-fit width (144 < box.width − 2·pad)
    // is preserved by the follow pass; only the recenter is applied.
    expect(lbl.width).toBe(144);
    expect(lbl.x + lbl.width / 2).toBeCloseTo(box.x + box.width / 2);
    expect(lbl.y + lbl.height / 2).toBeCloseTo(box.y + box.height / 2);
  });

  test('shrinking the container caps the label width at the new inner width', () => {
    const out = runLocal((s) => {
      s.addElement('s2', boundLabel('el-lbl', 'el-box'));
      s.updateElement('s2', 'el-box', { width: 120 }); // inner width 104 < 144
    });
    const box = out.slides['s2'].elements['el-box'];
    const lbl = out.slides['s2'].elements['el-lbl'] as TextElement;
    expect(lbl.width).toBe(120 - 16); // 2 × BOUND_TEXT_PADDING
    expect(lbl.x + lbl.width / 2).toBeCloseTo(box.x + box.width / 2);
  });

  test('arrow label sits on the arc-length midpoint after the rebind', () => {
    const out = runLocal((s) => {
      s.addElement('s2', boundLabel('el-lbl', 'el-conn'));
      s.updateElement('s2', 'el-box', { x: 700, y: 500 });
    });
    const conn = out.slides['s2'].elements['el-conn'] as ShapeElement;
    const lbl = out.slides['s2'].elements['el-lbl'] as TextElement;
    const mid = pathLabelCenter(conn)!;
    expect(lbl.x + lbl.width / 2).toBeCloseTo(mid.x);
    expect(lbl.y + lbl.height / 2).toBeCloseTo(mid.y);
  });

  test('terminal delete of the container removes the label everywhere incl. registry', () => {
    const out = runLocal((s) => {
      s.addElement('s2', boundLabel('el-lbl', 'el-box'));
      s.deleteElements('s2', ['el-box']);
    });
    expect(out.objects['el-box']).toBeUndefined();
    expect(out.objects['el-lbl']).toBeUndefined();
    for (const slide of Object.values(out.slides)) {
      expect(slide.elements['el-box']).toBeUndefined();
      expect(slide.elements['el-lbl']).toBeUndefined();
    }
  });

  test('unhide with position re-anchors the copied label on the container center', () => {
    const out = runLocal((s) => {
      s.addElement('s1', boundLabel('el-lbl', 'el-rect'));
      s.unhideElement('s3', 'el-rect', { x: 100, y: 200 });
    });
    const rect = out.slides['s3'].elements['el-rect'];
    const lbl = out.slides['s3'].elements['el-lbl'] as TextElement;
    expect(rect).toBeDefined();
    expect(lbl).toBeDefined();
    expect(lbl.visible).toBe(true);
    expect(lbl.x + lbl.width / 2).toBeCloseTo(rect.x + rect.width / 2);
    expect(lbl.y + lbl.height / 2).toBeCloseTo(rect.y + rect.height / 2);
  });

  test('keyframes stay self-consistent: moving the container on ONE slide only moves that keyframe label', () => {
    let dupId = '';
    const out = runLocal((s) => {
      // Two keyframes: s2 and a duplicate of it. The label starts already
      // in its synced position (its hugged width, centred on el-box) so the
      // duplicated keyframe is self-consistent from the start.
      s.addElement('s2', boundLabel('el-lbl', 'el-box', { x: 628, y: 430, width: 144 }));
      dupId = s.duplicateSlide('s2');
      s.updateElement('s2', 'el-box', { x: 700, y: 480 });
    });
    const movedLbl = out.slides['s2'].elements['el-lbl'] as TextElement;
    const movedBox = out.slides['s2'].elements['el-box'];
    const dupLbl = out.slides[dupId].elements['el-lbl'] as TextElement;
    const dupBox = out.slides[dupId].elements['el-box'];
    // Moved keyframe: label recentred on the moved box.
    expect(movedLbl.x + movedLbl.width / 2).toBeCloseTo(movedBox.x + movedBox.width / 2);
    // Untouched keyframe: label still centred on the ORIGINAL box position.
    expect(dupLbl.x + dupLbl.width / 2).toBeCloseTo(dupBox.x + dupBox.width / 2);
    expect(dupBox.x).not.toBeCloseTo(movedBox.x);
  });
});

// =============================================================================
// WS-3 Phase 3: mergeObjects (dual-path) — merging object SOURCE into TARGET
// re-identifies the source's keyframes under the target's id; conflicts
// resolve target-wins; bindings + bound-text containerIds remap deck-wide;
// the source's registry entry is dropped.
//
// Fixture recap: el-rect s1-only; el-solo s3-only; el-text s1+s2; el-box
// s2-only; el-conn s2 with startBinding → el-box; el-img s2(hidden)+s3.
// =============================================================================

describe('WS-3 Phase 3 mergeObjects (dual-path)', () => {
  const mergeCases: Array<{ name: string; action: Action }> = [
    {
      name: 'disjoint merge (el-rect@s1 into el-solo@s3) — keyframes re-identified',
      action: (s) => { s.mergeObjects('el-solo', 'el-rect'); },
    },
    {
      name: 'conflict merge (el-text into el-box) — target wins on s2, moves on s1',
      action: (s) => { s.mergeObjects('el-box', 'el-text'); },
    },
    {
      name: 'binding rewrite (el-box into el-solo) — el-conn re-points at el-solo',
      action: (s) => { s.mergeObjects('el-solo', 'el-box'); },
    },
    {
      name: 'bound-label containerId remap (label on el-box, el-box merged into el-solo)',
      action: (s) => {
        s.addElement('s2', textEl('el-lbl', {
          containerId: 'el-box', text: 'Label', width: 184, height: 40, x: 608, y: 430,
          style: { ...baseStyle, align: 'center', verticalAlign: 'middle' },
        }));
        s.mergeObjects('el-solo', 'el-box');
      },
    },
    {
      name: 'guard no-op: source === target',
      action: (s) => { s.mergeObjects('el-text', 'el-text'); },
    },
    {
      name: 'guard no-op: source exists on no slide',
      action: (s) => { s.mergeObjects('el-text', 'el-ghost'); },
    },
  ];

  test.each(mergeCases)('$name', ({ action }) => {
    expectEquivalent(action);
  });

  // Pinned outcomes — equivalence alone could be satisfied by both paths
  // doing nothing; these pin the actual merge result on each path.

  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s: conflict merge keeps the target keyframe, moves the disjoint one, cleans the registry', (_name, run) => {
    const out = run((s) => { s.mergeObjects('el-box', 'el-text'); });

    // s1 (el-text only): moved under the target id, embedded id rewritten,
    // z-position preserved (el-text was first in the order).
    const moved = out.slides.s1.elements['el-box'] as TextElement;
    expect(out.slides.s1.elements['el-text']).toBeUndefined();
    expect(moved.id).toBe('el-box');
    expect(moved.type).toBe('text');
    expect(moved.text).toBe('Text el-text');
    expect(out.slides.s1.elementOrder).toEqual(['el-box', 'el-rect', 'el-extra']);

    // s2 (both existed): TARGET WINS — the rect keyframe survives, the
    // source's element + order entry are dropped.
    const kept = out.slides.s2.elements['el-box'] as ShapeElement;
    expect(out.slides.s2.elements['el-text']).toBeUndefined();
    expect(kept.type).toBe('shape');
    expect(kept.x).toBe(600);
    expect(out.slides.s2.elementOrder).toEqual(['el-box', 'el-conn', 'el-img']);

    // Registry: source entry gone; target keeps its id/name/type.
    expect(out.objects['el-text']).toBeUndefined();
    expect(out.objects['el-box']).toEqual({ id: 'el-box', name: 'Rectangle 2', type: 'shape' });
  });

  test.each([
    ['local JSON path', runLocal],
    ['collab Y path', runCollab],
  ] as const)('%s: merging the bound target remaps el-conn\'s binding and a bound label\'s containerId', (_name, run) => {
    const out = run((s) => {
      s.addElement('s2', textEl('el-lbl', {
        containerId: 'el-box', text: 'Label', width: 184, height: 40, x: 608, y: 430,
        style: { ...baseStyle, align: 'center', verticalAlign: 'middle' },
      }));
      s.mergeObjects('el-solo', 'el-box');
    });

    // el-box's s2 keyframe now lives under el-solo, in el-box's old z-slot.
    const movedBox = out.slides.s2.elements['el-solo'] as ShapeElement;
    expect(out.slides.s2.elements['el-box']).toBeUndefined();
    expect(movedBox.id).toBe('el-solo');
    expect(movedBox.x).toBe(600);
    expect(out.slides.s2.elementOrder).toEqual(['el-text', 'el-solo', 'el-conn', 'el-img', 'el-lbl']);
    // el-solo's own s3 keyframe (the star) is untouched.
    expect((out.slides.s3.elements['el-solo'] as ShapeElement).shapeType).toBe('star');

    // Connector binding re-points at the surviving identity.
    const conn = out.slides.s2.elements['el-conn'] as ShapeElement;
    expect(conn.startBinding).toEqual({ elementId: 'el-solo', mode: 'pinned', fixedPoint: [0, .5] });
    expect(conn.endBinding).toBeNull();

    // Bound label follows the re-identified container.
    expect((out.slides.s2.elements['el-lbl'] as TextElement).containerId).toBe('el-solo');

    // Registry cleanup: el-box gone, el-solo keeps its meta.
    expect(out.objects['el-box']).toBeUndefined();
    expect(out.objects['el-solo']).toEqual({ id: 'el-solo', name: 'Star 1', type: 'shape' });
  });

  test('return-value parity: merged flag + droppedOnSlides agree across both paths', () => {
    let localRet: { merged: boolean; droppedOnSlides: string[] } | undefined;
    let collabRet: { merged: boolean; droppedOnSlides: string[] } | undefined;

    runLocal((s) => { localRet = s.mergeObjects('el-box', 'el-text'); });
    runCollab((s) => { collabRet = s.mergeObjects('el-box', 'el-text'); });
    expect(localRet).toEqual({ merged: true, droppedOnSlides: ['s2'] });
    expect(collabRet).toEqual(localRet);

    // Disjoint merge: no drops.
    runLocal((s) => { localRet = s.mergeObjects('el-solo', 'el-rect'); });
    runCollab((s) => { collabRet = s.mergeObjects('el-solo', 'el-rect'); });
    expect(localRet).toEqual({ merged: true, droppedOnSlides: [] });
    expect(collabRet).toEqual(localRet);

    // Guarded no-ops report merged: false on both paths.
    runLocal((s) => { localRet = s.mergeObjects('el-text', 'el-text'); });
    runCollab((s) => { collabRet = s.mergeObjects('el-text', 'el-text'); });
    expect(localRet).toEqual({ merged: false, droppedOnSlides: [] });
    expect(collabRet).toEqual(localRet);

    runLocal((s) => { localRet = s.mergeObjects('el-text', 'el-ghost'); });
    runCollab((s) => { collabRet = s.mergeObjects('el-text', 'el-ghost'); });
    expect(localRet).toEqual({ merged: false, droppedOnSlides: [] });
    expect(collabRet).toEqual(localRet);
  });
});
