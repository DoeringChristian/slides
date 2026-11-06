import { describe, expect, it } from 'vitest';
import { snapConnectorPoint, snapPathPoint } from './pathSnapping';
import { bindingDrop, resolveBinding } from '../paths/connectorUtils';
import { createShapeElement } from '../model/slideFactory';

const rect = createShapeElement('rect', { id: 'target', x: 100, y: 100, width: 100, height: 100, strokeWidth: 2 });
const origin = { x: 400, y: 150 };
const visiblePoint = (result: ReturnType<typeof snapConnectorPoint>) => result.drop?.point ?? result.point;

describe('shared connector snapping policy', () => {
  it.each([.25, .5, 1, 2, 3])('uses the same alignment candidates as ordinary points at zoom %s', zoom => {
    const others = [{ x: 100, y: 100, width: 100, height: 100 }];
    for (const x of [100, 150, 200]) {
      const point = { x: x + 4 / zoom, y: 350 };
      const alignment = { others };
      const ordinary = snapPathPoint(point, [origin], zoom, false, alignment);
      const connector = snapConnectorPoint(point, origin, [rect], zoom, false, false, alignment);
      expect(visiblePoint(connector)).toEqual(ordinary.point);
      expect(connector.guides).toEqual(ordinary.guides);
      expect(connector.drop).toBeNull();
    }
  });

  it('does not replace a winning ordinary guide with an attachment to a nearby object', () => {
    const point = { x: 96, y: 130 };
    const alignment = { others: [{ x: 96, y: 300, width: 30, height: 30 }] };
    const result = snapConnectorPoint(point, origin, [rect], 1, false, false, alignment);
    expect(visiblePoint(result)).toEqual(point);
    expect(result.drop).toBeNull();
    expect(result.guides.some(g => g.type === 'vertical' && g.position === 96)).toBe(true);
  });

  it('ignores nearby losing guides when preserving a valid aligned attachment', () => {
    const result = snapConnectorPoint({ x: 200, y: 150 }, origin, [rect], 1, false, false,
      { others: [rect, { x: 203, y: 300, width: 40, height: 40 }] });
    expect(result.drop?.target.id).toBe(rect.id);
    expect(visiblePoint(result)).toEqual({ x: 200, y: 150 });
  });

  it.each([.25, .5, 1, 2, 3])('bounds attachment acquisition in screen pixels at zoom %s', zoom => {
    const near = { x: 200 + 4 / zoom, y: 150 };
    const far = { x: 200 + 6 / zoom, y: 150 };
    const attached = snapConnectorPoint(near, origin, [rect], zoom, false, false);
    expect(attached.drop?.target.id).toBe(rect.id);
    expect(Math.hypot(visiblePoint(attached).x - near.x, visiblePoint(attached).y - near.y) * zoom).toBeLessThanOrEqual(5);
    const free = snapConnectorPoint(far, origin, [rect], zoom, false, false);
    expect(free.drop).toBeNull();
    expect(visiblePoint(free)).toEqual(far);
  });

  it.each([.25, .5, 1, 2, 3])('measures dot acquisition from its center, not its perimeter at zoom %s', zoom => {
    const dot = createShapeElement('dot', { id: 'dot', x: 100, y: 100, width: 100, height: 100 });
    const near = snapConnectorPoint({ x: 150 + 4 / zoom, y: 150 }, origin, [dot], zoom, false, false);
    expect(near.drop?.point).toEqual({ x: 150, y: 150 });
    const far = snapConnectorPoint({ x: 150 + 6 / zoom, y: 150 }, origin, [dot], zoom, false, false);
    expect(far.drop).toBeNull();
  });

  it('does not jump across an object when acquiring its opposite side', () => {
    const pointer = { x: 99, y: 130 };
    expect(bindingDrop(pointer, origin, [rect], '', 1, false, false)).toBeNull();
    expect(visiblePoint(snapConnectorPoint(pointer, origin, [rect], 1, false, false, undefined, '', false))).toEqual(pointer);
  });

  it('keeps Shift on the constrained ray while using ordinary point candidates', () => {
    const rayOrigin = { x: 0, y: 0 };
    const alignment = { others: [{ x: 100, y: 100, width: 0, height: 0 }] };
    const result = snapConnectorPoint({ x: 101, y: 102 }, rayOrigin, [rect], 1, true, false, alignment);
    const point = visiblePoint(result);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(100);
    expect(result.guides.some(g => g.type === 'direction')).toBe(true);
  });

  it('suppression disables both alignment and automatic attachment', () => {
    const point = { x: 202, y: 150 };
    const result = snapConnectorPoint(point, origin, [rect], 1, false, true, { others: [rect] });
    expect(result.point).toEqual(point);
    expect(result.drop).toBeNull();
    expect(result.guides).toEqual([]);
  });

  it('does not acquire objects outside the visible viewport', () => {
    const result = snapConnectorPoint({ x: 202, y: 150 }, origin, [rect], 1, false, false,
      { others: [rect], viewport: { x: 210, y: 0, width: 100, height: 300 } });
    expect(result.drop).toBeNull();
  });

  it('preserves existing attachment offsets independently of acquisition tolerance', () => {
    const dot = createShapeElement('dot', { id: 'dot', x: 100, y: 100, width: 100, height: 100 });
    const dotBinding = { elementId: dot.id, mode: 'aim' as const, fixedPoint: [.5, .5] as [number, number], gap: 12 };
    const edgeBinding = { ...dotBinding, elementId: rect.id };
    expect(resolveBinding(dotBinding, dot, origin)).toEqual({ x: 162, y: 150 });
    expect(resolveBinding(edgeBinding, rect, origin)).toEqual({ x: 212, y: 150 });
    expect(dotBinding.gap).toBe(12);
    expect(edgeBinding.gap).toBe(12);
  });
});
