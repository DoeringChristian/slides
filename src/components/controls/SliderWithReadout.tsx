import React, { useEffect, useRef, useState } from 'react';
import { ScrubInput } from './ScrubInput';
import type { ScrubSpec } from '../../utils/scrub';

/**
 * Range slider + compact numeric readout, speaking the same live-preview
 * protocol as ScrubInput (onScrubStart / onPreview / onCommit /
 * onScrubCancel — see useScrubCommit).
 *
 * Unit handling: `min`/`max`/`step` and the readout are in DISPLAY units;
 * `value` and every callback payload are in STORED units
 * (stored × `scale` = displayed, e.g. opacity stored 0–1 shown 0–100).
 * The scale conversion lives entirely in this component and never enters
 * the scrub math or the session.
 *
 * Slider gesture mapping: pointer-down → onScrubStart, each input event
 * while dragging → onPreview, pointer-up → onCommit (or onScrubCancel when
 * nothing changed), Escape / pointercancel → onScrubCancel. Keyboard
 * arrows on a focused (non-dragging) slider are discrete commits, one undo
 * entry each — same convention as ScrubInput's edit mode.
 */

export interface SliderWithReadoutProps {
  /** STORED-unit value (e.g. opacity 0..1). */
  value: number;
  /** Slider/readout bounds in DISPLAY units (e.g. 0..100). */
  min: number;
  max: number;
  /** displayed = stored × scale. Default 1. */
  scale?: number;
  /** Slider + readout arrow step, display units. Default 1. */
  step?: number;
  /** Display-only suffix on the readout (e.g. '%'). */
  unit?: string;
  onCommit: (value: number) => void;
  onPreview?: (value: number) => void;
  onScrubStart?: () => void;
  onScrubCancel?: () => void;
  disabled?: boolean;
  className?: string;
}

export const SliderWithReadout: React.FC<SliderWithReadoutProps> = ({
  value,
  min,
  max,
  scale = 1,
  step = 1,
  unit,
  onCommit,
  onPreview,
  onScrubStart,
  onScrubCancel,
  disabled,
  className,
}) => {
  // Display-unit draft while the slider thumb is being dragged; null = idle.
  const [draft, setDraft] = useState<number | null>(null);

  // Latest-prop refs so pointer/key handlers never see stale closures
  // (mirrored in an every-render effect, same pattern as ScrubInput).
  const valueRef = useRef(value);
  const scaleRef = useRef(scale);
  const onCommitRef = useRef(onCommit);
  const onPreviewRef = useRef(onPreview);
  const onScrubStartRef = useRef(onScrubStart);
  const onScrubCancelRef = useRef(onScrubCancel);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    valueRef.current = value;
    scaleRef.current = scale;
    onCommitRef.current = onCommit;
    onPreviewRef.current = onPreview;
    onScrubStartRef.current = onScrubStart;
    onScrubCancelRef.current = onScrubCancel;
    disabledRef.current = disabled;
  });

  const scrubbingRef = useRef(false);
  const cancelledRef = useRef(false);
  const draftRef = useRef(0); // display units
  const startRef = useRef(0); // display units, pre-scrub

  const beginScrub = () => {
    if (disabledRef.current || scrubbingRef.current) return;
    scrubbingRef.current = true;
    cancelledRef.current = false;
    draftRef.current = valueRef.current * scaleRef.current;
    startRef.current = draftRef.current;
    setDraft(draftRef.current);
    onScrubStartRef.current?.();
  };

  const endScrub = () => {
    if (!scrubbingRef.current) return;
    const cancelled = cancelledRef.current;
    scrubbingRef.current = false;
    cancelledRef.current = false;
    setDraft(null);
    if (cancelled) return;
    if (draftRef.current !== startRef.current) {
      onCommitRef.current(draftRef.current / scaleRef.current);
    } else {
      // Net-zero drag: no commit, but the session must still unwind.
      onScrubCancelRef.current?.();
    }
  };

  // pointercancel: no pointerup will follow — abort fully.
  const abortScrub = () => {
    if (!scrubbingRef.current) return;
    const cancelled = cancelledRef.current;
    scrubbingRef.current = false;
    cancelledRef.current = false;
    setDraft(null);
    if (!cancelled) onScrubCancelRef.current?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (scrubbingRef.current) {
      if (cancelledRef.current) return; // Escaped: ignore the rest of the drag
      draftRef.current = v;
      setDraft(v);
      if (onPreviewRef.current) onPreviewRef.current(v / scaleRef.current);
      else onCommitRef.current(v / scaleRef.current); // legacy continuous mode
    } else {
      // Keyboard nudge on a focused slider: discrete commit per press.
      onCommitRef.current(v / scaleRef.current);
    }
  };

  // Escape mid-drag cancels without committing (parity with ScrubInput).
  const isScrubbing = draft !== null;
  useEffect(() => {
    if (!isScrubbing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cancelledRef.current = true;
      setDraft(null);
      onScrubCancelRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isScrubbing]);

  const display = draft ?? value * scale;
  const readoutSpec: ScrubSpec = { min, max, step, precision: 0 };

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={display}
        disabled={disabled}
        onPointerDown={beginScrub}
        onPointerUp={endScrub}
        onPointerCancel={abortScrub}
        onChange={handleChange}
        className="flex-1 min-w-0 accent-blue-500 disabled:opacity-50"
      />
      <div className="w-14 shrink-0">
        <ScrubInput
          compact
          value={display}
          spec={readoutSpec}
          unit={unit}
          onCommit={(v) => onCommit(v / scale)}
          onPreview={onPreview && ((v) => onPreview(v / scale))}
          onScrubStart={onScrubStart}
          onScrubCancel={onScrubCancel}
          disabled={disabled}
        />
      </div>
    </div>
  );
};
