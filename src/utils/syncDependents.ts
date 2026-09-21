/**
 * Mutation-time dependent-geometry sync (WS-2 Phase 4).
 *
 * ONE pass, run from all four updateElement/updateElements store branches
 * (JSON + Y), that keeps every element which *depends* on another element's
 * geometry consistent after a mutation:
 *
 *   1. Connector rebinds — delegated to `rebindAfterElementsMoved` in
 *      connectorUtils (unchanged semantics).
 *   2. Bound-text follows — a TextElement with `containerId` tracks its
 *      container: the label KEEPS ITS OWN hug-the-text size (Excalidraw
 *      model — the box hugs the laid-out text, sized by `fitLabelToDoc`
 *      from the measured layout doc), shapes recenter it on the container's
 *      bbox center with width capped at `container.width −
 *      2·BOUND_TEXT_PADDING`; arrows/paths keep the label centered on the
 *      arc-length midpoint. Labels of connectors that were re-solved by
 *      step 1 follow the POST-rebind geometry, so an arrow label keeps
 *      riding the arrow when the arrow's bound target moves.
 *
 * Everything here is pure and DOM-free (unit-tested in
 * syncDependents.test.ts). The store call sites apply the returned changes
 * through their own path (object spread vs applyChangesToYElement), which is
 * what keeps the two collab paths semantically equivalent.
 */
import type { Slide, SlideElement, ShapeElement, TextElement } from '../types/presentation';
import { rebindAfterElementsMoved } from './connectorUtils';
import { pathArcLength, pointAtArcLength } from './pathShapes';
import { createTextElement } from './slideFactory';
import { DEFAULT_TEXT_STYLE, TEXT_BOX_PADDING } from './constants';

/** Gap kept between a container's edge and its bound label on each side. */
export const BOUND_TEXT_PADDING = 8;
/** A bound label never shrinks narrower than this. */
export const MIN_LABEL_WIDTH = 40;
/** Max label width for arrow/path containers (no box to derive it from). */
export const PATH_LABEL_WIDTH = 160;

const EPS = 1e-6;

export interface DependentSync {
  elementId: string;
  changes: Partial<SlideElement>;
}

// =============================================================================
// Bound-text lookup (no persisted reverse index — scan the slide)
// =============================================================================

/** First text element on the slide bound to `containerId`, in z-order. */
export function findBoundText(slide: Slide, containerId: string): TextElement | null {
  return findBoundTextIn(slide.elements, slide.elementOrder, containerId);
}

export function findBoundTextIn(
  elements: Record<string, SlideElement>,
  elementOrder: readonly string[],
  containerId: string,
): TextElement | null {
  for (const id of elementOrder) {
    const el = elements[id];
    if (el && el.type === 'text' && (el as TextElement).containerId === containerId) {
      return el as TextElement;
    }
  }
  return null;
}

/**
 * Expand a set of element ids with the ids of any bound texts whose container
 * is in the set (deterministic: labels appended in elementOrder order — both
 * store paths must produce identical id sequences). Used by the lifecycle
 * cascades (delete / hide / copy).
 */
export function expandWithBoundTexts(
  elements: Record<string, SlideElement>,
  elementOrder: readonly string[],
  ids: readonly string[],
): string[] {
  const set = new Set(ids);
  const out = [...ids];
  for (const id of elementOrder) {
    const el = elements[id];
    if (!el || el.type !== 'text') continue;
    const cid = (el as TextElement).containerId;
    if (cid && set.has(cid) && !set.has(id)) {
      set.add(id);
      out.push(id);
    }
  }
  return out;
}

// =============================================================================
// Label placement math
// =============================================================================

function isPathContainer(el: SlideElement): el is ShapeElement {
  return (
    el.type === 'shape' &&
    (el as ShapeElement).shapeType === 'path' &&
    ((el as ShapeElement).points?.length ?? 0) >= 4
  );
}

/** Absolute slide coords of the arc-length midpoint of a path container
 *  (points are relative to the element's x/y). Null for degenerate paths. */
export function pathLabelCenter(container: ShapeElement): { x: number; y: number } | null {
  const pts = container.points;
  if (!pts || pts.length < 4) return null;
  const curve = container.curve ?? 'linear';
  const closed = container.closed ?? false;
  const total = pathArcLength(pts, curve, closed, container.tangents);
  const mid = pointAtArcLength(pts, curve, closed, total / 2, container.tangents);
  if (!mid) return null;
  return { x: container.x + mid.x, y: container.y + mid.y };
}

/** Anchor point a bound label is centered on: arc-length midpoint for path
 *  containers (bbox center as degenerate fallback), bbox center otherwise. */
function labelAnchorFor(container: SlideElement): { x: number; y: number } {
  if (isPathContainer(container)) {
    const mid = pathLabelCenter(container as ShapeElement);
    if (mid) return mid;
  }
  return { x: container.x + container.width / 2, y: container.y + container.height / 2 };
}

/**
 * Widest a bound label's ELEMENT box may get (Excalidraw model: the box hugs
 * the text, this is the hug's cap — and therefore the width the text WRAPS
 * at). Shapes: container width minus the edge gap on each side; arrows/paths
 * have no box to derive it from and use the fixed PATH_LABEL_WIDTH.
 */
export function maxLabelWidthFor(container: SlideElement): number {
  if (isPathContainer(container)) return PATH_LABEL_WIDTH;
  return Math.max(MIN_LABEL_WIDTH, container.width - 2 * BOUND_TEXT_PADDING);
}

/** The text wrap width inside a bound label's box: the max element width
 *  minus the text element's own inner padding. Every consumer that lays a
 *  label out for FITTING (editor canvas refit, edit overlay) must wrap at
 *  this width; the element box then shrinks to the laid-out extent. */
export function labelWrapWidthFor(container: SlideElement): number {
  return Math.max(1, maxLabelWidthFor(container) - 2 * TEXT_BOX_PADDING);
}

export interface LabelFit {
  /** Hug-the-text label box (x/y/width/height), or null when already fitted. */
  label: Partial<TextElement> | null;
  /** Grow-only container change so label + gap still fit, or null. */
  container: Partial<SlideElement> | null;
}

/** Epsilon for measured-layout fitting (sub-pixel layout jitter is noise). */
const FIT_EPS = 0.5;

/**
 * Excalidraw-style hug-the-text label box from a measured layout doc.
 * `doc` must come from laying the label's text out at
 * `labelWrapWidthFor(container)` (SvgTextDoc.width/.height — math spans
 * contribute to both, so LaTeX labels size correctly). Pure math, no DOM:
 * the caller measures, this fits.
 *
 *   label.width  = doc.width + inner padding, clamped to
 *                  [MIN_LABEL_WIDTH, maxLabelWidthFor(container)]
 *   label.height = doc.height + inner padding
 *   x/y          = centered on the container anchor (bbox center for shapes,
 *                  arc-length midpoint for paths)
 *   container    = grows (never shrinks) when the wrapped text truly exceeds
 *                  its inner height; symmetric so its center stays put.
 */
export function fitLabelToDoc(
  container: SlideElement,
  label: TextElement,
  doc: { width: number; height: number },
): LabelFit {
  const width = Math.min(
    Math.max(MIN_LABEL_WIDTH, doc.width + 2 * TEXT_BOX_PADDING),
    maxLabelWidthFor(container),
  );
  const height = doc.height + 2 * TEXT_BOX_PADDING;
  const anchor = labelAnchorFor(container);
  const x = anchor.x - width / 2;
  const y = anchor.y - height / 2;

  const labelChanged =
    Math.abs(x - label.x) > FIT_EPS ||
    Math.abs(y - label.y) > FIT_EPS ||
    Math.abs(width - label.width) > FIT_EPS ||
    Math.abs(height - label.height) > FIT_EPS;

  let containerChanges: Partial<SlideElement> | null = null;
  if (!isPathContainer(container)) {
    const containerNeeded = height + 2 * BOUND_TEXT_PADDING;
    if (containerNeeded > container.height + FIT_EPS) {
      containerChanges = {
        height: containerNeeded,
        y: container.y - (containerNeeded - container.height) / 2,
      };
    }
  }

  return {
    label: labelChanged ? { x, y, width, height } : null,
    container: containerChanges,
  };
}

/**
 * Geometry changes that keep `label` attached to `container`, or null when
 * the label already sits where it should (epsilon compare — no-op writes
 * would spam undo/collab history).
 *
 * The label keeps its OWN hug-the-text size (`fitLabelToDoc` owns sizing —
 * this pure pass has no layout doc); it is only recentred on the container
 * anchor, with the width capped at the container's inner width so a
 * container shrink can't leave the label sticking out.
 */
export function boundLabelChangesFor(
  container: SlideElement,
  label: TextElement,
): Partial<TextElement> | null {
  const width = Math.min(label.width, maxLabelWidthFor(container));
  const anchor = labelAnchorFor(container);
  const x = anchor.x - width / 2;
  const y = anchor.y - label.height / 2;
  if (
    Math.abs(x - label.x) < EPS &&
    Math.abs(y - label.y) < EPS &&
    Math.abs(width - label.width) < EPS
  ) {
    return null;
  }
  return Math.abs(width - label.width) < EPS ? { x, y } : { x, y, width };
}

/** Fresh empty bound label for a container: a SMALL box (the text hugs into
 *  it as it's typed — the refit pass grows it), centered per the placement
 *  rules above (bbox center for shapes, arc midpoint for paths). */
export function createBoundLabel(container: SlideElement): TextElement {
  const height =
    DEFAULT_TEXT_STYLE.fontSize * DEFAULT_TEXT_STYLE.lineHeight + 2 * TEXT_BOX_PADDING;
  const width = Math.min(MIN_LABEL_WIDTH, maxLabelWidthFor(container));
  const center = labelAnchorFor(container);
  return createTextElement({
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    text: '',
    containerId: container.id,
    style: { ...DEFAULT_TEXT_STYLE, align: 'center', verticalAlign: 'middle' },
  });
}

// =============================================================================
// THE sync pass
// =============================================================================

/**
 * After some elements moved / resized / rotated / had their points edited,
 * compute every dependent-geometry patch on the slide: connector rebinds
 * (see `rebindAfterElementsMoved`) plus bound-text follows. `elements` must
 * be the POST-mutation snapshot; `movedIds` the elements whose geometry
 * changed this mutation. Connectors that get re-solved count as moved for
 * the label pass (labels follow the post-rebind arrow geometry).
 *
 * One shared implementation for all four store call sites (updateElement /
 * updateElements × Y / JSON) — neither path may inline its own variant.
 */
export function syncDependentsAfterMutation(
  elements: Record<string, SlideElement>,
  elementOrder: readonly string[],
  movedIds: ReadonlySet<string>,
): DependentSync[] {
  if (movedIds.size === 0) return [];

  const rebinds = rebindAfterElementsMoved(elements, elementOrder, movedIds);
  const results: DependentSync[] = rebinds.map((r) => ({
    elementId: r.elementId,
    changes: r.changes as Partial<SlideElement>,
  }));

  // Post-rebind working snapshot: labels must follow where the arrow ENDED
  // UP, not where it started.
  let working = elements;
  let effectiveMoved: ReadonlySet<string> = movedIds;
  if (rebinds.length > 0) {
    working = { ...elements };
    const grown = new Set(movedIds);
    for (const r of rebinds) {
      working[r.elementId] = { ...working[r.elementId], ...r.changes } as SlideElement;
      grown.add(r.elementId);
    }
    effectiveMoved = grown;
  }

  for (const id of elementOrder) {
    const el = working[id];
    if (!el || el.type !== 'text') continue;
    const label = el as TextElement;
    const cid = label.containerId;
    if (!cid || !effectiveMoved.has(cid)) continue;
    // A label that itself moved as part of this mutation still follows its
    // container when the container moved too (pure translation is a no-op
    // by the epsilon check; anything else re-anchors it).
    const container = working[cid];
    if (!container) continue;
    const changes = boundLabelChangesFor(container, label);
    if (changes) results.push({ elementId: id, changes });
  }

  return results;
}

// =============================================================================
// Arrow-label masking (synthetic render hint)
// =============================================================================

/** Synthetic hint attached to a path ShapeElement (`_labelMask`) telling the
 *  shared RenderShape to paint a background-coloured rect over the shaft
 *  under the label, so arrow labels read like Excalidraw's. */
export interface LabelMask {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

type MaskableShape = ShapeElement & { _labelMask?: LabelMask };

/**
 * Attach `_labelMask` hints to path elements that have a visible, non-empty
 * bound label in `elements`. `bgColor` is the slide's background colour
 * (solid backgrounds; callers fall back to white for gradient/image
 * backgrounds — accepted limitation). Returns the same array when nothing
 * needs masking. Pure — safe for editor, presenter and export callers.
 */
export function attachLabelMasks(elements: SlideElement[], bgColor: string): SlideElement[] {
  let masks: Map<string, LabelMask> | null = null;
  for (const el of elements) {
    if (el.type !== 'text') continue;
    const t = el as TextElement;
    if (!t.containerId || t.visible === false) continue;
    if ((t.text ?? '').trim() === '') continue;
    if (!masks) masks = new Map();
    masks.set(t.containerId, {
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
      color: bgColor,
    });
  }
  if (!masks) return elements;
  const found = masks;
  return elements.map((el) => {
    if (el.type === 'shape' && (el as ShapeElement).shapeType === 'path') {
      const m = found.get(el.id);
      if (m) return { ...(el as ShapeElement), _labelMask: m } as MaskableShape;
    }
    return el;
  });
}
