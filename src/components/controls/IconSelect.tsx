import React from 'react';

import { PreviewSelect } from './PreviewSelect';

/** Compatibility adapter for icon-sized option data. All choices use the
 * same compact-trigger preview palette as animation/property selectors. */
export interface IconSelectOption<V extends string> {
  value: V;
  title: string;
  preview: React.ReactNode;
}

export interface IconSelectProps<V extends string> {
  label: string;
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
  label, options, value, onChange, columns, disabled, className,
}: IconSelectProps<V>): React.ReactElement {
  return <PreviewSelect
    label={label}
    options={options.map(({ title, ...option }) => ({ ...option, label: title }))}
    value={value}
    onChange={onChange}
    columns={columns}
    disabled={disabled}
    className={className}
  />;
}
