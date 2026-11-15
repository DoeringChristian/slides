import { create } from 'zustand';
import type { Slide, SlideComment } from '../../types/presentation';

/** Which comment thread popover is open on the canvas. `elementId: null` is
 *  the slide-level thread (comments on the slide, or on elements that no
 *  longer exist on it). */
interface CommentUiState {
  open: { slideId: string; elementId: string | null } | null;
  openThread: (slideId: string, elementId: string | null) => void;
  close: () => void;
}

export const useCommentUi = create<CommentUiState>((set) => ({
  open: null,
  openThread: (slideId, elementId) => set({ open: { slideId, elementId } }),
  close: () => set({ open: null }),
}));

/** Group a slide's comments by what they are pinned to. Comments on an
 *  element that is no longer on the slide fall back to the slide thread. */
export function groupComments(slide: Slide | undefined) {
  const byTarget = new Map<string | null, SlideComment[]>();
  for (const comment of Object.values(slide?.comments ?? {})) {
    const target = comment.elementId && slide?.elements[comment.elementId] ? comment.elementId : null;
    byTarget.set(target, [...(byTarget.get(target) ?? []), comment]);
  }
  for (const list of byTarget.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return byTarget;
}

export const openCount = (comments: SlideComment[]) => comments.filter(c => !c.parentId && !c.resolved).length;
