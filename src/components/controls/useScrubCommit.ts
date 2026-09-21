import { useEffect, useMemo, useRef } from 'react';
import { usePresentationStore } from '../../store/presentationStore';
import { getActiveUndoManager } from '../../collab/activeUndo';
import { getNested, setNestedPartial } from '../properties/Property';

/**
 * Scrub-commit protocol: live canvas preview during a drag-to-scrub gesture
 * with EXACTLY ONE undo entry, in both undo systems.
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
  /** Capture the restore payload: applying its result must put every field
   *  the scrub can touch back to its current (pre-scrub) value. */
  snapshot: () => C;
}

export interface ScrubSession<C> {
  begin: () => void;
  preview: (changes: C) => void;
  /** Close the session with the committed changes. When no session is
   *  active this degrades to a plain `apply` — a discrete edit (typed
   *  value, arrow-key nudge) that should produce its own undo entry. */
  end: (finalChanges: C) => void;
  cancel: () => void;
}

export function runScrubSession<C>(handles: ScrubHandles<C>): ScrubSession<C> {
  let active = false;
  let snap: C | null = null;

  return {
    begin() {
      if (active) return;
      // Snapshot BEFORE pausing so a (theoretical) side effect of pause can't
      // sneak into the restore payload; nothing has previewed yet.
      snap = handles.snapshot();
      handles.pause();
      active = true;
    },

    preview(changes: C) {
      if (!active) return;
      handles.apply(changes);
    },

    end(finalChanges: C) {
      if (!active) {
        // No scrub in flight: a discrete commit (edit mode, arrow keys).
        handles.apply(finalChanges);
        return;
      }
      active = false;
      // CRITICAL ORDER — restore the pre-scrub state while history is still
      // paused, resume, THEN apply the final value. The state zundo records
      // as "past" on the final write is the restored (pre-scrub) state.
      // All three run in the same handler so React batches the paint.
      handles.apply(snap as C);
      handles.resume();
      handles.apply(finalChanges);
      snap = null;
    },

    cancel() {
      if (!active) return;
      active = false;
      handles.apply(snap as C);
      handles.resume();
      snap = null;
    },
  };
}

/** Build the restore payload for a set of dot-notation field paths: a
 *  partial that re-applies each field's CURRENT value (nested paths spread
 *  their intermediate objects from the element, so sibling fields under
 *  e.g. `style` survive the round-trip). */
export function snapshotFields<E>(element: E, fields: string[]): Partial<E> {
  let changes: Partial<E> = {};
  for (const f of fields) {
    changes = { ...changes, ...setNestedPartial(element, f, getNested(element, f)) };
  }
  return changes;
}

export interface UseScrubCommitArgs<T extends object> {
  element: T;
  update: (changes: Partial<T>) => void;
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
): ScrubSession<Partial<T>> {
  const elementRef = useRef(element);
  const updateRef = useRef(update);
  const syncFieldsRef = useRef(syncFields);
  useEffect(() => {
    elementRef.current = element;
    updateRef.current = update;
    syncFieldsRef.current = syncFields;
  });

  // The handle closures capture the refs but dereference them only when the
  // session runs (inside pointer-event handlers), never during render —
  // runScrubSession just stores the handles.
  /* eslint-disable react-hooks/refs */
  const session = useMemo(
    () =>
      runScrubSession<Partial<T>>({
        pause: () => {
          usePresentationStore.temporal.getState().pause();
          // Collab: force a capture boundary so the scrub's writes never
          // merge backwards into whatever was captured before the gesture.
          getActiveUndoManager()?.stopCapturing();
        },
        resume: () => {
          usePresentationStore.temporal.getState().resume();
        },
        apply: (changes) => updateRef.current(changes),
        snapshot: () => snapshotFields(elementRef.current, syncFieldsRef.current),
      }),
    [],
  );
  /* eslint-enable react-hooks/refs */

  // Never leave history paused if the row unmounts mid-scrub (element
  // deleted, panel switched): unwind like a cancel. No-op when idle.
  useEffect(() => () => session.cancel(), [session]);

  return session;
}
