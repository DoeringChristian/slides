import { create } from 'zustand';
import type { ShapeElement, Tool } from '../types/presentation';
import { parsePaintColor } from '../utils/paintColor';

export const CREATION_PREFERENCES_KEY = 'slides.creation-preferences.v1';
export type CreationKey = 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'curve' | 'polygon' | 'icon';
export type CreationStyle = Partial<Pick<ShapeElement, 'fill' | 'stroke' | 'strokeWidth' | 'strokeStyle' | 'fillStyle' | 'cornerRadius' | 'curve' | 'closed' | 'startHead' | 'endHead'>>;
const keys: CreationKey[] = ['rect', 'ellipse', 'triangle', 'star', 'line', 'arrow', 'curve', 'polygon', 'icon'];
const heads = ['none', 'arrow', 'triangle', 'triangle-outline', 'bar', 'dot', 'circle', 'circle-outline', 'diamond', 'diamond-outline', 'crowfoot-one', 'crowfoot-many', 'crowfoot-one-many'];
export function creationKeyForTool(tool: Tool): CreationKey | undefined {
  return tool === 'bspline' ? 'curve' : keys.includes(tool as CreationKey) ? tool as CreationKey : undefined;
}
export function creationKeyForShape(shape: ShapeElement): CreationKey {
  return shape.creationPreset;
}
/** Explicit allowlist; deck geometry, identity and transitions never enter preferences. */
export function sanitizeCreationStyle(key: CreationKey, input: unknown): CreationStyle {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const field of ['fill', 'stroke']) {
    const value = source[field];
    if (typeof value === 'string' && (value === '' || !!parsePaintColor(value))) out[field] = value;
  }
  for (const [field, max] of [['strokeWidth', 20], ['cornerRadius', 100]] as const) {
    const value = source[field];
    if (field === 'cornerRadius' && !['rect', 'line', 'arrow', 'curve', 'polygon'].includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[field] = Math.max(0, Math.min(max, value));
  }
  const enums: Record<string, string[]> = { fillStyle: ['solid', 'hachure', 'crosshatch'], strokeStyle: ['solid', 'dashed', 'dotted'] };
  if (['line', 'arrow', 'curve', 'polygon'].includes(key)) {
    Object.assign(enums, { curve: ['linear', 'smooth', 'bezier', 'bspline2', 'bspline3'], startHead: heads, endHead: heads });
    if (typeof source.closed === 'boolean') out.closed = source.closed;
  }
  for (const [field, values] of Object.entries(enums)) if (typeof source[field] === 'string' && values.includes(source[field])) out[field] = source[field];
  return out as CreationStyle;
}
export function readCreationPreferences(): Partial<Record<CreationKey, CreationStyle>> {
  try {
    const data = JSON.parse(localStorage.getItem(CREATION_PREFERENCES_KEY) ?? '{}');
    if (data.version !== 1) return {};
    return Object.fromEntries(keys.filter(key => data.styles?.[key]).map(key => [key, sanitizeCreationStyle(key, data.styles[key])]));
  } catch { return {}; }
}
export const useCreationPreferences = create<{
  styles: Partial<Record<CreationKey, CreationStyle>>;
  iconId: string;
  chooseIcon: (id: string) => void;
  remember: (key: CreationKey, changes: unknown) => void;
}>()((set, get) => ({
  styles: readCreationPreferences(), iconId: 'house',
  chooseIcon: iconId => set({ iconId }),
  remember: (key, changes) => {
    const clean = sanitizeCreationStyle(key, changes);
    if (!Object.keys(clean).length) return;
    const styles = { ...get().styles, [key]: { ...get().styles[key], ...clean } };
    set({ styles });
    try { localStorage.setItem(CREATION_PREFERENCES_KEY, JSON.stringify({ version: 1, styles })); } catch { /* unavailable/quota: session defaults still work */ }
  },
}));
