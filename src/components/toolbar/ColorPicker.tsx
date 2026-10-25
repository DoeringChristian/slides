import React, { useState, useRef, useEffect } from 'react';
import { PRESET_COLORS } from '../../utils/constants';
import { QUICK_PAINT_COLORS } from '../../utils/quickPaintColors';
import { ScrubInput, type ScrubInputProps } from '../controls/ScrubInput';
import { PalettePanel } from '../controls/PalettePanel';
import { noPaint, parsePaintColor, paintHex } from '../../utils/paintColor';

const checkerboard = { backgroundImage: 'conic-gradient(#ddd 25%, white 0 50%, #ddd 0 75%, white 0)', backgroundSize: '8px 8px' };

interface Props {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  allowTransparent?: boolean;
  palette?: 'fill' | 'stroke';
  /** Dense floating toolbars retain the same picker without inline presets. */
  compact?: boolean;
  /** Shape paint alpha; the caller owns scrub transactions/current-state writes. */
  alphaControl?: Omit<ScrubInputProps, 'value' | 'spec'>;
  onRgbChange?: (rgb: string) => void;
}

function PaintChip({ color }: { color: string }) {
  return <span className="block w-full h-full rounded border border-gray-300 relative overflow-hidden" style={checkerboard}>
    <span className="absolute inset-0" style={{ backgroundColor: noPaint(color) ? 'transparent' : color }} />
    {noPaint(color) && <span className="absolute inset-0" style={{ background: 'linear-gradient(45deg, transparent 47%, #ef4444 47%, #ef4444 53%, transparent 53%)' }} />}
  </span>;
}

export const ColorPicker: React.FC<Props> = ({ color, onChange, label = 'Color', allowTransparent = true, palette = 'stroke', compact = false, alphaControl, onRgbChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const dirtyHex = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // The portal is initially hidden until its layout pass positions it.
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external paint/alpha changes refresh the custom field
    setHexInput(color);
    dirtyHex.current = false;
  }, [color]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
        dirtyHex.current = false;
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isTransparent = noPaint(color);
  const parsed = parsePaintColor(color);
  const choose = (value: string) => {
    dirtyHex.current = false;
    if (noPaint(value) && !allowTransparent) return;
    if (noPaint(value)) onChange('transparent');
    else (onRgbChange ?? onChange)(value);
    setIsOpen(false);
  };
  const commitHex = () => {
    if (!dirtyHex.current) return;
    dirtyHex.current = false;
    const val = hexInput.trim().toLowerCase();
    if (!parsePaintColor(val) || (!allowTransparent && noPaint(val))) return;
    if (!alphaControl && !/^#[0-9a-f]{6}$/.test(val) && !noPaint(val)) return;
    if (val === color.toLowerCase()) return;
    if (noPaint(val)) onChange('transparent');
    else if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/.test(val)) (onRgbChange ?? onChange)(val);
    else onChange(val);
  };

  return (
    <div className={compact ? 'relative shrink-0' : 'relative flex flex-wrap items-center gap-1.5 w-full min-w-0'} ref={ref} role="group" aria-label={`${label} colors`}
      onKeyDown={e => {
        // Alpha scrubbing polls the window's modifier tracker, including when
        // focus stays in this picker's portaled hex input during the drag.
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      }}>
      {!compact && QUICK_PAINT_COLORS[palette].map(c => <button key={c} type="button"
        aria-label={`${label}: ${noPaint(c) ? 'No color' : c}`}
        aria-pressed={noPaint(c) ? isTransparent : !isTransparent && !!parsed && paintHex(parsed) === c}
        title={noPaint(c) ? 'No color' : c}
        disabled={noPaint(c) && !allowTransparent}
        onMouseDown={() => { dirtyHex.current = false; }}
        onClick={() => choose(c)}
        className="disabled:opacity-40 disabled:cursor-not-allowed w-7 h-7 shrink-0 p-0.5 rounded hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 aria-pressed:ring-1 aria-pressed:ring-violet-500">
        <PaintChip color={c} />
      </button>)}
      <button ref={anchorRef} type="button"
        onMouseDown={() => { dirtyHex.current = false; }}
        onClick={() => { setHexInput(color); dirtyHex.current = false; setIsOpen(!isOpen); }}
        className={`${compact ? 'w-6 h-6 p-1' : 'w-7 h-7 p-0.5 ml-1 ring-1 ring-gray-300'} shrink-0 rounded hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500`}
        title={label} aria-label={`${label}: current/custom color (${color || 'No color'})`} aria-haspopup="dialog" aria-expanded={isOpen}>
        <PaintChip color={color} />
      </button>
      {isOpen && <PalettePanel anchorRef={anchorRef} menuRef={menuRef} width={224}>
        <div role="dialog" aria-label={`${label} custom color`} onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation(); dirtyHex.current = false; setHexInput(color); setIsOpen(false); anchorRef.current?.focus();
          }
        }}>
          {allowTransparent && <button type="button" onMouseDown={() => { dirtyHex.current = false; }} onClick={() => choose('transparent')}
            className={`w-full h-7 rounded border mb-2 flex items-center justify-center gap-2 text-xs text-gray-600 ${isTransparent ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-gray-400'}`}>
            <span className="w-4 h-4"><PaintChip color="transparent" /></span>No color
          </button>}
          <div className="grid grid-cols-6 gap-1 mb-2">
            {PRESET_COLORS.map(c => <button key={c} type="button" aria-label={`${label}: ${c}`} onMouseDown={() => { dirtyHex.current = false; }} onClick={() => choose(c)}
              className={`w-7 h-7 rounded border ${c === color ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-gray-400'}`}
              style={{ backgroundColor: c }} />)}
          </div>
          {alphaControl && <div className="flex items-center gap-2 my-2" aria-label={`${label} alpha`}>
            <span className="text-xs text-gray-500">Alpha</span>
            <ScrubInput {...alphaControl} value={(parsed?.a ?? 1) * 100}
              spec={{ min: 0, max: 100, step: 1, scrubStep: 0.5, precision: 1 }}
              disabled={!parsed || isTransparent} unit="%" compact />
          </div>}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">Hex:</span>
            <input ref={inputRef} type="text" value={hexInput} aria-label={`${label} color`} title={parsed ? paintHex(parsed) : color}
              onChange={e => { dirtyHex.current = true; setHexInput(e.target.value); }} onBlur={commitHex}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitHex(); setIsOpen(false); anchorRef.current?.focus(); } }}
              className="min-w-0 flex-1 h-6 text-xs border border-gray-300 rounded px-2" placeholder="#000000" />
          </div>
        </div>
      </PalettePanel>}
    </div>
  );
};
