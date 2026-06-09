import React, { useEffect, useMemo, useState } from 'react';
import type {
  EasingType,
  PropertyTransitions,
  Slide,
  SlideElement,
  TransitionGroup,
  TransitionOptions,
} from '../../types/presentation';
import { usePresentationStore } from '../../store/presentationStore';
import { composeSlideFrame, renderPresenterElement } from '../presenter/presenterUtils';

interface Props {
  sourceElement: SlideElement | undefined;
  targetElement: SlideElement | undefined;
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
}

const ANIM_MS = 1200;
const PAUSE_MS = 400;
const CYCLE_MS = ANIM_MS + PAUSE_MS;

/**
 * Mini preview that loops the slide transition for one easing choice. Uses
 * composeSlideFrame + renderPresenterElement (the exact production renderer)
 * so the preview can never disagree with what shipping decks will play.
 */
export const TransitionPreview: React.FC<Props> = ({
  sourceElement, targetElement, group, easing, options, width, height, active = true,
}) => {
  const resources = usePresentationStore((s) => s.presentation.resources);
  const [t, setT] = useState(0);

  // Decide which side carries the transition. For a visibility fade-OUT the
  // source element holds the easing (the target is gone); everywhere else it's
  // the target.
  const isFadeOut = group === 'visibility' && Boolean(sourceElement?.visible) && !targetElement;
  const optionsKey: 'visibilityOptions' | 'contentOptions' | null =
    group === 'visibility' ? 'visibilityOptions' :
    group === 'content' ? 'contentOptions' :
    null;

  const withEasing = (el: SlideElement | undefined): SlideElement | undefined => {
    if (!el) return el;
    const transitions: PropertyTransitions = {
      ...(el.transitions || {}),
      [group]: easing,
    };
    if (optionsKey && options) {
      transitions[optionsKey] = options;
    }
    return { ...el, transitions };
  };

  const syntheticSource = useMemo(
    () => (isFadeOut ? withEasing(sourceElement) : sourceElement),
    [sourceElement, isFadeOut, easing, options, group],
  );
  const syntheticTarget = useMemo(
    () => (isFadeOut ? targetElement : withEasing(targetElement)),
    [targetElement, isFadeOut, easing, options, group],
  );

  useEffect(() => {
    if (!active) {
      setT(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const elapsed = (performance.now() - start) % CYCLE_MS;
      const tNew = elapsed < ANIM_MS ? elapsed / ANIM_MS : 1;
      setT(tNew);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, easing, options, sourceElement?.id, targetElement?.id]);

  // viewBox = union of source + target bboxes (+ 20% padding).
  const bbox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (el: SlideElement | undefined) => {
      if (!el) return;
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    };
    include(syntheticSource);
    include(syntheticTarget);
    if (!isFinite(minX)) return { x: 0, y: 0, width: 100, height: 50 };
    const padX = Math.max(20, (maxX - minX) * 0.2);
    const padY = Math.max(20, (maxY - minY) * 0.2);
    return {
      x: minX - padX,
      y: minY - padY,
      width: maxX - minX + 2 * padX,
      height: maxY - minY + 2 * padY,
    };
  }, [syntheticSource, syntheticTarget]);

  const slideA = useMemo<Slide>(() => makePreviewSlide('preview-A', syntheticSource), [syntheticSource]);
  const slideB = useMemo<Slide>(() => makePreviewSlide('preview-B', syntheticTarget), [syntheticTarget]);

  const { renderedElements } = composeSlideFrame({
    slideA,
    slideB,
    isForward: true,
    animProgress: t,
    isAnimating: true,
  });

  return (
    <svg
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

function makePreviewSlide(id: string, el: SlideElement | undefined): Slide {
  return {
    id,
    elements: el ? { [el.id]: el } : {},
    elementOrder: el ? [el.id] : [],
    background: { type: 'solid', color: '#ffffff' },
    transition: { duration: ANIM_MS },
    notes: '',
  };
}
