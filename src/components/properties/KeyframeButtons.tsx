import { useEditorStore } from '../../store/editorStore';
import { readKeyframeForMutation, type CurrentChange } from '../../store/currentMutation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { SlideElement } from '../../types/presentation';
import type { Property } from './Property';

interface Props<E extends SlideElement> {
  property: Property<E>;
  element: E;
  prev: E | undefined;
  next: E | undefined;
  update: (changes: CurrentChange<E>) => void;
}

/**
 * "Reset to previous / next keyframe" arrow buttons. A button only appears
 * when the matching neighbour exists AND the property's `syncFields` differ
 * between this slide and the neighbour. Clicking copies those fields from
 * the neighbour into this slide via the property's `copyFromKeyframe` —
 * handles nested paths and multi-field properties transparently.
 *
 * Pairs with SlideSyncButton + TransitionButton on every PropertyRow.
 */
export function KeyframeButtons<E extends SlideElement>({
  property, element, prev, next, update,
}: Props<E>) {
  const activeSlideId = useEditorStore(s => s.activeSlideId);
  const reset = (direction: 'previous' | 'next') => {
    const source = readKeyframeForMutation(activeSlideId, element.id, direction);
    if (source?.type === element.type) update(current => property.copyFromKeyframe(source as E, current));
  };
  const prevDiffers = prev && property.differsFromKeyframe(prev, element);
  const nextDiffers = next && property.differsFromKeyframe(next, element);
  if (!prevDiffers && !nextDiffers) return null;

  return (
    <div className="flex items-center gap-0.5">
      {prevDiffers && prev && (
        <button
          onClick={() => reset('previous')}
          className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          title="Reset to previous keyframe"
        >
          <ArrowLeft size={12} />
        </button>
      )}
      {nextDiffers && next && (
        <button
          onClick={() => reset('next')}
          className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          title="Reset to next keyframe"
        >
          <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}
