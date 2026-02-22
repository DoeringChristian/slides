import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { usePrevKeyframeElement, useNextKeyframeElement } from '../../store/selectors';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronsUp, ChevronsDown, Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import { TransitionButton } from './TransitionButton';
import type { SlideElement } from '../../types/presentation';

interface Props {
  element: SlideElement;
}

function KeyframeButtons({ element, prev, next, fields, update }: {
  element: SlideElement;
  prev: SlideElement | undefined;
  next: SlideElement | undefined;
  fields: (keyof SlideElement)[];
  update: (changes: Partial<SlideElement>) => void;
}) {
  const pick = (el: SlideElement) => {
    const changes: Partial<SlideElement> = {};
    for (const f of fields) (changes as any)[f] = el[f];
    return changes;
  };
  const differs = (kf: SlideElement | undefined) => {
    if (!kf) return false;
    return fields.some((f) => Math.round(kf[f] as number) !== Math.round(element[f] as number));
  };
  const prevDiffers = differs(prev);
  const nextDiffers = differs(next);

  return (
    <div className="flex items-center gap-0.5 ml-auto">
      {prevDiffers && (
        <button
          onClick={() => update(pick(prev))}
          className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          title="Reset to previous keyframe"
        >
          <ArrowLeft size={12} />
        </button>
      )}
      {nextDiffers && (
        <button
          onClick={() => update(pick(next))}
          className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          title="Reset to next keyframe"
        >
          <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}

export const ArrangePanel: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const moveForward = usePresentationStore((s) => s.moveElementForward);
  const moveBackward = usePresentationStore((s) => s.moveElementBackward);
  const moveToFront = usePresentationStore((s) => s.moveElementToFront);
  const moveToBack = usePresentationStore((s) => s.moveElementToBack);
  const prev = usePrevKeyframeElement(element.id);
  const next = useNextKeyframeElement(element.id);

  const update = (changes: Partial<SlideElement>) => {
    updateElement(activeSlideId, element.id, changes);
  };

  return (
    <div className="space-y-3 border-t border-gray-200 pt-3">
      <span className="text-xs font-medium text-gray-500 uppercase">Arrange</span>

      <div>
        <div className="flex items-center mb-1">
          <span className="text-xs text-gray-500">Position</span>
          <div className="flex items-center gap-0.5 ml-auto">
            <TransitionButton elementId={element.id} group="position" direction="in" />
            <TransitionButton elementId={element.id} group="position" direction="out" />
          </div>
          <KeyframeButtons element={element} prev={prev} next={next} fields={['x', 'y']} update={update} />
        </div>
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
        </div>
      </div>

      <div>
        <div className="flex items-center mb-1">
          <span className="text-xs text-gray-500">Size</span>
          <div className="flex items-center gap-0.5 ml-auto">
            <TransitionButton elementId={element.id} group="size" direction="in" />
            <TransitionButton elementId={element.id} group="size" direction="out" />
          </div>
          <KeyframeButtons element={element} prev={prev} next={next} fields={['width', 'height']} update={update} />
        </div>
        <div className="grid grid-cols-2 gap-2">
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
      </div>

      <div>
        <div className="flex items-center mb-1">
          <span className="text-xs text-gray-500">Rotation</span>
          <div className="flex items-center gap-0.5 ml-auto">
            <TransitionButton elementId={element.id} group="rotation" direction="in" />
            <TransitionButton elementId={element.id} group="rotation" direction="out" />
          </div>
          <KeyframeButtons element={element} prev={prev} next={next} fields={['rotation']} update={update} />
        </div>
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

      <div className="flex items-center gap-2">
        <button
          onClick={() => update({ locked: !element.locked })}
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-800"
        >
          {element.locked ? <Lock size={12} /> : <Unlock size={12} />}
          {element.locked ? 'Locked' : 'Unlocked'}
        </button>
      </div>

      <div className="flex items-center">
        <button
          onClick={() => update({ visible: !element.visible })}
          className={`flex items-center gap-2 text-xs ${element.visible ? 'text-gray-600 hover:text-gray-800' : 'text-orange-500 hover:text-orange-600'}`}
        >
          {element.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          {element.visible ? 'Visible' : 'Hidden'}
        </button>
        <div className="flex items-center gap-0.5 ml-auto">
          <TransitionButton elementId={element.id} group="visibility" direction="in" />
          <TransitionButton elementId={element.id} group="visibility" direction="out" />
        </div>
      </div>
    </div>
  );
};
