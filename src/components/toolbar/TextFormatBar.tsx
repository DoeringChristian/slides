import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { ColorPicker } from './ColorPicker';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { FONT_FAMILIES, FONT_SIZES } from '../../utils/constants';
import type { TextElement, TextStyle } from '../../types/presentation';

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
    <div className="flex items-center gap-1">
      <select
        value={style.fontFamily}
        onChange={(e) => updateStyle({ fontFamily: e.target.value })}
        className="h-7 text-xs border border-gray-300 rounded px-1 bg-white"
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      <select
        value={style.fontSize}
        onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })}
        className="h-7 w-14 text-xs border border-gray-300 rounded px-1 bg-white"
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

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
