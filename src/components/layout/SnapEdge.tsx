import React, { useRef } from 'react';

/**
 * The draggable edge of a panel. While dragging, the panel follows the
 * pointer (`onLive`); on release it snaps to whichever state is nearer
 * (`onCommit`). A click without a drag toggles to the other state.
 *
 * `edge` is the side of the panel the handle sits on: a left panel's handle
 * is on its 'right', a right panel's on its 'left', a bottom panel's on its
 * 'top'. Dragging away from the panel grows it.
 */
export function SnapEdge<T>({ edge, size, states, current, onLive, onCommit, title }: {
  edge: 'left' | 'right' | 'top';
  /** The panel's committed size in px. */
  size: number;
  /** Exactly two states, by size. */
  states: [{ size: number; value: T }, { size: number; value: T }];
  current: T;
  onLive: (size: number | null) => void;
  onCommit: (value: T) => void;
  title: string;
}) {
  const drag = useRef<{ start: number; startSize: number; moved: boolean } | null>(null);
  const horizontal = edge === 'top';
  const sign = edge === 'left' || edge === 'top' ? -1 : 1;
  const min = Math.min(states[0].size, states[1].size), max = Math.max(states[0].size, states[1].size);
  const sizeAt = (d: { start: number; startSize: number }, e: React.PointerEvent | PointerEvent) => {
    const delta = ((horizontal ? e.clientY : e.clientX) - d.start) * sign;
    // A little give past either end, so the drag feels physical.
    return Math.max(min - 24, Math.min(max + 48, d.startSize + delta));
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      title={title}
      data-snap-edge={edge}
      className={`absolute z-20 group ${horizontal
        ? 'left-0 right-0 -top-1 h-2 cursor-ns-resize'
        : `top-0 bottom-0 ${edge === 'right' ? '-right-1' : '-left-1'} w-2 cursor-ew-resize`}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { start: horizontal ? e.clientY : e.clientX, startSize: size, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.abs((horizontal ? e.clientY : e.clientX) - d.start) < 3) return;
        d.moved = true;
        onLive(sizeAt(d, e));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        onLive(null);
        if (!d) return;
        if (!d.moved) {
          onCommit(states[0].value === current ? states[1].value : states[0].value);
          return;
        }
        const live = sizeAt(d, e);
        onCommit(Math.abs(live - states[0].size) <= Math.abs(live - states[1].size) ? states[0].value : states[1].value);
      }}
      onPointerCancel={() => { drag.current = null; onLive(null); }}
    >
      <div className={`absolute bg-blue-400 opacity-0 group-hover:opacity-100 transition-opacity ${horizontal
        ? 'left-0 right-0 top-[3px] h-0.5'
        : 'top-0 bottom-0 left-[3px] w-0.5'}`} />
    </div>
  );
}
