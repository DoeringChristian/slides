import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween } from 'lucide-react';

export const AlignmentTools: React.FC = () => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElements = usePresentationStore((s) => s.updateElements);
  const selected = useSelectedElements();

  if (selected.length < 2) return null;

  const align = (type: string) => {
    const xs = selected.map((e) => e.x);
    const ys = selected.map((e) => e.y);
    const rights = selected.map((e) => e.x + e.width);
    const bottoms = selected.map((e) => e.y + e.height);

    // One batch update per action → a single undo entry, same as a canvas
    // drag commit.
    const updates = selected.flatMap((el) => {
      let changes: Partial<Record<'x' | 'y', number>> = {};
      switch (type) {
        case 'left': changes = { x: Math.min(...xs) }; break;
        case 'center-h': changes = { x: (Math.min(...xs) + Math.max(...rights)) / 2 - el.width / 2 }; break;
        case 'right': changes = { x: Math.max(...rights) - el.width }; break;
        case 'top': changes = { y: Math.min(...ys) }; break;
        case 'center-v': changes = { y: (Math.min(...ys) + Math.max(...bottoms)) / 2 - el.height / 2 }; break;
        case 'bottom': changes = { y: Math.max(...bottoms) - el.height }; break;
      }
      const noop = (changes.x === undefined || changes.x === el.x) &&
        (changes.y === undefined || changes.y === el.y);
      return noop ? [] : [{ elementId: el.id, changes }];
    });
    if (updates.length > 0) updateElements(activeSlideId, updates);
  };

  // Google Slides–style distribute: the outermost two elements stay put and
  // the ones between are spaced so every gap is equal (gaps may be negative
  // when the elements overlap, same as Slides).
  const distribute = (axis: 'h' | 'v') => {
    if (selected.length < 3) return;
    const pos = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'width' : 'height';
    const sorted = [...selected].sort((a, b) => a[pos] - b[pos]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last[pos] + last[size] - first[pos];
    const total = sorted.reduce((sum, el) => sum + el[size], 0);
    const gap = (span - total) / (sorted.length - 1);
    let cursor = first[pos];
    const updates: Array<{ elementId: string; changes: Partial<Record<'x' | 'y', number>> }> = [];
    sorted.forEach((el) => {
      if (el[pos] !== cursor) {
        updates.push({ elementId: el.id, changes: { [pos]: cursor } });
      }
      cursor += el[size] + gap;
    });
    if (updates.length > 0) updateElements(activeSlideId, updates);
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
      <button onClick={() => distribute('h')} disabled={selected.length < 3} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:hover:bg-transparent" title="Distribute Horizontally">
        <AlignHorizontalSpaceBetween size={14} />
      </button>
      <button onClick={() => distribute('v')} disabled={selected.length < 3} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:hover:bg-transparent" title="Distribute Vertically">
        <AlignVerticalSpaceBetween size={14} />
      </button>
    </div>
  );
};
