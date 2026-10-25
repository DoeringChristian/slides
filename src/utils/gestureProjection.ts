import type { Slide, SlideElement } from '../types/presentation';
import { attachLabelMasks, syncDependentsAfterMutation } from './syncDependents';

export interface GesturePatch {
  elementId: string;
  changes: Partial<SlideElement>;
}

/** Display-only scene: use the commit solver, then mask the complete ordered
 * scene. Single-element edits intentionally match updateElement's solver. */
export function projectGestureScene(slide: Slide, patches: readonly GesturePatch[], batch = true, measuredFit = false): SlideElement[] {
  const working = { ...slide.elements };
  const moved = new Set<string>();
  for (const { elementId, changes } of patches) {
    if (!working[elementId]) continue;
    working[elementId] = { ...working[elementId], ...changes } as SlideElement;
    if (changes.x !== undefined || changes.y !== undefined || changes.width !== undefined ||
        changes.height !== undefined || changes.rotation !== undefined || 'points' in changes || 'startBinding' in changes || 'endBinding' in changes) moved.add(elementId);
  }
  for (const dep of syncDependentsAfterMutation(working, slide.elementOrder, moved, batch ? slide.elements : undefined, measuredFit, slide.elements)) {
    working[dep.elementId] = { ...working[dep.elementId], ...dep.changes } as SlideElement;
  }
  return attachLabelMasks(slide.elementOrder.map(id => working[id]).filter(Boolean),
    slide.background.type === 'solid' ? slide.background.color : '#ffffff');
}
