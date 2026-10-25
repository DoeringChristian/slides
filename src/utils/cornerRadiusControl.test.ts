import { describe, expect, it } from 'vitest';
import { cornerRadiusClearance, cornerRadiusControl, type ControlHitEnvelope } from './cornerRadiusControl';
import { createShapeElement } from './slideFactory';

const shape = createShapeElement('path', { points: [0, 0, 240, 0, 240, 200, 440, 200], cornerRadius: 20 });

describe('cornerRadiusClearance finite first leg', () => {
  it.each([.5, 1, 2])('keeps the whole hit envelope finite and separate at every radius, zoom %s', zoom => {
    for (const hit of [6 / zoom, 12 / zoom]) {
      const control = cornerRadiusControl(shape)!;
      const obstacles: ControlHitEnvelope[] = [0, 120, 240].map(x => ({ kind: 'circle', x, y: 0, radius: 12 / zoom }));
      const interval = cornerRadiusClearance(control, zoom, hit, obstacles)!;
      expect(interval).not.toBeNull();
      expect(interval.start - hit).toBeGreaterThanOrEqual(0);
      expect(interval.end + hit).toBeLessThanOrEqual(240);
      for (let radius = 0; radius <= control.maxRadius; radius++) {
        const x = interval.end - radius / control.maxRadius * (interval.end - interval.start);
        for (const obstacle of obstacles) if (obstacle.kind === 'circle') {
          expect(Math.abs(x - obstacle.x)).toBeGreaterThan(obstacle.radius + hit);
        }
        expect(cornerRadiusClearance(cornerRadiusControl({ ...shape, cornerRadius: radius })!, zoom, hit, obstacles)).toEqual(interval);
      }
      expect(cornerRadiusClearance(control, zoom, hit, [...obstacles].reverse())).toEqual(interval);
      expect(interval.start).toBeGreaterThan(120); // equal-width tie nearest vertex 2
    }
  });
  it('omits only genuinely blocked slots, including remote-centered envelopes', () => {
    const control = cornerRadiusControl(shape)!;
    expect(cornerRadiusClearance(control, 1, 6, [{ kind: 'box', x: -100, y: -20, width: 1000, height: 40 }])).toBeNull();
    expect(cornerRadiusClearance(control, 1, 6, [{ kind: 'circle', x: 500, y: 0, radius: 600 }])).toBeNull();
    expect(cornerRadiusClearance(control, 1, 6, [{ kind: 'circle', x: 500, y: 0, radius: 6 }])).toEqual({ start: 6, end: 234 });
    const short = cornerRadiusControl({ ...shape, points: [0, 0, 40, 0, 40, 200, 240, 200] })!;
    expect(short.maxRadius).toBe(100);
    expect(cornerRadiusClearance(short, 1, 6, [0, 20, 40].map(x => ({ kind: 'circle', x, y: 0, radius: 7 })))).toBeNull();
    expect(cornerRadiusClearance(short, 2, 3, [0, 20, 40].map(x => ({ kind: 'circle', x, y: 0, radius: 3.5 })))).not.toBeNull();
  });
  it('global radius range and closure do not move the placement interval', () => {
    const element = { ...shape, points: [0, 0, 160, 0, 160, 40] };
    const open = cornerRadiusControl(element)!, closed = cornerRadiusControl({ ...element, closed: true })!;
    expect(open.maxRadius).toBe(20); expect(closed.maxRadius).toBe(80);
    const obstacle: ControlHitEnvelope = { kind: 'circle', x: 80, y: 0, radius: 5 };
    expect(cornerRadiusClearance(open, 1, 6, [obstacle])).toEqual(cornerRadiusClearance(closed, 1, 6, [obstacle]));
  });
  it('rejects degenerate and numerical sliver slots, without a forward extension', () => {
    const control = cornerRadiusControl(shape)!;
    for (const length of [0, 2, 12, 12.001, NaN, Infinity]) {
      expect(cornerRadiusClearance({ ...control, segmentLength: length }, 1, 6, [])).toBeNull();
    }
    expect(cornerRadiusClearance(control, 0, 6, [])).toBeNull();
  });
  it('uses the ordered first nonzero leg; prepend/reverse change association, append does not', () => {
    const c = cornerRadiusControl(shape)!;
    expect(c).toMatchObject({ x: 0, y: 0, dx: 1, dy: 0, segmentLength: 240 });
    expect(cornerRadiusControl({ ...shape, points: [0, 0, ...shape.points!] })).toEqual(c);
    expect(cornerRadiusControl({ ...shape, points: [...shape.points!, 440, 300] })).toEqual(c);
    const prepended = cornerRadiusControl({ ...shape, points: [-100, -100, ...shape.points!] })!;
    expect(prepended).toMatchObject({ x: -100, y: -100 });
    expect(prepended.dx).toBeCloseTo(Math.SQRT1_2); expect(prepended.dy).toBeCloseTo(Math.SQRT1_2);
    expect(cornerRadiusControl({ ...shape, points: [440, 200, 240, 200, 240, 0, 0, 0] })).toMatchObject({ x: 440, y: 200, dx: -1, dy: 0 });
  });
  it('preserves rectangle control geometry', () => {
    expect(cornerRadiusControl(createShapeElement('rect', { width: 200, height: 80 }))).toEqual({ x: 0, y: 0, dx: 1, dy: 0, maxRadius: 40 });
  });
});
