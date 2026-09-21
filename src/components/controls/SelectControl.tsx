import React from 'react';

/**
 * Palette select control. Values travel as strings — callers that store
 * numbers / unions stringify on the way in and parse on the way out
 * (see SelectProperty's `parse`).
 */
export interface SelectControlProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  /** h-7 text-xs instead of h-8 text-sm (toolbar / pair cells). */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export const SelectControl: React.FC<SelectControlProps> = ({
  value, options, onChange, compact, disabled, className,
}) => (
  <select
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full border border-gray-300 rounded bg-white disabled:opacity-50 ${
      compact ? 'h-7 text-xs px-1' : 'h-8 text-sm px-2'
    } ${className ?? ''}`}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);
