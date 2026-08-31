import { describe, expect, test } from 'vitest';
import { transitionPropertiesDiffer, transitionPropertyValues, easingHasOptions } from './transitionProperties';
import type { ShapeElement, TextElement } from '../types/presentation';

const base = {
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
};

const text: TextElement = {
  ...base,
  id: 'text',
  type: 'text',
  text: 'hello',
  style: {
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textDecoration: 'none',
    color: '#111111',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.2,
  },
};

const path: ShapeElement = {
  ...base,
  id: 'path',
  type: 'shape',
  shapeType: 'path',
  fill: '',
  stroke: '#000000',
  strokeWidth: 3,
  cornerRadius: 0,
  points: [0, 0, 100, 0],
  curve: 'linear',
  closed: false,
};

describe('transitionProperties', () => {
  test('detects rounded numeric property changes like the UI did inline', () => {
    expect(transitionPropertiesDiffer(text, { ...text, x: 10.4 }, 'position')).toBe(false);
    expect(transitionPropertiesDiffer(text, { ...text, x: 11 }, 'position')).toBe(true);
  });

  test('visibility compares visible existence across missing elements', () => {
    expect(transitionPropertiesDiffer(undefined, text, 'visibility')).toBe(true);
    expect(transitionPropertiesDiffer(text, { ...text, visible: false }, 'visibility')).toBe(true);
    expect(transitionPropertiesDiffer({ ...text, visible: false }, undefined, 'visibility')).toBe(false);
  });

  test('control point diff includes curve and closed state', () => {
    expect(transitionPropertyValues(path, 'controlPoints')).toEqual(['0,0,100,0', 'linear', 0]);
    expect(transitionPropertiesDiffer(path, { ...path, curve: 'bspline2' }, 'controlPoints')).toBe(true);
    expect(transitionPropertiesDiffer(path, { ...path, closed: true }, 'controlPoints')).toBe(true);
  });

  test('reports which easings have option panels', () => {
    expect(easingHasOptions('content', 'write')).toBe(true);
    expect(easingHasOptions('visibility', 'grow')).toBe(true);
    expect(easingHasOptions('position', 'ease')).toBe(false);
  });
});
