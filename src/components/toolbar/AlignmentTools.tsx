import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useSelectedElements } from '../../store/selectors';
import { getActiveUndoManager } from '../../collab/activeUndo';
import { arrangeUnits, planAlign, planDistribute, planMatchSize, targetUnit, type AlignEdge, type ArrangeUnit } from '../../utils/model/arrangeUnits';
import type { SlideElement } from '../../types/presentation';
import { AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, Scaling } from 'lucide-react';

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
  // Align and match size work against the object selected last (the
  // target, which stays as it is); distribute spans the outermost two.
  const plan = (make: (elements: Record<string, SlideElement>, units: ArrangeUnit[], target: ArrangeUnit) => ReturnType<typeof planAlign>) => {
    const slide = usePresentationStore.getState().presentation.slides[activeSlideId];
    if (!slide) return;
    const ids = useEditorStore.getState().selectedElementIds;
    const units = arrangeUnits(slide.elements, ids, useEditorStore.getState().activeObjectGroupId);
    const target = targetUnit(units, ids);
    if (!target) return;
    const updates = make(slide.elements, units, target);
    if (updates.length === 0) return;
    // Each press is its own undo step, however quickly they follow.
    const undo = getActiveUndoManager();
    undo?.stopCapturing();
    updateElements(activeSlideId, updates);
    undo?.stopCapturing();
  };
  const align = (edge: AlignEdge) => plan((elements, units, target) => planAlign(elements, units, edge, target));
  const distribute = (axis: 'h' | 'v') => plan((elements, units) => planDistribute(elements, units, axis));
  const matchSize = () => plan(planMatchSize);

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => align('left')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Left (to the last selected)">
        <AlignStartVertical size={14} />
      </button>
      <button onClick={() => align('center-h')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Center (to the last selected)">
        <AlignCenterVertical size={14} />
      </button>
      <button onClick={() => align('right')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Right (to the last selected)">
        <AlignEndVertical size={14} />
      </button>
      <button onClick={() => align('top')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Top (to the last selected)">
        <AlignStartHorizontal size={14} />
      </button>
      <button onClick={() => align('center-v')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Middle (to the last selected)">
        <AlignCenterHorizontal size={14} />
      </button>
      <button onClick={() => align('bottom')} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Align Bottom (to the last selected)">
        <AlignEndHorizontal size={14} />
      </button>
      <button onClick={() => distribute('h')} disabled={unitCount < 3} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:hover:bg-transparent" title="Distribute Horizontally">
        <AlignHorizontalSpaceBetween size={14} />
      </button>
      <button onClick={() => distribute('v')} disabled={unitCount < 3} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:hover:bg-transparent" title="Distribute Vertically">
        <AlignVerticalSpaceBetween size={14} />
      </button>
      <button onClick={matchSize} className="p-1 rounded hover:bg-gray-100 text-gray-600" title="Match Size (of the last selected)">
        <Scaling size={14} />
      </button>
    </div>
  );
};
