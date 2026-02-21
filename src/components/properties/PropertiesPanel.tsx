import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useSelectedElements, useActiveSlide, usePreviousSlideElement, useNextSlideElement } from '../../store/selectors';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { TextProperties } from './TextProperties';
import { ShapeProperties } from './ShapeProperties';
import { ImageProperties } from './ImageProperties';
import { SlideProperties } from './SlideProperties';
import { ArrangePanel } from './ArrangePanel';

export const PropertiesPanel: React.FC = () => {
  const selected = useSelectedElements();
  const slide = useActiveSlide();
  const element = selected.length === 1 ? selected[0] : null;
  const prevElement = usePreviousSlideElement(element?.id || '');
  const nextElement = useNextSlideElement(element?.id || '');
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const resetElementToKeyframe = usePresentationStore((s) => s.resetElementToKeyframe);
  const resetElementToNextKeyframe = usePresentationStore((s) => s.resetElementToNextKeyframe);

  const hasPrevDiff = element && prevElement && JSON.stringify(element) !== JSON.stringify(prevElement);
  const hasNextDiff = element && nextElement && JSON.stringify(element) !== JSON.stringify(nextElement);

  return (
    <div className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase">
          {element ? `${element.type} Properties` : 'Slide Properties'}
        </span>
        <div className="flex items-center gap-0.5">
          {hasPrevDiff && (
            <button
              onClick={() => resetElementToKeyframe(activeSlideId, element.id)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              title="Reset to previous keyframe"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          {hasNextDiff && (
            <button
              onClick={() => resetElementToNextKeyframe(activeSlideId, element.id)}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              title="Reset to next keyframe"
            >
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-4">
        {element ? (
          <>
            {element.type === 'text' && <TextProperties element={element} />}
            {element.type === 'shape' && <ShapeProperties element={element} />}
            {element.type === 'image' && <ImageProperties element={element} />}
            <ArrangePanel element={element} />
          </>
        ) : (
          slide && <SlideProperties slide={slide} />
        )}
      </div>
    </div>
  );
};
