import type { ShapeElement } from '../types/presentation';
import { creationKeyForShape, sanitizeCreationStyle, useCreationPreferences } from './creationPreferences';
import { updateElementFromCurrent, type CurrentChange } from './currentMutation';

/** Explicit accepted USER style boundary. The authored creation family is retained. Never
 * call from previews/restores, imports, keyframe actions or remote projection. */
export function updateShapeStyleFromCurrent(slideId: string, rendered: ShapeElement, changes: CurrentChange<ShapeElement>) {
  let accepted: { key: ReturnType<typeof creationKeyForShape>; style: Partial<ShapeElement> } | undefined;
  updateElementFromCurrent(slideId, rendered, current => {
    const partial = typeof changes === 'function' ? changes(current) : changes;
    const key = creationKeyForShape(current);
    const style = sanitizeCreationStyle(key, partial);
    if (!Object.keys(style).length) return partial;
    accepted = { key, style };
    return { ...partial, creationPreset: key };
  });
  if (accepted) useCreationPreferences.getState().remember(accepted.key, accepted.style);
}
