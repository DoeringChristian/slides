import type { SlideElement, TransitionGroup } from '../../types/presentation';

/** Where per-easing options live on `transitions` for the given group. */
export const optionsKeyFor = (group: TransitionGroup): 'contentOptions' | 'visibilityOptions' | null => {
  if (group === 'content') return 'contentOptions';
  if (group === 'visibility') return 'visibilityOptions';
  return null;
};

/** A visibility fade-OUT: the source element is visible and the target is
 *  gone, so the source side carries the transition. */
export function isVisibilityFadeOut(
  sourceElement: SlideElement | undefined,
  targetElement: SlideElement | undefined,
  group: TransitionGroup,
): boolean {
  return group === 'visibility' && Boolean(sourceElement?.visible) && !targetElement;
}
