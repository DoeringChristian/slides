/**
 * Pre-computed text layouts for export.
 *
 * An exported deck re-rendered its text from scratch: the player parsed font
 * files with opentype.js and ran MathJax to turn `$…$` into outlines, which is
 * why a single HTML file had to carry both. But that work is deterministic —
 * the same text, style and width always produce the same glyph outlines — so
 * it can be done once at export time and shipped as data.
 *
 * What is baked is the whole `SvgTextDoc`, which already holds math outlines
 * alongside text glyphs (`textLayout` emits both into `doc.paths`). One
 * mechanism therefore covers prose and equations.
 *
 * The source text stays in the deck untouched. The bake is additive, so an
 * exported HTML can still be imported back and edited: the editor recomputes
 * layouts from the text, and a stale baked entry is simply never looked up,
 * because any edit changes the key.
 */

import type { Presentation, TextElement } from '../../types/presentation';
import {
  finishLayoutRecording, primeLayoutCache, startLayoutRecording, type SvgTextDoc,
} from './textLayout';
import { layoutForElement } from './userTextSizing';

/** Map of layout key → settled layout, as embedded in an exported deck. */
export type BakedLayouts = Record<string, SvgTextDoc>;

/**
 * Lay out every text element in the deck and return the result.
 *
 * Elements are laid out through the same helper the renderer uses, and the
 * keys come from the layout cache itself rather than being recomputed here —
 * auto-content text lays out twice, and a re-derived key set would drift.
 *
 * Deduplicates heavily in practice: a real 53-slide talk with 413 text
 * elements collapses to ~33 distinct layouts, because an element that is
 * unchanged across keyframes lays out once.
 */
export async function bakeLayouts(presentation: Presentation): Promise<BakedLayouts> {
  startLayoutRecording();
  try {
    const pending: Promise<unknown>[] = [];
    for (const slideId of presentation.slideOrder) {
      const slide = presentation.slides[slideId];
      if (!slide) continue;
      for (const element of Object.values(slide.elements)) {
        if (element.type !== 'text') continue;
        // A failed layout must not fail the export: that element falls back to
        // live layout in the player, which is the pre-bake behaviour.
        pending.push(layoutForElement(element as TextElement).catch(() => undefined));
      }
    }
    await Promise.all(pending);
  } catch {
    // Keep whatever settled. Recording must still be stopped below, or every
    // later editor layout would accumulate into an abandoned key set.
  }
  return finishLayoutRecording();
}

/** Install an exported deck's layouts before the first frame is rendered. */
export function installBakedLayouts(baked: Record<string, unknown> | undefined): number {
  if (!baked) return 0;
  // `Presentation.bakedText` is typed loosely so the data model does not
  // depend on the renderer's SvgPath type. The shape is this module's output.
  primeLayoutCache(baked as BakedLayouts);
  return Object.keys(baked).length;
}
