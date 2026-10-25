import { describe, expect, it } from 'vitest';
import { createShapeElement } from './slideFactory';
import { rectangleRadii, resolveShapePaint } from './shapePaint';
import { shapeToPathD, shapeToSvgPaths } from './shapeToPath';

describe('steady shape paint and input path agreement', () => {
  it('retains open zero-width path paint fallback, without enabling ordinary zero-width outlines', () => {
    const path = createShapeElement('path', { strokeWidth: 0, stroke: '', fill: '', points: [0, 0, 100, 40] });
    expect(resolveShapePaint(path)).toEqual({ fill: 'none', stroke: '#000', strokeWidth: 3 });
    expect(shapeToSvgPaths(path)[0].strokeColor).toBe('#000');
    expect(resolveShapePaint({ ...path, closed: true }).strokeWidth).toBe(0);
    expect(resolveShapePaint({ ...path, shapeType: 'rect' }).strokeWidth).toBe(0);
    expect(resolveShapePaint({ ...path, stroke: 'transparent' }).stroke).toBe('transparent');
    expect(resolveShapePaint({ ...path, fill: '#123456' }).stroke).toBe('#123456');
  });
  it('matches independent SVG radii for extreme nonsquare rectangles', () => {
    for (const [width, height, rx, ry] of [[200, 40, 100, 20], [40, 200, 20, 100], [80, 60, 40, 30]]) {
      const rect = createShapeElement('rect', { x: 0, y: 0, width, height, cornerRadius: 100 });
      expect(rectangleRadii(rect)).toEqual({ rx, ry });
      expect(shapeToPathD(rect)).toContain(`a ${rx} ${ry} 0 0 1 ${rx} ${ry}`);
    }
  });
});
