import React, { useEffect, useRef, useState } from 'react';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { isShiftHeld } from '../../utils/keyboard';
import { DRAG_SLOP_MOUSE, DRAG_SLOP_TOUCH } from '../../utils/constants';
import {
  applyScrubDelta,
  commitValue,
  formatValue,
  parseInput,
  type ScrubSpec,
} from '../../utils/scrub';

/**
 * Blender-style numeric input: the whole field is a drag-to-scrub surface,
 * a plain click drops into a real text input.
 *
 * Disambiguation uses the armed→slop pattern from useSVGDrag: pointer-down
 * only ARMS the gesture; release before the slop threshold → edit mode;
 * crossing the slop horizontally → scrub. During a scrub the draft lives in
 * a ref (per-move math) and is mirrored to state for display — the store is
 * untouched until release, when `onCommit` fires exactly once with the
 * committed (clamped + precision-rounded) value. Shift toggles fine
 * scrubbing mid-drag (`isShiftHeld` polled per move). Escape or a
 * pointercancel cancels the scrub without committing.
 *
 * `touch-action: pan-y` keeps vertical pane scrolling alive on touch; a
 * vertical swipe never enters scrub (horizontal slop) and the browser's
 * scroll takeover surfaces as pointercancel → clean cancel. No pointer lock.
 */

export interface ScrubInputProps {
  value: number;
  /** Fired exactly once per completed gesture / edit, with the committed
   *  (clamped + rounded) value. Not fired when nothing changed. */
  onCommit: (value: number) => void;
  spec: ScrubSpec;
  /** Appended verbatim after the value (e.g. '°', 'px'). Display only. */
  unit?: string;
  /** Small inline label inside the field (e.g. 'X', 'W'). */
  subLabel?: string;
  /** h-7 text-xs instead of h-8 text-sm (pair cells). */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export const ScrubInput: React.FC<ScrubInputProps> = ({
  value,
  onCommit,
  spec,
  unit,
  subLabel,
  compact,
  disabled,
  className,
}) => {
  const [mode, setMode] = useState<'display' | 'edit'>('display');
  const [editDraft, setEditDraft] = useState('');
  // null = not scrubbing. Mirrors draftRef for display only.
  const [scrubDraft, setScrubDraft] = useState<number | null>(null);

  // Latest-prop refs so the window listeners installed at pointer-down never
  // act on stale closures. Mirrored in an every-render effect (not during
  // render, per react-hooks/refs); pointer/key events always fire after
  // effects flush, so handlers see current values.
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  const specRef = useRef(spec);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    valueRef.current = value;
    onCommitRef.current = onCommit;
    specRef.current = spec;
    disabledRef.current = disabled;
  });

  const phaseRef = useRef<'idle' | 'armed' | 'scrubbing'>('idle');
  const slopRef = useRef(DRAG_SLOP_MOUSE);
  const draftRef = useRef(0);
  const lastDxRef = useRef(0);
  const cancelledRef = useRef(false);
  const closingEditRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const dragHandlers = usePointerDrag({
    onStart: (e) => {
      if (disabledRef.current) return false;
      // Keep the pointer-down from starting a text selection / focus change.
      e.preventDefault();
      phaseRef.current = 'armed';
      slopRef.current = e.pointerType === 'touch' ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE;
      draftRef.current = valueRef.current;
      lastDxRef.current = 0;
      cancelledRef.current = false;
    },
    onMove: (_e, d) => {
      if (phaseRef.current === 'idle' || cancelledRef.current) return;
      if (phaseRef.current === 'armed') {
        // Horizontal slop only: vertical travel is pane scrolling (pan-y).
        if (Math.abs(d.dx) < slopRef.current) return;
        // Slop crossed: scrub starts now and catches up with the full delta
        // from the down point — the dead zone decides WHEN, not how much.
        phaseRef.current = 'scrubbing';
      }
      const dx = d.dx - lastDxRef.current;
      lastDxRef.current = d.dx;
      // Poll Shift per move so fine mode can toggle mid-drag.
      draftRef.current = applyScrubDelta(draftRef.current, dx, specRef.current, isShiftHeld());
      setScrubDraft(draftRef.current);
    },
    onEnd: (e) => {
      const phase = phaseRef.current;
      const cancelled = cancelledRef.current;
      phaseRef.current = 'idle';
      cancelledRef.current = false;
      setScrubDraft(null);
      // pointercancel (scroll takeover, alt-tab, iOS gesture) is neither a
      // click nor a commit: revert silently.
      if (e.type !== 'pointerup') return;
      if (phase === 'armed') {
        // Released inside the slop: a plain click → edit mode.
        closingEditRef.current = false;
        setEditDraft(formatValue(valueRef.current, specRef.current));
        setMode('edit');
        return;
      }
      if (phase === 'scrubbing' && !cancelled) {
        const committed = commitValue(draftRef.current, specRef.current);
        if (committed !== valueRef.current) onCommitRef.current(committed);
      }
    },
  });

  // Escape during a scrub cancels it (no commit on release).
  const isScrubbing = scrubDraft !== null;
  useEffect(() => {
    if (!isScrubbing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cancelledRef.current = true;
      setScrubDraft(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isScrubbing]);

  // Entering edit mode: focus with the text selected, ready to overtype.
  useEffect(() => {
    if (mode === 'edit') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [mode]);

  const finishEdit = (commit: boolean, draft: string) => {
    // Enter commits and leaves edit mode; the input's blur then must not
    // commit a second time.
    if (closingEditRef.current) return;
    closingEditRef.current = true;
    if (commit) {
      const parsed = parseInput(draft, specRef.current);
      // null (garbage input) → revert silently.
      if (parsed !== null) {
        const committed = commitValue(parsed, specRef.current);
        if (committed !== valueRef.current) onCommitRef.current(committed);
      }
    }
    setMode('display');
  };

  const nudge = (dir: 1 | -1, fine: boolean, draft: string) => {
    const s = specRef.current;
    const delta = dir * (s.step ?? 1) * (fine ? s.fineFactor ?? 0.1 : 1);
    const base = parseInput(draft, s) ?? valueRef.current;
    const committed = commitValue(base + delta, s);
    setEditDraft(formatValue(committed, s));
    // Each arrow press commits (the field stays in edit mode).
    if (committed !== valueRef.current) onCommitRef.current(committed);
  };

  const box = `w-full ${compact ? 'h-7 text-xs' : 'h-8 text-sm'} border border-gray-300 rounded px-2`;

  if (mode === 'edit' && !disabled) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={editDraft}
        onChange={(e) => setEditDraft(e.target.value)}
        onBlur={() => finishEdit(true, editDraft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finishEdit(true, editDraft);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finishEdit(false, editDraft);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            nudge(1, e.shiftKey, editDraft);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(-1, e.shiftKey, editDraft);
          }
        }}
        className={`${box} bg-white ${className ?? ''}`}
      />
    );
  }

  const shown = scrubDraft ?? value;
  return (
    <div
      {...(disabled ? {} : dragHandlers)}
      style={{ touchAction: 'pan-y' }}
      className={`${box} bg-white flex items-center gap-1 select-none ${
        disabled ? 'opacity-50' : 'cursor-ew-resize'
      } ${className ?? ''}`}
    >
      {subLabel && <span className="text-gray-400 shrink-0">{subLabel}</span>}
      <span className="truncate">{formatValue(shown, spec, unit)}</span>
    </div>
  );
};
