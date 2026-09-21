import React from 'react';

/**
 * Palette checkbox control. Deliberately renders NO label text of its own —
 * the row label comes from the containing PropertyRow / SlidePropertyRow
 * header, so the label is never drawn twice.
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, className }) => (
  <input
    type="checkbox"
    checked={checked}
    disabled={disabled}
    onChange={(e) => onChange(e.target.checked)}
    className={`accent-blue-500 disabled:opacity-50 ${className ?? ''}`}
  />
);
