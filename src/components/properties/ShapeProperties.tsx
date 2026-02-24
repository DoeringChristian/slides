import React from 'react';
import { useMultiSlideUpdate } from '../../store/selectors';
import { ColorPicker } from '../toolbar/ColorPicker';
import { TransitionButton } from './TransitionButton';
import { SlideSyncButton } from './SlideSyncButton';
import type { ShapeElement } from '../../types/presentation';

interface Props {
  element: ShapeElement;
}

export const ShapeProperties: React.FC<Props> = ({ element }) => {
  const update = useMultiSlideUpdate(element.id);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Fill</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['fill']} />
            <TransitionButton elementId={element.id} group="fill" direction="in" />
            <TransitionButton elementId={element.id} group="fill" direction="out" />
          </div>
        </div>
        <ColorPicker color={element.fill} onChange={(fill) => update({ fill })} />
      </div>
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Stroke</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['stroke']} />
            <TransitionButton elementId={element.id} group="stroke" direction="in" />
            <TransitionButton elementId={element.id} group="stroke" direction="out" />
          </div>
        </div>
        <ColorPicker color={element.stroke} onChange={(stroke) => update({ stroke })} />
      </div>
      <div>
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Stroke Width</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['strokeWidth']} />
            <TransitionButton elementId={element.id} group="strokeWidth" direction="in" />
            <TransitionButton elementId={element.id} group="strokeWidth" direction="out" />
          </div>
        </div>
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
          <div className="flex items-center mb-1">
            <label className="text-xs text-gray-500">Corner Radius</label>
            <div className="flex items-center gap-0.5 ml-auto">
              <SlideSyncButton elementId={element.id} fields={['cornerRadius']} />
              <TransitionButton elementId={element.id} group="cornerRadius" direction="in" />
              <TransitionButton elementId={element.id} group="cornerRadius" direction="out" />
            </div>
          </div>
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
        <div className="flex items-center mb-1">
          <label className="text-xs text-gray-500">Opacity</label>
          <div className="flex items-center gap-0.5 ml-auto">
            <SlideSyncButton elementId={element.id} fields={['opacity']} />
            <TransitionButton elementId={element.id} group="opacity" direction="in" />
            <TransitionButton elementId={element.id} group="opacity" direction="out" />
          </div>
        </div>
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
