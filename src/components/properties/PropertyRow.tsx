import React, { useContext } from 'react';
import { CreationDraftContext } from './CreationDraftContext';
import { updateShapeStyleFromCurrent } from '../../store/shapeStyleMutation';
import { isOwnedScrubMutation } from '../../utils/scrubMutation';
import type { ShapeElement } from '../../types/presentation';
import { usePrevKeyframeElement, useNextKeyframeElement } from '../../store/selectors';
import { TransitionButton } from './TransitionButton';
import { SlideSyncButton } from './SlideSyncButton';
import { KeyframeButtons } from './KeyframeButtons';
import { Property, ReadoutProperty } from './Property';
import { useEditorStore } from '../../store/editorStore';
import { updateElementFromCurrent, type CurrentChange } from '../../store/currentMutation';
import type { SlideElement } from '../../types/presentation';

interface Props<E extends SlideElement> {
  property: Property<E>;
  element: E;
}

/**
 * Standard property row.
 *
 *   [Label]            [SlideSync] [TransitionIn] [TransitionOut] [KeyframePrev] [KeyframeNext]
 *   [Editor body — number input, color picker, …]
 *
 * Header buttons are driven entirely from the property's declared metadata
 * (syncFields, transitionGroup); KeyframeButtons consults the property's
 * own differ + copier so nested paths and multi-field properties work
 * uniformly. A panel just lists Property instances — it never re-spells
 * the button row.
 */
export function PropertyRow<E extends SlideElement>({ property, element }: Props<E>): React.ReactElement | null {
  const prev = usePrevKeyframeElement(element.id) as E | undefined;
  const next = useNextKeyframeElement(element.id) as E | undefined;
  const activeSlideId = useEditorStore(s => s.activeSlideId);
  const draft = useContext(CreationDraftContext);
  const update = (changes: CurrentChange<E>) => {
    if (draft) { draft.update(changes as CurrentChange<ShapeElement>); return; }
    updateElementFromCurrent(activeSlideId, element, changes);
  };
  const accept = (changes: CurrentChange<E>) => {
    if (draft) draft.commit(changes as CurrentChange<ShapeElement>);
    else if (element.type === 'shape') updateShapeStyleFromCurrent(activeSlideId, element, changes as CurrentChange<ShapeElement>);
    else update(changes);
  };
  const edit = Object.assign((changes: CurrentChange<E>) => {
    if (isOwnedScrubMutation()) update(changes);
    else accept(changes);
  }, { commit: accept });

  if (!property.visibleFor(element)) return null;

  const label = property instanceof ReadoutProperty ? property.formattedLabel(element) : property.label;
  const editor = property.renderEditor({ element, update: edit });

  return (
    <div className="min-w-0">
      <div className={editor ? 'mb-1 min-w-0' : 'min-w-0'}>
        <div className="text-xs text-gray-500 break-words">{label}</div>
        {!draft && <div className="flex flex-wrap items-center gap-0.5 min-w-0 mt-0.5">
          <SlideSyncButton elementId={element.id} fields={property.syncFields} />
          {property.transitionGroup && (
            <>
              <TransitionButton elementId={element.id} group={property.transitionGroup} direction="in" />
              <TransitionButton elementId={element.id} group={property.transitionGroup} direction="out" />
            </>
          )}
          <KeyframeButtons property={property} element={element} prev={prev} next={next} update={update} />
        </div>}
      </div>
      {editor}
    </div>
  );
}
