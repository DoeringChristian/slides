import React from 'react';
import { ScrubInput } from './ScrubInput';
import type { ScrubSpec } from '../../utils/scrub';

/**
 * Two side-by-side ScrubInputs (Position X/Y, Size W/H) with inline
 * sub-labels. Each axis carries its own ScrubSpec, so min/max/step/precision
 * are honored per axis.
 */

export interface ScrubPairProps {
  values: [number, number];
  /** Inline sub-labels shown inside each field, e.g. ['X', 'Y']. */
  labels: [string, string];
  specs: [ScrubSpec, ScrubSpec];
  units?: [string | undefined, string | undefined];
  onCommit: (index: 0 | 1, value: number) => void;
  /** Live-preview pass-throughs (see ScrubInput / useScrubCommit): a shared
   *  session works because only one axis scrubs at a time. */
  onPreview?: (index: 0 | 1, value: number) => void;
  onScrubStart?: (index: 0 | 1) => void;
  onScrubCancel?: (index: 0 | 1) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export const ScrubPair: React.FC<ScrubPairProps> = ({
  values,
  labels,
  specs,
  units,
  onCommit,
  onPreview,
  onScrubStart,
  onScrubCancel,
  compact,
  disabled,
  className,
}) => (
  <div className={`grid grid-cols-2 gap-2 ${className ?? ''}`}>
    {([0, 1] as const).map((i) => (
      <ScrubInput
        key={i}
        value={values[i]}
        subLabel={labels[i]}
        spec={specs[i]}
        unit={units?.[i]}
        onCommit={(v) => onCommit(i, v)}
        onPreview={onPreview && ((v) => onPreview(i, v))}
        onScrubStart={onScrubStart && (() => onScrubStart(i))}
        onScrubCancel={onScrubCancel && (() => onScrubCancel(i))}
        compact={compact}
        disabled={disabled}
      />
    ))}
  </div>
);
