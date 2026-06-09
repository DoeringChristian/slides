import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Minus, TrendingUp, Spline, Layers, Type, ArrowRightLeft, PenLine } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type {
  EasingType,
  PropertyTransitions,
  SlideElement,
  TextElement,
  ShapeElement,
  ImageElement,
  TransitionGroup,
  TransitionOptions,
} from '../../types/presentation';
import { TransitionPreview } from './TransitionPreview';

interface Props {
  elementId: string;
  group: TransitionGroup;
  direction: 'in' | 'out';
  availableTypes?: EasingType[];
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
};

const EASING_LABELS: Record<EasingType, string> = {
  const: 'Constant',
  linear: 'Linear',
  ease: 'Ease',
  dissolve: 'Dissolve',
  fadeinout: 'Fade In/Out',
  typewriter: 'Typewriter',
  write: 'Write',
};

const DEFAULT_TYPES: EasingType[] = ['const', 'linear', 'ease'];
const CONTENT_TYPES: EasingType[] = ['const', 'dissolve', 'typewriter', 'write'];
const RESOURCE_TYPES: EasingType[] = ['const', 'dissolve', 'fadeinout'];
const VISIBILITY_TYPES: EasingType[] = ['const', 'linear', 'ease', 'write'];

// Which easings (per group) expose user-configurable options.
function easingHasOptions(group: TransitionGroup, easing: EasingType): boolean {
  if (easing === 'write' && group === 'content') return true;
  return false;
}

function getPropertyValues(element: SlideElement, group: TransitionGroup): (number | string | boolean | null | undefined)[] {
  switch (group) {
    case 'position': return [element.x, element.y];
    case 'size': return [element.width, element.height];
    case 'rotation': return [element.rotation];
    case 'opacity': return [element.opacity];
    case 'fill': return element.type === 'shape' ? [(element as ShapeElement).fill] : [];
    case 'stroke': return element.type === 'shape' ? [(element as ShapeElement).stroke] : [];
    case 'strokeWidth': return element.type === 'shape' ? [(element as ShapeElement).strokeWidth] : [];
    case 'cornerRadius': return element.type === 'shape' ? [(element as ShapeElement).cornerRadius] : [];
    case 'fontSize': return element.type === 'text' ? [(element as TextElement).style.fontSize] : [];
    case 'color': return element.type === 'text' ? [(element as TextElement).style.color] : [];
    case 'lineHeight': return element.type === 'text' ? [(element as TextElement).style.lineHeight] : [];
    case 'crop': return element.type === 'image' ? [
      (element as ImageElement).cropX,
      (element as ImageElement).cropY,
      (element as ImageElement).cropWidth,
      (element as ImageElement).cropHeight,
    ] : [];
    case 'resource': return element.type === 'image' ? [(element as ImageElement).resourceId] : [];
    case 'visibility': return [element.visible];
    case 'content': return element.type === 'text' ? [(element as TextElement).text] : [];
    default: return [];
  }
}

function propertiesDiffer(a: SlideElement | undefined, b: SlideElement | undefined, group: TransitionGroup): boolean {
  if (group === 'visibility') {
    const aVisible = a?.visible ?? false;
    const bVisible = b?.visible ?? false;
    const aExists = !!a;
    const bExists = !!b;
    return (aExists && aVisible) !== (bExists && bVisible);
  }
  if (!a || !b) return false;
  const valsA = getPropertyValues(a, group);
  const valsB = getPropertyValues(b, group);
  if (valsA.length !== valsB.length) return false;
  for (let i = 0; i < valsA.length; i++) {
    const valA = valsA[i];
    const valB = valsB[i];
    if (typeof valA === 'number' && typeof valB === 'number') {
      if (Math.round(valA) !== Math.round(valB)) return true;
    } else if (valA !== valB) {
      return true;
    }
  }
  return false;
}

const optionsKeyFor = (group: TransitionGroup): 'contentOptions' | 'visibilityOptions' | null => {
  if (group === 'content') return 'contentOptions';
  if (group === 'visibility') return 'visibilityOptions';
  return null;
};

export const TransitionButton: React.FC<Props> = ({
  elementId,
  group,
  direction,
  availableTypes,
}) => {
  const types = availableTypes ?? (
    group === 'content' ? CONTENT_TYPES :
    group === 'resource' ? RESOURCE_TYPES :
    group === 'visibility' ? VISIBILITY_TYPES :
    DEFAULT_TYPES
  );
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const updateElement = usePresentationStore((s) => s.updateElement);

  const currentSlideIndex = slideOrder.indexOf(activeSlideId);
  const sourceSlideIndex = direction === 'in' ? currentSlideIndex - 1 : currentSlideIndex;
  const targetSlideIndex = direction === 'in' ? currentSlideIndex : currentSlideIndex + 1;
  const sourceSlideId = slideOrder[sourceSlideIndex];
  const targetSlideId = slideOrder[targetSlideIndex];
  const sourceSlide = sourceSlideId ? slides[sourceSlideId] : undefined;
  const targetSlide = targetSlideId ? slides[targetSlideId] : undefined;
  const sourceElement = sourceSlide?.elements[elementId];
  const targetElement = targetSlide?.elements[elementId];

  const differs = propertiesDiffer(sourceElement, targetElement, group);

  // Where the transition lives: target by default, source for fade-out
  // visibility changes (because target doesn't exist).
  const isFadeOut = group === 'visibility' && sourceElement?.visible && !targetElement;
  const transitionElement = isFadeOut ? sourceElement : targetElement;
  const transitionSlideId = isFadeOut ? sourceSlideId : targetSlideId;

  const defaultEasing: EasingType = group === 'resource' ? 'dissolve' : group === 'content' ? 'const' : 'linear';
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
  };

  const handleOptionChange = (nextOptions: TransitionOptions) => {
    if (!optKey) return;
    writeNewTransitions((t) => { t[optKey] = nextOptions; });
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
              <WriteOptionsPanel
                value={currentOptions ?? {}}
                onChange={handleOptionChange}
                group={group}
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
 * below the button. Bypasses ancestor `overflow: hidden` clipping (the sidebar
 * does this, and z-index alone can't escape it).
 */
const PANEL_W = 420;
const GAP = 4;
const VIEWPORT_PAD = 8;

const PortalPanel: React.FC<{
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}> = ({ anchorRef, menuRef, children }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const reposition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Default: anchor right edge to button right edge, panel below.
      const desiredLeft = rect.right - PANEL_W;
      const left = Math.min(
        Math.max(VIEWPORT_PAD, desiredLeft),
        window.innerWidth - PANEL_W - VIEWPORT_PAD,
      );
      const top = rect.bottom + GAP;
      setPos({ top, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [anchorRef]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-xl p-3"
      style={{ top: pos.top, left: pos.left, width: PANEL_W }}
    >
      {children}
    </div>,
    document.body,
  );
};

const WriteOptionsPanel: React.FC<{
  value: TransitionOptions;
  onChange: (next: TransitionOptions) => void;
  group: TransitionGroup;
}> = ({ value, onChange, group }) => {
  if (group === 'content') {
    const undoFirst = Boolean(value.write?.undoFirst);
    return (
      <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer px-1">
        <input
          type="checkbox"
          checked={undoFirst}
          onChange={(e) => onChange({ ...value, write: { ...(value.write || {}), undoFirst: e.target.checked } })}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Undo source before writing target</span>
          <br />
          <span className="text-gray-500">
            First half un-writes the source text, second half writes the target.
            Off: source vanishes instantly and the full duration is spent writing
            the target.
          </span>
        </span>
      </label>
    );
  }
  return null;
};
