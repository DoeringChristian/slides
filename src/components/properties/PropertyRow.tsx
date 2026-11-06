import { SelectionPropertiesContext } from './SelectionPropertiesContext';
import { batchPropertyEditor, selectionProxy } from '../../store/batchPropertyEditor';
import { usePresentationStore } from '../../store/presentationStore';
import React, { useContext } from 'react';
import { CreationDraftContext } from './CreationDraftContext';
import { updateShapeStyleFromCurrent } from '../../store/shapeStyleMutation';
import { isOwnedScrubMutation } from '../../utils/editor/scrubMutation';
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
  const batchIds = useContext(SelectionPropertiesContext);
  const slide = usePresentationStore(s => s.presentation.slides[activeSlideId]);
  const geometry = ['position', 'size', 'rotation'].includes(property.key);
  const members = batchIds?.map(id => slide?.elements[id]).filter((el): el is E => !!el && (geometry || el.type === element.type) && property.visibleFor(el as E)) ?? [];
  const display = batchIds && members.length ? (geometry ? selectionProxy(members) : members[0]) as E : element;
  const batchEdit = batchIds ? batchPropertyEditor(activeSlideId, batchIds, geometry, el => geometry || (el.type === element.type && property.visibleFor(el as E))) : null;
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

  if (batchIds ? !members.length : !property.visibleFor(element)) return null;

  const label = property instanceof ReadoutProperty ? property.formattedLabel(display) : property.label;
  const editor = property.renderEditor({ element: display, update: batchEdit as typeof edit ?? edit });

  return (
    <div className="min-w-0" data-property={property.key}>
      <div className={editor ? 'mb-1 min-w-0' : 'min-w-0'}>
        <div className="text-xs text-gray-500 break-words">{label}{batchIds && !geometry && members.some(el => property.differsFromKeyframe(members[0], el)) && <span className="ml-1 text-gray-400">(Mixed)</span>}</div>
        {!draft && <SelectionPropertiesContext.Provider value={batchIds ? members.map(el => el.id) : null}><div className="flex flex-wrap items-center gap-0.5 min-w-0 mt-0.5">
          <SlideSyncButton elementId={element.id} fields={property.syncFields} />
          {property.transitionGroup && (
            <>
              <TransitionButton elementId={element.id} group={property.transitionGroup} direction="in" />
              <TransitionButton elementId={element.id} group={property.transitionGroup} direction="out" />
            </>
          )}
          <KeyframeButtons property={property} element={element} prev={prev} next={next} update={update} />
        </div></SelectionPropertiesContext.Provider>}
      </div>
      {editor}
    </div>
  );
}
