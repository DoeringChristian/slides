import type { SlideElement } from '../../types/presentation';
import type { ElementBounds } from '../../hooks/useAlignmentGuides';
import { getUserTextLayoutSync } from '../text/userTextSizing';
import { textInsets } from '../text/boundTextLayout';
import { textVerticalOffset } from '../text/textLayout';
import { visualExtent } from '../editor/marqueeSelection';

/** An element's snap box: what it covers as drawn — a rotated element by
 * its rotated outline's axis-aligned extent, not its unrotated box.
 *
 * Unrotated text also carries its flow: the renderer's settled line advances,
 * including wrapping/math. A new text box continues immediately after the
 * last row, without adding the original box's unused height or another full
 * line of padding. */
export function textFlowSnapBounds(element: SlideElement): ElementBounds {
  const bounds: ElementBounds = { ...(element.type === 'shape' && element.shapeType === 'dot' ? {centerOnly: true} : {}), ...visualExtent(element) };
  if (element.type !== 'text' || element.containerId || element.rotation % 360 !== 0) return bounds;
  const doc = getUserTextLayoutSync(element);
  if (!doc || !doc.lines.length || !element.text.trim()) return bounds;
  const padding = textInsets(element);
  const top = padding + textVerticalOffset(element.style.verticalAlign, element.height, padding, doc.height);
  return { ...bounds, textFlow: { top, bottom: top + doc.height } };
}
