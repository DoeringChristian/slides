import type { Presentation, SlideElement, ShapeElement, ConnectorBinding } from '../types/presentation';
import { ANCHOR_TO_UV } from './connectorUtils';

/**
 * In-place upgrades for legacy presentation data.
 *
 * The slide format evolves; rather than versioning every load site, we run a
 * single migrator over the presentation tree right after deserialisation.
 * Each rule is idempotent — running it on already-current data is a no-op,
 * so applying the migrator twice (e.g. through Y.Doc sync) is safe.
 */
export function migratePresentation(p: Presentation): Presentation {
  const slides = { ...p.slides };
  for (const slideId of Object.keys(slides)) {
    const slide = slides[slideId];
    const elements: Record<string, SlideElement> = { ...slide.elements };
    for (const elId of Object.keys(elements)) {
      elements[elId] = migrateElement(elements[elId]);
    }
    slides[slideId] = { ...slide, elements };
  }
  return { ...p, slides };
}

export function migrateElement(el: SlideElement): SlideElement {
  if (el.type === 'shape') return migrateShape(el);
  return el;
}

/** Binding v2: a legacy 5-anchor binding becomes a `pinned` binding whose
 *  `fixedPoint` is the anchor's [u,v] on the target's bbox — resolving to
 *  the exact same point the anchor used to. The `anchor` key is dropped.
 *  Already-migrated (or new edge-mode) bindings pass through unchanged, so
 *  the rule is idempotent. */
function migrateBinding(
  binding: ConnectorBinding | null | undefined,
): ConnectorBinding | null | undefined {
  if (!binding || binding.anchor === undefined) return binding;
  const { anchor, ...rest } = binding;
  // A stray legacy anchor on an explicit edge-mode binding carries no
  // information — just drop it.
  if (binding.mode === 'edge') return rest;
  return {
    ...rest,
    mode: 'pinned',
    fixedPoint: binding.fixedPoint ?? ANCHOR_TO_UV[anchor] ?? [0.5, 0.5],
  };
}

/** Collapse legacy line/arrow/polygon/bspline shapeType into the unified
 *  `path` model (same geometry, different defaults for `curve`, `closed`,
 *  and the optional arrowheads), then upgrade legacy anchor bindings to
 *  binding v2. */
function migrateShape(shape: ShapeElement): ShapeElement {
  let out = migrateShapeType(shape);
  const startBinding = migrateBinding(out.startBinding);
  if (startBinding !== out.startBinding) out = { ...out, startBinding };
  const endBinding = migrateBinding(out.endBinding);
  if (endBinding !== out.endBinding) out = { ...out, endBinding };
  return out;
}

function migrateShapeType(shape: ShapeElement): ShapeElement {
  const legacy = shape as ShapeElement & { bsplineDegree?: 2 | 3 };
  switch (legacy.shapeType as string) {
    case 'line':
      return {
        ...shape,
        shapeType: 'path',
        curve: shape.curve ?? 'linear',
        startArrow: shape.startArrow ?? false,
        endArrow: shape.endArrow ?? false,
        closed: shape.closed ?? false,
      };
    case 'arrow':
      return {
        ...shape,
        shapeType: 'path',
        curve: shape.curve ?? 'linear',
        startArrow: shape.startArrow ?? false,
        endArrow: shape.endArrow ?? true,
        closed: shape.closed ?? false,
      };
    case 'polygon':
      return {
        ...shape,
        shapeType: 'path',
        curve: shape.curve ?? 'linear',
        closed: shape.closed ?? false,
      };
    case 'bspline': {
      const degree = legacy.bsplineDegree ?? 3;
      const next: ShapeElement = {
        ...shape,
        shapeType: 'path',
        curve: shape.curve ?? (degree === 2 ? 'bspline2' : 'bspline3'),
        closed: shape.closed ?? false,
      };
      // Strip the legacy degree field so future writes don't carry it around.
      delete (next as ShapeElement & { bsplineDegree?: 2 | 3 }).bsplineDegree;
      return next;
    }
    default:
      return shape;
  }
}
