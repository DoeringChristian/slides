import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { jsonToYDoc, yDocToJson, getYElement, getYRoot } from './ySchema';
import { objectVisibleAnywhereInY, purgeObjectInY, resourceReferencedInY } from './yCleanup';
import {
  isObjectVisibleAnywhere,
  isResourceReferencedInSlides,
  purgeObjectFromSlides,
} from '../utils/presentationCleanup';
import type {
  ImageElement,
  Presentation,
  Resource,
  ShapeElement,
  Slide,
  TextElement,
} from '../types/presentation';

// =============================================================================
// Fixtures — same element builders as presentationCleanup.test.ts, completed to
// a full Presentation so that jsonToYDoc can build the identical Y side.
// =============================================================================

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

const resource = (id: string): Resource => ({
  id,
  name: `${id}.png`,
  type: 'image',
  src: `data:image/png;base64,${id}`,
  originalWidth: 100,
  originalHeight: 100,
});

function makePresentation(
  slides: Record<string, Slide>,
  resources: Record<string, Resource> = {},
): Presentation {
  const objects: Presentation['objects'] = {};
  for (const s of Object.values(slides)) {
    for (const el of Object.values(s.elements)) {
      objects[el.id] = {
        id: el.id,
        name: el.id,
        type: el.type === 'text' ? 'text' : el.type === 'image' ? 'image' : 'shape',
      };
    }
  }
  return {
    id: 'cleanup-deck',
    title: 'Cleanup equivalence deck',
    slides,
    slideOrder: Object.keys(slides),
    objects,
    resources,
    templates: {},
    theme: {
      name: 'Default',
      colors: {
        primary: '#3b82f6',
        secondary: '#1e40af',
        accent: '#f97316',
        background: '#ffffff',
        text: '#111111',
        heading: '#000000',
      },
      fonts: { heading: 'Inter', body: 'system-ui' },
    },
    width: 1920,
    height: 1080,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
  };
}

/** JSON-side equivalent of purgeObjectInY: purge from slides + drop orphaned resource. */
function purgeObjectFromPresentation(presentation: Presentation, objectId: string): Presentation {
  const purged = purgeObjectFromSlides(presentation.slides, objectId);
  let resources = presentation.resources;
  if (purged.resourceIdToRemove) {
    const { [purged.resourceIdToRemove]: _removed, ...remaining } = resources;
    resources = remaining;
  }
  return { ...presentation, slides: purged.slides, resources };
}

// =============================================================================
// Tests — every assertion pins the Y helper to its JSON twin on identical data.
// =============================================================================

describe('objectVisibleAnywhereInY ≡ isObjectVisibleAnywhere', () => {
  test('agrees for visible, hidden-everywhere, partially hidden and missing objects', () => {
    const fixture = makePresentation({
      s1: slide('s1', {
        text,
        rect: { ...rect, visible: false },
        img1: image('img1', 'res-a'),
      }),
      s2: slide('s2', {
        rect: { ...rect, visible: false },
        img1: { ...image('img1', 'res-a'), visible: false },
      }),
    }, { 'res-a': resource('res-a') });
    const doc = jsonToYDoc(fixture);

    for (const id of ['text', 'rect', 'img1', 'nonexistent']) {
      expect(objectVisibleAnywhereInY(doc, id)).toBe(isObjectVisibleAnywhere(fixture.slides, id));
    }
    // Sanity-pin the expected truth values themselves.
    expect(objectVisibleAnywhereInY(doc, 'text')).toBe(true);
    expect(objectVisibleAnywhereInY(doc, 'rect')).toBe(false);
    expect(objectVisibleAnywhereInY(doc, 'img1')).toBe(true);
    expect(objectVisibleAnywhereInY(doc, 'nonexistent')).toBe(false);
  });
});

describe('resourceReferencedInY ≡ isResourceReferencedInSlides', () => {
  test('agrees for referenced, unreferenced and unknown resources', () => {
    const fixture = makePresentation({
      s1: slide('s1', { img1: image('img1', 'res-a'), rect: { ...rect, visible: false } }),
      s2: slide('s2', { text }),
    }, { 'res-a': resource('res-a'), 'res-b': resource('res-b') });
    const doc = jsonToYDoc(fixture);

    for (const rid of ['res-a', 'res-b', 'res-missing']) {
      expect(resourceReferencedInY(doc, rid)).toBe(isResourceReferencedInSlides(fixture.slides, rid));
    }
    expect(resourceReferencedInY(doc, 'res-a')).toBe(true);
    expect(resourceReferencedInY(doc, 'res-b')).toBe(false);
  });
});

describe('purgeObjectInY ≡ purgeObjectFromSlides + resource drop', () => {
  test('keeps a resource that another element still references', () => {
    const fixture = makePresentation({
      s1: slide('s1', { img1: image('img1', 'res-a'), other: image('other', 'res-a') }, ['img1', 'other']),
      s2: slide('s2', { img1: image('img1', 'res-a') }),
    }, { 'res-a': resource('res-a') });

    const doc = jsonToYDoc(fixture);
    doc.transact(() => purgeObjectInY(doc, 'img1'));

    const jsonSide = purgeObjectFromPresentation(fixture, 'img1');
    expect(yDocToJson(doc)).toEqual(jsonSide);
    // 'other' still references res-a, so both sides keep it.
    expect(Object.keys(jsonSide.resources)).toEqual(['res-a']);
  });

  test('drops a resource once its last referencing element is purged', () => {
    const fixture = makePresentation({
      s1: slide('s1', { img1: image('img1', 'res-a'), text }, ['img1', 'text']),
      s2: slide('s2', { img1: image('img1', 'res-a') }),
    }, { 'res-a': resource('res-a') });

    const doc = jsonToYDoc(fixture);
    doc.transact(() => purgeObjectInY(doc, 'img1'));

    const jsonSide = purgeObjectFromPresentation(fixture, 'img1');
    expect(yDocToJson(doc)).toEqual(jsonSide);
    expect(jsonSide.resources).toEqual({});
    for (const s of Object.values(jsonSide.slides)) {
      expect(s.elements['img1']).toBeUndefined();
      expect(s.elementOrder).not.toContain('img1');
    }
  });

  test('purging a non-image object leaves resources untouched on both sides', () => {
    const fixture = makePresentation({
      s1: slide('s1', { rect, img1: image('img1', 'res-a') }, ['rect', 'img1']),
      s2: slide('s2', { rect }),
    }, { 'res-a': resource('res-a') });

    const doc = jsonToYDoc(fixture);
    doc.transact(() => purgeObjectInY(doc, 'rect'));

    const jsonSide = purgeObjectFromPresentation(fixture, 'rect');
    expect(yDocToJson(doc)).toEqual(jsonSide);
    expect(Object.keys(jsonSide.resources)).toEqual(['res-a']);
  });
});

describe('hideElement cascade equivalence (object hidden on every slide)', () => {
  // Mirrors presentationStore.hideElement: the image is already hidden on s2;
  // hiding it on s1 makes it invisible everywhere, which must purge it from all
  // slides, drop it from the object registry and free its orphaned resource —
  // identically on the JSON path and the Y path.
  function makeHideFixture(): Presentation {
    return makePresentation({
      s1: slide('s1', { img1: image('img1', 'res-a'), text }, ['img1', 'text']),
      s2: slide('s2', { img1: { ...image('img1', 'res-a'), visible: false }, rect }, ['img1', 'rect']),
    }, { 'res-a': resource('res-a') });
  }

  test('both paths converge to the same purged presentation', () => {
    const fixture = makeHideFixture();

    // ---- JSON path (as in hideElement's set() branch) ----
    let slides: Record<string, Slide> = {
      ...fixture.slides,
      s1: {
        ...fixture.slides.s1,
        elements: {
          ...fixture.slides.s1.elements,
          img1: { ...fixture.slides.s1.elements.img1, visible: false },
        },
      },
    };
    expect(isObjectVisibleAnywhere(slides, 'img1')).toBe(false);
    const { img1: _removedObject, ...remainingObjects } = fixture.objects;
    const purged = purgeObjectFromSlides(slides, 'img1');
    slides = purged.slides;
    let resources = fixture.resources;
    if (purged.resourceIdToRemove) {
      const { [purged.resourceIdToRemove]: _removedResource, ...remainingResources } = resources;
      resources = remainingResources;
    }
    const jsonResult: Presentation = { ...fixture, slides, objects: remainingObjects, resources };

    // ---- Y path (as in hideElement's doc branch, after the fix) ----
    const doc = jsonToYDoc(makeHideFixture());
    doc.transact(() => {
      const elMap = getYElement(doc, 's1', 'img1')!;
      elMap.set('visible', false);
      expect(objectVisibleAnywhereInY(doc, 'img1')).toBe(false);
      const objects = getYRoot(doc).get('objects') as Y.Map<unknown>;
      objects.delete('img1');
      purgeObjectInY(doc, 'img1');
    });

    const yResult = yDocToJson(doc);
    expect(yResult).toEqual(jsonResult);

    // The element is gone from every slide, the registry and the resource pool.
    for (const s of Object.values(yResult.slides)) {
      expect(s.elements['img1']).toBeUndefined();
      expect(s.elementOrder).not.toContain('img1');
    }
    expect(yResult.objects['img1']).toBeUndefined();
    expect(yResult.resources['res-a']).toBeUndefined();
    // Unrelated elements survive on both sides.
    expect(yResult.slides.s1.elements['text']).toBeDefined();
    expect(yResult.slides.s2.elements['rect']).toBeDefined();
  });

  test('without purgeObjectInY the Y path would diverge from the JSON path', () => {
    // Documents the bug the store fix closes: registry delete alone leaves the
    // hidden element (and its orphaned resource) behind in every slide.
    const fixture = makeHideFixture();
    const doc = jsonToYDoc(fixture);
    doc.transact(() => {
      getYElement(doc, 's1', 'img1')!.set('visible', false);
      (getYRoot(doc).get('objects') as Y.Map<unknown>).delete('img1');
      // no purgeObjectInY — the pre-fix hideElement Y branch
    });

    const stale = yDocToJson(doc);
    expect(stale.slides.s1.elements['img1']).toBeDefined();
    expect(stale.slides.s2.elements['img1']).toBeDefined();
    expect(stale.resources['res-a']).toBeDefined();

    // The purge is exactly the missing step: applying it restores equivalence.
    doc.transact(() => purgeObjectInY(doc, 'img1'));
    const repaired = yDocToJson(doc);

    const slides: Record<string, Slide> = {
      ...fixture.slides,
      s1: {
        ...fixture.slides.s1,
        elements: {
          ...fixture.slides.s1.elements,
          img1: { ...fixture.slides.s1.elements.img1, visible: false },
        },
      },
    };
    const { img1: _removedObject, ...remainingObjects } = fixture.objects;
    const purgedJson = purgeObjectFromPresentation({ ...fixture, slides, objects: remainingObjects }, 'img1');
    expect(repaired).toEqual(purgedJson);
  });
});
