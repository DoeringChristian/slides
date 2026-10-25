import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into document.body as a fixed-positioned panel anchored
 * to the trigger button. Bypasses ancestor `overflow: hidden` clipping (the
 * sidebar does this; z-index alone can't escape it).
 *
 * Placement: prefers below the button. If there isn't room below the
 * viewport, flips above. If the panel is taller than the viewport entirely,
 * pins to the top of the visible area and lets the panel scroll internally
 * (`max-height` + `overflow-y: auto`).
 */
const PANEL_W = 420;
const GAP = 4;
const VIEWPORT_PAD = 8;

export const PalettePanel: React.FC<{
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  width?: number;
}> = ({ anchorRef, menuRef, children, width: panelWidth = PANEL_W }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top: number; left: number; maxHeight: number; visible: boolean;
  }>({ top: 0, left: 0, maxHeight: 0, visible: false });

  const reposition = useCallback(() => {
    const button = anchorRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 0;

    // Horizontal: right-align to the button, clamp to viewport.
    const width = Math.min(panelWidth, window.innerWidth - 2 * VIEWPORT_PAD);
    const desiredLeft = rect.right - width;
    const left = Math.min(
      Math.max(VIEWPORT_PAD, desiredLeft),
      window.innerWidth - width - VIEWPORT_PAD,
    );

    // Vertical: prefer below; flip above if not enough room; otherwise pin
    // to whichever side has more room and cap the height.
    const spaceBelow = window.innerHeight - VIEWPORT_PAD - (rect.bottom + GAP);
    const spaceAbove = (rect.top - GAP) - VIEWPORT_PAD;
    const fitsBelow = panelHeight <= spaceBelow;
    const fitsAbove = panelHeight <= spaceAbove;

    let top: number;
    let maxHeight: number;
    if (fitsBelow || spaceBelow >= spaceAbove) {
      // Below (or below has more room than above even if neither fits).
      top = rect.bottom + GAP;
      maxHeight = Math.max(0, window.innerHeight - VIEWPORT_PAD - top);
    } else if (fitsAbove) {
      top = rect.top - GAP - panelHeight;
      maxHeight = panelHeight;
    } else {
      // Pin to the top of the viewport and let the panel scroll internally.
      top = VIEWPORT_PAD;
      maxHeight = Math.max(0, rect.top - GAP - VIEWPORT_PAD);
    }

    setPos((prev) => {
      if (
        prev.visible &&
        prev.top === top &&
        prev.left === left &&
        prev.maxHeight === maxHeight
      ) {
        return prev;
      }
      return { top, left, maxHeight, visible: true };
    });
  }, [anchorRef, panelWidth]);

  // Run on every render so a content height change (options panel toggling,
  // selection-driven layout shifts) re-runs the placement.
  useLayoutEffect(() => {
    reposition();
  });

  useEffect(() => {
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [reposition]);

  // eslint-disable-next-line react-hooks/immutability -- merge-refs callback ref: writes only happen when React attaches/detaches the DOM node, never during render
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el;
    // eslint-disable-next-line react-hooks/immutability -- forwarding the panel DOM node into the caller-owned menuRef (outside-click detection)
    (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [menuRef]);

  return createPortal(
    <div
      ref={setRefs}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl p-3 overflow-y-auto"
      style={{
        top: pos.top,
        left: pos.left,
        width: `min(${panelWidth}px, calc(100vw - ${2 * VIEWPORT_PAD}px))`,
        maxHeight: pos.maxHeight || undefined,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

