import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { useMultiSlideUpdate } from '../../store/selectors';
import { ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Lock, Unlock, Eye, EyeOff } from 'lucide-react';
import { TransitionButton } from './TransitionButton';
import { PropertyRow } from './PropertyRow';
import { Property, PairNumberProperty, NumberProperty } from './Property';
import type { SlideElement } from '../../types/presentation';

/**
 * Properties common to every element: position, size, rotation. Each is a
 * Property instance — header buttons + editor are rendered by PropertyRow.
 * Non-property widgets (layer order, lock, visibility toggle) stay
 * hand-rolled below because they're verbs, not animatable values.
 */
const ARRANGE_PROPERTIES: Property<SlideElement>[] = [
  new PairNumberProperty<SlideElement>({
    key: 'position', label: 'Position',
    transitionGroup: 'position', keys: ['x', 'y'], labels: ['X', 'Y'], round: true,
  }),
  new PairNumberProperty<SlideElement>({
    key: 'size', label: 'Size',
    transitionGroup: 'size', keys: ['width', 'height'], labels: ['W', 'H'], round: true,
  }),
  new NumberProperty<SlideElement>({
    key: 'rotation', label: 'Rotation',
    transitionGroup: 'rotation', min: 0, max: 360, round: true,
  }),
];

interface Props {
  element: SlideElement;
}

export const ArrangePanel: React.FC<Props> = ({ element }) => {
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const moveForward = usePresentationStore((s) => s.moveElementForward);
  const moveBackward = usePresentationStore((s) => s.moveElementBackward);
  const moveToFront = usePresentationStore((s) => s.moveElementToFront);
  const moveToBack = usePresentationStore((s) => s.moveElementToBack);
  const update = useMultiSlideUpdate(element.id);

  return (
    <div className="space-y-3 border-t border-gray-200 pt-3">
      <span className="text-xs font-medium text-gray-500 uppercase">Arrange</span>

      {ARRANGE_PROPERTIES.map((p) => (
        <PropertyRow key={p.key} property={p} element={element} />
      ))}

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
