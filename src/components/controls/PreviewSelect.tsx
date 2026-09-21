import React from 'react';

/**
 * EXCLUSIVE single-choice picker rendered as a grid of preview tiles —
 * the property-panel counterpart of the animation picker's easing grid
 * (TransitionButton) and of IconSelect (which stays for icon-sized rows
 * like arrowheads). Each tile is a caller-supplied preview node above a
 * tiny label; the preview is expected to be drawn with the same helper the
 * canvas renderer uses (strokeDashFor, real fontFamily, …) so the preview
 * IS the real thing. Exactly one option is selected, shown with a blue
 * ring; unselected tiles get a hover border. Sized for the w-64 properties
 * pane at 2–3 columns.
 */
export interface PreviewSelectOption<V extends string | number> {
  value: V;
  label: string;
  preview: React.ReactNode;
}

export interface PreviewSelectProps<V extends string | number> {
  options: Array<PreviewSelectOption<V>>;
  value: V;
  onChange: (value: V) => void;
  /** Grid width. Default 3; use 2 for long labels. */
  columns?: number;
  disabled?: boolean;
  className?: string;
}

export function PreviewSelect<V extends string | number>({
  options, value, onChange, columns = 3, disabled, className,
}: PreviewSelectProps<V>): React.ReactElement {
  return (
    <div
      role="radiogroup"
      className={`grid gap-1 ${className ?? ''}`}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.label}
            disabled={disabled}
            onClick={() => { if (!selected) onChange(o.value); }}
            className={`flex flex-col items-stretch rounded overflow-hidden border disabled:opacity-50 ${
              selected
                ? 'border-blue-500 ring-1 ring-blue-300'
                : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <div className="bg-gray-50 h-8 px-1 flex items-center justify-center overflow-hidden text-gray-700">
              {o.preview}
            </div>
            <div className={`px-1 py-0.5 text-[10px] leading-tight text-center truncate ${
              selected ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-500'
            }`}>
              {o.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}
