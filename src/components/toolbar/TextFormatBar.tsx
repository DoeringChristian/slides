import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { ColorPicker } from './ColorPicker';
import { ScrubInput } from '../controls/ScrubInput';
import { useScrubCommit } from '../controls/useScrubCommit';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { FONT_FAMILIES } from '../../utils/constants';
import type { TextElement, TextStyle } from '../../types/presentation';

/**
 * Compact font-size scrub field. Separate component (not inline in the bar)
 * because useScrubCommit is a hook and TextFormatBar early-returns before
 * any hook could run. Writes whole style objects, matching the bar's
 * updateStyle convention; the scrub session snapshots only style.fontSize
 * (setNestedPartial spreads the sibling style fields on restore).
 */
const FontSizeInput: React.FC<{
  element: TextElement;
  update: (changes: Partial<TextElement>) => void;
}> = ({ element, update }) => {
  const scrub = useScrubCommit({ element, update, syncFields: ['style.fontSize'] });
  const changesFor = (v: number): Partial<TextElement> => ({
    style: { ...element.style, fontSize: v },
  });
  return (
    <div className="w-14">
      <ScrubInput
        compact
        value={element.style.fontSize}
        spec={{ min: 6, max: 200, step: 1, precision: 0 }}
        onScrubStart={scrub.begin}
        onPreview={(v) => scrub.preview(changesFor(v))}
        onCommit={(v) => scrub.end(changesFor(v))}
        onScrubCancel={scrub.cancel}
      />
    </div>
  );
};

export const TextFormatBar: React.FC = () => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const selectedElements = useSelectedElements();

  const textEl = selectedElements[0] as TextElement | undefined;
  if (!textEl || textEl.type !== 'text') return null;

  const style = textEl.style;

  const updateStyle = (changes: Partial<TextStyle>) => {
    updateElement(activeSlideId, textEl.id, {
      style: { ...style, ...changes },
    } as Partial<TextElement>);
  };

  return (
    <div className="flex items-center flex-wrap overflow-x-auto gap-1">
      <select
        value={style.fontFamily}
        onChange={(e) => updateStyle({ fontFamily: e.target.value })}
        className="h-7 text-xs border border-gray-300 rounded px-1 bg-white"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      <FontSizeInput
        element={textEl}
        update={(changes) => updateElement(activeSlideId, textEl.id, changes)}
      />

      <button
        onClick={() => updateStyle({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
        className={`p-1 rounded ${style.fontWeight === 'bold' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
        title="Bold (Ctrl+B)"
      >
        <Bold size={14} />
      </button>
      <button
        onClick={() => updateStyle({ fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
        className={`p-1 rounded ${style.fontStyle === 'italic' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
        title="Italic (Ctrl+I)"
      >
        <Italic size={14} />
      </button>
      <button
        onClick={() => updateStyle({ textDecoration: style.textDecoration === 'underline' ? 'none' : 'underline' })}
        className={`p-1 rounded ${style.textDecoration === 'underline' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
        title="Underline (Ctrl+U)"
      >
        <Underline size={14} />
      </button>
      <button
        onClick={() => updateStyle({ textDecoration: style.textDecoration === 'line-through' ? 'none' : 'line-through' })}
        className={`p-1 rounded ${style.textDecoration === 'line-through' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}
      >
        <Strikethrough size={14} />
      </button>

      <div className="w-px h-5 bg-gray-300 mx-0.5" />

      <button onClick={() => updateStyle({ align: 'left' })} className={`p-1 rounded ${style.align === 'left' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}>
        <AlignLeft size={14} />
      </button>
      <button onClick={() => updateStyle({ align: 'center' })} className={`p-1 rounded ${style.align === 'center' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}>
        <AlignCenter size={14} />
      </button>
      <button onClick={() => updateStyle({ align: 'right' })} className={`p-1 rounded ${style.align === 'right' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`}>
        <AlignRight size={14} />
      </button>

      <div className="w-px h-5 bg-gray-300 mx-0.5" />

      <ColorPicker
        color={style.color}
        onChange={(color) => updateStyle({ color })}
        label="Text Color"
      />
    </div>
  );
};
