import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ColorPicker } from '../toolbar/ColorPicker';
import type { Slide, SlideTransition } from '../../types/presentation';

interface Props {
  slide: Slide;
}

const TRANSITIONS: SlideTransition['type'][] = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'zoom'];

export const SlideProperties: React.FC<Props> = ({ slide }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateSlideBackground = usePresentationStore((s) => s.updateSlideBackground);
  const updateSlideTransition = usePresentationStore((s) => s.updateSlideTransition);

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
        <label className="text-xs text-gray-500 block mb-1">Transition</label>
        <select
          value={slide.transition.type}
          onChange={(e) => updateSlideTransition(activeSlideId, { ...slide.transition, type: e.target.value as SlideTransition['type'] })}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2 bg-white"
        >
          {TRANSITIONS.map((t) => (
            <option key={t} value={t}>{t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ')}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Duration (ms)</label>
        <input
          type="number"
          value={slide.transition.duration}
          onChange={(e) => updateSlideTransition(activeSlideId, { ...slide.transition, duration: Number(e.target.value) })}
          min={100} max={2000} step={100}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2"
        />
      </div>
    </div>
  );
};
