import { useEffect } from 'react';
import type { Slide } from '../types/presentation';
import { chainTargetAfterLanding } from '../utils/presenterAdvance';

export interface ChainOptions {
  /** This surface currently owns presenter navigation (presenting, and not
   *  delegated to another view). */
  active: boolean;
  /** A slide transition is in flight — the chain only arms after landing. */
  isAnimating: boolean;
  /** False after manual "previous" — suppresses the chain until the user
   *  goes forward again (same semantics the old per-slide auto-advance had). */
  chainEnabled: boolean;
  /** slideOrder index the presenter is currently resting on. */
  currentIndex: number;
  slideOrder: string[];
  slides: Record<string, Slide>;
  /** Indices of non-hidden slides, ascending. */
  visibleIndices: number[];
  /** Kick off the transition to the given slideOrder index. */
  startAnimation: (targetIndex: number) => void;
}

/**
 * Framework-free effect body of useAutoAdvanceChain, exported for unit tests
 * (vitest runs in a node environment without a React renderer): decides
 * whether landing on `currentIndex` chains onward, arms the hold timer, and
 * returns the cleanup that cancels it — or undefined when nothing is armed.
 */
export function armChainTimer(opts: ChainOptions): (() => void) | undefined {
  if (!opts.active || opts.isAnimating || !opts.chainEnabled) return undefined;
  const chain = chainTargetAfterLanding(
    opts.slideOrder, opts.slides, opts.visibleIndices, opts.currentIndex,
  );
  if (!chain) return undefined;
  const timer = setTimeout(() => opts.startAnimation(chain.target), chain.holdMs);
  return () => clearTimeout(timer);
}

/**
 * Timed-chain auto-advance for slide groups. Single implementation shared by
 * PresenterView (fullscreen) and PresenterControlPanel (presenter mode) —
 * replaces the per-slide auto-advance effects that used to be duplicated in
 * both. The effect fires after every landing (isAnimating flips false or the
 * index changes); manual navigation cancels the pending hold because
 * `isAnimating`/`currentIndex` change re-runs the cleanup.
 */
export function useAutoAdvanceChain(opts: ChainOptions): void {
  const {
    active, isAnimating, chainEnabled, currentIndex,
    slideOrder, slides, visibleIndices, startAnimation,
  } = opts;
  useEffect(
    () => armChainTimer({
      active, isAnimating, chainEnabled, currentIndex,
      slideOrder, slides, visibleIndices, startAnimation,
    }),
    [active, isAnimating, chainEnabled, currentIndex, slideOrder, slides, visibleIndices, startAnimation],
  );
}
