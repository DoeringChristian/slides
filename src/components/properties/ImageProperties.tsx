import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import type { ImageElement } from '../../types/presentation';

interface Props {
  element: ImageElement;
}

export const ImageProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">Opacity</label>
        <input
          type="range"
          value={element.opacity * 100}
          onChange={(e) => updateElement(activeSlideId, element.id, { opacity: Number(e.target.value) / 100 })}
          min={0} max={100}
          className="w-full accent-blue-500"
        />
      </div>
      <div className="text-xs text-gray-400">
        Original: {element.originalWidth} x {element.originalHeight}
      </div>
      <button
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              updateElement(activeSlideId, element.id, { src: ev.target?.result as string });
            };
            reader.readAsDataURL(file);
          };
          input.click();
        }}
        className="w-full h-8 text-sm border border-gray-300 rounded hover:bg-gray-50"
      >
        Replace Image
      </button>
    </div>
  );
};
