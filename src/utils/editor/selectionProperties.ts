import type { SlideElement } from '../../types/presentation';
import { resizeSelection, rotateSelection, selectionResizeBounds, type ResizeUpdate } from '../geometry/resizeGeometry';

/** To the front / back, one step up / down, or right above / below another
 *  element (which must not itself be moved). */
export type LayerMove = 'front' | 'back' | 1 | -1 | { above: string } | { below: string };
/** Selected objects move together without reversing their stacking order. */
export function reorderSelection(order: string[], ids: string[], mode: LayerMove): string[] {
  const selected = new Set(ids), result = [...order];
  if (mode === 'front') return [...order.filter(id => !selected.has(id)), ...order.filter(id => selected.has(id))];
  if (mode === 'back') return [...order.filter(id => selected.has(id)), ...order.filter(id => !selected.has(id))];
  if (typeof mode === 'object') {
    const target = 'above' in mode ? mode.above : mode.below;
    const rest = order.filter(id => !selected.has(id)), at = rest.indexOf(target);
    if (at < 0) return result;
    const moved = order.filter(id => selected.has(id));
    rest.splice('above' in mode ? at + 1 : at, 0, ...moved);
    return rest;
  }
  if (mode === 1) {
    for (let i = result.length - 2; i >= 0; i--) if (selected.has(result[i]) && !selected.has(result[i + 1]))
      [result[i], result[i + 1]] = [result[i + 1], result[i]];
  } else {
    for (let i = 1; i < result.length; i++) if (selected.has(result[i]) && !selected.has(result[i - 1]))
      [result[i], result[i - 1]] = [result[i - 1], result[i]];
  }
  return result;
}

export function transformSelection(elements: SlideElement[], key: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number): ResizeUpdate[] {
  if (!elements.length || !Number.isFinite(value)) return [];
  const bounds = selectionResizeBounds(elements);
  if (key === 'x' || key === 'y') return elements.map(el => ({ elementId: el.id, changes: { [key]: el[key] + value - bounds[key] } }));
  // Rotation is a delta: a selection has no stored orientation of its own.
  if (key === 'rotation') return rotateSelection(elements, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, value);
  if (value <= 0 || bounds[key] <= 0) return [];
  return resizeSelection(elements, bounds, { ...bounds, [key]: value });
}
