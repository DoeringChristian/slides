import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal } from 'lucide-react';

export const AlignmentTools: React.FC = () => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const selected = useSelectedElements();

  if (selected.length < 2) return null;

  const align = (type: string) => {
    const xs = selected.map((e) => e.x);
    const ys = selected.map((e) => e.y);
    const rights = selected.map((e) => e.x + e.width);
    const bottoms = selected.map((e) => e.y + e.height);

    selected.forEach((el) => {
      let update: Record<string, number> = {};
      switch (type) {
        case 'left': update = { x: Math.min(...xs) }; break;
        case 'center-h': update = { x: (Math.min(...xs) + Math.max(...rights)) / 2 - el.width / 2 }; break;
        case 'right': update = { x: Math.max(...rights) - el.width }; break;
        case 'top': update = { y: Math.min(...ys) }; break;
        case 'center-v': update = { y: (Math.min(...ys) + Math.max(...bottoms)) / 2 - el.height / 2 }; break;
        case 'bottom': update = { y: Math.max(...bottoms) - el.height }; break;
      }
      updateElement(activeSlideId, el.id, update);
    });
  };

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => align('left')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Left">
        <AlignStartVertical size={14} />
      </button>
      <button onClick={() => align('center-h')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Center">
        <AlignCenterVertical size={14} />
      </button>
      <button onClick={() => align('right')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Right">
        <AlignEndVertical size={14} />
      </button>
      <button onClick={() => align('top')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Top">
        <AlignStartHorizontal size={14} />
      </button>
      <button onClick={() => align('center-v')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Middle">
        <AlignCenterHorizontal size={14} />
      </button>
      <button onClick={() => align('bottom')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Bottom">
        <AlignEndHorizontal size={14} />
      </button>
    </div>
  );
};
