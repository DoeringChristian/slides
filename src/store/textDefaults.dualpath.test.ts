import { afterEach, describe, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { deckTextStyle } from './textDefaults';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor } from '../collab/activeUndo';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement, createTextElement } from '../utils/model/slideFactory';
import { createBoundLabel } from '../utils/model/syncDependents';
import { DEFAULT_TEXT_STYLE } from '../utils/constants';
import type { Presentation } from '../types/presentation';

afterEach(() => setActiveDoc(null));

function setup(collab: boolean) {
  const p = createPresentation();
  const sid = p.slideOrder[0];
  p.slides[sid].elements = { t: createTextElement({ id: 't', text: 'Hi' }) };
  p.slides[sid].elementOrder = ['t'];
  store.setState({ presentation: p });
  store.temporal.getState().clear();
  const doc = collab ? jsonToYDoc(p) : null;
  setActiveDoc(doc);
  const undo = doc ? createUndoManagerFor(doc) : null;
  // Collab: the store follows the doc through yToStoreSync in the app; here
  // mirror it by hand so deckTextStyle (which reads the store) sees writes.
  const sync = () => { if (doc) store.setState({ presentation: yDocToJson(doc) as Presentation }); };
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation) as Presentation;
  return { sid, read, sync, undo };
}

describe.each([false, true])('default text fonts collab=%s', collab => {
  it('remembers the picked fonts in the deck, without an undo step of their own', () => {
    const { sid, read, sync, undo } = setup(collab);
    // The pick edits the element (an undo step) and sets the default (none).
    store.getState().updateElement(sid, 't', { style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Libertinus Serif' } });
    undo?.stopCapturing();
    store.getState().setDefaultTextFonts({ fontFamily: 'Libertinus Serif', mathFont: 'mathjax-termes' });
    sync();
    expect(read().theme.fonts).toMatchObject({ body: 'Libertinus Serif', math: 'mathjax-termes' });
    expect(deckTextStyle()).toMatchObject({ fontFamily: 'Libertinus Serif', mathFont: 'mathjax-termes' });

    // One undo reverts the element edit; it is not spent on the preference.
    if (undo) {
      expect(undo.undoStack).toHaveLength(1);
      undo.undo();
    } else {
      expect(store.temporal.getState().pastStates).toHaveLength(1);
      store.temporal.getState().undo();
    }
    sync();
    expect((read().slides[sid].elements.t as { style: { fontFamily: string } }).style.fontFamily).toBe(DEFAULT_TEXT_STYLE.fontFamily);

    // "Match text font" clears the math default.
    store.getState().setDefaultTextFonts({ mathFont: '' });
    sync();
    expect(read().theme.fonts.math).toBeUndefined();
    expect(deckTextStyle().mathFont).toBeUndefined();
  });
});

describe('deckTextStyle', () => {
  it('falls back to the default font for faces that are not bundled', () => {
    setup(false);
    // createDefaultTheme still says 'Arial', as older decks do.
    expect(store.getState().presentation.theme.fonts.body).toBe('Arial');
    expect(deckTextStyle()).toEqual(DEFAULT_TEXT_STYLE);
  });

  it('gives new shape labels the deck font', () => {
    setup(false);
    store.getState().setDefaultTextFonts({ fontFamily: 'Libertinus Serif' });
    const label = createBoundLabel(createShapeElement('rect', { id: 'box' }), deckTextStyle());
    expect(label.style).toMatchObject({ fontFamily: 'Libertinus Serif', align: 'center', verticalAlign: 'middle' });
  });
});
