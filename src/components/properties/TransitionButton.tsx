import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, Minus, TrendingUp, Spline, Layers,
  Type, ArrowRightLeft, PenLine, Pencil, MoveHorizontal,
  ArrowRightFromLine, Maximize, Circle, Sparkles,
} from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type {
  EasingType,
  PropertyTransitions,
  SlideElement,
  TransitionGroup,
  TransitionOptions,
} from '../../types/presentation';
import { TransitionPreview } from './TransitionPreview';
import { isVisibilityFadeOut, optionsKeyFor } from './transitionSide';
import { defaultVisibilityEasing } from '../../utils/interpolation';
import { DEFAULT_TYPES, RESOURCE_TYPES, CONTENT_TYPES, visibilityTypesFor } from '../../utils/easingCatalog';
import { EASING_LABELS, easingHasOptions, transitionPropertiesDiffer } from '../../utils/transitionProperties';

interface Props {
  elementId: string;
  group: TransitionGroup;
  direction: 'in' | 'out';
}

const ICON_SIZE = 14;

const EASING_ICONS: Record<EasingType, React.ReactNode> = {
  const: <Minus size={ICON_SIZE} />,
  linear: <TrendingUp size={ICON_SIZE} />,
  ease: <Spline size={ICON_SIZE} />,
  dissolve: <Layers size={ICON_SIZE} />,
  fadeinout: <ArrowRightLeft size={ICON_SIZE} />,
  typewriter: <Type size={ICON_SIZE} />,
  write: <PenLine size={ICON_SIZE} />,
  create: <Pencil size={ICON_SIZE} />,
  wipe: <MoveHorizontal size={ICON_SIZE} />,
  slidein: <ArrowRightFromLine size={ICON_SIZE} />,
  grow: <Maximize size={ICON_SIZE} />,
  iris: <Circle size={ICON_SIZE} />,
  fadebyglyph: <Sparkles size={ICON_SIZE} />,
};

export const TransitionButton: React.FC<Props> = ({
  elementId,
  group,
  direction,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const updateElement = usePresentationStore((s) => s.updateElement);
  // Read this hook unconditionally — it MUST be above the `if (!canEdit)
  // early return below, or the hook count varies between renders and React
  // aborts mid-reconcile. That abort leaves fibers half-attached and shows
  // up downstream as a `removeChild NotFoundError`. `canEdit` flips
  // transiently while the multi-slide mirror runs (mirror updates the
  // sibling slide first, so `propertiesDiffer` returns true for one render,
  // then false the next).
  const rememberEasing = useEditorStore((s) => s.rememberEasing);

  const currentSlideIndex = slideOrder.indexOf(activeSlideId);
  const sourceSlideIndex = direction === 'in' ? currentSlideIndex - 1 : currentSlideIndex;
  const targetSlideIndex = direction === 'in' ? currentSlideIndex : currentSlideIndex + 1;
  const sourceSlideId = slideOrder[sourceSlideIndex];
  const targetSlideId = slideOrder[targetSlideIndex];
  const sourceSlide = sourceSlideId ? slides[sourceSlideId] : undefined;
  const targetSlide = targetSlideId ? slides[targetSlideId] : undefined;
  const sourceElement = sourceSlide?.elements[elementId];

  const targetElement = targetSlide?.elements[elementId];

  // Visibility options depend on the element type (shapes get Create, text
  // gets glyph effects, etc.). The element exists on at least one side of
  // the transition.
  const elementType = (sourceElement ?? targetElement)?.type;
  const types =
    group === 'content' ? CONTENT_TYPES :
    group === 'resource' ? RESOURCE_TYPES :
    group === 'visibility' ? visibilityTypesFor(elementType) :
    DEFAULT_TYPES;

  const differs = transitionPropertiesDiffer(sourceElement, targetElement, group);

  // Where the transition lives: target by default, source for fade-out
  // visibility changes (because target doesn't exist).
  const isFadeOut = isVisibilityFadeOut(sourceElement, targetElement, group);
  const transitionElement = isFadeOut ? sourceElement : targetElement;
  const transitionSlideId = isFadeOut ? sourceSlideId : targetSlideId;

  const defaultEasing: EasingType =
    group === 'resource' ? 'dissolve' :
    group === 'content' ? 'const' :
    group === 'visibility' ? defaultVisibilityEasing(transitionElement) :
    'linear';
  const currentEasing: EasingType = transitionElement?.transitions?.[group] || defaultEasing;
  const optKey = optionsKeyFor(group);
  const currentOptions: TransitionOptions | undefined = optKey
    ? transitionElement?.transitions?.[optKey]
    : undefined;

  const canEdit = !!transitionElement && differs;

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
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

  if (!canEdit) return null;

  const writeNewTransitions = (mutate: (t: PropertyTransitions) => void) => {
    const next: PropertyTransitions = { ...(transitionElement!.transitions || {}) };
    mutate(next);
    updateElement(transitionSlideId!, elementId, { transitions: next } as Partial<SlideElement>);
  };

  const handleSelect = (easing: EasingType) => {
    writeNewTransitions((t) => { t[group] = easing; });
    if (elementType) rememberEasing(elementType, group, easing, currentOptions);
  };

  const handleOptionChange = (nextOptions: TransitionOptions) => {
    if (!optKey) return;
    writeNewTransitions((t) => { t[optKey] = nextOptions; });
    if (elementType) rememberEasing(elementType, group, currentEasing, nextOptions);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center gap-0.5"
        title={`${direction === 'in' ? 'Incoming' : 'Outgoing'} transition: ${EASING_LABELS[currentEasing]}`}
      >
        {direction === 'in' ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        {EASING_ICONS[currentEasing]}
      </button>

      {isOpen && (
        <PortalPanel anchorRef={buttonRef} menuRef={menuRef}>
          <div className="text-xs font-medium text-gray-500 mb-2 px-1">
            {direction === 'in' ? 'Incoming' : 'Outgoing'} transition
          </div>

          <div className="grid grid-cols-3 gap-2">
            {types.map((easing) => {
              const selected = currentEasing === easing;
              return (
                <button
                  key={easing}
                  onClick={() => handleSelect(easing)}
                  className={`group flex flex-col items-stretch rounded overflow-hidden border ${
                    selected ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-400'
                  }`}
                  title={EASING_LABELS[easing]}
                >
                  <div className="bg-gray-50 aspect-[3/2]">
                    <TransitionPreview
                      sourceElement={sourceElement}
                      targetElement={targetElement}
                      group={group}
                      easing={easing}
                      options={easing === currentEasing ? currentOptions : undefined}
                      width={120}
                      height={80}
                      active={isOpen}
                    />
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-1 text-xs ${
                    selected ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'
                  }`}>
                    {EASING_ICONS[easing]}
                    <span>{EASING_LABELS[easing]}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {easingHasOptions(group, currentEasing) && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-medium text-gray-500 mb-2 px-1">
                {EASING_LABELS[currentEasing]} options
              </div>
              <EasingOptionsPanel
                value={currentOptions ?? {}}
                onChange={handleOptionChange}
                easing={currentEasing}
              />
            </div>
          )}
        </PortalPanel>
      )}
    </div>
  );
};

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

const PortalPanel: React.FC<{
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}> = ({ anchorRef, menuRef, children }) => {
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
    const desiredLeft = rect.right - PANEL_W;
    const left = Math.min(
      Math.max(VIEWPORT_PAD, desiredLeft),
      window.innerWidth - PANEL_W - VIEWPORT_PAD,
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
  }, [anchorRef]);

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
        width: PANEL_W,
        maxHeight: pos.maxHeight || undefined,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

/** Per-easing settings panel. Dispatches on the currently-selected easing
 *  and renders the right sub-panel. */
const EasingOptionsPanel: React.FC<{
  value: TransitionOptions;
  onChange: (next: TransitionOptions) => void;
  easing: EasingType;
}> = ({ value, onChange, easing }) => {
  if (easing === 'write' || easing === 'typewriter') {
    const sub = value[easing] ?? {};
    const undoFirstDefault = easing === 'typewriter';
    const undoFirst = sub.undoFirst ?? undoFirstDefault;
    return (
      <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={undoFirst}
          onChange={(e) => onChange({ ...value, [easing]: { ...sub, undoFirst: e.target.checked } })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Undo source before revealing target</span>
          <br />
          <span className="text-gray-500">
            First half un-reveals the source text, second half reveals the target.
            Off: source vanishes instantly and the full duration is spent
            revealing the target.
          </span>
        </span>
      </label>
    );
  }

  if (easing === 'wipe' || easing === 'slidein') {
    const sub = value[easing] ?? {};
    const from = sub.from ?? 'left';
    const setFrom = (next: 'left' | 'right' | 'top' | 'bottom') =>
      onChange({ ...value, [easing]: { ...sub, from: next } });
    return (
      <div className="text-xs text-gray-700 px-1 space-y-2">
        <div className="font-medium">From</div>
        <div className="grid grid-cols-4 gap-1">
          {(['left', 'right', 'top', 'bottom'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setFrom(d)}
              className={`py-1 rounded border text-xs ${
                from === d ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-200 hover:border-gray-400 text-gray-600'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (easing === 'create') {
    const sub = value.create ?? {};
    const tipDraw = sub.tipDraw ?? false;
    return (
      <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={tipDraw}
          onChange={(e) => onChange({ ...value, create: { ...sub, tipDraw: e.target.checked } })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Arrowhead rides the tip</span>
          <br />
          <span className="text-gray-500">
            For paths with an end arrow: the arrowhead moves along with the
            growing tip of the line instead of materialising last. Off:
            the shaft draws first, then the arrowhead appears.
          </span>
        </span>
      </label>
    );
  }

  if (easing === 'grow') {
    const sub = value.grow ?? {};
    const anchor = sub.anchor ?? 'center';
    const setAnchor = (next: typeof anchor) =>
      onChange({ ...value, grow: { ...sub, anchor: next } });
    const cells: Array<typeof anchor> = [
      'top-left', 'top', 'top-right',
      'left', 'center', 'right',
      'bottom-left', 'bottom', 'bottom-right',
    ];
    return (
      <div className="text-xs text-gray-700 px-1 space-y-2">
        <div className="font-medium">Anchor</div>
        <div className="grid grid-cols-3 gap-1 w-32">
          {cells.map((c) => (
            <button
              key={c}
              onClick={() => setAnchor(c)}
              className={`aspect-square rounded border ${
                anchor === c ? 'bg-blue-500 border-blue-700' : 'bg-white border-gray-300 hover:border-gray-500'
              }`}
              title={c}
            />
          ))}
        </div>
        <div className="text-gray-500">Element grows from this point.</div>
      </div>
    );
  }

  return null;
};
