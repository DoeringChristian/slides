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

describe('applyScrubDelta — scrubStep overrides step for drags', () => {
  it('uses scrubStep per pixel when given', () => {
    expect(runSequence(0, [{ dx: 10 }], { step: 1, scrubStep: 0.2 })).toBeCloseTo(2, 10);
  });

  it('falls back to step when scrubStep is absent', () => {
    expect(runSequence(0, [{ dx: 10 }], { step: 0.5 })).toBeCloseTo(5, 10);
  });

  it('fine factor applies on top of scrubStep', () => {
    expect(
      runSequence(0, [{ dx: 10, fine: true }], { step: 1, scrubStep: 0.2 }),
    ).toBeCloseTo(0.2, 10);
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

describe('commitValue — Ctrl snapping', () => {
  it('snaps to whole values with snap 1', () => {
    expect(commitValue(10.4, {}, 1)).toBe(10);
    expect(commitValue(10.6, {}, 1)).toBe(11);
    expect(commitValue(-2.6, {}, 1)).toBe(-3);
  });

  it('snaps to an arbitrary multiple', () => {
    expect(commitValue(10.3, {}, 0.5)).toBe(10.5);
    expect(commitValue(17, {}, 15)).toBe(15);
  });

  it('produces dust-free multiples (0.1 grid)', () => {
    // 0.34999… / 0.1 → 3.4999…; naive round-and-multiply would return
    // 0.30000000000000004.
    expect(commitValue(0.34999999, {}, 0.1)).toBe(0.3);
    expect(commitValue(0.25, {}, 0.1)).toBe(0.3);
  });

  it('replaces precision rounding (the multiple is the grid)', () => {
    // precision 2 would give 10.26; snap wins.
    expect(commitValue(10.26, { precision: 2 }, 1)).toBe(10);
    // precision 1 would re-round 10.25 → 10.3, breaking the 0.25 grid.
    expect(commitValue(10.3, { precision: 1 }, 0.25)).toBe(10.25);
  });

  it('clamps after snapping — bounds win even off-grid', () => {
    expect(commitValue(0.2, { min: 0.1 }, 1)).toBe(0.1);
    expect(commitValue(20.6, { max: 20.4 }, 1)).toBe(20); // clamp → 20.4 → snap → 20
    expect(commitValue(-5, { min: 0 }, 1)).toBe(0);
  });

  it('does not snap when the parameter is absent (regression)', () => {
    expect(commitValue(10.4, {})).toBe(10.4);
  });
});

describe('Ctrl snapping mid-sequence (preview path)', () => {
  it('draft accumulates unrounded while previews snap; releasing Ctrl returns to the exact position', () => {
    const spec: ScrubSpec = { step: 1 };
    let v = applyScrubDelta(0, 3.4, spec, false); // 3.4
    // Ctrl pressed: the previewed value snaps, the draft is untouched.
    expect(commitValue(v, spec, 1)).toBe(3);
    v = applyScrubDelta(v, 0.2, spec, false); // ~3.6
    expect(commitValue(v, spec, 1)).toBe(4);
    // Ctrl released: preview is the raw accumulator again.
    expect(commitValue(v, spec)).toBeCloseTo(3.6, 10);
  });

  it('ctrl+shift: fine accumulation, then snap at commit', () => {
    const spec: ScrubSpec = { step: 1 };
    // 16 fine px at default fineFactor 0.1 → draft 1.6.
    const draft = runSequence(0, [{ dx: 8, fine: true }, { dx: 8, fine: true }], spec);
    expect(draft).toBeCloseTo(1.6, 10);
    expect(commitValue(draft, spec, 1)).toBe(2);
  });

  it('snap respects clamping mid-drag', () => {
    const spec: ScrubSpec = { step: 1, min: 0, max: 10 };
    const draft = runSequence(9, [{ dx: 5 }], spec); // clamped to 10
    expect(commitValue(draft, spec, 3)).toBe(9); // 10 → nearest multiple of 3 in range
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


describe('cyclic ScrubSpec', () => {
  const angle: ScrubSpec = { min: 0, wrap: 360, step: 1, precision: 1 };
  it('wraps backwards and forwards, including large negative typed values', () => {
    expect(applyScrubDelta(0, -1, angle, false)).toBe(359);
    expect(applyScrubDelta(359, 1, angle, false)).toBe(0);
    expect(parseInput('-721.25', angle)).toBe(358.75);
    expect(commitValue(1080, angle)).toBe(0);
  });
  it('keeps unrounded fine accumulation and wraps after Ctrl/precision rounding', () => {
    const draft = applyScrubDelta(0, -1, angle, true);
    expect(draft).toBeCloseTo(359.9);
    expect(commitValue(draft, angle, 1)).toBe(0);
    expect(commitValue(draft, angle)).toBeCloseTo(359.9);
    expect(commitValue(359.96, angle)).toBe(0);
    expect(runSequence(0, [{ dx: -0.1, fine: true }, { dx: -0.1, fine: true }], angle)).toBeCloseTo(359.98);
  });
  it('supports a nonzero interval origin and does not wrap bounded controls', () => {
    expect(clampValue(-181, { min: -180, wrap: 360 })).toBe(179);
    expect(clampValue(180, { min: -180, wrap: 360 })).toBe(-180);
    expect(applyScrubDelta(99, 5, { min: 0, max: 100 }, false)).toBe(100);
    expect(applyScrubDelta(0, -5, { min: 0, max: 20 }, false)).toBe(0);
  });
});
