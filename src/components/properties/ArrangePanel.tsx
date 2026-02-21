import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Lock, Unlock } from 'lucide-react';
import type { SlideElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
}

export const ArrangePanel: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const moveForward = usePresentationStore((s) => s.moveElementForward);
  const moveBackward = usePresentationStore((s) => s.moveElementBackward);
  const moveToFront = usePresentationStore((s) => s.moveElementToFront);
  const moveToBack = usePresentationStore((s) => s.moveElementToBack);

  const update = (changes: Partial<SlideElement>) => {
    updateElement(activeSlideId, element.id, changes);
  };

  return (
    <div className="space-y-3 border-t border-gray-200 pt-3">
      <span className="text-xs font-medium text-gray-500 uppercase">Arrange</span>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">X</label>
          <input type="number" value={Math.round(element.x)} onChange={(e) => update({ x: Number(e.target.value) })}
            className="w-full h-7 text-xs border border-gray-300 rounded px-2" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Y</label>
          <input type="number" value={Math.round(element.y)} onChange={(e) => update({ y: Number(e.target.value) })}
            className="w-full h-7 text-xs border border-gray-300 rounded px-2" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">W</label>
          <input type="number" value={Math.round(element.width)} onChange={(e) => update({ width: Number(e.target.value) })}
            className="w-full h-7 text-xs border border-gray-300 rounded px-2" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">H</label>
          <input type="number" value={Math.round(element.height)} onChange={(e) => update({ height: Number(e.target.value) })}
            className="w-full h-7 text-xs border border-gray-300 rounded px-2" />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Rotation</label>
        <input type="number" value={Math.round(element.rotation)} onChange={(e) => update({ rotation: Number(e.target.value) })}
          min={0} max={360} className="w-full h-7 text-xs border border-gray-300 rounded px-2" />
      </div>

      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 mr-auto">Layer</span>
        <button onClick={() => moveToBack(activeSlideId, element.id)} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Send to Back">
          <ChevronsDown size={14} />
        </button>
        <button onClick={() => moveBackward(activeSlideId, element.id)} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Send Backward">
          <ArrowDown size={14} />
        </button>
        <button onClick={() => moveForward(activeSlideId, element.id)} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Bring Forward">
          <ArrowUp size={14} />
        </button>
        <button onClick={() => moveToFront(activeSlideId, element.id)} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Bring to Front">
          <ChevronsUp size={14} />
        </button>
      </div>

      <button
        onClick={() => update({ locked: !element.locked })}
        className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-800"
      >
        {element.locked ? <Lock size={12} /> : <Unlock size={12} />}
        {element.locked ? 'Locked' : 'Unlocked'}
      </button>
    </div>
  );
};
