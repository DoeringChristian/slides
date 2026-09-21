import { describe, expect, test } from 'vitest';
import {
  isObjectVisibleAnywhere,
  isResourceReferencedInSlides,
  objectSubtypeForElement,
  objectTypeForElement,
  purgeObjectFromSlides,
} from './presentationCleanup';
import type { ImageElement, ShapeElement, Slide, TextElement } from '../types/presentation';

const base = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
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

const rect: ShapeElement = {
  ...base,
  id: 'rect',
  type: 'shape',
  shapeType: 'rect',
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 1,
  cornerRadius: 0,
};

const image = (id: string, resourceId: string): ImageElement => ({
  ...base,
  id,
  type: 'image',
  resourceId,
  cropX: 0,
  cropY: 0,
  cropWidth: 100,
  cropHeight: 100,
});

const slide = (id: string, elements: Slide['elements'], elementOrder = Object.keys(elements)): Slide => ({
  id,
  elements,
  elementOrder,
  background: { type: 'solid', color: '#fff' },
  transition: { duration: 300 },
  notes: '',
});

describe('presentationCleanup', () => {
  test('derives object metadata from elements', () => {
    expect(objectTypeForElement(text)).toBe('text');
    expect(objectSubtypeForElement(text)).toBe('text');
    expect(objectTypeForElement(rect)).toBe('shape');
    expect(objectSubtypeForElement(rect)).toBe('rect');
  });

  test('detects resource references and visible objects', () => {
    const slides = {
      s1: slide('s1', { img1: image('img1', 'res-a'), rect: { ...rect, visible: false } }),
      s2: slide('s2', { text }),
    };
    expect(isResourceReferencedInSlides(slides, 'res-a')).toBe(true);
    expect(isResourceReferencedInSlides(slides, 'res-b')).toBe(false);
    expect(isObjectVisibleAnywhere(slides, 'rect')).toBe(false);
    expect(isObjectVisibleAnywhere(slides, 'text')).toBe(true);
  });

  test('purges object everywhere but only reports unreferenced image resource', () => {
    const slides = {
      s1: slide('s1', { img1: image('img1', 'res-a'), other: image('other', 'res-a') }, ['img1', 'other']),
      s2: slide('s2', { img1: image('img1', 'res-a') }),
    };

    const purged = purgeObjectFromSlides(slides, 'img1');
    expect(Object.keys(purged.slides.s1.elements)).toEqual(['other']);
    expect(purged.slides.s1.elementOrder).toEqual(['other']);
    expect(Object.keys(purged.slides.s2.elements)).toEqual([]);
    expect(purged.resourceIdToRemove).toBeNull();

    const finalPurge = purgeObjectFromSlides(purged.slides, 'other');
    expect(finalPurge.resourceIdToRemove).toBe('res-a');
  });
});
