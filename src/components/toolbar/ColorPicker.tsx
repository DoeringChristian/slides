import React, { useState, useRef, useEffect } from 'react';
import { PRESET_COLORS } from '../../utils/constants';

interface Props {
  color: string;
  onChange: (color: string) => void;
  label?: string;
}

export const ColorPicker: React.FC<Props> = ({ color, onChange, label = 'Color' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHexInput(color);
  }, [color]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 p-1 rounded hover:bg-gray-100"
        title={label}
      >
        <div className="w-4 h-4 rounded border border-gray-300" style={{ backgroundColor: color }} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-3 z-50 w-56">
          <div className="grid grid-cols-6 gap-1 mb-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { onChange(c); setIsOpen(false); }}
                className={`w-7 h-7 rounded border ${c === color ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-400'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">Hex:</span>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={() => {
                if (/^#[0-9a-fA-F]{6}$/.test(hexInput)) {
                  onChange(hexInput);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(hexInput)) {
                  onChange(hexInput);
                  setIsOpen(false);
                }
              }}
              className="flex-1 h-6 text-xs border border-gray-300 rounded px-2"
              placeholder="#000000"
            />
          </div>
        </div>
      )}
    </div>
  );
};
