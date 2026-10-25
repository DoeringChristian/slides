import { CreationDraftContext } from '../properties/CreationDraftContext';
import { useContext, useEffect, useRef, useState } from 'react';
import { ownScrubMutation, registerScrubMutation } from '../../utils/scrubMutation';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { getActiveUndoManager, beginScrubCapture } from '../../collab/activeUndo';
import { copyNestedFields } from '../properties/Property';
import type { CurrentChange } from '../../store/currentMutation';

/**
 * Scrub-commit protocol: live canvas preview during a drag-to-scrub gesture
 * with EXACTLY ONE undo entry, in both undo systems.
 *
 * Unrelated local actions invalidate and cancel the gesture before writing;
 * later pointer events are inert. Explicit typed/nudge edits remain usable.
 *
 * The ordering is the critical piece:
 *
 *   begin()   — snapshot the pre-scrub values of all syncFields, then pause
 *               zundo history and (collab) force a Y.UndoManager capture
 *               boundary.
 *   preview() — plain store updates: history is paused locally; collab peers
 *               see the live scrub (each write goes through Yjs as usual).
 *   end()     — WHILE STILL PAUSED restore the pre-scrub snapshot, resume,
 *               then apply the final changes. zundo records the state before
 *               the final write — which is now the PRE-scrub state — so the
 *               whole gesture collapses into a single undo entry. On the Y
 *               side the capture window opened at begin() merges the scrub's
 *               writes (previews + restore + final) into one undo step.
 *   cancel()  — restore the snapshot while paused, resume. No entry.
 *
 * `runScrubSession` is the pure, DOM-free core (node-testable); the hook
 * wires it to the presentation store, the active Y.UndoManager, and the
 * per-row `update` callback the property editors already receive.
 */

export interface ScrubHandles<C> {
  /** Pause history capture (zundo pause; collab capture boundary). */
  pause: () => void;
  /** Resume history capture. */
  resume: () => void;
  /** Write a change set to the store. Previews, the pre-scrub restore, and
   *  the final commit all route through the same writer. */
  apply: (changes: C) => void;
  /** Accepted edit boundary; previews/restores never call this. */
  commit?: (changes: C) => void;
  /** Capture the restore payload: applying its result must put every field
   *  the scrub can touch back to its current (pre-scrub) value. */
  snapshot: () => C;
  /** Close collab capture AFTER the final write (or after restoring a cancel). */
  finish?: (cancelled: boolean) => void;
}

export interface ScrubSession<C> {
  begin: () => void;
  preview: (changes: C) => void;
  /** Close the session with the committed changes. When no session is
   *  active this degrades to a plain `apply` — a discrete edit (typed
   *  value, arrow-key nudge) that should produce its own undo entry. */
  end: (finalChanges: C) => void;
  cancel: () => void;
  /** Typed values/nudges are not the tail of an invalidated pointer gesture. */
  commitDiscrete: (changes: C) => void;
}

export function runScrubSession<C>(handles: ScrubHandles<C>): ScrubSession<C> {
  let active = false;
  let invalidated = false;
  let snap: C | null = null;
  let release: (() => void) | undefined;
  const apply = (changes: C) => ownScrubMutation(() => handles.apply(changes));
  const commit = (changes: C) => (handles.commit ?? handles.apply)(changes);
  const close = (cancelled: boolean, finalChanges?: C) => {
    active = false;
    release?.(); release = undefined;
    try {
      apply(snap as C);
    } finally {
      handles.resume();
      try {
        if (!cancelled) ownScrubMutation(() => commit(finalChanges as C));
      } finally {
        ownScrubMutation(() => handles.finish?.(cancelled));
        snap = null;
      }
    }
  };
  return {
    begin() {
      if (active) return;
      release = registerScrubMutation(() => {
        invalidated = true;
        if (active) close(true);
      });
      invalidated = false;
      try {
        snap = handles.snapshot();
        handles.pause();
        active = true;
      } catch (error) {
        release(); release = undefined;
        handles.resume();
        throw error;
      }
    },
    preview(changes: C) {
      if (!active) return;
      try { apply(changes); } catch (error) {
        invalidated = true;
        close(true);
        throw error;
      }
    },
    end(finalChanges: C) {
      if (invalidated) return;
      if (!active) { commit(finalChanges); return; }
      close(false, finalChanges);
    },
    cancel() {
      invalidated = true;
      if (active) close(true);
    },
    commitDiscrete(changes: C) {
      if (active) close(true);
      invalidated = false;
      commit(changes);
    },
  };
}

/** Build the restore payload for a set of dot-notation field paths: a
 *  partial that re-applies each field's CURRENT value (nested paths spread
 *  their intermediate objects from the element, so sibling fields under
 *  e.g. `style` survive the round-trip). */
export function snapshotFields<E>(element: E, fields: string[]): Partial<E> {
  return copyNestedFields(element, element, fields);
}

export interface UseScrubCommitArgs<T extends object> {
  element: T;
  update: ((changes: CurrentChange<T>) => void) & { commit?: (changes: CurrentChange<T>) => void };
  /** All field paths the gesture may touch (the property's `syncFields`),
   *  snapshotted at begin() and restored at end()/cancel(). */
  syncFields: string[];
}

/**
 * Per-row hook binding `runScrubSession` to the presentation store's two
 * undo systems. Map the editor's callbacks:
 *   onScrubStart → begin, onPreview → preview, onCommit → end,
 *   onScrubCancel → cancel.
 * The returned session is referentially stable; it always reads the latest
 * element / update through refs, so mid-scrub re-renders are safe.
 */
export function useScrubCommit<T extends object>(
  { element, update, syncFields }: UseScrubCommitArgs<T>,
): ScrubSession<CurrentChange<T>> {
  const draft = useContext(CreationDraftContext);
  const draftRef = useRef(draft);
  const elementRef = useRef(element);
  const updateRef = useRef(update);
  const syncFieldsRef = useRef(syncFields);
  // Closes the collab capture window opened at `pause`. Held in a ref (not a
  // closure variable) because the session handles are built once and mutate
  // it across gestures.
  const finishCaptureRef = useRef<((cancelled: boolean) => void) | undefined>(undefined);
  useEffect(() => {
    draftRef.current = draft;
    elementRef.current = element;
    updateRef.current = update;
    syncFieldsRef.current = syncFields;
  });

  // The handle closures capture the refs but dereference them only when the
  // session runs (inside pointer-event handlers), never during render —
  // runScrubSession just stores the handles.
  /* eslint-disable react-hooks/refs */
  // Lazy state initializer rather than useMemo: the session must be built
  // exactly once (it owns gesture state), and an empty-dep useMemo is only a
  // caching hint the compiler may discard.
  const [session] = useState(
    () => runScrubSession<CurrentChange<T>>({
      pause: () => {
        if (draftRef.current) return;
        usePresentationStore.temporal.getState().pause();
        // Collab: force a capture boundary so the scrub's writes never
        // merge backwards into whatever was captured before the gesture.
        finishCaptureRef.current = beginScrubCapture(getActiveUndoManager());
      },
      resume: () => {
        if (draftRef.current) return;
        usePresentationStore.temporal.getState().resume();
      },
      apply: (changes) => updateRef.current(changes),
      commit: (changes) => (updateRef.current.commit ?? updateRef.current)(changes),
      snapshot: () => {
        const source = elementRef.current, fields = syncFieldsRef.current;
        // The captured values belong to the gesture; sibling values do not.
        return current => copyNestedFields(source, current, fields);
      },
      finish: (cancelled) => {
        draftRef.current?.discard();
        finishCaptureRef.current?.(cancelled);
        finishCaptureRef.current = undefined;
      },
    }),
  );
  /* eslint-enable react-hooks/refs */

  useEffect(() => useEditorStore.subscribe((next, previous) => {
    if (next.activeSlideId !== previous.activeSlideId
      || next.selectedElementIds.join() !== previous.selectedElementIds.join()) session.cancel();
  }), [session]);

  // Never leave history paused if the row unmounts mid-scrub (element
  // deleted, panel switched): unwind like a cancel. No-op when idle.
  useEffect(() => () => session.cancel(), [session]);

  return session;
}
