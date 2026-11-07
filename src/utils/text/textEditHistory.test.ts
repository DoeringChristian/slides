import { describe, it, expect } from 'vitest';
import { createTextEditHistory, diffTexts, COALESCE_MS } from './textEditHistory';

const snap = (text: string, caret = text.length) => ({ text, caret });

/** Type `text` one character at a time, all within one coalescing window. */
function type(history: ReturnType<typeof createTextEditHistory>, text: string, from = '', t0 = 1000) {
  let current = from;
  let now = t0;
  for (const ch of text) {
    current += ch;
    history.record(snap(current), now);
    now += 50;
  }
  return current;
}

describe('diffTexts', () => {
  it('finds a pure insertion', () => {
    expect(diffTexts('ac', 'abc')).toEqual({ at: 1, removed: '', inserted: 'b' });
  });

  it('finds a pure deletion', () => {
    expect(diffTexts('abc', 'ac')).toEqual({ at: 1, removed: 'b', inserted: '' });
  });

  it('finds a replacement', () => {
    expect(diffTexts('abc', 'axc')).toEqual({ at: 1, removed: 'b', inserted: 'x' });
  });

  it('reports no change for equal texts', () => {
    expect(diffTexts('abc', 'abc')).toEqual({ at: 3, removed: '', inserted: '' });
  });

  it('handles appending to empty', () => {
    expect(diffTexts('', 'hi')).toEqual({ at: 0, removed: '', inserted: 'hi' });
  });

  it('does not over-match a repeated character', () => {
    // 'aa' -> 'aaa' is one insertion wherever it is attributed, and the
    // prefix/suffix split must not claim to remove anything.
    const change = diffTexts('aa', 'aaa');
    expect(change.removed).toBe('');
    expect(change.inserted).toBe('a');
  });
});

describe('a run of typing is one undo step', () => {
  it('coalesces a word and restores the session start', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'hello');
    expect(h.canUndo()).toBe(true);
    expect(h.undo(snap('hello'))?.text).toBe('');
    expect(h.canUndo()).toBe(false);
  });

  it('breaks at a space, so undo steps back one word', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'one two');
    expect(h.undo(snap('one two'))?.text).toBe('one ');
    expect(h.undo(snap('one '))?.text).toBe('');
  });

  it('breaks at a newline', () => {
    const h = createTextEditHistory(snap(''));
    const text = type(h, 'a\nb');
    expect(text).toBe('a\nb');
    expect(h.undo(snap('a\nb'))?.text).toBe('a\n');
    expect(h.undo(snap('a\n'))?.text).toBe('a');
  });

  it('breaks after a pause', () => {
    const h = createTextEditHistory(snap(''));
    h.record(snap('a'), 1000);
    h.record(snap('ab'), 1000 + COALESCE_MS + 1);
    expect(h.undo(snap('ab'))?.text).toBe('a');
  });

  it('breaks when the caret jumps', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'abc');
    // Insert at the start instead of continuing at the end.
    h.record(snap('Xabc', 1), 1200);
    expect(h.undo(snap('Xabc'))?.text).toBe('abc');
  });

  it('breaks between typing and deleting', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'abc');
    h.record(snap('ab'), 1200);
    expect(h.undo(snap('ab'))?.text).toBe('abc');
  });

  it('coalesces a backspace run', () => {
    const h = createTextEditHistory(snap('abcd'));
    h.record(snap('abc'), 1000);
    h.record(snap('ab'), 1050);
    h.record(snap('a'), 1100);
    expect(h.undo(snap('a'))?.text).toBe('abcd');
  });

  it('treats a selection replacement as its own step', () => {
    const h = createTextEditHistory(snap('hello world'));
    h.record(snap('hello there'), 1000);
    h.record(snap('hello theres'), 1050);
    expect(h.undo(snap('hello theres'))?.text).toBe('hello there');
    expect(h.undo(snap('hello there'))?.text).toBe('hello world');
  });
});

describe('redo', () => {
  it('returns what was undone', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'hi');
    expect(h.undo(snap('hi'))?.text).toBe('');
    expect(h.canRedo()).toBe(true);
    expect(h.redo()?.text).toBe('hi');
    expect(h.canRedo()).toBe(false);
  });

  it('is discarded by a new edit', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'hi');
    h.undo(snap('hi'));
    h.record(snap('bye'), 5000);
    expect(h.canRedo()).toBe(false);
  });

  it('does not fuse a post-undo edit into the entry it replaced', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'ab');
    h.undo(snap('ab'));
    type(h, 'xy', '', 9000);
    expect(h.undo(snap('xy'))?.text).toBe('');
  });

  it('keeps the on-screen state when it is ahead of the last record', () => {
    // The final keystroke of a run can reach the DOM before it is recorded;
    // undo must still be able to redo back to it.
    const h = createTextEditHistory(snap(''));
    type(h, 'ab');
    h.undo(snap('abc'));
    expect(h.redo()?.text).toBe('abc');
  });
});

describe('caret', () => {
  it('comes back with the text', () => {
    const h = createTextEditHistory(snap('', 0));
    h.record(snap('hello', 5), 1000);
    expect(h.undo(snap('hello', 5))).toEqual({ text: '', caret: 0 });
  });

  it('tracks caret movement without creating an entry', () => {
    const h = createTextEditHistory(snap('abc', 3));
    h.record(snap('abc', 0), 1000);
    expect(h.canUndo()).toBe(false);
  });
});

describe('breakRun', () => {
  it('forces the next edit into a new entry', () => {
    const h = createTextEditHistory(snap(''));
    type(h, 'ab');
    h.breakRun();
    h.record(snap('abc'), 1200);
    expect(h.undo(snap('abc'))?.text).toBe('ab');
  });
});
