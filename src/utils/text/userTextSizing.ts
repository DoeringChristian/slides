import type { TextElement } from '../../types/presentation';
import { textInsets } from './boundTextLayout';
import { getLayoutSync, layoutSvgText, type SvgTextDoc } from './textLayout';

/** Only free-standing text uses content sizing. */
export function hasContentSizing(element: TextElement): boolean {
  return !element.containerId;
}

export function textSizingWidth(element: TextElement): number {
  return element.textSizing === 'auto-content' && !element.containerId
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, element.width - textInsets(element) * 2);
}

export function textSizeFromDoc(element: TextElement, doc: SvgTextDoc): Pick<TextElement, 'width' | 'height'> {
  if (!hasContentSizing(element)) return { width: element.width, height: element.height };
  return {
    width: element.textSizing === 'auto-content' ? Math.max(1, doc.width) + textInsets(element) * 2 : element.width,
    height: Math.max(1, doc.height) + textInsets(element) * 2,
  };
}

/** Auto-content measures and paints the same unwrapped layout, even before
 * the live box width catches up. Alignment uses the measured content width,
 * never the effectively infinite measurement width. */
export async function layoutUserText(element: TextElement, rawLines?: Set<number>): Promise<SvgTextDoc> {
  const auto = element.textSizing === 'auto-content' && !element.containerId;
  const style = auto && element.style.align !== 'left' ? { ...element.style, align: 'left' as const } : element.style;
  const doc = await layoutSvgText(element.text, style, textSizingWidth(element), rawLines);
  if (!auto || element.style.align === 'left') return doc;
  // A sub-pixel cushion avoids a floating-point sum rewrapping the longest row.
  return layoutSvgText(element.text, element.style, doc.width + 0.001, rawLines);
}

export async function measureUserText(element: TextElement, rawLines?: Set<number>) {
  return textSizeFromDoc(element, await layoutUserText(element, rawLines));
}

/** Read the exact same two-pass auto layout as the shared SVG renderer. */
export function getUserTextLayoutSync(element: TextElement): SvgTextDoc | null {
  const auto = element.textSizing === 'auto-content' && !element.containerId;
  const style = auto && element.style.align !== 'left' ? { ...element.style, align: 'left' as const } : element.style;
  const doc = getLayoutSync(element.text, style, textSizingWidth(element));
  return auto && element.style.align !== 'left' && doc
    ? getLayoutSync(element.text, element.style, doc.width + 0.001) : doc;
}

/**
 * The layout the SVG renderer uses for an element.
 *
 * The auto-content / fixed-width branch lives here so the renderer and the
 * export baker ask for exactly the same layouts. If they diverged, a baked
 * deck would miss entries and silently fall back to live layout — which is
 * precisely what the bake exists to avoid.
 */
export function layoutForElement(element: TextElement, rawLines?: Set<number>): Promise<SvgTextDoc> {
  return element.textSizing === 'auto-content' && !element.containerId
    ? layoutUserText(element, rawLines)
    : layoutSvgText(element.text || '', element.style, textSizingWidth(element), rawLines);
}
