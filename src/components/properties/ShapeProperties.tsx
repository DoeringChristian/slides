import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ColorPicker } from '../toolbar/ColorPicker';
import type { ShapeElement } from '../../types/presentation';

interface Props {
  element: ShapeElement;
}

export const ShapeProperties: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);

  const update = (changes: Partial<ShapeElement>) => {
    updateElement(activeSlideId, element.id, changes);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 block mb-1">Fill</label>
        <ColorPicker color={element.fill} onChange={(fill) => update({ fill })} />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Stroke</label>
        <ColorPicker color={element.stroke} onChange={(stroke) => update({ stroke })} />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Stroke Width</label>
        <input
          type="number"
          value={element.strokeWidth}
          onChange={(e) => update({ strokeWidth: Number(e.target.value) })}
          min={0} max={20} step={1}
          className="w-full h-8 text-sm border border-gray-300 rounded px-2"
        />
      </div>
      {element.shapeType === 'rect' && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">Corner Radius</label>
          <input
            type="number"
            value={element.cornerRadius}
            onChange={(e) => update({ cornerRadius: Number(e.target.value) })}
            min={0} max={100} step={1}
            className="w-full h-8 text-sm border border-gray-300 rounded px-2"
          />
        </div>
      )}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Opacity</label>
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
