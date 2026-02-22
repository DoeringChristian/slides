import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ColorPicker } from '../toolbar/ColorPicker';
import { Timer } from 'lucide-react';
import type { Slide } from '../../types/presentation';

interface Props {
  slide: Slide;
}

export const SlideProperties: React.FC<Props> = ({ slide }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateSlideBackground = usePresentationStore((s) => s.updateSlideBackground);
  const updateSlideTransition = usePresentationStore((s) => s.updateSlideTransition);
  const updateSlideAutoAdvance = usePresentationStore((s) => s.updateSlideAutoAdvance);

  const bgColor = slide.background.type === 'solid' ? slide.background.color : '#ffffff';

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">Background</label>
        <ColorPicker
          color={bgColor}
          onChange={(color) => updateSlideBackground(activeSlideId, { type: 'solid', color })}
          label="Background Color"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Animation Duration (ms)</label>
        <input
          type="number"
          value={slide.transition.duration}
          onChange={(e) => updateSlideTransition(activeSlideId, { duration: Number(e.target.value) })}
          min={100} max={2000} step={100}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2"
        />
      </div>
      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Timer size={14} className="text-gray-500" />
          <label className="text-xs text-gray-500">Auto-Advance</label>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={slide.autoAdvance ?? false}
            onChange={(e) => updateSlideAutoAdvance(activeSlideId, e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm text-gray-700">Automatically advance to next slide</span>
        </label>
        {slide.autoAdvance && (
          <div className="mt-2">
            <label className="text-xs text-gray-500 block mb-1">Delay (seconds)</label>
            <input
              type="number"
              value={slide.autoAdvanceDelay ?? 0.3}
              onChange={(e) => updateSlideAutoAdvance(activeSlideId, true, Number(e.target.value))}
              min={0.1} max={300} step={0.1}
              className="w-full h-8 text-sm border border-gray-300 rounded px-2"
            />
          </div>
        )}
      </div>
    </div>
  );
};
