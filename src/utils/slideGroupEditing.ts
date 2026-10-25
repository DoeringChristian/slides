import type { GroupRun } from './presenterAdvance';

/** Membership edits affect only the chosen contiguous real run, never another
 * run that happens to reuse its id. Each surviving chain gets its own id. */
export function planSlideGroupEdit(
  order: string[],
  groupIdOf: (id: string) => string | undefined,
  slideId: string,
  mode: 'split' | 'remove',
  newId: () => string,
): Map<string, string | undefined> {
  const changes = new Map<string, string | undefined>();
  const index = order.indexOf(slideId);
  const groupId = groupIdOf(slideId);
  if (index < 0 || !groupId) return changes;
  let start = index, end = index + 1;
  while (start > 0 && groupIdOf(order[start - 1]) === groupId) start--;
  while (end < order.length && groupIdOf(order[end]) === groupId) end++;
  if (mode === 'split' && (index === start || end - start < 2)) return changes;
  const assign = (ids: string[]) => {
    const id = ids.length >= 2 ? newId() : undefined;
    ids.forEach(sid => changes.set(sid, id));
  };
  assign(order.slice(start, index));
  if (mode === 'remove') changes.set(slideId, undefined);
  assign(order.slice(index + (mode === 'remove' ? 1 : 0), end));
  return changes;
}

/** Membership, not groupId: disjoint runs and later regrouping never inherit
 * another run's local folding state. No persisted presentation fields. */
export function slideGroupRunKey(run: GroupRun): string {
  return JSON.stringify([run.groupId, ...run.slideIds]);
}

/** Keep the active thumbnail visible even when its run is folded. */
export function foldedSlideIds(runs: GroupRun[], collapsed: ReadonlySet<string>, activeSlideId: string): Set<string> {
  return new Set(runs.flatMap(run => collapsed.has(slideGroupRunKey(run))
    ? run.slideIds.filter(id => id !== activeSlideId) : []));
}
