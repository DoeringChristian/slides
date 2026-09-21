import React from 'react';

/**
 * EXCLUSIVE single-choice icon selector: a row (or `columns`-wide grid) of
 * small buttons, each rendering a caller-supplied preview node — typically
 * an inline SVG drawn with the same helper the canvas renderer uses, so the
 * preview IS the real thing. Exactly one option is selected; the selection
 * is shown with a blue ring. Counterpart to IconButtonRow (independent
 * toggles).
 */
export interface IconSelectOption<V extends string> {
  value: V;
  title: string;
  preview: React.ReactNode;
}

export interface IconSelectProps<V extends string> {
  options: Array<IconSelectOption<V>>;
  value: V;
  onChange: (value: V) => void;
  /** Lay the options out as a grid with this many columns instead of a
   *  wrapping row. */
  columns?: number;
  disabled?: boolean;
  className?: string;
}

export function IconSelect<V extends string>({
  options, value, onChange, columns, disabled, className,
}: IconSelectProps<V>): React.ReactElement {
  return (
    <div
      role="radiogroup"
      className={`${columns ? 'grid gap-1' : 'flex flex-wrap gap-1'} ${className ?? ''}`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            disabled={disabled}
            onClick={() => { if (!selected) onChange(o.value); }}
            className={`flex items-center justify-center p-1 rounded border disabled:opacity-50 ${
              selected
                ? 'border-blue-300 bg-blue-50 text-blue-700 ring-2 ring-blue-400'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {o.preview}
          </button>
        );
      })}
    </div>
  );
}
