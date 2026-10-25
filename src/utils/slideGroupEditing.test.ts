import { describe, expect, it } from 'vitest';
import { foldedSlideIds, planSlideGroupEdit, slideGroupRunKey } from './slideGroupEditing';
import { chainTargetAfterLanding, groupRuns } from './presenterAdvance';
import { createSlide } from './slideFactory';

const order = ['a', 'b', 'c', 'd', 'e'];
const slides = Object.fromEntries(order.map(id => [id, { ...createSlide(), id, groupId: 'g', hidden: id === 'c' }]));
function plan(mode: 'split' | 'remove', id: string, ids = order) {
  let n = 0;
  return planSlideGroupEdit(ids, () => 'g', id, mode, () => `new-${++n}`);
}
describe('slideGroupEditing contiguous membership plans', () => {
  it.each([
    ['a', [undefined, 'new-1', 'new-1', 'new-1', 'new-1']],
    ['c', ['new-1', 'new-1', undefined, 'new-2', 'new-2']],
    ['e', ['new-1', 'new-1', 'new-1', 'new-1', undefined]],
  ])('remove %s keeps the slide and normalizes surviving chains', (id, expected) => {
    expect(order.map(sid => plan('remove', id as string).get(sid))).toEqual(expected);
  });
  it('two members become ungrouped on either removal', () => {
    for (const id of ['a', 'b']) expect([...plan('remove', id, ['a', 'b']).values()]).toEqual([undefined, undefined]);
  });
  it('split boundaries: before first is no-op, before second/last normalizes singleton', () => {
    expect(plan('split', 'a').size).toBe(0);
    expect([...plan('split', 'b').values()]).toEqual([undefined, 'new-1', 'new-1', 'new-1', 'new-1']);
    expect([...plan('split', 'e').values()]).toEqual(['new-1', 'new-1', 'new-1', 'new-1', undefined]);
    expect([...plan('split', 'c').values()]).toEqual(['new-1', 'new-1', 'new-2', 'new-2', 'new-2']);
    expect([...plan('split', 'b', ['a', 'b']).values()]).toEqual([undefined, undefined]);
  });
  it('reused ids cannot edit a disjoint run; ungrouped/missing/legacy is inert', () => {
    const ids = ['a', 'b', 'gap', 'c', 'd'];
    const changes = planSlideGroupEdit(ids, id => id === 'gap' ? undefined : 'g', 'a', 'remove', () => 'fresh');
    expect([...changes.keys()]).toEqual(['a', 'b']);
    expect(planSlideGroupEdit(ids, () => undefined, 'a', 'remove', () => 'fresh').size).toBe(0);
    expect(plan('split', 'missing').size).toBe(0);
  });
  it('hidden member participates in editing and split stops playback between chains', () => {
    const updated = structuredClone(slides);
    for (const [id, groupId] of plan('split', 'c')) updated[id].groupId = groupId!;
    expect(groupRuns(order, updated).map(r => r.slideIds)).toEqual([['a', 'b'], ['c', 'd', 'e']]);
    expect(chainTargetAfterLanding(order, updated, [0, 1, 3, 4], 1)).toBeNull();
    expect(chainTargetAfterLanding(order, updated, [0, 1, 3, 4], 3)?.target).toBe(4);
  });
  it('folding is local; always reveals the active slide, including hidden members, without changing playback', () => {
    const before = JSON.stringify(slides), runs = groupRuns(order, slides);
    const collapsed = new Set([slideGroupRunKey(runs[0])]);
    expect([...foldedSlideIds(runs, collapsed, 'c')]).toEqual(['a', 'b', 'd', 'e']);
    expect([...foldedSlideIds(runs, collapsed, 'd')]).toEqual(['a', 'b', 'c', 'e']);
    expect(foldedSlideIds(runs, new Set(), 'a').size).toBe(0);
    expect(foldedSlideIds([{ ...runs[0], slideIds: ['x', 'y'] }], collapsed, 'a').size).toBe(0);
    expect(JSON.stringify(slides)).toBe(before);
    expect(chainTargetAfterLanding(order, slides, [0, 1, 3, 4], 1)?.target).toBe(3);
  });
});
