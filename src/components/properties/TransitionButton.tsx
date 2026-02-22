import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Minus, TrendingUp, Spline, Layers } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { EasingType, PropertyTransitions, SlideElement, TextElement, ShapeElement, ImageElement } from '../../types/presentation';

interface Props {
  elementId: string;
  group: keyof PropertyTransitions;
  direction: 'in' | 'out';
  availableTypes?: EasingType[];
}

const ICON_SIZE = 14;

const EASING_ICONS: Record<EasingType, React.ReactNode> = {
  const: <Minus size={ICON_SIZE} />,
  linear: <TrendingUp size={ICON_SIZE} />,
  ease: <Spline size={ICON_SIZE} />,
  crossfade: <Layers size={ICON_SIZE} />,
};

const EASING_LABELS: Record<EasingType, string> = {
  const: 'Constant (snap)',
  linear: 'Linear',
  ease: 'Ease (smooth)',
  crossfade: 'Crossfade',
};

// Map property groups to the actual element fields to compare
function getPropertyValues(element: SlideElement, group: keyof PropertyTransitions): (number | string | boolean | null | undefined)[] {
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
    default: return [];
  }
}

function propertiesDiffer(a: SlideElement | undefined, b: SlideElement | undefined, group: keyof PropertyTransitions): boolean {
  // For visibility: element appearing/disappearing counts as a difference
  if (group === 'visibility') {
    const aVisible = a?.visible ?? false;
    const bVisible = b?.visible ?? false;
    // Also treat element not existing as not visible
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
    // For numbers, compare with rounding
    if (typeof valA === 'number' && typeof valB === 'number') {
      if (Math.round(valA) !== Math.round(valB)) return true;
    } else if (valA !== valB) {
      return true;
    }
  }
  return false;
}

export const TransitionButton: React.FC<Props> = ({
  elementId,
  group,
  direction,
  availableTypes = ['const', 'linear', 'ease'],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const slideOrder = usePresentationStore((s) => s.presentation.slideOrder);
  const slides = usePresentationStore((s) => s.presentation.slides);
  const updateElement = usePresentationStore((s) => s.updateElement);

  // Find current slide index
  const currentSlideIndex = slideOrder.indexOf(activeSlideId);

  // For 'in' direction: compare with previous slide, edit current slide's transitions
  // For 'out' direction: compare with next slide, edit next slide's transitions
  const sourceSlideIndex = direction === 'in' ? currentSlideIndex - 1 : currentSlideIndex;
  const targetSlideIndex = direction === 'in' ? currentSlideIndex : currentSlideIndex + 1;

  const sourceSlideId = slideOrder[sourceSlideIndex];
  const targetSlideId = slideOrder[targetSlideIndex];

  const sourceSlide = sourceSlideId ? slides[sourceSlideId] : undefined;
  const targetSlide = targetSlideId ? slides[targetSlideId] : undefined;

  const sourceElement = sourceSlide?.elements[elementId];
  const targetElement = targetSlide?.elements[elementId];

  // Only show if the property differs between source and target
  const differs = propertiesDiffer(sourceElement, targetElement, group);

  // For visibility transitions when element disappears (fade-out),
  // we store the transition on the source element since target doesn't exist
  const isFadeOut = group === 'visibility' && sourceElement?.visible && !targetElement;

  // Determine which element holds the transition settings
  // For fade-out: use source element (since target doesn't exist)
  // For everything else: use target element
  const transitionElement = isFadeOut ? sourceElement : targetElement;
  const transitionSlideId = isFadeOut ? sourceSlideId : targetSlideId;

  // Get current easing value from the appropriate element
  const currentEasing: EasingType = transitionElement?.transitions?.[group] || 'linear';

  // Can edit if we have an element to store transitions on and property differs
  const canEdit = !!transitionElement && differs;

  // Close menu when clicking outside
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
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  if (!canEdit) return null;

  const handleSelect = (easing: EasingType) => {
    const newTransitions: PropertyTransitions = {
      ...transitionElement!.transitions,
      [group]: easing,
    };
    updateElement(transitionSlideId!, elementId, { transitions: newTransitions } as Partial<SlideElement>);
    setIsOpen(false);
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
        <div
          ref={menuRef}
          className="absolute z-[9999] top-full mt-1 right-0 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[140px]"
        >
          {availableTypes.map((type) => (
            <button
              key={type}
              onClick={() => handleSelect(type)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 ${
                currentEasing === type ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
              }`}
            >
              {EASING_ICONS[type]}
              {EASING_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
