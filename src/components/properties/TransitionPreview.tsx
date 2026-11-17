import React, { useEffect, useMemo, useState } from 'react';
import type {
  EasingType,
  PropertyTransitions,
  Slide,
  SlideElement,
  TransitionGroup,
  TransitionOptions,
} from '../../types/presentation';
import { selectionResizeBounds } from '../../utils/geometry/resizeGeometry';
import { usePresentationStore } from '../../store/presentationStore';
import { isVisibilityFadeOut, optionsKeyFor } from './transitionSide';
import { composeSlideFrame, renderPresenterElement } from '../presenter/presenterUtils';

// ---------------------------------------------------------------------------
// Shared animation clock for every preview card in every open picker. With
// per-card RAF loops each card snapshots its own `performance.now()` at mount
// and drifts out of phase from siblings; one global RAF feeding one `t` value
// to all subscribers keeps every card on the same frame.
// ---------------------------------------------------------------------------
const ANIM_MS = 1200;
const PAUSE_MS = 400;
const CYCLE_MS = ANIM_MS + PAUSE_MS;

const subscribers = new Set<(t: number) => void>();
let sharedRaf = 0;

function tickAll(): void {
  // Use the page-relative clock so all cards across all open pickers share
  // a single phase even if they mount at different times.
  const phase = performance.now() % CYCLE_MS;
  const t = phase < ANIM_MS ? phase / ANIM_MS : 1;
  for (const fn of subscribers) fn(t);
  sharedRaf = requestAnimationFrame(tickAll);
}

function subscribeTick(fn: (t: number) => void): () => void {
  subscribers.add(fn);
  if (subscribers.size === 1) {
    sharedRaf = requestAnimationFrame(tickAll);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) {
      cancelAnimationFrame(sharedRaf);
      sharedRaf = 0;
    }
  };
}

function useSharedAnimationTick(active: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- rewind the preview to t=0 when it deactivates; intentional reset of shared-tick state
      setT(0);
      return;
    }
    return subscribeTick(setT);
  }, [active]);
  return t;
}

interface Props {
  sourceElement?: SlideElement;
  targetElement?: SlideElement;
  sourceElements?: SlideElement[];
  targetElements?: SlideElement[];
  /** Property group whose easing this preview is showing (e.g. 'visibility',
   *  'content', 'position', …). */
  group: TransitionGroup;
  easing: EasingType;
  options?: TransitionOptions;
  /** Preview tile size in pixels. */
  width: number;
  height: number;
  /** Pause the RAF when the card isn't visible (perf). */
  active?: boolean;
  /** Drawn as they are (no easing override): what the previewed elements
   *  need to be seen — a crop shape's image and fellow crop shapes. */
  sourceContext?: SlideElement[];
  targetContext?: SlideElement[];
}

/**
 * Mini preview that loops the slide transition for one easing choice. Uses
 * composeSlideFrame + renderPresenterElement (the exact production renderer)
 * so the preview can never disagree with what shipping decks will play.
 *
 * All cards share a single RAF source (`useSharedAnimationTick`) so they tick
 * in phase — picking "ease" vs "write" you see the same t across the grid.
 */
const NO_CONTEXT: SlideElement[] = [];

export const TransitionPreview: React.FC<Props> = ({
  sourceElement, targetElement, sourceElements, targetElements, group, easing, options, width, height, active = true,
  sourceContext = NO_CONTEXT, targetContext = NO_CONTEXT,
}) => {
  const resources = usePresentationStore((s) => s.presentation.resources);
  const t = useSharedAnimationTick(active);

  const { slideA, slideB, bbox } = useMemo(() => {
    const sources = sourceElements ?? (sourceElement ? [sourceElement] : []);
    const targets = targetElements ?? (targetElement ? [targetElement] : []);
    const sourceMap = new Map(sources.map(el => [el.id, el]));
    const targetMap = new Map(targets.map(el => [el.id, el]));
    const withEasing = (el: SlideElement): SlideElement => {
      const transitions: PropertyTransitions = { ...el.transitions, [group]: easing };
      const optionsKey = optionsKeyFor(group);
      if (optionsKey && options) transitions[optionsKey] = options;
      return { ...el, transitions };
    };
    const a = sources.map(el => isVisibilityFadeOut(el, targetMap.get(el.id), group) ? withEasing(el) : el);
    const b = targets.map(el => isVisibilityFadeOut(sourceMap.get(el.id), el, group) ? el : withEasing(el));
    // Include every member on both sides and account for rotated bounds.
    const all = [...sources, ...targets, ...sourceContext, ...targetContext];
    const bounds = all.length ? selectionResizeBounds(all) : {x:0,y:0,width:100,height:50};
    const padX = Math.max(20, bounds.width * .2), padY = Math.max(20, bounds.height * .2);
    return {
      slideA: makePreviewSlide('preview-A', [...sourceContext, ...a]), slideB: makePreviewSlide('preview-B', [...targetContext, ...b]),
      bbox: { x: bounds.x-padX, y: bounds.y-padY, width: bounds.width+2*padX, height: bounds.height+2*padY },
    };
  }, [sourceElement, targetElement, sourceElements, targetElements, group, easing, options, sourceContext, targetContext]);

  const { renderedElements } = composeSlideFrame({
    slideA,
    slideB,
    isForward: true,
    animProgress: t,
    isAnimating: true,
  });

  return (
    <svg
      data-preview-elements={renderedElements.length}
      width={width}
      height={height}
      viewBox={`${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', background: '#ffffff' }}
    >
      {renderedElements.map((el) => renderPresenterElement(el, resources))}
    </svg>
  );
};

function makePreviewSlide(id: string, elements: SlideElement[]): Slide {
  return {
    id,
    elements: Object.fromEntries(elements.map(el => [el.id, el])),
    elementOrder: elements.map(el => el.id),
    background: { type: 'solid', color: '#ffffff' },
    transition: { duration: ANIM_MS },
    notes: '',
  };
}
