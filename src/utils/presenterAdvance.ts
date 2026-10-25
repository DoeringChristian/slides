/**
 * Slide-group (timed chain) helpers — pure and DOM-free.
 *
 * Groups are stored as `Slide.groupId`; only maximal CONTIGUOUS runs of equal
 * groupId with length ≥ 2 count as a group (a lone groupId — e.g. left behind
 * after its partner slide was deleted — is inert). During playback, landing
 * on a grouped slide arms a hold timer (`autoAdvanceDelay` seconds) and then
 * auto-starts the transition to the next visible slide of the same run.
 *
 * Everything here is consumed by the presenter (both PresenterView and
 * PresenterControlPanel via useAutoAdvanceChain), the store's reorder
 * post-pass, and the slide-panel UI — one implementation, no forks.
 */
import type { Slide } from '../types/presentation';

export interface GroupRun {
  groupId: string;
  /** Slide ids of the run, in slideOrder order. */
  slideIds: string[];
  /** Index of the run's first slide in slideOrder. */
  start: number;
}

/** Compute maximal contiguous groupId runs (length ≥ 2). */
export function groupRuns(slideOrder: string[], slides: Record<string, Slide>): GroupRun[] {
  const runs: GroupRun[] = [];
  let i = 0;
  while (i < slideOrder.length) {
    const gid = slides[slideOrder[i]]?.groupId;
    if (!gid) { i++; continue; }
    let j = i + 1;
    while (j < slideOrder.length && slides[slideOrder[j]]?.groupId === gid) j++;
    if (j - i >= 2) runs.push({ groupId: gid, slideIds: slideOrder.slice(i, j), start: i });
    i = j;
  }
  return runs;
}

/** The run containing slideOrder index `index`, if any. */
export function findRunAt(runs: GroupRun[], index: number): GroupRun | undefined {
  return runs.find((r) => index >= r.start && index < r.start + r.slideIds.length);
}

export interface ChainTarget {
  /** slideOrder index to auto-advance to. */
  target: number;
  /** Hold before starting the transition, in milliseconds. */
  holdMs: number;
}

/**
 * After the presenter lands on `currentIndex` (animation complete): if the
 * next VISIBLE slide belongs to the same group run, return it as the chain
 * target with the landing slide's hold (`autoAdvanceDelay ?? 0` seconds).
 * Hidden slides inside the run are skipped like everywhere else in the
 * presenter; if skipping leaves the run (next visible slide is past the run's
 * end), the chain stops. Returns null when there is nothing to chain to.
 */
export function chainTargetAfterLanding(
  slideOrder: string[],
  slides: Record<string, Slide>,
  visibleIndices: number[],
  currentIndex: number,
): ChainTarget | null {
  const run = findRunAt(groupRuns(slideOrder, slides), currentIndex);
  if (!run) return null;
  const pos = visibleIndices.indexOf(currentIndex);
  if (pos === -1 || pos >= visibleIndices.length - 1) return null;
  const next = visibleIndices[pos + 1];
  const runEnd = run.start + run.slideIds.length - 1;
  if (next > runEnd) return null;
  const holdMs = (slides[slideOrder[currentIndex]]?.autoAdvanceDelay ?? 0) * 1000;
  return { target: next, holdMs };
}

/**
 * Target of a MANUAL "next" while at `currentIndex`. Mid-group, next jumps
 * to the group's LAST slide (skipping the rest of the chain) — per the
 * settled UX decision; if the run's last slide is hidden, the last visible
 * run member after the current slide is used instead. At the group end, or
 * outside any group, this is the ordinary next visible slide. Returns
 * undefined at the end of the deck.
 */
export function manualNextTarget(
  slideOrder: string[],
  slides: Record<string, Slide>,
  visibleIndices: number[],
  currentIndex: number,
): number | undefined {
  const pos = visibleIndices.indexOf(currentIndex);
  const normalNext = pos === -1
    ? visibleIndices.find((i) => i > currentIndex)
    : visibleIndices[pos + 1];
  const run = findRunAt(groupRuns(slideOrder, slides), currentIndex);
  if (run) {
    const runEnd = run.start + run.slideIds.length - 1;
    if (currentIndex < runEnd) {
      for (let k = visibleIndices.length - 1; k >= 0; k--) {
        const i = visibleIndices[k];
        if (i <= runEnd && i > currentIndex) return i;
      }
      // No visible run member after the current slide — fall through.
    }
  }
  return normalNext;
}

/** Stable per-group accent color for the slide-panel visuals: hue hashed
 *  from the groupId so a group keeps its color across reorders, sessions
 *  and peers. */
export function groupColorFor(groupId: string): string {
  let h = 0;
  for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360}, 70%, 50%)`;
}

/**
 * True when `slideIds` (order-independent, no duplicates) occupy a
 * contiguous span of `slideOrder` and there are at least two of them —
 * the precondition for groupSlides.
 */
export function areSlidesContiguous(slideOrder: string[], slideIds: string[]): boolean {
  if (slideIds.length < 2) return false;
  const indices = slideIds.map((id) => slideOrder.indexOf(id));
  if (indices.some((i) => i === -1)) return false;
  if (new Set(indices).size !== indices.length) return false;
  const min = Math.min(...indices);
  const max = Math.max(...indices);
  return max - min + 1 === indices.length;
}

/**
 * Groups whose members are no longer contiguous under `slideOrder` —
 * reorderSlides strips these (dissolve on split) in its post-pass.
 * `groupIdOf` abstracts over plain slides vs Y.Map slides so both store
 * paths share this exact decision.
 */
export function groupsToDissolve(
  slideOrder: string[],
  groupIdOf: (slideId: string) => string | undefined,
): Set<string> {
  const positions = new Map<string, number[]>();
  slideOrder.forEach((id, i) => {
    const gid = groupIdOf(id);
    if (!gid) return;
    const arr = positions.get(gid);
    if (arr) arr.push(i);
    else positions.set(gid, [i]);
  });
  const dissolve = new Set<string>();
  for (const [gid, pos] of positions) {
    // `pos` is ascending by construction.
    if (pos[pos.length - 1] - pos[0] + 1 !== pos.length) dissolve.add(gid);
  }
  return dissolve;
}
