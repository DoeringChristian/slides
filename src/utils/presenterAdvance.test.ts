import { describe, expect, test } from 'vitest';
import {
  groupRuns,
  findRunAt,
  chainTargetAfterLanding,
  manualNextTarget,
  areSlidesContiguous,
  groupsToDissolve,
} from './presenterAdvance';
import type { Slide } from '../types/presentation';

// =============================================================================
// Fixtures
// =============================================================================

function slide(id: string, overrides?: Partial<Slide>): Slide {
  return {
    id,
    elements: {},
    elementOrder: [],
    background: { type: 'solid', color: '#ffffff' },
    transition: { duration: 300 },
    notes: '',
    ...overrides,
  };
}

/** Build (slideOrder, slides) from an override spec, in insertion order. */
function deck(specs: Array<Partial<Slide> & { id: string }>): {
  order: string[];
  slides: Record<string, Slide>;
} {
  const slides: Record<string, Slide> = {};
  for (const spec of specs) slides[spec.id] = slide(spec.id, spec);
  return { order: specs.map((s) => s.id), slides };
}

const visibleOf = (order: string[], slides: Record<string, Slide>) =>
  order.map((id, i) => ({ id, i })).filter(({ id }) => !slides[id].hidden).map(({ i }) => i);

// =============================================================================
// groupRuns
// =============================================================================

describe('groupRuns', () => {
  test('collects only maximal contiguous runs of length ≥ 2', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g1' },
      { id: 'b', groupId: 'g1' },
      { id: 'c' },
      { id: 'd', groupId: 'g2' }, // lone groupId — inert
      { id: 'e', groupId: 'g3' },
      { id: 'f', groupId: 'g3' },
      { id: 'g', groupId: 'g3' },
    ]);
    expect(groupRuns(order, slides)).toEqual([
      { groupId: 'g1', slideIds: ['a', 'b'], start: 0 },
      { groupId: 'g3', slideIds: ['e', 'f', 'g'], start: 4 },
    ]);
  });

  test('a split group yields two independent runs (each still ≥ 2) or none', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g' },
      { id: 'b', groupId: 'g' },
      { id: 'c' },
      { id: 'd', groupId: 'g' },
    ]);
    // d alone is not a run; a+b still are.
    expect(groupRuns(order, slides)).toEqual([
      { groupId: 'g', slideIds: ['a', 'b'], start: 0 },
    ]);
  });

  test('findRunAt maps an index to its containing run', () => {
    const { order, slides } = deck([
      { id: 'a' },
      { id: 'b', groupId: 'g' },
      { id: 'c', groupId: 'g' },
      { id: 'd' },
    ]);
    const runs = groupRuns(order, slides);
    expect(findRunAt(runs, 0)).toBeUndefined();
    expect(findRunAt(runs, 1)?.groupId).toBe('g');
    expect(findRunAt(runs, 2)?.groupId).toBe('g');
    expect(findRunAt(runs, 3)).toBeUndefined();
  });
});

// =============================================================================
// chainTargetAfterLanding
// =============================================================================

describe('chainTargetAfterLanding', () => {
  const grouped = () => deck([
    { id: 'a', groupId: 'g', autoAdvanceDelay: 2 },
    { id: 'b', groupId: 'g' }, // no delay → hold 0
    { id: 'c', groupId: 'g', autoAdvanceDelay: 0.5 },
    { id: 'd' },
  ]);

  test('within a group, chains to the next visible slide with the landing slide’s hold', () => {
    const { order, slides } = grouped();
    const visible = visibleOf(order, slides);
    expect(chainTargetAfterLanding(order, slides, visible, 0)).toEqual({ target: 1, holdMs: 2000 });
    expect(chainTargetAfterLanding(order, slides, visible, 1)).toEqual({ target: 2, holdMs: 0 });
  });

  test('at the group’s last slide the chain stops', () => {
    const { order, slides } = grouped();
    expect(chainTargetAfterLanding(order, slides, visibleOf(order, slides), 2)).toBeNull();
  });

  test('outside any group there is no chain', () => {
    const { order, slides } = grouped();
    expect(chainTargetAfterLanding(order, slides, visibleOf(order, slides), 3)).toBeNull();
  });

  test('hidden slides inside the run are skipped by the chain', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g', autoAdvanceDelay: 1 },
      { id: 'b', groupId: 'g', hidden: true },
      { id: 'c', groupId: 'g' },
    ]);
    expect(chainTargetAfterLanding(order, slides, visibleOf(order, slides), 0))
      .toEqual({ target: 2, holdMs: 1000 });
  });

  test('when hiding leaves the run (next visible slide is past its end), the chain stops', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g' },
      { id: 'b', groupId: 'g', hidden: true },
      { id: 'c' },
    ]);
    expect(chainTargetAfterLanding(order, slides, visibleOf(order, slides), 0)).toBeNull();
  });

  test('boundaries: last slide of the deck and a hidden current slide chain nowhere', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g' },
      { id: 'b', groupId: 'g' },
    ]);
    const visible = visibleOf(order, slides);
    expect(chainTargetAfterLanding(order, slides, visible, 1)).toBeNull();
    // Current index not in visibleIndices (hidden slide reached via direct jump).
    expect(chainTargetAfterLanding(order, slides, [1], 0)).toBeNull();
  });
});

// =============================================================================
// manualNextTarget
// =============================================================================

describe('manualNextTarget', () => {
  const grouped = () => deck([
    { id: 'a' },
    { id: 'b', groupId: 'g' },
    { id: 'c', groupId: 'g' },
    { id: 'd', groupId: 'g' },
    { id: 'e' },
  ]);

  test('mid-group, next jumps to the group’s LAST slide', () => {
    const { order, slides } = grouped();
    const visible = visibleOf(order, slides);
    expect(manualNextTarget(order, slides, visible, 1)).toBe(3);
    expect(manualNextTarget(order, slides, visible, 2)).toBe(3);
  });

  test('at the group’s end, next leaves the group normally', () => {
    const { order, slides } = grouped();
    expect(manualNextTarget(order, slides, visibleOf(order, slides), 3)).toBe(4);
  });

  test('outside a group it is the ordinary next visible slide', () => {
    const { order, slides } = grouped();
    expect(manualNextTarget(order, slides, visibleOf(order, slides), 0)).toBe(1);
  });

  test('a hidden group-end falls back to the last VISIBLE run member', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g' },
      { id: 'b', groupId: 'g' },
      { id: 'c', groupId: 'g', hidden: true },
      { id: 'd' },
    ]);
    expect(manualNextTarget(order, slides, visibleOf(order, slides), 0)).toBe(1);
  });

  test('when no visible run member follows, next falls through to the slide after the group', () => {
    const { order, slides } = deck([
      { id: 'a', groupId: 'g' },
      { id: 'b', groupId: 'g', hidden: true },
      { id: 'c' },
    ]);
    expect(manualNextTarget(order, slides, visibleOf(order, slides), 0)).toBe(2);
  });

  test('end of deck returns undefined', () => {
    const { order, slides } = grouped();
    expect(manualNextTarget(order, slides, visibleOf(order, slides), 4)).toBeUndefined();
  });

  test('a hidden current index advances to the next visible slide', () => {
    const { order, slides } = deck([
      { id: 'a' },
      { id: 'b', hidden: true },
      { id: 'c' },
    ]);
    expect(manualNextTarget(order, slides, visibleOf(order, slides), 1)).toBe(2);
  });
});

// =============================================================================
// areSlidesContiguous / groupsToDissolve
// =============================================================================

describe('areSlidesContiguous', () => {
  const order = ['a', 'b', 'c', 'd'];

  test('contiguous spans of ≥ 2 pass, order-independent', () => {
    expect(areSlidesContiguous(order, ['a', 'b'])).toBe(true);
    expect(areSlidesContiguous(order, ['c', 'b', 'd'])).toBe(true);
  });

  test('rejects singletons, gaps, duplicates and unknown ids', () => {
    expect(areSlidesContiguous(order, ['a'])).toBe(false);
    expect(areSlidesContiguous(order, ['a', 'c'])).toBe(false);
    expect(areSlidesContiguous(order, ['a', 'a'])).toBe(false);
    expect(areSlidesContiguous(order, ['a', 'nope'])).toBe(false);
  });
});

describe('groupsToDissolve', () => {
  test('flags exactly the groups whose members are no longer contiguous', () => {
    const gids: Record<string, string | undefined> = {
      a: 'g1', b: 'g1',        // stays contiguous
      c: 'g2', e: 'g2',        // split by d
      d: undefined,
    };
    const dissolve = groupsToDissolve(['a', 'b', 'c', 'd', 'e'], (id) => gids[id]);
    expect(dissolve).toEqual(new Set(['g2']));
  });
});
