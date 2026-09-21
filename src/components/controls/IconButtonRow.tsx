import React from 'react';

/**
 * Row of INDEPENDENT icon toggle buttons (each has its own on/off state —
 * for an exclusive single-choice row see IconSelect). Active styling matches
 * the established video-playback buttons: blue tone by default, orange for
 * "warning-ish" states (e.g. muted).
 */
export interface IconButtonRowItem {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  /** Optional text rendered after the icon (e.g. "Loop"). */
  label?: string;
  activeTone?: 'blue' | 'orange';
}

const ACTIVE_TONE = {
  blue: 'bg-blue-50 border-blue-300 text-blue-700',
  orange: 'bg-orange-50 border-orange-300 text-orange-700',
} as const;

export const IconButtonRow: React.FC<{
  items: IconButtonRowItem[];
  className?: string;
}> = ({ items, className }) => (
  <div className={`flex gap-2 ${className ?? ''}`}>
    {items.map((it, i) => (
      <button
        key={i}
        type="button"
        onClick={it.onClick}
        title={it.title}
        className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${
          it.active
            ? ACTIVE_TONE[it.activeTone ?? 'blue']
            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {it.icon}
        {it.label}
      </button>
    ))}
  </div>
);
