/**
 * Tests for the timed-chain hook's effect body (`armChainTimer`). The vitest
 * environment is plain node (no React renderer / DOM), so the React wrapper
 * `useAutoAdvanceChain` — a one-line useEffect over armChainTimer — is
 * covered manually (present, group two slides, watch the chain play), while
 * ALL of its decision + timer logic is exercised here with fake timers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { armChainTimer } from './useAutoAdvanceChain';
import type { ChainOptions } from './useAutoAdvanceChain';
import type { Slide } from '../types/presentation';

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

/** Two-slide group (2 s hold on the first) followed by a loose slide. */
function baseOptions(overrides?: Partial<ChainOptions>): ChainOptions {
  const slides: Record<string, Slide> = {
    a: slide('a', { groupId: 'g', autoAdvanceDelay: 2 }),
    b: slide('b', { groupId: 'g' }),
    c: slide('c'),
  };
  return {
    active: true,
    isAnimating: false,
    chainEnabled: true,
    currentIndex: 0,
    slideOrder: ['a', 'b', 'c'],
    slides,
    visibleIndices: [0, 1, 2],
    startAnimation: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('armChainTimer', () => {
  test('fires startAnimation with the chain target after the hold elapses', () => {
    const opts = baseOptions();
    const cleanup = armChainTimer(opts);
    expect(cleanup).toBeTypeOf('function');
    expect(opts.startAnimation).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1999);
    expect(opts.startAnimation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(opts.startAnimation).toHaveBeenCalledExactlyOnceWith(1);
  });

  test('a zero hold still defers to the timer (next tick), like the old behavior', () => {
    const opts = baseOptions({ currentIndex: 1 }); // b → chains to... b is last? no: b is run end
    // b IS the run's last slide — nothing armed.
    expect(armChainTimer(opts)).toBeUndefined();

    // A no-delay first slide arms a 0 ms timer.
    const opts2 = baseOptions();
    delete opts2.slides['a'].autoAdvanceDelay;
    armChainTimer(opts2);
    expect(opts2.startAnimation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(opts2.startAnimation).toHaveBeenCalledExactlyOnceWith(1);
  });

  test('the cleanup cancels the pending hold (manual navigation / unmount)', () => {
    const opts = baseOptions();
    const cleanup = armChainTimer(opts)!;
    cleanup();
    vi.advanceTimersByTime(10_000);
    expect(opts.startAnimation).not.toHaveBeenCalled();
  });

  test.each([
    ['inactive surface', { active: false }],
    ['animation in flight', { isAnimating: true }],
    ['chain suppressed after manual prev', { chainEnabled: false }],
    ['ungrouped current slide', { currentIndex: 2 }],
  ] as const)('arms nothing when %s', (_name, override) => {
    const opts = baseOptions(override as Partial<ChainOptions>);
    expect(armChainTimer(opts)).toBeUndefined();
    vi.advanceTimersByTime(10_000);
    expect(opts.startAnimation).not.toHaveBeenCalled();
  });
});
