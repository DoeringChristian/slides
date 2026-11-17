import { describe, expect, it } from 'vitest';
import { createShapeElement } from '../model/slideFactory';
import { gradientFill, hasFillPaint } from './shapeFill';
import { interpolateElement } from '../animation/interpolation';
import { attachGroupCrops, groupCropPaint } from '../model/groupCrop';
import type { ShapeElement } from '../../types/presentation';

const rect = (over: Partial<ShapeElement> = {}) =>
  createShapeElement('rect', { id: 'r', x: 100, y: 50, width: 200, height: 100, fill: '#ff0000', ...over });

describe('gradient fills', () => {
  it('solid and hatched fills have no gradient', () => {
    expect(gradientFill(rect())).toBeNull();
    expect(gradientFill(rect({ fillStyle: 'hachure' }))).toBeNull();
  });

  it('linear: from the line\'s start to its end, relative to the box (default top→bottom)', () => {
    const c = (n: number) => expect.closeTo(n, 9);
    expect(gradientFill(rect({ fillStyle: 'linear', fillTo: '#0000ff' }))).toEqual(
      { kind: 'linear', from: '#ff0000', to: '#0000ff', x1: c(200), y1: c(50), x2: c(200), y2: c(150) });
    const g = gradientFill(rect({ fillStyle: 'linear', fillLine: [0, 0.5, 1, 0.5] }), true)!;
    expect(g).toMatchObject({ kind: 'linear', x1: c(0), y1: c(50), x2: c(200), y2: c(50) });
    // fillTo absent: a fade-out of the fill.
    expect(g.to).toBe('rgba(255, 0, 0, 0)');
  });

  it('radial: centred on the line\'s start, reaching its end (default centre → corner)', () => {
    expect(gradientFill(rect({ fillStyle: 'radial', fillTo: '#000000' }))).toEqual(
      { kind: 'radial', from: '#ff0000', to: '#000000', cx: 200, cy: 100, r: Math.hypot(200, 100) / 2 });
  });

  it('a gradient from transparent still paints', () => {
    expect(hasFillPaint(rect({ fill: '', fillStyle: 'linear', fillTo: '#000000' }))).toBe(true);
    expect(hasFillPaint(rect({ fill: '' }))).toBe(false);
  });

  it('solid ↔ gradient blends (solid is a gradient to its own colour); lines interpolate', () => {
    const a = rect({ fill: '#000000' });
    const b = rect({ fill: '#000000', fillStyle: 'linear', fillTo: '#ffffff', fillLine: [0, 0.5, 1, 0.5] });
    const mid = interpolateElement(a, b, 0.5) as ShapeElement;
    expect(mid.fillStyle).toBe('linear');
    expect(mid.fillTo).toBe(interpolateElement(rect({ fill: '#000000' }), rect({ fill: '#ffffff' }), 0.5).type === 'shape'
      ? (interpolateElement(rect({ fill: '#000000' }), rect({ fill: '#ffffff' }), 0.5) as ShapeElement).fill : '');
    const turn = interpolateElement(rect({ fillStyle: 'linear', fillLine: [0, 0, 1, 0] }), rect({ fillStyle: 'linear', fillLine: [0, 0, 0, 1] }), 0.5) as ShapeElement;
    expect(turn.fillLine).toEqual([0, 0, 0.5, 0.5]);
  });
});

describe('crop tint', () => {
  const image = { ...rect({ id: 'i' }), type: 'image', resourceId: null, objectGroupIds: ['g'] } as never;
  it('a crop shape hides its fill unless it tints', () => {
    const plain = rect({ id: 'c', objectGroupIds: ['g'], cropGroupId: 'g', fillStyle: 'linear' });
    const tint = { ...plain, cropTint: true };
    const [, paintedPlain] = attachGroupCrops([image, plain]);
    expect((groupCropPaint(paintedPlain) as ShapeElement).fill).toBe('none');
    const [, paintedTint] = attachGroupCrops([image, tint]);
    expect(groupCropPaint(paintedTint)).toMatchObject({ fill: '#ff0000', fillStyle: 'linear' });
  });
});
