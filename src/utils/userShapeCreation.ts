import type { ShapeElement, Tool } from '../types/presentation';
import { createShapeElement } from './slideFactory';
import { CURATED_ICONS } from './curatedIcons';
import { creationKeyForTool, useCreationPreferences } from '../store/creationPreferences';

/** Only user gestures consume preferences. Imports/templates keep the pure factory. */
export function composeUserShape(tool: Tool, overrides: Partial<ShapeElement> = {}): ShapeElement {
  const key = creationKeyForTool(tool) ?? 'rect';
  const prefs = useCreationPreferences.getState();
  const shapeType = key === 'icon' ? 'vector' : ['line', 'arrow', 'curve', 'polygon'].includes(key) ? 'path' : key as 'rect' | 'ellipse' | 'triangle' | 'star';
  const geometry = key === 'icon' ? (CURATED_ICONS.find(icon => icon.id === prefs.iconId) ?? CURATED_ICONS[0]).geometry : undefined;
  return createShapeElement(shapeType, {
    creationPreset: key,
    ...(shapeType === 'path' ? { points: [0, 0, 100, 60], closed: false, curve: key === 'curve' ? 'smooth' : 'linear', startHead: 'none', endHead: key === 'arrow' ? 'triangle' : 'none' } : {}),
    ...(geometry ? { geometry: structuredClone(geometry), width: 100, height: 100 } : {}),
    ...prefs.styles[key],
    // A two-point line/arrow gesture has endpoints, not a closing segment.
    // Retain the preference for multipoint drafts; explicit authored topology
    // (including a panel's closed preview) still wins via overrides below.
    ...((key === 'line' || key === 'arrow') && (overrides.points?.length ?? 4) <= 4 ? { closed: false } : {}),
    ...overrides,
  });
}
/** Click placement fits the selected native design box inside 64 slide units.
 * This is creation-only: persisted/imported vector dimensions are untouched. */
export function iconPlacementBox(cx: number, cy: number) {
  const icon = CURATED_ICONS.find(icon => icon.id === useCreationPreferences.getState().iconId) ?? CURATED_ICONS[0];
  const width = 64 * Math.min(1, icon.aspectRatio);
  const height = 64 / Math.max(1, icon.aspectRatio);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
/** Standard shape design boxes are square.
 * Text uses the existing 300×50 creation default; paths constrain angles instead. */
export function creationBox(tool: Tool, sx: number, sy: number, ex: number, ey: number, preserveAspect = false) {
  if (tool === 'icon') return iconPlacementBox(ex, ey);
  let width = Math.abs(ex - sx), height = Math.abs(ey - sy);
  if (preserveAspect && !['line', 'arrow', 'polygon', 'bspline'].includes(tool)) {
    const ratio = tool === 'text' ? 300 / 50 : 1;
    width = Math.max(width, height * ratio); height = width / ratio;
  }
  return { x: ex < sx ? sx - width : sx, y: ey < sy ? sy - height : sy, width, height };
}
