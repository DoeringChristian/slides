import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { arrangeUnits, planAlign, planDistribute, type AlignEdge } from '../../utils/model/arrangeUnits';
import type { SlideElement } from '../../types/presentation';
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween } from 'lucide-react';

export const AlignmentTools: React.FC = () => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElements = usePresentationStore((s) => s.updateElements);
  const selected = useSelectedElements();

  const scope = useEditorStore((s) => s.activeObjectGroupId);
  const slideElements = usePresentationStore((s) => s.presentation.slides[activeSlideId]?.elements);
  // A cropped image (or any group) is one unit: one alone has nothing to align with.
  const unitCount = slideElements ? arrangeUnits(slideElements, selected.map(el => el.id), scope).length : 0;
  if (unitCount < 2) return null;

  // Groups move as one, by the box they show (a cropped image by its crop):
  // see utils/model/arrangeUnits. One batch update → one undo step.
  const plan = (make: (elements: Record<string, SlideElement>, units: ReturnType<typeof arrangeUnits>) => ReturnType<typeof planAlign>) => {
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    if (!slide) return;
    const units = arrangeUnits(slide.elements, selected.map(el => el.id), useEditorStore.getState().activeObjectGroupId);
    const updates = make(slide.elements, units);
    if (updates.length > 0) updateElements(activeSlideId, updates);
  };
  const align = (edge: AlignEdge) => plan((elements, units) => planAlign(elements, units, edge));
  const distribute = (axis: 'h' | 'v') => plan((elements, units) => planDistribute(elements, units, axis));

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
      <button onClick={() => distribute('h')} disabled={unitCount < 3} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:hover:bg-transparent" title="Distribute Horizontally">
        <AlignHorizontalSpaceBetween size={14} />
      </button>
      <button onClick={() => distribute('v')} disabled={unitCount < 3} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:hover:bg-transparent" title="Distribute Vertically">
        <AlignVerticalSpaceBetween size={14} />
      </button>
    </div>
  );
};
