import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GitMerge, Type, Square, Image as ImageIcon } from 'lucide-react';
import type { ObjectMeta } from '../../types/presentation';

interface Props {
  /** The object this row represents — the merge SOURCE. */
  object: ObjectMeta;
  /** The other objects — candidate merge TARGETS. */
  candidates: ObjectMeta[];
  /** Called with the picked TARGET id ("merge ‹object› into ‹picked›"). */
  onMergeInto: (targetId: string) => void;
}

const TYPE_ICONS: Record<ObjectMeta['type'], React.ReactNode> = {
  text: <Type size={12} className="text-gray-500 shrink-0" />,
  shape: <Square size={12} className="text-gray-500 shrink-0" />,
  image: <ImageIcon size={12} className="text-gray-500 shrink-0" />,
};

/**
 * "Merge into…" action for an objects-bar row: opens a small portal picker
 * (same document.body / fixed-position pattern as TransitionButton's panel —
 * the drawer clips overflow, z-index alone can't escape it) listing every
 * OTHER object. Picking one merges THIS row's object into the picked target.
 */
export const MergeIntoButton: React.FC<Props> = ({ object, candidates, onMergeInto }) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handlePick = (targetId: string) => {
    setIsOpen(false);
    onMergeInto(targetId);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((open) => !open);
        }}
        className={`absolute bottom-1 left-1 p-0.5 rounded bg-white/80 hover:bg-white shadow-sm ${
          isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 coarse:opacity-100'
        } transition-opacity`}
        title={`Merge “${object.name}” into…`}
      >
        <GitMerge size={12} className="text-gray-500 hover:text-blue-600" />
      </button>

      {isOpen && (
        <MergePickerPanel anchorRef={buttonRef} panelRef={panelRef}>
          <div className="text-xs font-medium text-gray-500 mb-1 px-1">
            Merge “{object.name}” into…
          </div>
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              onClick={(e) => {
                e.stopPropagation();
                handlePick(candidate.id);
              }}
              className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 text-left"
              title={`Merge “${object.name}” into “${candidate.name}”`}
            >
              {TYPE_ICONS[candidate.type]}
              <span className="truncate">{candidate.name}</span>
            </button>
          ))}
        </MergePickerPanel>
      )}
    </>
  );
};

// Small portal panel anchored to the trigger button (TransitionButton's
// PortalPanel pattern, sized down). Prefers below; flips above when there is
// no room; scrolls internally when neither side fits.
const PANEL_W = 208;
const GAP = 4;
const VIEWPORT_PAD = 8;

const MergePickerPanel: React.FC<{
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}> = ({ anchorRef, panelRef, children }) => {
  const [pos, setPos] = useState<{
    top: number; left: number; maxHeight: number; visible: boolean;
  }>({ top: 0, left: 0, maxHeight: 0, visible: false });

  const reposition = useCallback(() => {
    const button = anchorRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 0;

    const left = Math.min(
      Math.max(VIEWPORT_PAD, rect.left),
      window.innerWidth - PANEL_W - VIEWPORT_PAD,
    );

    const spaceBelow = window.innerHeight - VIEWPORT_PAD - (rect.bottom + GAP);
    const spaceAbove = (rect.top - GAP) - VIEWPORT_PAD;
    const fitsBelow = panelHeight <= spaceBelow;
    const fitsAbove = panelHeight <= spaceAbove;

    let top: number;
    let maxHeight: number;
    if (fitsBelow || spaceBelow >= spaceAbove) {
      top = rect.bottom + GAP;
      maxHeight = Math.max(0, window.innerHeight - VIEWPORT_PAD - top);
    } else if (fitsAbove) {
      top = rect.top - GAP - panelHeight;
      maxHeight = panelHeight;
    } else {
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
  }, [anchorRef, panelRef]);

  // Run on every render so a content height change re-runs placement.
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

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl p-1.5 overflow-y-auto"
      style={{
        top: pos.top,
        left: pos.left,
        width: PANEL_W,
        maxHeight: pos.maxHeight || undefined,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
};
