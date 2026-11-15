import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Check, RotateCcw, Trash2, X, Sparkles } from 'lucide-react';
import { usePresentationStore } from '../../store/presentationStore';
import { useEditorStore } from '../../store/editorStore';
import { useIdentity } from '../../hooks/useIdentity';
import { getElementBounds } from '../../utils/geometry/geometry';
import { CANVAS_PADDING, SLIDE_WIDTH } from '../../utils/constants';
import { useCommentUi, groupComments, openCount } from './commentUi';
import type { SlideComment } from '../../types/presentation';

/**
 * Review comments on the canvas: a small badge ("bug") at the top-right of
 * every element with open comments, one at the slide's corner for comments
 * on the slide itself (or on elements no longer on it), and a popover with
 * the thread. Posting a comment can hand it straight to the assistant, which
 * does what it asks and answers in the thread.
 */

/** A fresh comment, stamped now. */
function makeComment(fields: Pick<SlideComment, 'text' | 'author'> & Partial<Pick<SlideComment, 'elementId' | 'parentId'>>): SlideComment {
  return {
    id: `c-${crypto.randomUUID().slice(0, 8)}`,
    ...(fields.elementId ? { elementId: fields.elementId } : {}),
    ...(fields.parentId ? { parentId: fields.parentId } : {}),
    text: fields.text,
    author: fields.author,
    createdAt: Date.now(),
  };
}

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

async function forwardToAssistant(slideId: string, comment: SlideComment) {
  // Loaded on demand: the assistant (and its model SDKs) stays out of the
  // editor bundle until someone uses it.
  const { useAgentStore } = await import('../../agent/agentStore');
  useAgentStore.getState().forwardComment(slideId, comment);
}

const Badge: React.FC<{ count: number; color: string; left: number; top: number; active: boolean; onClick: () => void; title: string }> = ({ count, color, left, top, active, onClick, title }) => (
  <button
    data-comment-ui=""
    onPointerDown={e => e.stopPropagation()}
    onClick={e => { e.stopPropagation(); onClick(); }}
    className={`absolute z-20 flex items-center gap-0.5 rounded-full rounded-bl-none pl-1.5 pr-2 py-0.5 text-[11px] font-semibold text-white shadow-md transition-transform hover:scale-110 ${active ? 'ring-2 ring-white scale-110' : ''}`}
    style={{ left, top, background: color, transform: 'translate(-20%, -100%)' }}
    title={title}
  >
    <MessageSquare size={11} />
    {count > 0 && count}
  </button>
);

const CommentEntry: React.FC<{
  comment: SlideComment;
  replies: SlideComment[];
  meId: string;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  onDelete: (id: string) => void;
}> = ({ comment, replies, meId, onReply, onResolve, onDelete }) => {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const entry = (c: SlideComment, root: boolean) => (
    <div key={c.id} className={root ? '' : 'pl-3 border-l-2 border-gray-100 mt-1.5'}>
      <div className="flex items-center gap-1.5 text-xs">
        {c.author.assistant
          ? <Sparkles size={11} className="text-violet-600 shrink-0" />
          : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.author.color }} />}
        <span className="font-medium text-gray-800 truncate">{c.author.name}</span>
        <span className="text-gray-400 shrink-0">{timeAgo(c.createdAt)}</span>
        <span className="flex-1" />
        {c.author.id === meId && (
          <button onClick={() => onDelete(c.id)} className="text-gray-300 hover:text-red-500" title="Delete"><Trash2 size={11} /></button>
        )}
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap break-words mt-0.5">{c.text}</div>
    </div>
  );
  return (
    <div className={`py-2 border-b border-gray-100 last:border-b-0 ${comment.resolved ? 'opacity-60' : ''}`}>
      {entry(comment, true)}
      {replies.map(r => entry(r, false))}
      <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
        {!comment.resolved && <button onClick={() => setReplying(v => !v)} className="hover:text-gray-800">Reply</button>}
        <button onClick={() => onResolve(!comment.resolved)} className="flex items-center gap-0.5 hover:text-gray-800">
          {comment.resolved ? <><RotateCcw size={10} /> Reopen</> : <><Check size={10} /> Resolve</>}
        </button>
      </div>
      {replying && (
        <div className="mt-1.5 flex gap-1">
          <input
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && text.trim()) { onReply(text.trim()); setText(''); setReplying(false); }
              if (e.key === 'Escape') setReplying(false);
            }}
            placeholder="Reply…"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
};

const ThreadPopover: React.FC<{
  slideId: string;
  elementId: string | null;
  comments: SlideComment[];
  left: number;
  top: number;
}> = ({ slideId, elementId, comments, left, top }) => {
  const me = useIdentity();
  const close = useCommentUi(s => s.close);
  const elementName = usePresentationStore(s => (elementId ? s.presentation.objects[elementId]?.name : undefined));
  const [text, setText] = useState('');
  const [ask, setAsk] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const store = usePresentationStore.getState;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!ref.current?.contains(target) && !target.closest?.('[data-comment-ui]')) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [close]);

  const roots = comments.filter(c => !c.parentId);
  const visibleRoots = roots.filter(c => showResolved || !c.resolved);
  const resolvedCount = roots.filter(c => c.resolved).length;
  const author = { id: me.userId, name: me.name, color: me.color };

  const post = () => {
    const body = text.trim();
    if (!body) return;
    const comment = makeComment({ text: body, author, elementId: elementId ?? undefined });
    store().addComment(slideId, comment);
    setText('');
    if (ask) void forwardToAssistant(slideId, comment);
  };

  return (
    <div
      ref={ref}
      data-comment-ui=""
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      className="absolute z-30 w-72 bg-white rounded-lg shadow-xl border border-gray-200 flex flex-col select-text"
      style={{ left, top, maxHeight: 420 }}
    >
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-gray-100 shrink-0">
        <MessageSquare size={13} className="text-gray-500" />
        <span className="text-xs font-medium text-gray-700 flex-1 truncate">
          {elementId ? `Comments on ${elementName ?? 'this element'}` : 'Comments on this slide'}
        </span>
        <button onClick={close} className="text-gray-400 hover:text-gray-700" title="Close (Esc)"><X size={14} /></button>
      </div>
      <div className="overflow-y-auto px-3 flex-1">
        {visibleRoots.map(root => (
          <CommentEntry
            key={root.id}
            comment={root}
            replies={comments.filter(c => c.parentId === root.id)}
            meId={me.userId}
            onReply={reply => store().addComment(slideId, makeComment({ text: reply, author, parentId: root.id, elementId: root.elementId }))}
            onResolve={resolved => store().updateComment(slideId, root.id, { resolved })}
            onDelete={id => store().deleteComment(slideId, id)}
          />
        ))}
        {resolvedCount > 0 && (
          <button onClick={() => setShowResolved(v => !v)} className="text-[11px] text-gray-500 hover:text-gray-800 py-1.5">
            {showResolved ? 'Hide resolved' : `Show ${resolvedCount} resolved`}
          </button>
        )}
      </div>
      <div className="p-2 border-t border-gray-100 shrink-0 space-y-1.5">
        <textarea
          autoFocus={!visibleRoots.length}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
          }}
          rows={2}
          placeholder={elementId ? 'Comment on this element…' : 'Comment on this slide…'}
          className="w-full resize-none border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-400"
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-gray-600 flex-1" title="Send this comment to the assistant; it does what it asks and answers in the thread">
            <input type="checkbox" checked={ask} onChange={e => setAsk(e.target.checked)} />
            Ask the assistant
          </label>
          <button
            onClick={post}
            disabled={!text.trim()}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded px-2.5 py-1 text-xs font-medium"
            title="Post (⌘Enter)"
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
};

export const CommentLayer: React.FC<{ zoom: number }> = ({ zoom }) => {
  const slideId = useEditorStore(s => s.activeSlideId);
  const editingTextId = useEditorStore(s => s.editingTextId);
  const slide = usePresentationStore(s => s.presentation.slides[slideId]);
  const open = useCommentUi(s => s.open);
  const openThread = useCommentUi(s => s.openThread);
  const close = useCommentUi(s => s.close);
  const groups = useMemo(() => groupComments(slide), [slide]);

  // A thread belongs to its slide: navigating away closes it.
  useEffect(() => {
    if (open && open.slideId !== slideId) close();
  }, [open, slideId, close]);

  if (!slide || editingTextId) return null;

  const anchorFor = (elementId: string | null) => {
    const el = elementId ? slide.elements[elementId] : undefined;
    if (!el) return { left: (SLIDE_WIDTH + CANVAS_PADDING) * zoom, top: CANVAS_PADDING * zoom };
    const b = getElementBounds(el);
    return { left: (b.x + b.width + CANVAS_PADDING) * zoom, top: (b.y + CANVAS_PADDING) * zoom };
  };

  const badges: React.ReactNode[] = [];
  for (const [target, comments] of groups) {
    const count = openCount(comments);
    const isOpen = open?.slideId === slideId && open.elementId === target;
    if (!count && !isOpen) continue;
    const firstOpen = comments.find(c => !c.parentId && !c.resolved) ?? comments[0];
    const { left, top } = anchorFor(target);
    badges.push(
      <Badge
        key={target ?? '__slide'}
        count={count}
        color={firstOpen.author.assistant ? '#7c3aed' : firstOpen.author.color}
        left={left}
        top={top}
        active={isOpen}
        onClick={() => (isOpen ? close() : openThread(slideId, target))}
        title={`${count} open comment${count === 1 ? '' : 's'}${target ? '' : ' on this slide'}`}
      />,
    );
  }

  let popover: React.ReactNode = null;
  if (open && open.slideId === slideId) {
    const { left, top } = anchorFor(open.elementId);
    popover = (
      <ThreadPopover
        key={`${open.slideId}:${open.elementId ?? ''}`}
        slideId={slideId}
        elementId={open.elementId}
        comments={groups.get(open.elementId) ?? []}
        left={left + 12}
        top={Math.max(0, top - 8)}
      />
    );
  }

  return <>{badges}{popover}</>;
};
