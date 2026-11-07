import { MultiSelectionProperties } from './MultiSelectionProperties';
import { CreationProperties } from './CreationProperties';
import { creationKeyForTool, useCreationPreferences } from '../../store/creationPreferences';
import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useSelectedElements, useActiveSlide, usePreviousSlideElement, useNextSlideElement } from '../../store/selectors';
import { useEditorStore } from '../../store/editorStore';
import { usePresentationStore } from '../../store/presentationStore';
import { TextProperties } from './TextProperties';
import { ShapeProperties } from './ShapeProperties';
import { ImageProperties } from './ImageProperties';
import { SlideProperties } from './SlideProperties';
import { ArrangePanel } from './ArrangePanel';
import { PanelHeader } from './PanelHeader';
import { TransitionButton } from './TransitionButton';
import type { SlideElement } from '../../types/presentation';

/** Element types that can participate in a cross-type geometry morph. */
const isMorphable = (el: SlideElement | undefined): boolean =>
  el?.type === 'text' || el?.type === 'shape';

export const PropertiesPanel: React.FC = () => {
  const tool = useEditorStore(s => s.tool);
  const iconId = useCreationPreferences(s => s.iconId);
  const creationKey = creationKeyForTool(tool);
  const selected = useSelectedElements();
  const slide = useActiveSlide();
  const element = selected.length === 1 ? selected[0] : null;
  const prevElement = usePreviousSlideElement(element?.id || '');
  const nextElement = useNextSlideElement(element?.id || '');
  const activeSlideId = useEditorStore((s) => s.activeSlideId);
  const resetElementToKeyframe = usePresentationStore((s) => s.resetElementToKeyframe);
  const resetElementToNextKeyframe = usePresentationStore((s) => s.resetElementToNextKeyframe);

  const hasPrevDiff = element && prevElement && JSON.stringify(element) !== JSON.stringify(prevElement);
  const hasNextDiff = element && nextElement && JSON.stringify(element) !== JSON.stringify(nextElement);

  // Cross-TYPE morph row: shown when an adjacent keyframe holds this object
  // as a DIFFERENT morphable element type (text ↔ shape). The in/out
  // TransitionButtons are the same picker every other group uses; each
  // renders only when its own side actually differs.
  const showMorphRow = Boolean(
    element && isMorphable(element) && (
      (prevElement && isMorphable(prevElement) && prevElement.type !== element.type) ||
      (nextElement && isMorphable(nextElement) && nextElement.type !== element.type)
    ),
  );

  // Hide header for image/text elements (controls are in their respective Properties components)
  const showHeader = !element || (element.type !== 'image' && element.type !== 'text');

  if (creationKey) {
    return <div className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      <h2 className="p-3 text-sm font-medium border-b">Create {creationKey === 'icon' ? 'icon' : creationKey}</h2>
      <div className="p-3"><CreationProperties key={`${activeSlideId}:${tool}:${iconId}`} tool={tool} creationKey={creationKey} /></div>
      <p className="p-3 text-xs text-gray-500">Drag on the slide to create. Styles are remembered on this browser.</p>
    </div>;
  }

  return (
    <div className="w-64 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
      {showHeader && selected.length < 2 && (
        <div className="p-3 border-b border-gray-200">
          {/* Which transition pickers appear here is derived from what
              actually changed across the adjacent keyframes — see
              headerGroups.ts. Text / image render their own header in their
              own components. */}
          <PanelHeader
            label={element ? element.type : 'Slide'}
            elementId={element?.id}
          >
            {hasPrevDiff && (
              <button
                onClick={() => resetElementToKeyframe(activeSlideId, element.id)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                title="Reset to previous keyframe"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            {hasNextDiff && (
              <button
                onClick={() => resetElementToNextKeyframe(activeSlideId, element.id)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                title="Reset to next keyframe"
              >
                <ArrowRight size={14} />
              </button>
            )}
          </PanelHeader>
        </div>
      )}

      <div className="p-3 space-y-4">
        {selected.length > 1 ? <MultiSelectionProperties key={`${activeSlideId}:${selected.map(el => el.id).join()}`} elements={selected} /> : element ? (
          <>
            {element.type === 'text' && <TextProperties element={element} />}
            {element.type === 'shape' && <ShapeProperties element={element} />}
            {element.type === 'image' && <ImageProperties element={element} />}
            {showMorphRow && (
              <div>
                <div className="flex items-center">
                  <span className="text-xs text-gray-500">Morph</span>
                  <div className="flex items-center gap-0.5 ml-auto">
                    <TransitionButton elementId={element.id} group="morph" direction="in" />
                    <TransitionButton elementId={element.id} group="morph" direction="out" />
                  </div>
                </div>
              </div>
            )}
            <ArrangePanel element={element} />
          </>
        ) : (
          slide && <SlideProperties slide={slide} />
        )}
      </div>
    </div>
  );
};
