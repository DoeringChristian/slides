import type { ShapeElement, SlideElement } from '../types/presentation';

export interface TranslationDelta { x: number; y: number }

/** A body drag changes positions only. Preview and commit share this plan,
 * including the existing detach policy for stationary/locked targets. */
export function planElementTranslation(
  elements: Record<string, SlideElement>,
  startPositions: ReadonlyMap<string, TranslationDelta>,
  delta: TranslationDelta,
): Array<{ elementId: string; changes: Partial<ShapeElement> & TranslationDelta }> {
  const updates: Array<{ elementId: string; changes: Partial<ShapeElement> & TranslationDelta }> = [];
  const movingIds = new Set([...startPositions.keys()].filter(id => elements[id] && !elements[id].locked));
  for (const elementId of movingIds) {
    const element = elements[elementId];
    const start = startPositions.get(elementId)!;
    const changes: Partial<ShapeElement> & TranslationDelta = { x: start.x + delta.x, y: start.y + delta.y };
    if (changes.x === element.x && changes.y === element.y) continue;
    if (element.type === 'shape' && element.shapeType === 'path') {
      if (element.startBinding && !movingIds.has(element.startBinding.elementId)) changes.startBinding = null;
      if (element.endBinding && !movingIds.has(element.endBinding.elementId)) changes.endBinding = null;
    }
    updates.push({ elementId, changes });
  }
  return updates;
}

/** Verify from pre/post snapshots, never selection/movedIds alone. Comparing
 * all non-position fields is deliberately conservative: geometry or parameter
 * edits must still run the ordinary solver. Bindings are checked per endpoint
 * by the caller, allowing the opposite, stationary end to detach. */
export function verifiedTranslations(
  before: Record<string, SlideElement>,
  after: Record<string, SlideElement>,
  movedIds: ReadonlySet<string>,
): ReadonlyMap<string, TranslationDelta> {
  const translations = new Map<string, TranslationDelta>();
  for (const id of movedIds) {
    const prev = before[id], next = after[id];
    if (!prev || !next) continue;
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const unchanged = [...keys].every(key => {
      if (key === 'x' || key === 'y' || key === 'startBinding' || key === 'endBinding') return true;
      const k = key as keyof SlideElement;
      return JSON.stringify(prev[k]) === JSON.stringify(next[k]);
    });
    const x = next.x - prev.x, y = next.y - prev.y;
    if (unchanged && Number.isFinite(x) && Number.isFinite(y)) translations.set(id, { x, y });
  }
  return translations;
}

export function sameTranslation(a: TranslationDelta | undefined, b: TranslationDelta | undefined): boolean {
  // Addition/subtraction at different origins can differ by floating-point noise.
  return !!a && !!b && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}
