import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Presentation, Resource, Slide, SlideElement, TextElement } from '../types/presentation';
import { composeSlideFrame, layerFadeFrame, renderPresenterElement } from '../components/presenter/presenterUtils';
import { SVGBackground } from '../components/svg/SVGBackground';
import { renderElement as renderExportElement, svgToPngDataURL } from '../utils/io/svgRenderer';
import { layoutForElement } from '../utils/text/userTextSizing';
import { mediaDataUrls, slideImageIds } from '../media/embed';
import { MediaSourcesContext } from '../media/useMediaSource';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../utils/constants';

/**
 * Rasterise a slide — or the in-flight frame of the transition into it — so
 * the agent can see its own work.
 *
 * Shared-renderer rule: elements are drawn by the presenter's own leaf,
 * `renderPresenterElement`, over the frame `composeSlideFrame` produces, so
 * the agent sees what the audience sees. Text lays out asynchronously, so
 * every text element's layout is awaited first; the shared `SVGTextPaths`
 * then draws synchronously from the warm cache, which is what lets a static
 * render be complete.
 *
 * Images are the one exception: `RenderImage` emits an <img> inside a
 * foreignObject, which never loads when an SVG is rasterised through an
 * <img>. They go through the PNG exporter's `<image>` path instead, with
 * their sources inlined as data URLs.
 */

const LAYOUT_TIMEOUT_MS = 15000;

async function warmTextLayouts(elements: SlideElement[]): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const el of elements) {
    if (el.type !== 'text') continue;
    pending.push(layoutForElement(el as TextElement).catch(() => undefined));
    const dissolve = (el as TextElement & { _dissolveText?: { text: string } })._dissolveText;
    if (dissolve) pending.push(layoutForElement({ ...(el as TextElement), text: dissolve.text }).catch(() => undefined));
  }
  await Promise.race([
    Promise.all(pending),
    new Promise(resolve => setTimeout(resolve, LAYOUT_TIMEOUT_MS)),
  ]);
}

/** Data URLs of the images a frame draws: the render becomes a PNG, and an
 *  SVG drawn into a canvas loads no external media. */
function frameImageIds(elements: SlideElement[], resources: Record<string, Resource>, background: Slide['background']): Set<string> {
  return slideImageIds({ elements: Object.fromEntries(elements.map(el => [el.id, el])), background }, resources);
}

function hasEffect(el: SlideElement): boolean {
  // The exporter handles group crops itself; anything else is an animation
  // effect only the presenter leaf knows how to draw.
  return Object.keys(el).some(key => key.startsWith('_') && key !== '_labelMask' && key !== '_groupClips');
}

function labelOverlay(elements: SlideElement[]): string {
  return elements.filter(el => el.visible).map(el => {
    const text = el.id.replace(/[<>&"]/g, '');
    const w = text.length * 7 + 8;
    return `<g><rect x="${el.x}" y="${el.y - 16}" width="${w}" height="15" fill="#e11d48" opacity="0.85"/>`
      + `<text x="${el.x + 4}" y="${el.y - 5}" font-family="monospace" font-size="11" fill="#fff">${text}</text>`
      + `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="none" stroke="#e11d48" stroke-width="1" stroke-dasharray="4 3"/></g>`;
  }).join('');
}

export interface RenderOptions {
  /** Progress 0..1 of the transition from the previous slide into this one. */
  t?: number;
  /** Draw each element's id and box over the render. */
  labels?: boolean;
}

export async function renderSlideSvg(presentation: Presentation, slideId: string, options: RenderOptions = {}): Promise<string> {
  const slide = presentation.slides[slideId];
  if (!slide) throw new Error(`No slide ${slideId}`);
  const index = presentation.slideOrder.indexOf(slideId);
  const prev = index > 0 ? presentation.slides[presentation.slideOrder[index - 1]] : undefined;
  const animating = options.t !== undefined && options.t < 1 && !!prev;
  const frame = animating
    ? composeSlideFrame({ slideA: prev!, slideB: slide, isForward: true, animProgress: Math.max(0, options.t!), isAnimating: true })
    : composeSlideFrame({ slideA: slide, slideB: null, isForward: true, animProgress: 0, isAnimating: false });

  await warmTextLayouts(frame.renderedElements);
  const resources = presentation.resources;
  const sources = await mediaDataUrls(resources, frameImageIds(frame.renderedElements, resources, slide.background));
  const still = (node: React.ReactNode) => renderToStaticMarkup(createElement(MediaSourcesContext.Provider, { value: sources }, node));

  const background = animating
    ? `<rect x="0" y="0" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="${frame.bgColor}"/>`
    : still(createElement(SVGBackground, { background: slide.background, width: SLIDE_WIDTH, height: SLIDE_HEIGHT, resources }));
  const draw = (elements: SlideElement[]) => elements.map(el => (el.type === 'image' && !hasEffect(el)
    ? renderExportElement(el, resources, sources)
    : still(createElement(Fragment, null, renderPresenterElement(el, resources))))).join('');
  // Objects fading together fade as one layer, as in the presenter.
  const layered = layerFadeFrame(frame.renderedElements, resources);
  const overlay = layered.overlay;
  const split = overlay ? overlay.drawnAfter : layered.elements.length;
  const body = draw(layered.elements.slice(0, split)) + (overlay
    ? `<g opacity="${1 - overlay.alpha}"><defs><clipPath id="layer-fade">${overlay.regions.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`).join('')}</clipPath></defs>`
      + `<g clip-path="url(#layer-fade)"><rect x="${-SLIDE_WIDTH}" y="${-SLIDE_HEIGHT}" width="${3 * SLIDE_WIDTH}" height="${3 * SLIDE_HEIGHT}" fill="${frame.bgColor}"/>${draw(overlay.elements)}</g></g>`
    : '') + draw(layered.elements.slice(split));

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}">`
    + background + body + (options.labels ? labelOverlay(frame.renderedElements) : '') + '</svg>';
}

/** PNG as base64 (no data-URL prefix), at slide resolution. */
export async function renderSlidePng(presentation: Presentation, slideId: string, options: RenderOptions = {}): Promise<string> {
  const svg = await renderSlideSvg(presentation, slideId, options);
  const dataUrl = await svgToPngDataURL(svg, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, pixelRatio: 1 });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
