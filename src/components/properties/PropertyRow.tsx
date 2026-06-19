import React from 'react';
import { usePrevKeyframeElement, useNextKeyframeElement, useMultiSlideUpdate } from '../../store/selectors';
import { TransitionButton } from './TransitionButton';
import { SlideSyncButton } from './SlideSyncButton';
import { KeyframeButtons } from './KeyframeButtons';
import { Property, ReadoutProperty } from './Property';
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
  const update = useMultiSlideUpdate(element.id) as (changes: Partial<E>) => void;

  if (!property.visibleFor(element)) return null;

  const label = property instanceof ReadoutProperty ? property.formattedLabel(element) : property.label;
  const editor = property.renderEditor({ element, update });

  return (
    <div>
      <div className={editor ? 'flex items-center mb-1' : 'flex items-center'}>
        <span className="text-xs text-gray-500">{label}</span>
        <div className="flex items-center gap-0.5 ml-auto">
          <SlideSyncButton elementId={element.id} fields={property.syncFields} />
          {property.transitionGroup && (
            <>
              <TransitionButton elementId={element.id} group={property.transitionGroup} direction="in" />
              <TransitionButton elementId={element.id} group={property.transitionGroup} direction="out" />
            </>
          )}
        </div>
        <KeyframeButtons property={property} element={element} prev={prev} next={next} update={update} />
      </div>
      {editor}
    </div>
  );
}
