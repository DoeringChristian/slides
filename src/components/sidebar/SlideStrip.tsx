import React from 'react';
import { ArrowUp, ArrowDown, Copy, Plus, Trash2 } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';

/**
 * The slide panel collapsed to a narrow strip: slide numbers to navigate,
 * and the slide actions you need while working on one slide — a new slide
 * or a keyframe copy (the usual way to build the next animation step) above
 * or below the current one, and delete.
 */

const ActionPair: React.FC<{ label: string; icon: React.ReactNode; above: () => void; below: () => void }> = ({ label, icon, above, below }) => (
  <div className="flex flex-col items-center gap-0.5" title={label}>
    <div className="text-gray-500">{icon}</div>
    <div className="flex gap-0.5">
      <button onClick={above} className="p-1 rounded hover:bg-gray-100 text-gray-600" title={`${label} above`} aria-label={`${label} above`}>
        <ArrowUp size={12} />
      </button>
      <button onClick={below} className="p-1 rounded hover:bg-gray-100 text-gray-600" title={`${label} below`} aria-label={`${label} below`}>
        <ArrowDown size={12} />
      </button>
    </div>
  </div>
);

export const SlideStrip: React.FC = () => {
  const slideOrder = usePresentationStore(s => s.presentation.slideOrder);
  const slides = usePresentationStore(s => s.presentation.slides);
  const activeSlideId = useEditorStore(s => s.activeSlideId);
  const selectedSlideIds = useEditorStore(s => s.selectedSlideIds);
  const index = slideOrder.indexOf(activeSlideId);

  const go = (id: string | undefined) => { if (id) useEditorStore.getState().setActiveSlide(id); };
  const store = usePresentationStore.getState;
  const newSlide = (offset: 0 | 1) => go(store().addEmptySlide(index + offset));
  // A keyframe copy of the current slide, placed above or below it.
  const copySlide = (below: boolean) => go(below
    ? store().addSlideWithMode(index, 'previous')
    : store().addSlideWithMode(index - 1, 'next'));

  return (
    <div className="w-full h-full bg-white flex flex-col items-center" data-slide-strip="">
      <div className="flex flex-col items-center gap-2 py-2 border-b border-gray-200 w-full shrink-0">
        <ActionPair label="New slide" icon={<Plus size={14} />} above={() => newSlide(0)} below={() => newSlide(1)} />
        <ActionPair label="Copy of this slide" icon={<Copy size={14} />} above={() => copySlide(false)} below={() => copySlide(true)} />
        <button
          onClick={() => store().deleteSlide(activeSlideId)}
          disabled={slideOrder.length <= 1}
          className="p-1 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 disabled:opacity-30"
          title="Delete this slide" aria-label="Delete this slide"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto w-full flex flex-col items-center gap-1 py-2">
        {slideOrder.map((id, i) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`w-9 h-7 shrink-0 rounded text-xs tabular-nums ${id === activeSlideId
              ? 'bg-orange-500 text-white font-medium'
              : selectedSlideIds.includes(id) ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'} ${slides[id]?.hidden ? 'opacity-40' : ''}`}
            title={`Slide ${i + 1}${slides[id]?.hidden ? ' (hidden)' : ''}`}
            aria-current={id === activeSlideId ? 'true' : undefined}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
};
