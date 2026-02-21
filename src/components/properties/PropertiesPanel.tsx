import React from 'react';
import { useSelectedElements, useActiveSlide } from '../../store/selectors';
import { TextProperties } from './TextProperties';
import { ShapeProperties } from './ShapeProperties';
import { ImageProperties } from './ImageProperties';
import { SlideProperties } from './SlideProperties';
import { ArrangePanel } from './ArrangePanel';

export const PropertiesPanel: React.FC = () => {
  const selected = useSelectedElements();
  const slide = useActiveSlide();

  const element = selected.length === 1 ? selected[0] : null;

  return (
    <div className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <div className="p-3 border-b border-gray-200">
        <span className="text-xs font-medium text-gray-500 uppercase">
          {element ? `${element.type} Properties` : 'Slide Properties'}
        </span>
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
