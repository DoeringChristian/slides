import React from 'react';
import { Property } from './Property';

/**
 * Property row for non-element scopes (currently the Slide panel): the
 * uniform label header + the property's editor body, WITHOUT the
 * element-only buttons (SlideSync / Transition in-out / Keyframe reset) —
 * those are keyed to element ids and per-element transitions, which a
 * slide doesn't have. The update callback is supplied by the panel (a
 * dispatch adapter over the existing dual-path slide actions).
 */
interface Props<T extends object> {
  property: Property<T>;
  element: T;
  update: (changes: Partial<T>) => void;
}

export function SlidePropertyRow<T extends object>({
  property, element, update,
}: Props<T>): React.ReactElement | null {
  if (!property.visibleFor(element)) return null;

  const editor = property.renderEditor({ element, update });

  return (
    <div>
      <div className={editor ? 'flex items-center mb-1' : 'flex items-center'}>
        <span className="text-xs text-gray-500">{property.label}</span>
      </div>
      {editor}
    </div>
  );
}
