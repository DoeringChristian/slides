import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useMultiSlideUpdate, usePreviousSlideElement, useNextSlideElement } from '../../store/selectors';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ColorPicker } from '../toolbar/ColorPicker';
import { TransitionButton } from './TransitionButton';
import { SlideSyncButton } from './SlideSyncButton';
import { FONT_FAMILIES, FONT_SIZES } from '../../utils/constants';
import type { TextElement, TextStyle } from '../../types/presentation';

interface Props {
  element: TextElement;
}

export const TextProperties: React.FC<Props> = ({ element }) => {
  const update = useMultiSlideUpdate(element.id);
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);

  // For content reset buttons
  const prevElement = usePreviousSlideElement(element.id) as TextElement | undefined;
  const nextElement = useNextSlideElement(element.id) as TextElement | undefined;
  const hasPrevContentDiff = prevElement && prevElement.text !== element.text;
  const hasNextContentDiff = nextElement && nextElement.text !== element.text;

  const updateStyle = (changes: Partial<TextStyle>) => {
    update({
      style: { ...element.style, ...changes },
    } as Partial<TextElement>);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-gray-500 uppercase">Text</div>
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Content</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['text']} />
            <TransitionButton elementId={element.id} group="content" direction="in" />
            <TransitionButton elementId={element.id} group="content" direction="out" />
            {hasPrevContentDiff && (
              <button
                onClick={() => updateElement(activeSlideId, element.id, { text: prevElement!.text })}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                title="Reset to previous keyframe"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            {hasNextContentDiff && (
              <button
                onClick={() => updateElement(activeSlideId, element.id, { text: nextElement!.text })}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                title="Reset to next keyframe"
              >
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-400 truncate">
          {element.text?.slice(0, 50) || '(empty)'}{element.text && element.text.length > 50 ? '...' : ''}
        </div>
      </div>
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Font</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['style.fontFamily']} />
          </div>
        </div>
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
          <div className="flex items-center mb-1">
            <label className="text-xs text-gray-500">Size</label>
            <div className="flex items-center gap-0.5 ml-auto">
              <SlideSyncButton elementId={element.id} fields={['style.fontSize']} />
              <TransitionButton elementId={element.id} group="fontSize" direction="in" />
              <TransitionButton elementId={element.id} group="fontSize" direction="out" />
            </div>
          </div>
          <select
            value={element.style.fontSize}
            onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
            className="w-full h-8 text-sm border border-gray-300 rounded px-2 bg-white"
          >
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <div className="flex items-center mb-1">
            <label className="text-xs text-gray-500">Color</label>
            <div className="flex items-center gap-0.5 ml-auto">
              <SlideSyncButton elementId={element.id} fields={['style.color']} />
              <TransitionButton elementId={element.id} group="color" direction="in" />
              <TransitionButton elementId={element.id} group="color" direction="out" />
            </div>
          </div>
          <ColorPicker color={element.style.color} onChange={(color) => updateStyle({ color })} allowTransparent={false} />
        </div>
      </div>
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Line Height</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['style.lineHeight']} />
            <TransitionButton elementId={element.id} group="lineHeight" direction="in" />
            <TransitionButton elementId={element.id} group="lineHeight" direction="out" />
          </div>
        </div>
        <input
          type="number"
          value={element.style.lineHeight}
          onChange={(e) => updateStyle({ lineHeight: Number(e.target.value) })}
          min={0.5} max={3} step={0.1}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2"
        />
      </div>
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Opacity</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['opacity']} />
            <TransitionButton elementId={element.id} group="opacity" direction="in" />
            <TransitionButton elementId={element.id} group="opacity" direction="out" />
          </div>
        </div>
        <input
          type="range"
          value={element.opacity * 100}
          onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
          min={0} max={100}
          className="w-full accent-blue-500"
        />
      </div>
    </div>
  );
};
