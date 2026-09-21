import type { Presentation, Slide, SlideElement, ShapeElement, TextElement, ConnectorBinding } from '../types/presentation';
import { ANCHOR_TO_UV } from './connectorUtils';
import { generateId } from './idGenerator';

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
    slides[slideId] = { ...slide, elements: migrateBoundTextInElements(elements) };
  }
  return migrateAutoAdvanceToGroups({ ...p, slides });
}

/** Bound text (WS-2 Phase 4): a text element whose `containerId` doesn't
 *  resolve to an element ON THE SAME SLIDE is a dangling label — the
 *  container was deleted (or never copied to this keyframe) by a build that
 *  predates the lifecycle cascades. Dropping the key promotes it to free
 *  text, which loses nothing (a dangling label already rendered as free
 *  text; it just couldn't be selected sanely). Explicit `containerId: null`
 *  is normalised to absent. Idempotent: a clean slide's elements map is
 *  returned unchanged (same reference). Exported for tests. */
export function migrateBoundTextInElements(
  elements: Record<string, SlideElement>,
): Record<string, SlideElement> {
  let out: Record<string, SlideElement> | null = null;
  for (const [elId, el] of Object.entries(elements)) {
    if (el.type !== 'text') continue;
    const containerId = (el as TextElement).containerId;
    if (containerId === undefined) continue;
    if (containerId !== null && elements[containerId] !== undefined) continue;
    const { containerId: _dangling, ...rest } = el as TextElement;
    if (!out) out = { ...elements };
    out[elId] = rest as SlideElement;
  }
  return out ?? elements;
}

/** Slide-level rule (WS-4): the legacy per-slide `autoAdvance` flag becomes
 *  slide groups (timed chains). Each maximal run of consecutive
 *  `autoAdvance: true` slides PLUS the slide it advances into becomes one
 *  group (fresh groupId); the boolean flag is deleted everywhere while
 *  `autoAdvanceDelay` lives on as the per-slide hold. A trailing flag with
 *  no successor just loses the flag. Slides that already carry a groupId are
 *  never re-grouped, and a migrated deck carries no flags at all — so the
 *  pass is idempotent. */
function migrateAutoAdvanceToGroups(p: Presentation): Presentation {
  const hasFlags = Object.values(p.slides).some((s) => s.autoAdvance !== undefined);
  if (!hasFlags) return p;

  const slides = { ...p.slides };
  const order = p.slideOrder;
  const stripFlag = (id: string) => {
    if (slides[id]?.autoAdvance === undefined) return;
    const { autoAdvance: _flag, ...rest } = slides[id];
    slides[id] = rest as Slide;
  };

  let i = 0;
  while (i < order.length) {
    if (!slides[order[i]]?.autoAdvance) { i++; continue; }
    let j = i;
    while (j < order.length && slides[order[j]]?.autoAdvance) j++;
    const end = Math.min(j + 1, order.length); // the run + its landing slide
    const runIds = order.slice(i, end);
    if (runIds.length >= 2 && runIds.every((id) => !slides[id]?.groupId)) {
      const groupId = generateId();
      for (const id of runIds) {
        stripFlag(id);
        slides[id] = { ...slides[id], groupId };
      }
    } else {
      // Trailing flag with no successor, or a run overlapping an existing
      // group: just drop the legacy flags.
      for (const id of runIds) stripFlag(id);
    }
    i = end;
  }
  // Sweep leftover flags (explicit `autoAdvance: false`, orphan slides).
  for (const id of Object.keys(slides)) stripFlag(id);
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
 *  and the optional arrowheads), lift legacy `startArrow`/`endArrow`
 *  booleans into the typed `startHead`/`endHead` fields, then upgrade
 *  legacy anchor bindings to binding v2. */
function migrateShape(shape: ShapeElement): ShapeElement {
  let out = migrateHeads(migrateShapeType(shape));
  const startBinding = migrateBinding(out.startBinding);
  if (startBinding !== out.startBinding) out = { ...out, startBinding };
  const endBinding = migrateBinding(out.endBinding);
  if (endBinding !== out.endBinding) out = { ...out, endBinding };
  return out;
}

/** Legacy boolean arrowheads → typed heads. `true` becomes `'triangle'`
 *  (exactly the glyph the boolean used to render); `false` just vanishes
 *  (absent = 'none'). Decks that already carry typed heads keep them —
 *  a stray leftover boolean never overwrites a typed head. The booleans
 *  are always deleted, so the rule is idempotent (second pass sees no
 *  boolean and returns the same object). */
function migrateHeads(shape: ShapeElement): ShapeElement {
  const legacy = shape as ShapeElement & { startArrow?: boolean; endArrow?: boolean };
  if (legacy.startArrow === undefined && legacy.endArrow === undefined) return shape;
  const next = { ...legacy };
  if (next.startArrow !== undefined) {
    if (next.startArrow && next.startHead === undefined) next.startHead = 'triangle';
    delete next.startArrow;
  }
  if (next.endArrow !== undefined) {
    if (next.endArrow && next.endHead === undefined) next.endHead = 'triangle';
    delete next.endArrow;
  }
  return next;
}

function migrateShapeType(shape: ShapeElement): ShapeElement {
  const legacy = shape as ShapeElement & { bsplineDegree?: 2 | 3; endArrow?: boolean };
  switch (legacy.shapeType as string) {
    case 'line':
      return {
        ...shape,
        shapeType: 'path',
        curve: shape.curve ?? 'linear',
        closed: shape.closed ?? false,
      };
    case 'arrow':
      return {
        ...shape,
        shapeType: 'path',
        curve: shape.curve ?? 'linear',
        closed: shape.closed ?? false,
        // The defining difference vs 'line': an end head by default. An
        // explicit legacy boolean (either value) or an existing typed head
        // wins — migrateHeads folds those in right after this pass.
        ...(legacy.endArrow === undefined && shape.endHead === undefined
          ? { endHead: 'triangle' as const }
          : {}),
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
