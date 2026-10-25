import type { Presentation } from '../types/presentation';

/** Native data has one supported schema. Reject superseded payloads, never
 * reinterpret them or silently strip their geometry/bindings on save. */
export function assertCurrentPresentation(presentation: Presentation): Presentation {
  const unsupported = (where: string): never => {
    throw new Error(`Unsupported presentation format: ${where}. Only the current native schema is supported.`);
  };
  for (const slide of [...Object.values(presentation.slides), ...Object.values(presentation.templates)]) {
    if ('autoAdvance' in slide) unsupported(`slide ${slide.id} uses autoAdvance`);
    for (const el of Object.values(slide.elements)) {
      if (el.type === 'text') {
        if (!['auto-content', 'user-width'].includes(el.textSizing)) unsupported(`text ${el.id} requires textSizing`);
        if (!['measured', 'padded'].includes(el.boundTextLayout)) unsupported(`text ${el.id} requires boundTextLayout`);
      }
      if (el.type !== 'shape') continue;
      if (!['rect', 'ellipse', 'triangle', 'star', 'path', 'vector'].includes(el.shapeType)) unsupported(`shape ${el.id} has obsolete shapeType`);
      if (!['rect', 'ellipse', 'triangle', 'star', 'line', 'arrow', 'curve', 'polygon', 'icon'].includes(el.creationPreset)) unsupported(`shape ${el.id} requires creationPreset`);
      if ('startArrow' in el || 'endArrow' in el || 'bsplineDegree' in el) unsupported(`shape ${el.id} has obsolete path fields`);
      for (const binding of [el.startBinding, el.endBinding]) {
        if (binding == null) continue;
        if (!['aim', 'pinned'].includes(binding.mode) || 'anchor' in binding || 'focus' in binding
          || !Array.isArray(binding.fixedPoint) || binding.fixedPoint.length !== 2
          || binding.fixedPoint.some(v => !Number.isFinite(v) || v < 0 || v > 1)) unsupported(`connector ${el.id} requires an aim/pinned fixedPoint binding`);
      }
    }
  }
  return presentation;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid presentation: ${path} must be an object.`);
  }
  return value as RecordValue;
}
function orderedMap(value: unknown, order: unknown, path: string): RecordValue {
  const map = record(value, path);
  if (!Array.isArray(order) || order.some(id => typeof id !== 'string') || new Set(order).size !== order.length) {
    throw new Error(`Invalid presentation: ${path} order must contain unique string IDs.`);
  }
  for (const id of order) {
    if (!Object.hasOwn(map, id)) throw new Error(`Invalid presentation: ${path} order references missing ID "${id}".`);
  }
  for (const [id, entry] of Object.entries(map)) {
    if (record(entry, `${path}.${id}`).id !== id) throw new Error(`Invalid presentation: ${path}.${id} has a mismatched ID.`);
    if (!order.includes(id)) throw new Error(`Invalid presentation: ${path}.${id} is missing from its order.`);
  }
  return map;
}

// Validate native structure and references without rewriting input.
export function assertPresentation(value: unknown): Presentation {
  const p = record(value, 'root');
  for (const key of ['id', 'title']) {
    if (typeof p[key] !== 'string' || (key === 'id' && !p[key])) throw new Error(`Invalid presentation: ${key} must be a string.`);
  }
  for (const key of ['width', 'height', 'createdAt', 'updatedAt']) {
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || (['width', 'height'].includes(key) && p[key] <= 0)) {
      throw new Error(`Invalid presentation: ${key} must be a valid number.`);
    }
  }
  record(p.objects, 'objects'); const resources = record(p.resources, 'resources');
  const templates = record(p.templates, 'templates'); const theme = record(p.theme, 'theme');
  record(theme.colors, 'theme.colors'); record(theme.fonts, 'theme.fonts');
  const slides = orderedMap(p.slides, p.slideOrder, 'slides');
  const entries = [
    ...Object.entries(slides).map(([id, entry]) => ({ id, entry, isSlide: true })),
    ...Object.entries(templates).map(([id, entry]) => ({ id, entry, isSlide: false })),
  ];
  for (const { id, entry, isSlide } of entries) {
    const slide = record(entry, `slide/template ${id}`);
    const elements = orderedMap(slide.elements, slide.elementOrder, `elements of ${id}`);
    record(slide.background, `background of ${id}`);
    if (isSlide) record(slide.transition, `transition of ${id}`);
    for (const [eid, raw] of Object.entries(elements)) {
      const el = record(raw, `element ${eid}`);
      if (!['text', 'shape', 'image', 'group'].includes(el.type as string)) throw new Error(`Invalid presentation: element ${eid} has an unsupported type.`);
      const references: unknown[] = [];
      if (el.type === 'text') {
        if (typeof el.text !== 'string') throw new Error(`Invalid presentation: text of ${eid} must be a string.`);
        record(el.style, `style of ${eid}`);
        if (el.containerId != null && typeof el.containerId !== 'string') {
          throw new Error(`Invalid presentation: containerId of ${eid} must be a string or null.`);
        }
      }
      if (el.type === 'text' && el.containerId != null) references.push(el.containerId);
      if (el.type === 'shape') for (const key of ['startBinding', 'endBinding']) {
        if (el[key] != null) references.push(record(el[key], `${key} of ${eid}`).elementId);
      }
      if (el.type === 'group') {
        if (!Array.isArray(el.childIds)) throw new Error(`Invalid presentation: childIds of ${eid} must be an array.`);
        references.push(...el.childIds);
      }
      for (const ref of references) if (typeof ref !== 'string' || !Object.hasOwn(elements, ref)) {
        throw new Error(`Invalid presentation: element ${eid} references missing element "${String(ref)}" on ${id}.`);
      }
      if (el.type === 'image' && el.resourceId != null && (typeof el.resourceId !== 'string' || !Object.hasOwn(resources, el.resourceId))) {
        throw new Error(`Invalid presentation: image ${eid} references missing resource "${String(el.resourceId)}".`);
      }
    }
  }
  return assertCurrentPresentation(value as Presentation);
}
