// Y.Doc schema mirroring the Presentation JSON shape (see
// src/types/presentation.ts). Functions are deterministic and pure: build a
// fresh Y.Doc from a JSON Presentation, or materialise a Y.Doc back to JSON.
//
// The schema lives in one place so the converter, the adapter (Phase 5), and
// the server's cold-start migration (Phase 3) can all reference it without
// drift.

import * as Y from 'yjs';
import type {
  Presentation,
  Slide,
  SlideElement,
  SlideTemplate,
  Theme,
  ObjectMeta,
  Resource,
  SlideBackground,
  TextElement,
  ShapeElement,
  ImageElement,
  GroupElement,
} from '../types/presentation';

// =============================================================================
// Public API
// =============================================================================

/** Top-level key under which the presentation lives in any collab Y.Doc. */
export const ROOT_KEY = 'presentation';

/**
 * Build a fresh Y.Doc populated with `presentation`, or hydrate an existing
 * empty Y.Doc. The caller owns the returned doc.
 */
export function jsonToYDoc(presentation: Presentation, doc: Y.Doc = new Y.Doc()): Y.Doc {
  const root = doc.getMap(ROOT_KEY);
  doc.transact(() => {
    populateRoot(root, presentation);
  }, 'init');
  return doc;
}

/**
 * Read back a Presentation from a Y.Doc. Throws if the doc hasn't been
 * initialised (root map is empty).
 */
export function yDocToJson(doc: Y.Doc): Presentation {
  const root = doc.getMap(ROOT_KEY);
  if (root.size === 0) {
    throw new Error('yDocToJson: presentation map is empty');
  }
  // Yjs' .toJSON() recurses through every nested Y type, returning plain
  // strings / arrays / objects. The schema is laid out so the recursion
  // matches the Presentation TypeScript shape exactly.
  return root.toJSON() as Presentation;
}

// =============================================================================
// Internal: builders. Each populates a parent Y.Map / Y.Array with the right
// nested Y types. Order matters — children must be created and then assigned
// to the parent, never reused across docs.
// =============================================================================

function populateRoot(root: Y.Map<unknown>, p: Presentation) {
  // Raw scalars and never-merged fields stay as plain values inside the Y.Map.
  root.set('id', p.id);
  root.set('width', p.width);
  root.set('height', p.height);
  root.set('createdAt', p.createdAt);
  root.set('updatedAt', p.updatedAt);

  // Concurrent typing → Y.Text.
  root.set('title', mkText(p.title));

  // Theme: flat scalar fields, but wrapped so future field additions don't
  // cause a whole-map replace.
  root.set('theme', themeToYMap(p.theme));

  // Maps + arrays.
  root.set('objects', objectsToYMap(p.objects));
  root.set('resources', resourcesToYMap(p.resources));
  root.set('slides', slidesToYMap(p.slides));
  root.set('slideOrder', mkArray(p.slideOrder));
  root.set('templates', templatesToYMap(p.templates));
}

function themeToYMap(theme: Theme): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('name', theme.name);
  m.set('colors', mkScalarMap(theme.colors));
  m.set('fonts', mkScalarMap(theme.fonts));
  return m;
}

function objectsToYMap(objects: Record<string, ObjectMeta>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [id, obj] of Object.entries(objects)) {
    m.set(id, mkScalarMap(obj));
  }
  return m;
}

function resourcesToYMap(resources: Record<string, Resource>): Y.Map<unknown> {
  // Resources are append-mostly; `src` (often a multi-MB base64 data URL)
  // stays raw — wrapping it in Y.Text would bloat CRDT metadata for no
  // collaborative-edit benefit.
  const m = new Y.Map<unknown>();
  for (const [id, res] of Object.entries(resources)) {
    m.set(id, mkScalarMap(res));
  }
  return m;
}

function slidesToYMap(slides: Record<string, Slide>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [id, slide] of Object.entries(slides)) {
    m.set(id, slideToYMap(slide));
  }
  return m;
}

function templatesToYMap(templates: Record<string, SlideTemplate>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [id, tpl] of Object.entries(templates)) {
    const t = new Y.Map<unknown>();
    t.set('id', tpl.id);
    t.set('name', tpl.name);
    t.set('elements', elementsToYMap(tpl.elements));
    t.set('elementOrder', mkArray(tpl.elementOrder));
    t.set('background', backgroundToYMap(tpl.background));
    m.set(id, t);
  }
  return m;
}

function slideToYMap(slide: Slide): Y.Map<unknown> {
  const s = new Y.Map<unknown>();
  s.set('id', slide.id);
  s.set('elements', elementsToYMap(slide.elements));
  s.set('elementOrder', mkArray(slide.elementOrder));
  s.set('background', backgroundToYMap(slide.background));
  s.set('transition', mkScalarMap(slide.transition));
  s.set('notes', mkText(slide.notes));
  setIfDefined(s, 'hidden', slide.hidden);
  setIfDefined(s, 'autoAdvance', slide.autoAdvance);
  setIfDefined(s, 'autoAdvanceDelay', slide.autoAdvanceDelay);
  return s;
}

function backgroundToYMap(bg: SlideBackground): Y.Map<unknown> {
  // Discriminated union — store the active variant flat as a Y.Map so the
  // type tag + companion fields end up in `.toJSON()`'s output unchanged.
  return mkScalarMap(bg);
}

function elementsToYMap(elements: Record<string, SlideElement>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [id, el] of Object.entries(elements)) {
    m.set(id, elementToYMap(el));
  }
  return m;
}

/** Exported: action code in presentationStore needs this to insert new elements
 *  into the Y.Doc as full Y.Map subtrees mirroring jsonToYDoc's layout. */
export function elementToYMap(el: SlideElement): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  // Common BaseElement scalars.
  m.set('id', el.id);
  m.set('type', el.type);
  m.set('x', el.x);
  m.set('y', el.y);
  m.set('width', el.width);
  m.set('height', el.height);
  m.set('rotation', el.rotation);
  m.set('opacity', el.opacity);
  m.set('locked', el.locked);
  m.set('visible', el.visible);
  if (el.transitions) {
    m.set('transitions', mkScalarMap(el.transitions));
  }

  switch (el.type) {
    case 'text': {
      const t = el as TextElement;
      m.set('text', mkText(t.text));
      m.set('style', mkScalarMap(t.style));
      return m;
    }
    case 'shape': {
      const s = el as ShapeElement;
      m.set('shapeType', s.shapeType);
      m.set('fill', s.fill);
      m.set('stroke', s.stroke);
      m.set('strokeWidth', s.strokeWidth);
      m.set('cornerRadius', s.cornerRadius);
      if (s.points) m.set('points', [...s.points]);
      setIfDefined(m, 'startBinding', s.startBinding ? mkScalarMap(s.startBinding) : s.startBinding);
      setIfDefined(m, 'endBinding', s.endBinding ? mkScalarMap(s.endBinding) : s.endBinding);
      return m;
    }
    case 'image': {
      const i = el as ImageElement;
      setIfDefined(m, 'resourceId', i.resourceId);
      m.set('cropX', i.cropX);
      m.set('cropY', i.cropY);
      m.set('cropWidth', i.cropWidth);
      m.set('cropHeight', i.cropHeight);
      setIfDefined(m, 'playing', i.playing);
      setIfDefined(m, 'loop', i.loop);
      setIfDefined(m, 'muted', i.muted);
      setIfDefined(m, 'startTime', i.startTime);
      return m;
    }
    case 'group': {
      const g = el as GroupElement;
      m.set('childIds', mkArray(g.childIds));
      return m;
    }
  }
  return m;
}

// =============================================================================
// Tiny Y-type builders
// =============================================================================

function mkText(str: string): Y.Text {
  const t = new Y.Text();
  if (str) t.insert(0, str);
  return t;
}

function mkArray<T>(items: readonly T[]): Y.Array<T> {
  const a = new Y.Array<T>();
  if (items.length > 0) a.insert(0, [...items]);
  return a;
}

/** Y.Map of flat scalar fields — no nested Y types. Round-trips via toJSON.
 *  Accepts any object (interfaces don't get index signatures by default, so
 *  the parameter is widened to `object` and cast on entry). */
function mkScalarMap(obj: object): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined) continue;
    m.set(k, v);
  }
  return m;
}

function setIfDefined<T>(m: Y.Map<unknown>, key: string, value: T | undefined) {
  if (value !== undefined) m.set(key, value as unknown);
}
