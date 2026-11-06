/** Selection in the displayed object-list order; hidden rows are excluded by
 * the caller. A plain click replaces, Ctrl/Cmd toggles, Shift selects a range. */
export function selectObjectRange(order: string[], selected: string[], id: string,
  anchor: string | null, modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): string[] {
  if (!order.includes(id)) return selected;
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  if (modifiers.shiftKey && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return additive ? [...new Set([...selected, ...range])] : range;
  }
  if (additive) return selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
  return [id];
}
