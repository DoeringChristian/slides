import type { SlideElement } from '../../types/presentation';
import type { LayerFadeHint } from './interpolation';
import { getElementBounds } from '../geometry/geometry';
import { resizeElementBounds } from '../geometry/resizeGeometry';
import { layoutForElementSync, textHorizontalOffset } from '../text/userTextSizing';
import { textInsets } from '../text/boundTextLayout';
import { textVerticalOffset } from '../text/textLayout';

/**
 * Objects that fade together fade as one layer.
 *
 * Faded one by one, overlapping objects that all disappear show each other
 * through: at half way the top one is half transparent over the ones below.
 * Instead, a frame is the blend of two pictures of the slide — WITH the
 * fading objects (each at its full opacity, in its own place in the
 * stacking order) and WITHOUT them — weighted by how far the fade is:
 *
 *     frame = alpha · with + (1 − alpha) · without
 *
 * Where a fading object covers one that stays, it fades into that object,
 * never into another fading object below; a staying object above a fading
 * one keeps covering it. The renderer draws `with` as the frame itself
 * (fading objects at full opacity, so they keep their DOM identity) and lays
 * `without` over it at 1 − alpha: the slide background plus the staying
 * objects below the topmost fading one that reach into its area, clipped to
 * that area — elsewhere the two pictures are identical; objects above it are
 * drawn once, after the overlay.
 *
 * One alpha forms a layer (one easing, one direction — exits and entrances
 * run in separate halves); other fading objects keep fading on their own. A
 * staying video is never copied (a second player could not stay in sync):
 * fading objects reaching into one fade on their own instead.
 */

type Box = { x: number; y: number; width: number; height: number };

export interface LayerFadePlan {
  /** 0 → 1: how present the layer is. */
  alpha: number;
  /** The layer: drawn at their full opacity in the frame. */
  members: Set<string>;
  /** Their full opacities. */
  opacity: Map<string, number>;
  /** The area they cover (padded for strokes and ink); the overlay is
   *  clipped to it. */
  regions: Box[];
  /** The staying objects drawn again in the overlay, in frame order. */
  overlay: string[];
  /** Frame index the overlay goes before: everything from here on lies
   *  above the layer and is drawn once, over it. */
  drawnAfter: number;
}

/** Padding around an object's box for what it paints outside it (strokes,
 *  arrowheads, text ink, label halos), in slide pixels. */
const INK_PAD = 48;

/** An element's axis-aligned extent as drawn, padded for ink. */
export function inkBox(el: SlideElement): Box {
  let b: Box = el.type === 'shape' && el.shapeType === 'path' ? resizeElementBounds(el) : getElementBounds(el);
  // Text paints its laid-out lines, which can reach past a box that has not
  // caught up with them: the area is where the renderer puts them.
  const doc = el.type === 'text' ? layoutForElementSync(el) : null;
  if (el.type === 'text' && doc) {
    const pad = textInsets(el);
    const x = el.x + pad + textHorizontalOffset(el, doc.width);
    const y = el.y + pad + textVerticalOffset(el.style.verticalAlign, el.height, pad, doc.height);
    const x0 = Math.min(b.x, x), y0 = Math.min(b.y, y);
    // The box keeps its centre as the rotation pivot: grow it symmetrically.
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    const hw = Math.max(cx - x0, Math.max(b.x + b.width, x + doc.width) - cx), hh = Math.max(cy - y0, Math.max(b.y + b.height, y + doc.height) - cy);
    b = { x: cx - hw, y: cy - hh, width: 2 * hw, height: 2 * hh };
  }
  const r = (el.rotation ?? 0) * Math.PI / 180;
  const w = Math.abs(b.width * Math.cos(r)) + Math.abs(b.height * Math.sin(r));
  const h = Math.abs(b.width * Math.sin(r)) + Math.abs(b.height * Math.cos(r));
  const pad = INK_PAD + (el.type === 'shape' ? 3 * (el.strokeWidth ?? 0) : 0);
  return { x: b.x + b.width / 2 - w / 2 - pad, y: b.y + b.height / 2 - h / 2 - pad, width: w + 2 * pad, height: h + 2 * pad };
}

const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const key = (alpha: number) => Math.round(alpha * 1e6);

export function planLayerFade(elements: SlideElement[], isVideo: (el: SlideElement) => boolean): LayerFadePlan | null {
  const hintOf = (el: SlideElement) => (el as SlideElement & LayerFadeHint)._layerFade;
  const fading = elements.filter(el => { const h = hintOf(el); return h && h.alpha > 0 && h.alpha < 1; });
  if (!fading.length) return null;
  // The layer: the alpha most fading objects share. A fading video can be in
  // it — members are drawn once — only a staying one would need a copy.
  const classes = new Map<number, SlideElement[]>();
  for (const el of fading) {
    const k = key(hintOf(el)!.alpha);
    classes.set(k, [...(classes.get(k) ?? []), el]);
  }
  let layer = [...classes.values()].sort((a, b) => b.length - a.length)[0];
  const index = new Map(elements.map((el, i) => [el.id, i]));
  const boxes = new Map(elements.map(el => [el.id, inkBox(el)]));
  for (;;) {
    const members = new Set(layer.map(el => el.id));
    const regions = layer.map(el => boxes.get(el.id)!);
    // Only what lies below the topmost member differs between the pictures:
    // an object above it covers both alike (drawing it once, after the
    // overlay, is exact — even semi-transparent, as compositing over is
    // linear in what is underneath), so it is neither copied nor moved.
    const top = Math.max(...layer.map(el => index.get(el.id)!));
    const overlay = elements.slice(0, top).filter(el => !members.has(el.id) && regions.some(r => meets(r, boxes.get(el.id)!)));
    // A staying video in the overlay would need a second player: the members
    // reaching into it fade on their own instead. Each round drops at least
    // one member (a video is in the overlay only by meeting one), so this ends.
    const videos = overlay.filter(isVideo);
    if (videos.length) {
      layer = layer.filter(m => !videos.some(v => meets(boxes.get(m.id)!, boxes.get(v.id)!)));
      if (!layer.length) return null;
      continue;
    }
    // A lone fading object over nothing that stays is exactly a plain fade.
    if (layer.length === 1 && !overlay.length) return null;
    return {
      alpha: hintOf(layer[0])!.alpha,
      members,
      opacity: new Map(layer.map(el => [el.id, hintOf(el)!.opacity])),
      regions,
      overlay: overlay.map(el => el.id),
      drawnAfter: top + 1,
    };
  }
}
