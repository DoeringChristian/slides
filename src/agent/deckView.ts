import type { Presentation, Slide, SlideElement, TransitionGroup } from '../types/presentation';
import { transitionPropertiesDiffer } from '../utils/animation/transitionProperties';
import { defaultEasingFor } from '../utils/animation/interpolation';
import { DEFAULT_TEXT_STYLE } from '../utils/constants';

/**
 * Compact, model-facing views of the deck.
 *
 * Every token of deck JSON the model reads is context it cannot spend on the
 * task, so views drop defaults, editor bookkeeping and noise, round
 * coordinates, and add the one fact the raw data hides: whether an element
 * continues from the previous keyframe (same id → it animates) or enters.
 */

const round = (n: number) => Math.round(n * 10) / 10;

/** Fields that are editor bookkeeping, not content the model should edit. */
const HIDDEN_FIELDS = new Set([
  'locked', 'boundTextLayout', 'boundTextBaselineHeight', 'creationPreset', 'geometry',
]);

const ELEMENT_DEFAULTS: Record<string, unknown> = {
  rotation: 0,
  opacity: 1,
  visible: true,
  fillStyle: 'solid',
  strokeStyle: 'solid',
  startHead: 'none',
  endHead: 'none',
  closed: false,
  curve: 'linear',
  containerId: null,
  startBinding: null,
  endBinding: null,
  cropGroupId: null,
};

function roundDeep(value: unknown): unknown {
  if (typeof value === 'number') return round(value);
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)]));
  }
  return value;
}

export function compactElement(element: SlideElement, name?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { id: element.id, type: element.type };
  if (name) out.name = name;
  for (const [key, value] of Object.entries(element)) {
    if (key === 'id' || key === 'type' || key.startsWith('_') || HIDDEN_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    if (key in ELEMENT_DEFAULTS && JSON.stringify(ELEMENT_DEFAULTS[key]) === JSON.stringify(value)) continue;
    if (key === 'style') {
      const style = Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([k, v]) => (DEFAULT_TEXT_STYLE as Record<string, unknown>)[k] !== v));
      if (Object.keys(style).length) out.style = style;
      continue;
    }
    if (key === 'transitions' && value && Object.keys(value).length === 0) continue;
    if (key === 'objectGroupIds' && Array.isArray(value) && value.length === 0) continue;
    out[key] = roundDeep(value);
  }
  if (element.type === 'shape' && element.shapeType === 'vector') out.icon = element.geometry?.provenance?.icon ?? 'vector';
  return out;
}

export function slideIndex(presentation: Presentation, slideId: string): number {
  return presentation.slideOrder.indexOf(slideId);
}

function previousSlide(presentation: Presentation, slideId: string): Slide | null {
  const i = slideIndex(presentation, slideId);
  return i > 0 ? presentation.slides[presentation.slideOrder[i - 1]] ?? null : null;
}

function firstText(slide: Slide): string | undefined {
  for (const id of slide.elementOrder) {
    const el = slide.elements[id];
    if (el?.type === 'text' && el.visible && el.text.trim()) return excerpt(el.text, 60);
  }
  return undefined;
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function deckView(presentation: Presentation): Record<string, unknown> {
  return {
    title: presentation.title,
    size: { width: presentation.width, height: presentation.height },
    slides: presentation.slideOrder.map((id, index) => {
      const slide = presentation.slides[id];
      if (!slide) return { index, id, missing: true };
      const entry: Record<string, unknown> = { index, id, elements: slide.elementOrder.length };
      const text = firstText(slide);
      if (text) entry.text = text;
      if (slide.notes.trim()) entry.notes = excerpt(slide.notes, 60);
      if (slide.hidden) entry.hidden = true;
      const carried = continuity(presentation, id);
      if (carried) entry.fromPrevious = `${carried.continues} continue, ${carried.new} new`;
      if (slide.groupId) entry.autoPlayGroup = slide.groupId;
      return entry;
    }),
  };
}

export function slideView(presentation: Presentation, slideId: string): Record<string, unknown> | null {
  const slide = presentation.slides[slideId];
  if (!slide) return null;
  const prev = previousSlide(presentation, slideId);
  const elements = slide.elementOrder
    .map(id => slide.elements[id])
    .filter((el): el is SlideElement => Boolean(el))
    .map(el => {
      const view = compactElement(el, presentation.objects[el.id]?.name);
      if (prev) view.keyframe = prev.elements[el.id] ? 'continues' : 'enters';
      return view;
    });
  const exits = prev ? prev.elementOrder.filter(id => !slide.elements[id]) : [];
  const view: Record<string, unknown> = {
    id: slide.id,
    index: slideIndex(presentation, slideId),
    background: slide.background,
    transitionMs: slide.transition.duration,
    elements,
  };
  if (exits.length) view.exitsFromPrevious = exits;
  const comments = openComments(slide);
  if (comments.length) view.comments = comments;
  if (slide.notes) view.notes = slide.notes;
  if (slide.hidden) view.hidden = true;
  return view;
}

/** Unresolved comment threads on a slide, oldest first, replies inline. */
export function openComments(slide: Slide): Array<Record<string, unknown>> {
  const all = Object.values(slide.comments ?? {}).sort((a, b) => a.createdAt - b.createdAt);
  return all
    .filter(c => !c.parentId && !c.resolved)
    .map(c => {
      const thread: Record<string, unknown> = { id: c.id, author: c.author.name, text: c.text };
      if (c.elementIds?.length) thread.elementIds = c.elementIds;
      if (c.region) thread.region = { x: Math.round(c.region.x), y: Math.round(c.region.y), width: Math.round(c.region.width), height: Math.round(c.region.height) };
      const replies = all.filter(r => r.parentId === c.id).map(r => ({ author: r.author.name, text: r.text }));
      if (replies.length) thread.replies = replies;
      return thread;
    });
}

const GROUPS: TransitionGroup[] = ['position', 'size', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth',
  'cornerRadius', 'fontSize', 'color', 'lineHeight', 'crop', 'resource', 'content', 'controlPoints',
  'startArrow', 'endArrow', 'morph'];

const shown = (el: SlideElement | undefined): boolean => !!el && el.visible;

/**
 * What playback does when advancing INTO `slideId`, per element: which
 * objects move or change (and with which easing), which enter, which exit.
 * The keyframe model in words, built on the same diff and default-easing
 * logic the editor's transition panel uses.
 */
export function explainTransition(presentation: Presentation, slideId: string): Record<string, unknown> | null {
  const slide = presentation.slides[slideId];
  if (!slide) return null;
  const index = presentation.slideOrder.indexOf(slideId);
  const prev = index > 0 ? presentation.slides[presentation.slideOrder[index - 1]] : undefined;
  if (!prev) return { slide: index + 1, note: 'First slide: nothing animates into it; every visible element is simply shown.' };
  const name = (id: string) => presentation.objects[id]?.name;
  const label = (id: string) => (name(id) ? `${id} ("${name(id)}")` : id);
  const animates: string[] = [];
  const enters: string[] = [];
  const exits: string[] = [];
  const unchanged: string[] = [];
  const ids = [...new Set([...prev.elementOrder, ...slide.elementOrder])];
  for (const id of ids) {
    const a = prev.elements[id];
    const b = slide.elements[id];
    if (!shown(a) && shown(b)) {
      const easing = b!.transitions?.visibility ?? defaultEasingFor('visibility', b);
      enters.push(`${label(id)} — ${a ? 'hidden before, revealed' : 'new'}, visibility: ${easing}`);
      continue;
    }
    if (shown(a) && !shown(b)) {
      const target = (b ?? a)!;
      const easing = target.transitions?.visibility ?? defaultEasingFor('visibility', target);
      exits.push(`${label(id)} — ${b ? 'hidden here' : 'not on this slide'}, visibility: ${easing}`);
      continue;
    }
    if (!a || !b || !shown(a) || !shown(b)) continue;
    const changes = GROUPS
      .filter(group => transitionPropertiesDiffer(a, b, group))
      .map(group => `${group} (${b.transitions?.[group as keyof typeof b.transitions] as string ?? defaultEasingFor(group, b)})`);
    if (changes.length) animates.push(`${label(id)}: ${changes.join(', ')}`);
    else unchanged.push(id);
  }
  return {
    slide: index + 1,
    durationMs: slide.transition.duration,
    animates,
    enters,
    exits,
    unchangedCount: unchanged.length,
    ...(animates.length === 0 && unchanged.length === 0 && enters.length > 0
      ? { note: 'Nothing carries over from the previous slide: it is a cut, not an animation. Reuse ids from the previous slide to animate.' }
      : {}),
  };
}

/** How many of a slide's visible elements continue from the previous one. */
export function continuity(presentation: Presentation, slideId: string): { continues: number; new: number } | null {
  const index = presentation.slideOrder.indexOf(slideId);
  const slide = presentation.slides[slideId];
  const prev = index > 0 ? presentation.slides[presentation.slideOrder[index - 1]] : undefined;
  if (!slide || !prev) return null;
  let continues = 0, fresh = 0;
  for (const id of slide.elementOrder) {
    if (!shown(slide.elements[id])) continue;
    if (prev.elements[id]) continues++; else fresh++;
  }
  return { continues, new: fresh };
}
