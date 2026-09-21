import { describe, expect, test } from 'vitest';
import {
  collectGhostObjectIds,
  isObjectVisibleAnywhere,
  isResourceReferencedInSlides,
  objectExistsAnywhere,
  objectSubtypeForElement,
  objectTypeForElement,
  purgeObjectFromSlides,
  repairPresentation,
} from './presentationCleanup';
import type { ImageElement, Presentation, ShapeElement, Slide, TextElement } from '../types/presentation';

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

  test('objectExistsAnywhere reports presence, not visibility', () => {
    const slides = {
      s1: slide('s1', { rect: { ...rect, visible: false }, text }),
      s2: slide('s2', { rect: { ...rect, visible: false } }),
    };
    // Hidden on every slide it appears on — still PRESENT.
    expect(objectExistsAnywhere(slides, 'rect')).toBe(true);
    expect(isObjectVisibleAnywhere(slides, 'rect')).toBe(false);
    expect(objectExistsAnywhere(slides, 'text')).toBe(true);
    // Never present on any slide.
    expect(objectExistsAnywhere(slides, 'ghost')).toBe(false);
  });

  test('collectGhostObjectIds returns exactly the registry ids with zero occurrences', () => {
    const slides = {
      s1: slide('s1', { rect: { ...rect, visible: false } }),
      s2: slide('s2', { text }),
    };
    const objects = {
      rect: { id: 'rect', name: 'Rect', type: 'shape' as const },
      text: { id: 'text', name: 'Text', type: 'text' as const },
      ghost: { id: 'ghost', name: 'Ghost', type: 'shape' as const },
      'ghost-img': { id: 'ghost-img', name: 'Ghost image', type: 'image' as const },
    };
    expect(collectGhostObjectIds(slides, objects).sort()).toEqual(['ghost', 'ghost-img']);
    expect(collectGhostObjectIds(slides, { rect: objects.rect })).toEqual([]);
  });
});

describe('repairPresentation (load-time ghost repair)', () => {
  function makePresentation(
    slides: Record<string, Slide>,
    objects: Presentation['objects'],
    resources: Presentation['resources'] = {},
    templates: Presentation['templates'] = {},
  ): Presentation {
    return {
      id: 'deck',
      title: 'Repair deck',
      slides,
      slideOrder: Object.keys(slides),
      objects,
      resources,
      templates,
      theme: {
        name: 'Default',
        colors: {
          primary: '#3b82f6', secondary: '#1e40af', accent: '#f97316',
          background: '#ffffff', text: '#111111', heading: '#000000',
        },
        fonts: { heading: 'Inter', body: 'system-ui' },
      },
      width: 1920,
      height: 1080,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    };
  }

  const res = (id: string) => ({
    id, name: `${id}.png`, type: 'image' as const,
    src: `data:image/png;base64,${id}`, originalWidth: 10, originalHeight: 10,
  });

  test('drops ghost registry entries and unreferenced resources', () => {
    const corrupted = makePresentation(
      { s1: slide('s1', { text, img1: image('img1', 'res-a') }) },
      {
        text: { id: 'text', name: 'Text', type: 'text' },
        img1: { id: 'img1', name: 'Image', type: 'image' },
        ghost: { id: 'ghost', name: 'Ghost', type: 'shape' },
      },
      { 'res-a': res('res-a'), 'res-leak': res('res-leak') },
    );

    const repaired = repairPresentation(corrupted);
    expect(repaired.objects['ghost']).toBeUndefined();
    expect(repaired.objects['text']).toBeDefined();
    expect(repaired.objects['img1']).toBeDefined();
    expect(repaired.resources['res-leak']).toBeUndefined();
    expect(repaired.resources['res-a']).toBeDefined();
    // Slides are untouched — the repair only prunes registry + resources.
    expect(repaired.slides).toBe(corrupted.slides);
  });

  test('keeps a registry entry whose element is merely hidden everywhere', () => {
    const deck = makePresentation(
      { s1: slide('s1', { rect: { ...rect, visible: false } }) },
      { rect: { id: 'rect', name: 'Rect', type: 'shape' } },
    );
    expect(repairPresentation(deck).objects['rect']).toBeDefined();
  });

  test('keeps a resource that only a template references', () => {
    const deck = makePresentation(
      { s1: slide('s1', { text }) },
      { text: { id: 'text', name: 'Text', type: 'text' } },
      { 'res-tpl': res('res-tpl') },
      {
        'tpl-1': {
          id: 'tpl-1',
          name: 'Template',
          elements: { 'tpl-img': image('tpl-img', 'res-tpl') },
          elementOrder: ['tpl-img'],
          background: { type: 'solid', color: '#fff' },
        },
      },
    );
    expect(repairPresentation(deck).resources['res-tpl']).toBeDefined();
  });

  test('is idempotent and returns a clean deck by reference', () => {
    const clean = makePresentation(
      { s1: slide('s1', { text }) },
      { text: { id: 'text', name: 'Text', type: 'text' } },
    );
    expect(repairPresentation(clean)).toBe(clean);

    const corrupted = makePresentation(
      { s1: slide('s1', { text }) },
      {
        text: { id: 'text', name: 'Text', type: 'text' },
        ghost: { id: 'ghost', name: 'Ghost', type: 'shape' },
      },
      { 'res-leak': res('res-leak') },
    );
    const once = repairPresentation(corrupted);
    expect(repairPresentation(once)).toBe(once);
    expect(once).not.toBe(corrupted);

    // Explicitly out of scope: elements present in `elements` but missing
    // from `elementOrder` are left alone (pending product decision).
    const missingFromOrder = makePresentation(
      { s1: slide('s1', { text, rect }, ['text']) },
      {
        text: { id: 'text', name: 'Text', type: 'text' },
        rect: { id: 'rect', name: 'Rect', type: 'shape' },
      },
    );
    const out = repairPresentation(missingFromOrder);
    expect(out).toBe(missingFromOrder);
    expect(out.slides.s1.elements['rect']).toBeDefined();
    expect(out.slides.s1.elementOrder).toEqual(['text']);
  });
});

// =============================================================================
// WS-2 Phase 4 bound text: purge cascade
// =============================================================================

describe('purgeObjectFromSlides bound-text cascade', () => {
  const boundLabel = (id: string, containerId: string): TextElement => ({
    ...text,
    id,
    containerId,
  });

  test('purging a container also purges its bound labels and reports their ids', () => {
    const slides = {
      s1: slide('s1', { rect, lbl: boundLabel('lbl', 'rect'), text }, ['rect', 'lbl', 'text']),
      s2: slide('s2', { rect, lbl: boundLabel('lbl', 'rect') }, ['rect', 'lbl']),
    };
    const purged = purgeObjectFromSlides(slides, 'rect');
    expect(purged.purgedBoundTextIds).toEqual(['lbl']);
    for (const s of Object.values(purged.slides)) {
      expect(s.elements['rect']).toBeUndefined();
      expect(s.elements['lbl']).toBeUndefined();
      expect(s.elementOrder).not.toContain('rect');
      expect(s.elementOrder).not.toContain('lbl');
    }
    // Unrelated text survives.
    expect(purged.slides.s1.elements['text']).toBeDefined();
  });

  test('purging a label directly does not cascade to its container', () => {
    const slides = {
      s1: slide('s1', { rect, lbl: boundLabel('lbl', 'rect') }, ['rect', 'lbl']),
    };
    const purged = purgeObjectFromSlides(slides, 'lbl');
    expect(purged.purgedBoundTextIds).toEqual([]);
    expect(purged.slides.s1.elements['rect']).toBeDefined();
    expect(purged.slides.s1.elements['lbl']).toBeUndefined();
  });

  test('purging an object without labels reports an empty cascade', () => {
    const slides = { s1: slide('s1', { rect, text }, ['rect', 'text']) };
    const purged = purgeObjectFromSlides(slides, 'rect');
    expect(purged.purgedBoundTextIds).toEqual([]);
  });
});
