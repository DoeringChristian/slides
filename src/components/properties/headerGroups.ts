import type { SlideElement, TransitionGroup } from '../../types/presentation';
import { useActiveSlide, usePreviousSlideElement, useNextSlideElement } from '../../store/selectors';
import { transitionPropertiesDiffer } from '../../utils/animation/transitionProperties';

/** Transition groups the panel header offers, in priority order per element
 *  type.
 *
 *  The header used to be hardwired to `visibility` (plus `content` for text
 *  and `resource` for images), so an object whose GEOMETRY changed between
 *  keyframes showed no header button at all — the easing for it was reachable
 *  only from the matching property row further down. These lists are
 *  candidates, not a fixed set: `useHeaderGroups` keeps the ones that
 *  actually differ across an adjacent keyframe, so the header shows the
 *  animation this object is really doing.
 *
 *  Order is "how much the change defines the transition": appearing or
 *  disappearing outranks changing content, which outranks changing shape.
 *  Purely numeric groups (position, size, fill, …) are deliberately absent —
 *  they are always available on their own property row, and hoisting them
 *  would put five pickers in the header on any ordinary move. */
const HEADER_GROUPS: Record<SlideElement['type'], TransitionGroup[]> = {
  text: ['visibility', 'content', 'morph', 'controlPoints'],
  shape: ['visibility', 'morph', 'controlPoints', 'startArrow', 'endArrow'],
  image: ['visibility', 'resource'],
  group: ['visibility'],
};

/** How many pickers the header shows at once. Two covers the real pairings
 *  (a line that appears AND gains a vertex; text that appears AND changes)
 *  without letting the row grow unbounded. */
const MAX_HEADER_GROUPS = 2;

/**
 * The transition groups worth showing in the header for one element: the
 * highest-priority groups that actually differ from the previous or next
 * keyframe.
 *
 * `TransitionButton` already self-hides when its own side doesn't differ, so
 * passing a group that changed on only one side is safe — exactly one of the
 * in/out pair renders.
 */
export function useHeaderGroups(elementId: string | undefined): TransitionGroup[] {
  const slide = useActiveSlide();
  const previous = usePreviousSlideElement(elementId ?? '');
  const next = useNextSlideElement(elementId ?? '');
  const element = elementId ? slide?.elements[elementId] : undefined;
  if (!element) return [];
  const changed = HEADER_GROUPS[element.type].filter((group) =>
    transitionPropertiesDiffer(previous, element, group)
    || transitionPropertiesDiffer(element, next, group));
  return changed.slice(0, MAX_HEADER_GROUPS);
}
