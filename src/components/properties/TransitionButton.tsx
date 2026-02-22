import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Minus, TrendingUp, Spline, Layers } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { EasingType, PropertyTransitions, SlideElement } from '../../types/presentation';

interface Props {
  elementId: string;
  group: keyof PropertyTransitions;
  direction: 'in' | 'out';
  availableTypes?: EasingType[];
}

const EASING_ICONS: Record<EasingType, React.ReactNode> = {
  const: <Minus size={10} />,
  linear: <TrendingUp size={10} />,
  ease: <Spline size={10} />,
  crossfade: <Layers size={10} />,
};

const EASING_LABELS: Record<EasingType, string> = {
  const: 'Constant (snap)',
  linear: 'Linear',
  ease: 'Ease (smooth)',
  crossfade: 'Crossfade',
};

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

  // For 'in' direction: we edit the current slide's element transitions
  // For 'out' direction: we edit the next slide's element transitions
  const targetSlideIndex = direction === 'in' ? currentSlideIndex : currentSlideIndex + 1;
  const targetSlideId = slideOrder[targetSlideIndex];
  const targetSlide = targetSlideId ? slides[targetSlideId] : undefined;
  const targetElement = targetSlide?.elements[elementId];

  // Get current easing value
  const currentEasing: EasingType = targetElement?.transitions?.[group] || 'linear';

  // Can't edit transitions if no target slide exists
  const canEdit = !!targetElement;

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
      ...targetElement.transitions,
      [group]: easing,
    };
    updateElement(targetSlideId, elementId, { transitions: newTransitions } as Partial<SlideElement>);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center"
        title={`${direction === 'in' ? 'Incoming' : 'Outgoing'} transition: ${EASING_LABELS[currentEasing]}`}
      >
        {direction === 'in' ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
        {EASING_ICONS[currentEasing]}
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute z-50 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[120px]"
          style={{ [direction === 'in' ? 'right' : 'left']: 0 }}
        >
          {availableTypes.map((type) => (
            <button
              key={type}
              onClick={() => handleSelect(type)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 ${
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
