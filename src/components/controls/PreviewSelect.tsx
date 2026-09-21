import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PalettePanel } from './PalettePanel';

export interface PreviewSelectOption<V extends string | number> {
  value: V;
  label: string;
  preview: React.ReactNode;
}

export interface PreviewSelectProps<V extends string | number> {
  label: string;
  options: Array<PreviewSelectOption<V>>;
  value: V;
  onChange: (value: V) => void;
  columns?: number;
  disabled?: boolean;
  className?: string;
  /** Animation selectors use an icon trigger and keep their options open. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  closeOnSelect?: boolean;
  previewHeight?: number;
  footer?: React.ReactNode;
}

/** Shared animation/property palette: compact current-value trigger, anchored
 * portal, preview tiles, and optional settings. Callers supply only the real
 * preview geometry, not another picker implementation. */
export function PreviewSelect<V extends string | number>({
  label, options, value, onChange, columns = 3, disabled, className,
  trigger, triggerClassName, closeOnSelect = true, previewHeight = 40, footer,
}: PreviewSelectProps<V>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value);
  const isOpen = open && !disabled;

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen]);

  return (
    <div className={className}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${selected?.label ?? value}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        title={`${label}: ${selected?.label ?? value}`}
        className={triggerClassName ?? 'w-full h-8 px-2 border border-gray-300 rounded flex items-center gap-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50'}
        onClick={() => setOpen(!open)}
      >
        {trigger ?? <>
          <span className="flex items-center justify-center w-16 h-6 overflow-hidden shrink-0" aria-hidden="true">{selected?.preview}</span>
          <span className="truncate flex-1 text-left">{selected?.label ?? value}</span>
          <ChevronDown size={12} />
        </>}
      </button>
      {isOpen && <PalettePanel anchorRef={buttonRef} menuRef={menuRef}>
        <div id={id} role="dialog" aria-label={label}>
          <div className="text-xs font-medium text-gray-500 mb-2 px-1">{label}</div>
          <div
            role="radiogroup"
            aria-label={label}
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            onKeyDown={(e) => {
              const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1
                : e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : 0;
              if (!delta && e.key !== 'Home' && e.key !== 'End') return;
              e.preventDefault();
              e.stopPropagation();
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
              const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (idx + delta + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }}
          >
            {options.map((o) => {
              const active = o.value === value;
              return <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={o.label}
                title={o.label}
                onClick={() => {
                  if (!active) onChange(o.value);
                  if (closeOnSelect) { setOpen(false); buttonRef.current?.focus(); }
                }}
                className={`flex flex-col items-stretch rounded overflow-hidden border ${active ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-400'}`}
              >
                <div className="bg-gray-50 px-1 flex items-center justify-center overflow-hidden text-gray-700" style={{ height: previewHeight }}>{o.preview}</div>
                <div className={`px-2 py-1 text-xs text-center ${active ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'}`}>{o.label}</div>
              </button>;
            })}
          </div>
          {footer}
        </div>
      </PalettePanel>}
    </div>
  );
}
