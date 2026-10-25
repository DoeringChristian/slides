import type { SlideElement } from '../types/presentation';

/** Hover-only routing: input/selection IDs still belong to the original label. */
export function textHoverOwner(raw: SlideElement | null, elements: Record<string, SlideElement>, selectedIds: string[], editingTextId: string | null): SlideElement | null {
  if (raw?.type !== 'text' || !raw.containerId || selectedIds.includes(raw.id) || editingTextId === raw.id) return raw;
  const container = elements[raw.containerId];
  return container?.type === 'shape' && container.visible ? container : raw;
}
