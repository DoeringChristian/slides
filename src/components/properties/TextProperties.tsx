import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ColorPicker } from '../toolbar/ColorPicker';
import { FONT_FAMILIES, FONT_SIZES } from '../../utils/constants';
import type { TextElement, TextStyle } from '../../types/presentation';

interface Props {
  element: TextElement;
}

export const TextProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);

  const updateStyle = (changes: Partial<TextStyle>) => {
    updateElement(activeSlideId, element.id, {
      style: { ...element.style, ...changes },
    } as Partial<TextElement>);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">Font</label>
        <select
          value={element.style.fontFamily}
          onChange={(e) => updateStyle({ fontFamily: e.target.value })}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2 bg-white"
        >
          {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">Size</label>
          <select
            value={element.style.fontSize}
            onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
            className="w-full h-8 text-sm border border-gray-300 rounded px-2 bg-white"
          >
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">Color</label>
          <ColorPicker color={element.style.color} onChange={(color) => updateStyle({ color })} />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Line Height</label>
        <input
          type="number"
          value={element.style.lineHeight}
          onChange={(e) => updateStyle({ lineHeight: Number(e.target.value) })}
          min={0.5} max={3} step={0.1}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2"
        />
      </div>
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
    </div>
  );
};
