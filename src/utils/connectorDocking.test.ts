import { describe, expect, it } from 'vitest';
import { createShapeElement, createTextElement } from './slideFactory';
import { bindDraftEndpoints, bindingDrop, bindingFor, connectorDockCue, resolveBinding, silhouetteDistance } from './connectorUtils';

describe('connectorDockCue (pinned c0ad61c simple midpoint source)', () => {
  it.each([.5, 1, 2])('uses source world budget and transformed shared anchors at zoom %s', zoom => {
    for (const shapeType of ['rect', 'ellipse'] as const) for (const rotation of [0, 37, 90]) {
      const target = createShapeElement(shapeType, { id: 'target', x: 100, y: 100, width: 200, height: 120, rotation, strokeWidth: 2 });
      const p = resolveBinding({ elementId: target.id, mode: 'pinned', fixedPoint: [1, .5] }, target, { x: 0, y: 0 });
      const r = rotation * Math.PI / 180;
      const pointer = (distance: number) => ({ x: p.x + Math.cos(r) * distance, y: p.y + Math.sin(r) * distance });
      const budget = (zoom === .5 ? 20 : 15) + 1;
      expect(connectorDockCue(pointer(budget - .01), target, zoom)?.active).toBe(true);
      expect(connectorDockCue(pointer(budget + .01), target, zoom)?.active).toBe(false);
      expect(connectorDockCue(pointer(budget * 2 + .01), target, zoom)).toBeNull();
      const cue = connectorDockCue(pointer(3), target, zoom)!;
      expect(cue.binding.mode).toBe('pinned');
      expect(cue.binding.fixedPoint![0]).toBeCloseTo(1);
      expect(cue.binding.fixedPoint![1]).toBeCloseTo(.5);
      expect(Math.abs(silhouetteDistance(target, cue.point))).toBeLessThan(1e-7);
      const drop = bindingDrop(pointer(3), { x: 600, y: 600 }, [target], '', zoom)!;
      expect(drop.dock).toEqual(cue);
      expect(drop.point.x).toBeCloseTo(cue.point.x);
      expect(drop.point.y).toBeCloseTo(cue.point.y);
      expect(connectorDockCue(pointer(-1), target, zoom)).toBeNull();
      expect(connectorDockCue(pointer(1), target, zoom, true)).toBeNull();
      expect(bindingDrop(pointer(1), { x: 600, y: 600 }, [target], '', zoom, false, false)?.binding.mode).toBe('aim');
    }
  });
  it('omits unsupported, bound-text, locked, hidden and degenerate targets', () => {
    const targets = [
      ...(['triangle', 'star', 'vector', 'path'] as const).map(shapeType => createShapeElement(shapeType)),
      createShapeElement('rect', { locked: true }), createShapeElement('rect', { visible: false }),
      createShapeElement('rect', { width: 0 }), createTextElement({ containerId: 'container' }),
    ];
    for (const target of targets) expect(connectorDockCue(resolveBinding({ elementId: target.id, mode: 'pinned', fixedPoint: [1, .5] }, target, { x: 0, y: 0 }), target)).toBeNull();
  });
  it('uses nearest highlighted midpoint rather than upstream first-overlapping acquisition', () => {
    const target = createShapeElement('rect', { x: 0, y: 0, width: 10, height: 10 });
    const cue = connectorDockCue({ x: 4, y: -1 }, target)!;
    expect(cue.point).toEqual({ x: 5, y: 0 });
    expect(bindingDrop({ x: 4, y: -1 }, { x: 100, y: 100 }, [target], '')?.binding).toEqual(cue.binding);
  });
  it('retains start pin for arbitrary outgoing directions, Shift and transformed targets', () => {
    const target = createShapeElement('ellipse', { id: 'a', x: 100, y: 100, width: 200, height: 120 });
    const pin = connectorDockCue({ x: 305, y: 160 }, target)!.binding;
    for (const end of [[700, 700], [0, 0], [700, 160]]) {
      const bound = bindDraftEndpoints([300, 160, ...end], [target], 1, end[1] === 160, pin);
      expect(bound.startBinding).toEqual(pin);
      expect(bound.absPoints.slice(0, 2)).toEqual([300, 160]);
    }
    const transformed = { ...target, rotation: 37, width: 300, height: 80, x: 120 };
    const resolved = resolveBinding(pin, transformed, { x: 600, y: 500 });
    const result = bindDraftEndpoints([300, 160, 600, 500], [transformed], 1, false, pin);
    expect(result.absPoints.slice(0, 2)).toEqual([resolved.x, resolved.y]);
    expect(result.startBinding).toEqual(pin);
    expect(bindDraftEndpoints([300, 160, 600, 500], [], 1, false, pin).startBinding).toBeNull();
  });
  it('leaves interior aims and pinned metadata unchanged', () => {
    const target = createShapeElement('rect', { id: 'a', x: 100, y: 100, width: 200, height: 120 });
    const aim = bindingDrop({ x: 200, y: 130 }, { x: 600, y: 500 }, [target], '')!.binding;
    expect(aim).toMatchObject({ mode: 'aim', fixedPoint: [.5, .25], gap: 0 });
    const edge = bindingFor({ x: 310, y: 165 }, target, 'aim');
    const before = JSON.stringify(edge);
    resolveBinding(edge, target, { x: 700, y: 700 });
    expect(JSON.stringify(edge)).toBe(before);
  });
});
