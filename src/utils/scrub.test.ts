import { describe, it, expect } from 'vitest';
import {
  applyScrubDelta,
  clampValue,
  commitValue,
  formatValue,
  parseInput,
  type ScrubSpec,
} from './scrub';

/** Fold a sequence of pointer-move deltas through the incremental model,
 *  the way ScrubInput does per move. */
function runSequence(
  start: number,
  moves: Array<{ dx: number; fine?: boolean }>,
  spec: ScrubSpec,
): number {
  let v = start;
  for (const m of moves) v = applyScrubDelta(v, m.dx, spec, m.fine ?? false);
  return v;
}

describe('applyScrubDelta — accumulation', () => {
  it('accumulates per-event deltas at step 1', () => {
    expect(runSequence(10, [{ dx: 3 }, { dx: 2 }, { dx: 5 }], {})).toBe(20);
  });

  it('scales by step', () => {
    expect(runSequence(10, [{ dx: 3 }, { dx: 2 }, { dx: 5 }], { step: 2 })).toBe(30);
    expect(runSequence(1, [{ dx: 4 }, { dx: 1 }], { step: 0.1 })).toBeCloseTo(1.5, 10);
  });

  it('handles direction reversal within a drag', () => {
    expect(runSequence(10, [{ dx: 5 }, { dx: -8 }], {})).toBe(7);
  });
});

describe('applyScrubDelta — clamping', () => {
  it('clamps at max per move; overshoot is not banked', () => {
    const spec: ScrubSpec = { max: 20 };
    // 18 → clamp(23)=20 → clamp(25)=20 → moving back applies immediately.
    expect(runSequence(18, [{ dx: 5 }, { dx: 5 }, { dx: -3 }], spec)).toBe(17);
  });

  it('clamps at min per move', () => {
    const spec: ScrubSpec = { min: 0 };
    expect(runSequence(2, [{ dx: -10 }, { dx: -10 }, { dx: 4 }], spec)).toBe(4);
  });
});

describe('applyScrubDelta — fine factor toggling mid-sequence', () => {
  it('Shift pressed halfway: coarse pixels count coarse, fine pixels fine', () => {
    // 10 coarse px + 10 fine px at step 1, default fineFactor 0.1 → +10 + 1.
    const moves = [
      { dx: 4 }, { dx: 3 }, { dx: 3 },
      { dx: 5, fine: true }, { dx: 5, fine: true },
    ];
    expect(runSequence(100, moves, { step: 1 })).toBeCloseTo(111, 10);
  });

  it('Shift released mid-drag returns to coarse', () => {
    const moves = [{ dx: 10, fine: true }, { dx: 10 }];
    expect(runSequence(0, moves, { step: 1, fineFactor: 0.5 })).toBeCloseTo(15, 10);
  });
});

describe('precision rounds at commit only', () => {
  it('a 5px fine drag at step 1 moves 0.5, not 0', () => {
    const spec: ScrubSpec = { step: 1, precision: 0 };
    const draft = runSequence(
      10,
      [{ dx: 1, fine: true }, { dx: 1, fine: true }, { dx: 1, fine: true }, { dx: 1, fine: true }, { dx: 1, fine: true }],
      spec,
    );
    // Per-move rounding would have flushed every 0.1 increment to zero.
    expect(draft).toBeCloseTo(10.5, 10);
    expect(commitValue(draft, spec)).toBe(11);
  });

  it('sub-half accumulation rounds down at commit', () => {
    const spec: ScrubSpec = { step: 1, precision: 0 };
    const draft = runSequence(10, [{ dx: 2, fine: true }, { dx: 2, fine: true }], spec);
    expect(draft).toBeCloseTo(10.4, 10);
    expect(commitValue(draft, spec)).toBe(10);
  });
});

describe('commitValue', () => {
  it('rounds to the given number of decimals', () => {
    expect(commitValue(10.44, { precision: 1 })).toBeCloseTo(10.4, 10);
    expect(commitValue(10.45, { precision: 0 })).toBe(10);
    expect(commitValue(10.5, { precision: 0 })).toBe(11);
  });

  it('does not round when precision is undefined', () => {
    expect(commitValue(10.4444, {})).toBe(10.4444);
  });

  it('clamps before rounding', () => {
    expect(commitValue(25.7, { max: 20, precision: 0 })).toBe(20);
    expect(commitValue(-3.2, { min: 0, precision: 0 })).toBe(0);
  });
});

describe('clampValue', () => {
  it('applies min and max independently and passes through otherwise', () => {
    expect(clampValue(5, { min: 0, max: 10 })).toBe(5);
    expect(clampValue(-1, { min: 0 })).toBe(0);
    expect(clampValue(11, { max: 10 })).toBe(10);
    expect(clampValue(-99, {})).toBe(-99);
  });
});

describe('parseInput', () => {
  it('parses plain and signed decimals', () => {
    expect(parseInput('42', {})).toBe(42);
    expect(parseInput(' 3.5 ', {})).toBe(3.5);
    expect(parseInput('-12', {})).toBe(-12);
  });

  it("tolerates ',' as decimal separator", () => {
    expect(parseInput('3,5', {})).toBe(3.5);
    expect(parseInput('-0,25', {})).toBe(-0.25);
  });

  it('returns null for garbage (caller reverts)', () => {
    expect(parseInput('', {})).toBeNull();
    expect(parseInput('   ', {})).toBeNull();
    expect(parseInput('abc', {})).toBeNull();
    expect(parseInput('1.2.3', {})).toBeNull();
    expect(parseInput('12px', {})).toBeNull();
    expect(parseInput('1,2,3', {})).toBeNull();
  });

  it('clamps parsed values to the spec range', () => {
    expect(parseInput('500', { max: 100 })).toBe(100);
    expect(parseInput('-500', { min: 0 })).toBe(0);
  });
});

describe('formatValue', () => {
  it('uses fixed decimals when precision is set', () => {
    expect(formatValue(12.6, { precision: 0 })).toBe('13');
    expect(formatValue(12.6, { precision: 2 })).toBe('12.60');
  });

  it('trims float noise without precision', () => {
    expect(formatValue(0.1 + 0.2, {})).toBe('0.3');
    expect(formatValue(45, {})).toBe('45');
  });

  it('appends the unit verbatim', () => {
    expect(formatValue(45, { precision: 0 }, '°')).toBe('45°');
    expect(formatValue(24, {}, 'px')).toBe('24px');
  });

  it('never shows negative zero', () => {
    expect(formatValue(-0.2, { precision: 0 })).toBe('0');
    expect(formatValue(-0, {})).toBe('0');
  });
});
