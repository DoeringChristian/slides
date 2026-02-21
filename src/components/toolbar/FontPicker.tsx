import React from 'react';
import { FONT_FAMILIES } from '../../utils/constants';

interface Props {
  value: string;
  onChange: (font: string) => void;
}

export const FontPicker: React.FC<Props> = ({ value, onChange }) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs border border-gray-300 rounded px-1 bg-white"
    >
      {FONT_FAMILIES.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f }}>
          {f}
        </option>
      ))}
    </select>
  );
};
