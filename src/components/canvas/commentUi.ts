import { create } from 'zustand';
import type { Slide, SlideComment } from '../../types/presentation';
import { useEditorStore } from '../../store/editorStore';

export type CommentRegion = NonNullable<SlideComment['region']>;

/** What a comment thread is about: elements (one, or a selection), an area
 *  or point of the slide (`region`, plus the elements inside it), or — both
 *  null — the slide as a whole. */
export interface CommentTarget {
  elementIds: string[] | null;
  region: CommentRegion | null;
}

/** Which comment thread popover is open on the canvas. */
interface CommentUiState {
  open: ({ slideId: string } & CommentTarget) | null;
  openThread: (slideId: string, elementIds: string[] | null, region?: CommentRegion | null) => void;
  close: () => void;
}

export const useCommentUi = create<CommentUiState>((set) => ({
  open: null,
  openThread: (slideId, elementIds, region = null) => set({ open: {
    slideId,
    elementIds: elementIds?.length ? [...elementIds].sort() : null,
    region: region ? roundRegion(region) : null,
  } }),
  close: () => set({ open: null }),
}));

const round = (n: number) => Math.round(n * 10) / 10;
export const roundRegion = (r: CommentRegion): CommentRegion =>
  ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });

/** Key of a thread target. A region is its own target (the elements inside
 *  it are context, not identity); otherwise the sorted element ids; '' for
 *  the slide. */
export function targetKey(target: CommentTarget | { elementIds?: string[] | null; region?: CommentRegion | null }): string {
  if (target.region) {
    const r = roundRegion(target.region);
    return `region:${r.x},${r.y},${r.width},${r.height}`;
  }
  return target.elementIds?.length ? [...target.elementIds].sort().join(',') : '';
}

/** The elements a comment is about that are still on the slide, sorted;
 *  null when none are. */
export function presentTargets(slide: Slide | undefined, comment: SlideComment): string[] | null {
  const ids = (comment.elementIds ?? []).filter(id => slide?.elements[id]).sort();
  return ids.length ? ids : null;
}

/** What a stored comment is about, as shown on the canvas: its region if it
 *  has one; else its elements still on the slide; else the slide. */
export function commentTarget(slide: Slide | undefined, comment: SlideComment): CommentTarget {
  return comment.region
    ? { elementIds: presentTargets(slide, comment), region: roundRegion(comment.region) }
    : { elementIds: presentTargets(slide, comment), region: null };
}

/** Group a slide's comments by target (keyed by `targetKey`). Replies follow
 *  their thread. */
export function groupComments(slide: Slide | undefined) {
  const byTarget = new Map<string, CommentTarget & { comments: SlideComment[] }>();
  const all = Object.values(slide?.comments ?? {});
  const roots = new Map(all.filter(c => !c.parentId).map(c => [c.id, c]));
  for (const comment of all) {
    const root = comment.parentId ? roots.get(comment.parentId) ?? comment : comment;
    const target = commentTarget(slide, root);
    const key = targetKey(target);
    const group = byTarget.get(key) ?? { ...target, comments: [] };
    group.comments.push(comment);
    byTarget.set(key, group);
  }
  for (const group of byTarget.values()) group.comments.sort((a, b) => a.createdAt - b.createdAt);
  return byTarget;
}

export const openCount = (comments: SlideComment[]) => comments.filter(c => !c.parentId && !c.resolved).length;

/** Choose the Comment tool. With objects already selected there is nothing
 *  to point at: the comment box opens on the selection right away. */
export function startCommentTool() {
  const editor = useEditorStore.getState();
  if (editor.selectedElementIds.length) {
    useCommentUi.getState().openThread(editor.activeSlideId, editor.selectedElementIds);
    return;
  }
  editor.setTool('comment');
}
