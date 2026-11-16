import type {
  EasingType,
  ImageElement,
  Presentation,
  ShapeElement,
  SlideElement,
  TextElement,
  TransitionGroup,
  TransitionOptions,
} from '../types/presentation';
import { usePresentationStore } from '../store/presentationStore';
import { getActiveDoc } from '../collab/yDocAdapter';
import { yDocToJson } from '../collab/ySchema';
import { withMirroring } from '../utils/model/multiSlide';
import { withAutoDrawSuspended } from '../utils/paths/autoDraw';
import { createImageElement, createShapeElement, createTextElement } from '../utils/model/slideFactory';
import { deckTextStyle } from '../store/textDefaults';
import { hasContentSizing, measureUserText } from '../utils/text/userTextSizing';
import { FONT_FAMILIES, MATH_FONTS } from '../utils/text/fontRegistry';
import { applicable } from '../utils/animation/stickyEasings';
import { deckView, slideView, explainTransition } from './deckView';
import { renderSlidePng } from './renderSlide';
import { validateInput } from './validateInput';
import type { ImageBlock, JsonSchema, TextBlock, ToolSpec } from './providers/types';
import type { ChatAttachment } from './attachments';
import { loadImageFile } from '../utils/model/slideFactory';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../utils/constants';

/**
 * The agent's deck tools.
 *
 * Reads come from the live document (the Y.Doc when a collab session is
 * active, so a read right after a write never sees the store's not-yet-synced
 * copy). Writes go through presentationStore actions — the dual-path layer
 * the editor itself uses — inside `agentWrite`. Never touch ySchema from here.
 */

export interface ToolOutput {
  content: Array<TextBlock | ImageBlock>;
  isError?: boolean;
  /** One line for the chat panel. */
  summary: string;
}

export interface ToolContext {
  /** Called with the slide a tool is about to change. */
  onSlide?: (slideId: string) => void;
  /** Media the user attached in this conversation, by id. */
  attachments?: ReadonlyMap<string, ChatAttachment>;
}

/** The assistant's identity on comments it writes. */
export const ASSISTANT_AUTHOR = { id: 'assistant', name: 'Assistant', color: '#7c3aed', assistant: true } as const;

export interface DeckTool extends ToolSpec {
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
}

class ToolError extends Error {}

/** The current deck, exactly as the next write will see it. */
export function readPresentation(): Presentation {
  const doc = getActiveDoc();
  return doc ? yDocToJson(doc) as Presentation : usePresentationStore.getState().presentation;
}

/** Writes name their slide explicitly, so the selection-driven editor
 *  behaviours — multi-slide mirroring and auto-draw keyframe spawning — must
 *  not redirect or fan them out. */
export function agentWrite<T>(fn: () => T): T {
  return withMirroring(() => withAutoDrawSuspended(fn));
}

const store = () => usePresentationStore.getState();

const json = (value: unknown): TextBlock => ({ type: 'text', text: JSON.stringify(value) });

function requireSlide(p: Presentation, slideId: unknown) {
  const slide = typeof slideId === 'string' ? p.slides[slideId] : undefined;
  if (!slide) throw new ToolError(`No slide with id ${JSON.stringify(slideId)}. Call get_deck for the slide ids.`);
  return slide;
}

const slideLabel = (p: Presentation, slideId: string) => `slide ${p.slideOrder.indexOf(slideId) + 1}`;

// ── Schemas ──────────────────────────────────────────────────────────────

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SHAPE_TYPES = ['rect', 'ellipse', 'triangle', 'star', 'dot', 'path'] as const;
const HEADS = ['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline',
  'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'] as const;
const GROUPS: TransitionGroup[] = ['position', 'size', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth',
  'cornerRadius', 'fontSize', 'color', 'lineHeight', 'crop', 'resource', 'visibility', 'content',
  'controlPoints', 'startArrow', 'endArrow', 'morph'];
const EASINGS: EasingType[] = ['const', 'linear', 'ease', 'dissolve', 'fadeinout', 'typewriter', 'write', 'create',
  'extend', 'wipe', 'slidein', 'grow', 'iris', 'croplift', 'cropliftease', 'cropfade', 'cropfadeease', 'fadebyglyph'];

const num = (description?: string, minimum?: number, maximum?: number): JsonSchema =>
  ({ type: 'number', ...(description ? { description } : {}), ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
const str = (description?: string): JsonSchema => ({ type: 'string', ...(description ? { description } : {}) });
const oneOf = (values: readonly string[], description?: string): JsonSchema =>
  ({ type: 'string', enum: values, ...(description ? { description } : {}) });

const styleSchema: JsonSchema = {
  type: 'object',
  description: 'Text style; only the fields given change.',
  additionalProperties: false,
  properties: {
    fontFamily: oneOf(FONT_FAMILIES),
    mathFont: oneOf(MATH_FONTS.map(f => f.id), 'Font for $…$ math; omit to match fontFamily'),
    fontSize: num('px', 4, 400),
    fontWeight: oneOf(['normal', 'bold']),
    fontStyle: oneOf(['normal', 'italic']),
    textDecoration: oneOf(['none', 'underline', 'line-through']),
    color: str('CSS hex color'),
    align: oneOf(['left', 'center', 'right']),
    verticalAlign: oneOf(['top', 'middle', 'bottom']),
    lineHeight: num(undefined, 0.5, 4),
  },
};

const elementFields: Record<string, JsonSchema> = {
  name: str('Human-readable object name shown in the object list'),
  x: num('Left edge, slide units'),
  y: num('Top edge, slide units'),
  width: num('Box width. Text: omit for a single auto-sized line, give it to wrap at that width', 0),
  height: num('Box height. Ignored for free text (measured)', 0),
  rotation: num('Degrees'),
  opacity: num(undefined, 0, 1),
  visible: { type: 'boolean', description: 'false hides it on this keyframe (it can fade/animate in on a later one)' },
  text: str('Markdown-lite text: **bold**, *italic*, "- " bullets, $LaTeX$ math'),
  style: styleSchema,
  containerId: str('Bind this text as the label of a shape or arrow on the same slide'),
  shapeType: oneOf(SHAPE_TYPES),
  fill: str('Fill color, "" for none'),
  fillStyle: oneOf(['solid', 'hachure', 'crosshatch']),
  stroke: str('Stroke color, "" for none'),
  strokeWidth: num(undefined, 0, 100),
  cornerRadius: num('rect only', 0),
  points: { type: 'array', items: { type: 'number' }, description: 'path only: flat [x0,y0,x1,y1,…] RELATIVE to (x,y)' },
  closed: { type: 'boolean', description: 'path only: close into a polygon' },
  curve: oneOf(['linear', 'smooth', 'bspline2', 'bspline3', 'bezier'], 'path only'),
  startHead: oneOf(HEADS, 'path only'),
  endHead: oneOf(HEADS, 'path only'),
  strokeStyle: oneOf(['solid', 'dashed', 'dotted']),
  resourceId: str('image only: an existing resource id from get_deck'),
};

const addSpecSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: str('Reuse the id of an element from another slide to continue it as a keyframe (it animates); omit for a new element'),
    type: oneOf(['text', 'shape', 'image'], 'Required for new elements'),
    ...elementFields,
  },
};

const patchSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: str(), ...elementFields },
};

// ── Element construction ─────────────────────────────────────────────────

type Spec = Record<string, unknown>;

/** The element's instance on the nearest slide before `slideId`, else after. */
function findKeyframeSource(p: Presentation, slideId: string, id: string): SlideElement | undefined {
  const index = p.slideOrder.indexOf(slideId);
  for (let i = index - 1; i >= 0; i--) {
    const el = p.slides[p.slideOrder[i]]?.elements[id];
    if (el) return el;
  }
  for (let i = index + 1; i < p.slideOrder.length; i++) {
    const el = p.slides[p.slideOrder[i]]?.elements[id];
    if (el) return el;
  }
  return undefined;
}

function pointsBox(points: number[]) {
  let w = 0, h = 0;
  for (let i = 0; i + 1 < points.length; i += 2) {
    w = Math.max(w, points[i]);
    h = Math.max(h, points[i + 1]);
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

/** Copy spec fields onto an element; `style` merges. */
function applyFields(element: SlideElement, spec: Spec): SlideElement {
  const out = { ...element } as Record<string, unknown>;
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'id' || key === 'type' || key === 'name' || value === undefined) continue;
    if (key === 'style') out.style = { ...(element as TextElement).style, ...(value as object) };
    else out[key] = value;
  }
  return out as unknown as SlideElement;
}

function presetFor(shape: ShapeElement): ShapeElement['creationPreset'] {
  if (shape.shapeType !== 'path') return shape.shapeType as ShapeElement['creationPreset'];
  if (shape.closed) return 'polygon';
  if ((shape.endHead && shape.endHead !== 'none') || (shape.startHead && shape.startHead !== 'none')) return 'arrow';
  return shape.curve && shape.curve !== 'linear' ? 'curve' : 'line';
}

function checkElement(p: Presentation, slideId: string, el: SlideElement) {
  if (el.type === 'shape' && el.shapeType === 'path' && (!el.points || el.points.length < 4 || el.points.length % 2)) {
    throw new ToolError(`${el.id}: a path needs points [x0,y0,x1,y1,…] with at least two vertices`);
  }
  if (el.type === 'text' && el.containerId) {
    const container = p.slides[slideId]?.elements[el.containerId];
    if (!container || container.type !== 'shape') throw new ToolError(`${el.id}: containerId must name a shape on this slide`);
  }
  if (el.type === 'image' && el.resourceId && !p.resources[el.resourceId]) {
    throw new ToolError(`${el.id}: no resource ${el.resourceId}`);
  }
}

/** Free text gets the editor's own measured box: never a guessed height. */
async function measured<T extends SlideElement>(el: T): Promise<T> {
  if (el.type !== 'text' || !hasContentSizing(el)) return el;
  try {
    return { ...el, ...(await measureUserText(el)) };
  } catch {
    return el;
  }
}

async function buildElement(p: Presentation, slideId: string, spec: Spec): Promise<SlideElement> {
  const slide = p.slides[slideId];
  const id = spec.id as string | undefined;
  if (id !== undefined && !ID_PATTERN.test(id)) throw new ToolError(`Invalid id ${JSON.stringify(id)} (letters, digits, - and _)`);
  if (id && slide.elements[id]) {
    throw new ToolError(slide.elements[id].visible
      ? `${id} is already on this slide; use update_elements`
      : `${id} is on this slide but hidden; use update_elements with visible=true`);
  }

  const source = id ? findKeyframeSource(p, slideId, id) : undefined;
  let base: SlideElement;
  if (source) {
    if (spec.type && spec.type !== source.type) throw new ToolError(`${id} is a ${source.type} on other slides; keep the type (or use a new id)`);
    base = structuredClone(source);
  } else if (spec.type === 'text') {
    base = createTextElement({ text: '', textSizing: spec.width !== undefined ? 'user-width' : 'auto-content', style: deckTextStyle() });
  } else if (spec.type === 'shape') {
    const shapeType = (spec.shapeType as ShapeElement['shapeType'] | undefined) ?? 'rect';
    base = createShapeElement(shapeType);
  } else if (spec.type === 'image') {
    const resource = typeof spec.resourceId === 'string' ? p.resources[spec.resourceId] : undefined;
    base = createImageElement(resource?.id ?? null, resource?.originalWidth ?? 400, resource?.originalHeight ?? 300) as ImageElement;
  } else {
    throw new ToolError(id ? `No element ${id} on any slide; give a type to create it` : 'type is required for a new element');
  }

  let el = applyFields({ ...base, id: id ?? base.id }, spec);
  if (el.type === 'shape') {
    if (el.shapeType === 'path' && el.points && spec.width === undefined && spec.height === undefined) {
      el = { ...el, ...pointsBox(el.points) };
    }
    if (!source) el = { ...el, creationPreset: presetFor(el) };
  }
  if (el.type === 'text' && spec.width !== undefined && !source) el = { ...el, textSizing: 'user-width' };
  checkElement(p, slideId, el);
  return measured(el);
}

/** Does a newly created element look like an object the previous slide
 *  already has? Recreating an object under a new id cross-fades two copies
 *  instead of animating one, the commonest way to lose the keyframe model. */
function looksLike(a: SlideElement, b: SlideElement): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'text' && b.type === 'text') {
    const first = (t: string) => t.trim().split('\n')[0].trim().toLowerCase();
    if (first(a.text) && first(a.text) === first(b.text)) return true;
  }
  if (a.type === 'shape' && b.type === 'shape' && a.shapeType !== b.shapeType) return false;
  if (a.type === 'image' && b.type === 'image' && a.resourceId && a.resourceId === b.resourceId) return true;
  // Same kind of thing in nearly the same place at nearly the same size.
  const near = Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 24;
  const sameSize = Math.abs(a.width - b.width) < Math.max(24, a.width * 0.2) && Math.abs(a.height - b.height) < Math.max(24, a.height * 0.2);
  return near && sameSize;
}

function duplicateWarnings(p: Presentation, slideId: string, created: SlideElement[]): string[] {
  const index = p.slideOrder.indexOf(slideId);
  const prev = index > 0 ? p.slides[p.slideOrder[index - 1]] : undefined;
  if (!prev) return [];
  const current = p.slides[slideId];
  const warnings: string[] = [];
  for (const el of created) {
    const match = prev.elementOrder.map(id => prev.elements[id]).find(old => old && old.visible && old.id !== el.id && looksLike(old, el));
    if (!match) continue;
    const name = p.objects[match.id]?.name;
    const what = `${el.id} looks like ${match.id}${name ? ` ("${name}")` : ''} on the previous slide but has a new id, so playback will fade one out and the other in instead of animating it.`;
    warnings.push(current.elements[match.id]
      ? `${what} ${match.id} is already on this slide: edit it with update_elements and delete ${el.id}.`
      : `${what} Delete ${el.id} and add it again with id "${match.id}" (it continues the object; your fields override).`);
  }
  return warnings;
}

// ── Tools ────────────────────────────────────────────────────────────────

const getDeck: DeckTool = {
  name: 'get_deck',
  description: 'The deck outline: title, slide size, and every slide in order with its id, element count, first text and notes excerpt. Call this first.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  async run() {
    const p = readPresentation();
    const view = deckView(p);
    const resources = Object.values(p.resources).map(r => ({ id: r.id, name: r.name, type: r.type, width: r.originalWidth, height: r.originalHeight }));
    return { content: [json(resources.length ? { ...view, resources } : view)], summary: 'Read the deck outline' };
  },
};

const getSlide: DeckTool = {
  name: 'get_slide',
  description: 'One slide in full: its elements in z-order (back to front) with all non-default properties, background, notes and transition duration. Each element says whether it continues from the previous slide (same id, animates) or enters; exitsFromPrevious lists ids that disappear.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['slideId'], properties: { slideId: str() } },
  async run(input) {
    const p = readPresentation();
    requireSlide(p, input.slideId);
    return { content: [json(slideView(p, input.slideId as string))], summary: `Read ${slideLabel(p, input.slideId as string)}` };
  },
};

const renderSlide: DeckTool = {
  name: 'render_slide',
  description: 'Look at a slide as the audience sees it (PNG, 960×540). Use after editing to check layout, overflow and overlaps. With t in [0,1), shows the frame mid-transition from the previous slide. labels=true outlines every element with its id.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId'],
    properties: { slideId: str(), t: num('Transition progress from the previous slide', 0, 1), labels: { type: 'boolean' } },
  },
  async run(input) {
    const p = readPresentation();
    requireSlide(p, input.slideId);
    const data = await renderSlidePng(p, input.slideId as string, { t: input.t as number | undefined, labels: input.labels as boolean | undefined });
    const label = slideLabel(p, input.slideId as string);
    return {
      content: [{ type: 'image', mediaType: 'image/png', data }, { type: 'text', text: `${label}${input.t !== undefined ? ` at t=${input.t}` : ''}` }],
      summary: `Looked at ${label}${input.t !== undefined ? ` (t=${input.t})` : ''}`,
    };
  },
};

const explainTransitionTool: DeckTool = {
  name: 'explain_transition',
  description: 'What happens when the presenter advances INTO this slide from the previous one: which objects animate (and which properties, with which easing), which enter, which exit. Use it to check that an animation does what you intend — e.g. that a title or diagram continues rather than being replaced.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['slideId'], properties: { slideId: str() } },
  async run(input) {
    const p = readPresentation();
    requireSlide(p, input.slideId);
    return { content: [json(explainTransition(p, input.slideId as string))], summary: `Checked the transition into ${slideLabel(p, input.slideId as string)}` };
  },
};

const addSlide: DeckTool = {
  name: 'add_slide',
  description: 'Insert the next keyframe after afterSlideId (default: at the end). mode "copy" (the default, and almost always right) duplicates that slide with the SAME element ids, so whatever you then change on the new slide animates from the old state. mode "empty" starts a blank slide: a hard cut where nothing carries over — use it only for a genuine change of scene. Returns the new slide id.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { afterSlideId: str(), mode: oneOf(['copy', 'empty'], 'Default "copy"') },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const afterId = (input.afterSlideId as string | undefined) ?? p.slideOrder[p.slideOrder.length - 1];
    if (input.afterSlideId !== undefined) requireSlide(p, afterId);
    const afterIndex = p.slideOrder.indexOf(afterId);
    const copy = input.mode !== 'empty';
    const newId = agentWrite(() => copy
      ? store().addSlideWithMode(afterIndex, 'previous')
      : store().addEmptySlide(afterIndex + 1));
    if (!newId) throw new ToolError('Could not add the slide');
    ctx.onSlide?.(newId);
    const carried = copy ? (p.slides[afterId]?.elementOrder ?? []) : [];
    return {
      content: [json(copy
        ? { slideId: newId, index: afterIndex + 1, carriedOver: carried, note: 'Same ids as the previous slide: edit these elements (move, resize, recolor, change text, hide) to animate; do not recreate them.' }
        : { slideId: newId, index: afterIndex + 1, note: 'Empty slide: a cut. Nothing animates into it unless you add elements with ids from the previous slide.' })],
      summary: `Added slide ${afterIndex + 2}${copy ? ' (copy of the previous)' : ''}`,
    };
  },
};

const deleteSlide: DeckTool = {
  name: 'delete_slide',
  description: 'Delete a slide. The last remaining slide cannot be deleted.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['slideId'], properties: { slideId: str() } },
  async run(input) {
    const p = readPresentation();
    requireSlide(p, input.slideId);
    if (p.slideOrder.length <= 1) throw new ToolError('Cannot delete the only slide');
    const label = slideLabel(p, input.slideId as string);
    agentWrite(() => store().deleteSlide(input.slideId as string));
    return { content: [json({ deleted: input.slideId })], summary: `Deleted ${label}` };
  },
};

const moveSlide: DeckTool = {
  name: 'move_slide',
  description: 'Move a slide to a new 0-based index.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'toIndex'],
    properties: { slideId: str(), toIndex: { type: 'integer', minimum: 0 } },
  },
  async run(input) {
    const p = readPresentation();
    requireSlide(p, input.slideId);
    const order = p.slideOrder.filter(id => id !== input.slideId);
    const to = Math.min(input.toIndex as number, order.length);
    order.splice(to, 0, input.slideId as string);
    agentWrite(() => store().reorderSlides(order));
    return { content: [json({ slideOrder: order })], summary: `Moved a slide to position ${to + 1}` };
  },
};

const addElements: DeckTool = {
  name: 'add_elements',
  description: 'Add elements to a slide, on top of the existing ones, in the order given. Only for objects that are NEW to the story: anything already on the previous slide should be edited (update_elements on a copied slide), not added again. To bring back an object from an earlier slide, pass its id without a type: it continues as the same object (your fields override). For a new object give type, and preferably a readable id (e.g. "title", "box-a") to refer to it on later keyframes. Free text is measured automatically (omit height). Returns ids, measured boxes, and warnings when something duplicates an object on the previous slide.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'elements'],
    properties: { slideId: str(), elements: { type: 'array', items: addSpecSchema } },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    requireSlide(p, slideId);
    const specs = input.elements as Spec[];
    const built: SlideElement[] = [];
    const staged: Presentation = { ...p, slides: { ...p.slides, [slideId]: { ...p.slides[slideId], elements: { ...p.slides[slideId].elements } } } };
    for (const spec of specs) {
      const el = await buildElement(staged, slideId, spec);
      if (built.some(b => b.id === el.id)) throw new ToolError(`Duplicate id ${el.id}`);
      built.push(el);
      staged.slides[slideId].elements[el.id] = el;
    }
    ctx.onSlide?.(slideId);
    agentWrite(() => {
      store().addElements(slideId, built);
      specs.forEach((spec, i) => { if (typeof spec.name === 'string' && spec.name.trim()) store().renameObject(built[i].id, spec.name.trim()); });
      // Bound labels take their geometry from the container: nudge each
      // container through the store so its dependent-sync pass places them.
      for (const containerId of new Set(built.flatMap(el => el.type === 'text' && el.containerId ? [el.containerId] : []))) {
        const container = staged.slides[slideId].elements[containerId];
        if (container) store().updateElement(slideId, containerId, { x: container.x });
      }
    });
    const warnings = duplicateWarnings(staged, slideId, built.filter((el, i) => !specs[i].id || !findKeyframeSource(p, slideId, el.id)));
    const after = readPresentation().slides[slideId];
    const result = built.map(el => {
      const now = after?.elements[el.id] ?? el;
      return { id: el.id, x: Math.round(now.x), y: Math.round(now.y), width: Math.round(now.width), height: Math.round(now.height) };
    });
    return {
      content: [json(warnings.length ? { added: result, warnings } : { added: result })],
      summary: `Added ${built.length} element${built.length === 1 ? '' : 's'} to ${slideLabel(p, slideId)}`,
    };
  },
};

const updateElements: DeckTool = {
  name: 'update_elements',
  description: 'Change elements on one slide by id; only the fields given change (style merges). Changing an element here changes only this keyframe. Free text is re-measured.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'patches'],
    properties: { slideId: str(), patches: { type: 'array', items: patchSchema } },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    const slide = requireSlide(p, slideId);
    const updates: Array<{ elementId: string; changes: Partial<SlideElement> }> = [];
    const renames: Array<[string, string]> = [];
    for (const patch of input.patches as Spec[]) {
      const current = slide.elements[patch.id as string];
      if (!current) throw new ToolError(`No element ${patch.id} on this slide`);
      let next = applyFields(current, patch);
      if (next.type === 'shape' && current.type === 'shape') {
        if (next.shapeType === 'path' && patch.points && patch.width === undefined && patch.height === undefined) next = { ...next, ...pointsBox(next.points!) };
        if (patch.shapeType && patch.shapeType !== current.shapeType) next = { ...next, creationPreset: presetFor(next) };
      }
      if (next.type === 'text' && patch.width !== undefined && next.textSizing === 'auto-content') next = { ...next, textSizing: 'user-width' };
      checkElement(p, slideId, next);
      const textChanged = next.type === 'text' && ['text', 'style', 'width', 'textSizing'].some(k => k in patch);
      if (textChanged) next = await measured(next);
      const changes = Object.fromEntries(Object.entries(next)
        .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((current as unknown as Record<string, unknown>)[key]))) as Partial<SlideElement>;
      if (Object.keys(changes).length) updates.push({ elementId: current.id, changes });
      if (typeof patch.name === 'string' && patch.name.trim()) renames.push([current.id, patch.name.trim()]);
    }
    ctx.onSlide?.(slideId);
    agentWrite(() => {
      if (updates.length) store().updateElements(slideId, updates);
      for (const [id, name] of renames) store().renameObject(id, name);
    });
    return { content: [json({ updated: updates.map(u => u.elementId) })], summary: `Edited ${updates.length} element${updates.length === 1 ? '' : 's'} on ${slideLabel(p, slideId)}` };
  },
};

const deleteElements: DeckTool = {
  name: 'delete_elements',
  description: 'Remove elements from this slide ONWARD: they are hidden on this slide and every later one (so they exit here, with their visibility transition), and earlier slides keep them. An element hidden on every slide is removed from the deck. To hide something on just one keyframe, use update_elements with visible=false.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'ids'],
    properties: { slideId: str(), ids: { type: 'array', items: str() } },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    const slide = requireSlide(p, slideId);
    const ids = (input.ids as string[]).filter(id => slide.elements[id]);
    if (!ids.length) throw new ToolError('None of those ids are on this slide');
    ctx.onSlide?.(slideId);
    agentWrite(() => store().deleteElements(slideId, ids));
    return { content: [json({ deleted: ids })], summary: `Removed ${ids.length} element${ids.length === 1 ? '' : 's'} from ${slideLabel(p, slideId)}` };
  },
};

const setTransitions: DeckTool = {
  name: 'set_transitions',
  description: 'Set how an element animates INTO this slide from the previous one, per property group. Easing "none" clears a group. Not every easing fits every group/element (e.g. "write" is for text visibility/content, "create"/"extend" for shapes); invalid combinations are rejected with the allowed ones.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'elementId', 'transitions'],
    properties: {
      slideId: str(),
      elementId: str(),
      transitions: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(GROUPS.map(g => [g, oneOf([...EASINGS, 'none'])])),
      },
      visibilityOptions: {
        type: 'object',
        description: 'Options for the visibility easing, e.g. {"wipe":{"from":"left"}}, {"grow":{"anchor":"center"}}, {"create":{"tipDraw":true}}, {"stagger":{"lagRatio":0.2}}',
      },
      contentOptions: { type: 'object', description: 'Options for the content easing, e.g. {"write":{"undoFirst":true}}' },
    },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    const slide = requireSlide(p, slideId);
    const element = slide.elements[input.elementId as string];
    if (!element) throw new ToolError(`No element ${input.elementId} on this slide`);
    const transitions = { ...(element.transitions ?? {}) } as Record<string, unknown>;
    for (const [group, easing] of Object.entries(input.transitions as Record<string, string>)) {
      if (easing === 'none') { delete transitions[group]; continue; }
      if (!applicable(element, group as TransitionGroup, easing as EasingType)) {
        const allowed = EASINGS.filter(e => applicable(element, group as TransitionGroup, e));
        throw new ToolError(`${easing} does not apply to ${group} on this ${element.type}; allowed: ${allowed.join(', ') || 'none'}`);
      }
      transitions[group] = easing;
    }
    if (input.visibilityOptions) transitions.visibilityOptions = { ...(transitions.visibilityOptions as object), ...(input.visibilityOptions as TransitionOptions) };
    if (input.contentOptions) transitions.contentOptions = { ...(transitions.contentOptions as object), ...(input.contentOptions as TransitionOptions) };
    ctx.onSlide?.(slideId);
    agentWrite(() => store().updateElement(slideId, element.id, { transitions }));
    return { content: [json({ transitions })], summary: `Set transitions on ${slideLabel(p, slideId)}` };
  },
};

const setSlide: DeckTool = {
  name: 'set_slide',
  description: 'Change slide-level settings: background color, speaker notes, and the duration of the transition into this slide.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId'],
    properties: {
      slideId: str(),
      background: str('Solid background color'),
      notes: str('Speaker notes (replaces)'),
      transitionMs: num('Duration of the animation into this slide', 0, 20000),
    },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    const slide = requireSlide(p, slideId);
    ctx.onSlide?.(slideId);
    agentWrite(() => {
      if (typeof input.background === 'string') store().updateSlideBackground(slideId, { type: 'solid', color: input.background });
      if (typeof input.notes === 'string') store().updateSlideNotes(slideId, input.notes);
      if (typeof input.transitionMs === 'number') store().updateSlideTransition(slideId, { ...slide.transition, duration: input.transitionMs });
    });
    return { content: [json({ ok: true })], summary: `Updated ${slideLabel(p, slideId)} settings` };
  },
};

const setTitle: DeckTool = {
  name: 'set_title',
  description: 'Rename the deck.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: str() } },
  async run(input) {
    agentWrite(() => store().updateTitle(input.title as string));
    return { content: [json({ title: input.title })], summary: 'Renamed the deck' };
  },
};

const replyToComment: DeckTool = {
  name: 'reply_to_comment',
  description: 'Answer a review comment on a slide (shown to everyone in the comment thread), and resolve it when the request is done. Reply briefly: what you changed, or what you need from the author.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'commentId', 'text'],
    properties: { slideId: str(), commentId: str(), text: str(), resolve: { type: 'boolean', description: 'Mark the thread resolved' } },
  },
  async run(input) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    const slide = requireSlide(p, slideId);
    const comment = slide.comments?.[input.commentId as string];
    if (!comment) throw new ToolError(`No comment ${input.commentId} on this slide`);
    const rootId = comment.parentId ?? comment.id;
    store().addComment(slideId, {
      id: `c-${crypto.randomUUID().slice(0, 8)}`,
      parentId: rootId,
      ...(comment.elementId ? { elementId: comment.elementId } : {}),
      text: input.text as string,
      author: { ...ASSISTANT_AUTHOR },
      createdAt: Date.now(),
    });
    if (input.resolve) store().updateComment(slideId, rootId, { resolved: true });
    return { content: [json({ ok: true })], summary: `Replied to a comment on ${slideLabel(p, slideId)}${input.resolve ? ' and resolved it' : ''}` };
  },
};

const insertAttachment: DeckTool = {
  name: 'insert_attachment',
  description: 'Place an image the user attached in this chat onto a slide (full resolution, added to the deck\'s resources). Give x/y and optionally width; height follows the aspect ratio. Returns the new element id.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['slideId', 'attachmentId'],
    properties: { slideId: str(), attachmentId: str('e.g. "a1"'), x: num(), y: num(), width: num(undefined, 1), name: str() },
  },
  async run(input, ctx) {
    const p = readPresentation();
    const slideId = input.slideId as string;
    requireSlide(p, slideId);
    const attachment = ctx.attachments?.get(input.attachmentId as string);
    if (!attachment) throw new ToolError(`No attachment ${input.attachmentId} in this conversation`);
    if (attachment.kind !== 'image') throw new ToolError(`${attachment.id} is a PDF; only images can be placed`);
    const { resource, element, isExisting } = await loadImageFile(attachment.file, undefined, p.resources);
    const aspect = element.height / element.width;
    const width = (input.width as number | undefined) ?? element.width;
    const height = width * aspect;
    const placed = {
      ...element,
      width,
      height,
      x: (input.x as number | undefined) ?? (SLIDE_WIDTH - width) / 2,
      y: (input.y as number | undefined) ?? (SLIDE_HEIGHT - height) / 2,
    };
    ctx.onSlide?.(slideId);
    agentWrite(() => {
      if (!isExisting) store().addResource(resource);
      store().addElement(slideId, placed);
      if (typeof input.name === 'string' && input.name.trim()) store().renameObject(placed.id, input.name.trim());
    });
    return {
      content: [json({ id: placed.id, x: Math.round(placed.x), y: Math.round(placed.y), width: Math.round(width), height: Math.round(height) })],
      summary: `Placed ${attachment.name} on ${slideLabel(p, slideId)}`,
    };
  },
};

export const DECK_TOOLS: DeckTool[] = [
  getDeck, getSlide, renderSlide, explainTransitionTool,
  addSlide, deleteSlide, moveSlide,
  addElements, updateElements, deleteElements,
  setTransitions, setSlide, setTitle,
  replyToComment, insertAttachment,
];

/** Validate and run one tool call; never throws. */
export async function runTool(name: string, input: unknown, ctx: ToolContext = {}): Promise<ToolOutput> {
  const tool = DECK_TOOLS.find(t => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true, summary: `Unknown tool ${name}` };
  const problems = validateInput(input, tool.inputSchema);
  if (problems.length) {
    return {
      content: [{ type: 'text', text: `Invalid input:\n${problems.slice(0, 10).join('\n')}` }],
      isError: true,
      summary: `${name}: invalid input`,
    };
  }
  try {
    return await tool.run(input as Record<string, unknown>, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof ToolError)) console.error(`[agent] ${name} failed`, err);
    return { content: [{ type: 'text', text: message }], isError: true, summary: `${name} failed: ${message}` };
  }
}
