/**
 * Unit tests for the scrub-commit session core (`runScrubSession`) against a
 * REAL zustand + zundo temporal store shaped like the presentation store
 * (same `equality` and `limit` options). The sharpest edge under test is the
 * ordering inside `end()`: restore-while-paused → resume → final commit must
 * yield EXACTLY ONE undo entry whose past state is the PRE-scrub state.
 */
import { describe, expect, test, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { temporal } from 'zundo';

// The module under test reaches Property.tsx → ScrubInput → utils/keyboard,
// which installs window listeners at import time; this suite runs in the
// node environment, so stub the keyboard module (modifier polling is
// irrelevant to session math).
vi.mock('../../utils/keyboard', () => ({
  isShiftHeld: () => false,
  isCtrlHeld: () => false,
}));

import { runScrubSession, snapshotFields, type ScrubHandles } from './useScrubCommit';

interface TestElement {
  id: string;
  x: number;
  y: number;
  width: number;
  style: { fontSize: number; fontFamily: string; color: string };
}

interface TestState {
  presentation: {
    slides: Record<string, { elements: Record<string, TestElement> }>;
    updatedAt: number;
  };
  updateElement: (elementId: string, changes: Partial<TestElement>) => void;
}

function makeStore() {
  const initial: TestElement = {
    id: 'e1',
    x: 10,
    y: 20,
    width: 100,
    style: { fontSize: 16, fontFamily: 'Inter', color: '#111111' },
  };
  const store = createStore<TestState>()(
    temporal(
      (set) => ({
        presentation: {
          slides: { s1: { elements: { e1: initial } } },
          updatedAt: 0,
        },
        updateElement: (elementId, changes) =>
          set((state) => {
            const slide = state.presentation.slides.s1;
            const el = slide.elements[elementId];
            if (!el) return state;
            return {
              presentation: {
                ...state.presentation,
                slides: {
                  ...state.presentation.slides,
                  s1: { ...slide, elements: { ...slide.elements, [elementId]: { ...el, ...changes } } },
                },
                updatedAt: Date.now(),
              },
            };
          }),
      }),
      {
        // Same temporal options as src/store/presentationStore.ts.
        limit: 50,
        equality: (pastState, currentState) => pastState.presentation === currentState.presentation,
      },
    ),
  );
  return store;
}

type TestStore = ReturnType<typeof makeStore>;

function el(store: TestStore): TestElement {
  return store.getState().presentation.slides.s1.elements.e1;
}

function pastStates(store: TestStore) {
  return store.temporal.getState().pastStates as TestState[];
}

/** Mirrors exactly what useScrubCommit wires up (minus the Y.UndoManager,
 *  which is null outside a collab session). */
function handlesFor(store: TestStore, syncFields: string[]): ScrubHandles<Partial<TestElement>> {
  return {
    pause: () => store.temporal.getState().pause(),
    resume: () => store.temporal.getState().resume(),
    apply: (changes) => store.getState().updateElement('e1', changes),
    snapshot: () => snapshotFields(el(store), syncFields),
  };
}

describe('runScrubSession', () => {
  test('begin → N previews → end grows pastStates by EXACTLY 1, past = pre-scrub, current = final', () => {
    const store = makeStore();
    const session = runScrubSession(handlesFor(store, ['x']));

    // Control: plain updates each push one entry (this is the per-move spam
    // the session exists to prevent).
    store.getState().updateElement('e1', { x: 11 });
    store.getState().updateElement('e1', { x: 12 });
    expect(pastStates(store).length).toBe(2);

    const before = pastStates(store).length;
    const preScrubX = el(store).x; // 12

    session.begin();
    session.preview({ x: 40 });
    session.preview({ x: 41 });
    session.preview({ x: 42 });
    expect(el(store).x).toBe(42); // canvas sees the live scrub
    expect(pastStates(store).length).toBe(before); // history paused
    session.end({ x: 42 });

    expect(pastStates(store).length).toBe(before + 1);
    const top = pastStates(store)[pastStates(store).length - 1];
    expect(top.presentation.slides.s1.elements.e1.x).toBe(preScrubX);
    expect(el(store).x).toBe(42);

    // Undo jumps straight back to the pre-scrub state.
    store.temporal.getState().undo();
    expect(el(store).x).toBe(preScrubX);
    store.temporal.getState().redo();
    expect(el(store).x).toBe(42);
  });

  test('cancel leaves pastStates unchanged and restores the pre-scrub value', () => {
    const store = makeStore();
    const session = runScrubSession(handlesFor(store, ['x']));

    store.getState().updateElement('e1', { x: 20 });
    const before = pastStates(store).length;

    session.begin();
    session.preview({ x: 55 });
    session.preview({ x: 60 });
    expect(el(store).x).toBe(60);
    session.cancel();

    expect(pastStates(store).length).toBe(before);
    expect(el(store).x).toBe(20);

    // History capture resumed: the next plain edit records normally.
    store.getState().updateElement('e1', { x: 21 });
    expect(pastStates(store).length).toBe(before + 1);
  });

  test('nested path (style.fontSize) snapshot/restore preserves sibling style fields', () => {
    const store = makeStore();
    const session = runScrubSession(handlesFor(store, ['style.fontSize']));

    const before = pastStates(store).length;
    session.begin();
    // Previews built the way the editors build them: intermediate objects
    // spread from the live element.
    session.preview({ style: { ...el(store).style, fontSize: 24 } });
    session.preview({ style: { ...el(store).style, fontSize: 30 } });
    session.end({ style: { ...el(store).style, fontSize: 32 } });

    expect(pastStates(store).length).toBe(before + 1);
    const top = pastStates(store)[pastStates(store).length - 1];
    // Past = pre-scrub fontSize with siblings intact...
    expect(top.presentation.slides.s1.elements.e1.style).toEqual({
      fontSize: 16,
      fontFamily: 'Inter',
      color: '#111111',
    });
    // ...and the final state keeps siblings too.
    expect(el(store).style).toEqual({ fontSize: 32, fontFamily: 'Inter', color: '#111111' });

    store.temporal.getState().undo();
    expect(el(store).style).toEqual({ fontSize: 16, fontFamily: 'Inter', color: '#111111' });
  });

  test('multi-field session (pair) restores every syncField', () => {
    const store = makeStore();
    const session = runScrubSession(handlesFor(store, ['x', 'y']));

    const before = pastStates(store).length;
    session.begin();
    session.preview({ x: 100 });
    session.preview({ y: 200 });
    session.cancel();

    expect(pastStates(store).length).toBe(before);
    expect(el(store).x).toBe(10);
    expect(el(store).y).toBe(20);
  });

  test('end without begin is a plain discrete commit (one entry each)', () => {
    const store = makeStore();
    const session = runScrubSession(handlesFor(store, ['x']));

    session.end({ x: 15 });
    session.end({ x: 16 });

    expect(pastStates(store).length).toBe(2);
    expect(el(store).x).toBe(16);
    // preview / cancel outside a session are no-ops.
    session.preview({ x: 99 });
    session.cancel();
    expect(el(store).x).toBe(16);
    expect(pastStates(store).length).toBe(2);
  });

  test('double begin is idempotent; the first snapshot wins', () => {
    const store = makeStore();
    const session = runScrubSession(handlesFor(store, ['x']));

    session.begin();
    session.preview({ x: 77 });
    session.begin(); // must NOT re-snapshot the previewed value
    session.preview({ x: 88 });
    session.cancel();

    expect(el(store).x).toBe(10);
    expect(pastStates(store).length).toBe(0);
  });
});
