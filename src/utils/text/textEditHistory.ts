/**
 * Undo/redo for one text-editing session.
 *
 * The editor could not simply leave this to the browser. The overlay owns the
 * contentEditable's DOM — it rewrites line divs, moves the caret, and routes
 * structural edits through React state rather than letting the browser apply
 * them — and every one of those writes discards the native undo stack. On top
 * of that, Ctrl+Z was being swallowed by the global shortcut handler and run
 * against the PRESENTATION store, which does not even hold the text yet: an
 * edit session commits once, when it ends, so an undo mid-typing reverted
 * whatever structural change came before the session and left the half-typed
 * text sitting on top of it.
 *
 * So the session keeps its own stack of snapshots. It is deliberately a stack
 * of whole states rather than deltas: the texts are a few hundred characters,
 * and states cannot drift out of sync with the document the way a delta log
 * can when a structural edit rewrites the DOM underneath it.
 *
 * Granularity is the part worth getting right. One entry per keystroke makes
 * Ctrl+Z useless; one entry per session makes it destructive. Runs of ordinary
 * typing therefore coalesce into a single entry and break at the boundaries a
 * person expects to land on — a word, a line, a pause, or a change of
 * direction between typing and deleting.
 */

/** A point-in-time state of the edited text, with where the caret was. */
export interface TextSnapshot {
  text: string;
  caret: number;
}

/** The smallest edit that turns one text into another. */
export interface TextChange {
  /** Offset of the first differing character. */
  at: number;
  removed: string;
  inserted: string;
}

/**
 * Typing pauses longer than this start a new undo entry, so stepping away
 * mid-sentence and coming back does not fuse the two into one undo.
 */
export const COALESCE_MS = 800;

/**
 * The single edit between two texts, as a common-prefix/common-suffix diff.
 *
 * Exact for the edits a text field actually produces (one contiguous region
 * changes at a time), which is all this needs to classify a keystroke.
 */
export function diffTexts(before: string, after: string): TextChange {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < max - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]
  ) end++;
  return {
    at: start,
    removed: before.slice(start, before.length - end),
    inserted: after.slice(start, after.length - end),
  };
}

/** A run of same-direction single-character edits that fuse into one entry. */
interface OpenRun {
  kind: 'insert' | 'delete';
  /** Offset the next character of the run has to touch to continue it. */
  boundary: number;
}

export interface TextEditHistory {
  /**
   * Note a new state. Coalesces into the current entry when it continues the
   * run in progress, otherwise starts a new one. Recording anything discards
   * the redo stack, which is what makes "undo, then type" behave.
   */
  record(snapshot: TextSnapshot, now?: number): void;
  /** The state to go back to, or undefined at the start of the session. */
  undo(current: TextSnapshot): TextSnapshot | undefined;
  /** The state to go forward to, or undefined if nothing was undone. */
  redo(): TextSnapshot | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  /** End the current run, so the next edit starts a fresh entry. */
  breakRun(): void;
}

const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t';

export function createTextEditHistory(initial: TextSnapshot): TextEditHistory {
  // entries[0] is the text as the session found it, so undoing everything
  // restores it rather than running off the end into the previous document
  // state — which belongs to the presentation's undo stack, not this one.
  const entries: TextSnapshot[] = [{ ...initial }];
  let index = 0;
  let run: OpenRun | null = null;
  let lastAt = 0;

  /** Does this step continue the run in progress? */
  const continues = (change: TextChange, now: number): boolean => {
    if (!run || now - lastAt > COALESCE_MS) return false;
    if (change.removed && change.inserted) return false; // a replacement
    if (change.inserted.length === 1 && !change.removed) {
      // A newline is always its own undo step: a line is a unit people expect
      // to get back whole.
      if (change.inserted === '\n') return false;
      return run.kind === 'insert' && change.at === run.boundary;
    }
    if (change.removed.length === 1 && !change.inserted) {
      // Backspace walks left, Delete stays put; both continue a delete run.
      return run.kind === 'delete' && (change.at === run.boundary || change.at === run.boundary - 1);
    }
    return false;
  };

  /** Where the next character of the run has to land, or null to end it. */
  const runAfter = (change: TextChange): OpenRun | null => {
    if (change.inserted.length === 1 && !change.removed && change.inserted !== '\n') {
      // Close the run on whitespace so undo steps back a word at a time.
      if (isSpace(change.inserted)) return null;
      return { kind: 'insert', boundary: change.at + 1 };
    }
    if (change.removed.length === 1 && !change.inserted) {
      return { kind: 'delete', boundary: change.at };
    }
    return null;
  };

  return {
    record(snapshot, now = Date.now()) {
      const current = entries[index];
      if (snapshot.text === current.text) {
        // Pure caret movement. Keep it — an undo should put the caret back
        // where the user actually was — but never let it open a run.
        current.caret = snapshot.caret;
        return;
      }
      // entries[index] always holds the last recorded state, so this is the
      // single keystroke that just happened, even mid-run.
      const change = diffTexts(current.text, snapshot.text);
      if (continues(change, now)) {
        // Extend the entry in place. The state from before the run is still
        // at index - 1, so one Ctrl+Z unwinds the whole run.
        entries[index] = { ...snapshot };
      } else {
        entries.length = index + 1; // drop anything that was undone
        entries.push({ ...snapshot });
        index = entries.length - 1;
      }
      run = runAfter(change);
      lastAt = now;
    },
    undo(current) {
      if (index === 0) return undefined;
      // Whatever is on screen may be ahead of the top entry (the last
      // keystroke of a run that has not been recorded yet); keep it so redo
      // can return to it.
      if (current.text !== entries[index].text) entries[index] = { ...current };
      run = null;
      index--;
      return { ...entries[index] };
    },
    redo() {
      if (index >= entries.length - 1) return undefined;
      run = null;
      index++;
      return { ...entries[index] };
    },
    canUndo: () => index > 0,
    canRedo: () => index < entries.length - 1,
    breakRun() { run = null; },
  };
}
