import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SVGShapeNode } from './SVGShapeNode';
import { createShapeElement } from '../../utils/slideFactory';
import { pathPointsInSlide } from '../../utils/pathEditing';
import { getRotationCenter } from '../../utils/geometry';

describe('SVGShapeNode path body input geometry', () => {
  it.each([0, 37, 90])('negative-relative line visual and input share origin at %s°', rotation => {
    const element = createShapeElement('path', { x: 700, y: 300, width: 300, height: 210, rotation, points: [-100, -70, 200, 100], endHead: 'triangle' });
    const { x, y } = getRotationCenter(element);
    const markup = renderToStaticMarkup(<svg><SVGShapeNode element={element} /></svg>);
    const transforms = [...markup.matchAll(/transform="rotate\(([^)]+)\)"/g)].map(m => m[1]);
    expect(transforms.every(t => t === `${rotation}, ${x}, ${y}`)).toBe(true);
    if (rotation) expect(transforms.length).toBeGreaterThanOrEqual(2);
    const before = pathPointsInSlide(element);
    const after = pathPointsInSlide({ ...element, x: element.x + 86, y: element.y + 54 });
    after.forEach((v, i) => expect(v - before[i]).toBeCloseTo(i % 2 ? 54 : 86));
  });
});
