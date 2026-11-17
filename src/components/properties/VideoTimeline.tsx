import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat, Square, StepForward } from 'lucide-react';
import { IconSelect } from '../controls/IconSelect';
import { usePresentationStore } from '../../store/presentationStore';
import { useMultiSlideUpdate } from '../../store/selectors';
import { segmentOf } from '../../utils/animation/mediaPlayback';
import { mediaUrl } from '../svg/mediaSources';
import type { ImageElement, VideoPlayback } from '../../types/presentation';

/** Thumbnails per filmstrip. */
const FRAMES = 8;
/** Handles move in tenths of a second. */
const STEP = 0.1;

const filmstrips = new Map<string, Promise<{ duration: number; frames: string[] }>>();

/** A video's duration and evenly spaced thumbnails (cached per source). */
function filmstrip(src: string): Promise<{ duration: number; frames: string[] }> {
  let job = filmstrips.get(src);
  if (!job) {
    job = (async () => {
      const video = document.createElement('video');
      video.muted = true; video.preload = 'auto'; video.crossOrigin = 'anonymous'; video.src = await mediaUrl(src);
      await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('video')); });
      // Some encodings (MediaRecorder WebM) report Infinity until scanned.
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e9;
        await new Promise(r => { video.ondurationchange = r; setTimeout(r, 1500); });
      }
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const canvas = document.createElement('canvas');
      canvas.height = 40; canvas.width = Math.round(40 * (video.videoWidth || 16) / (video.videoHeight || 9));
      const ctx = canvas.getContext('2d')!;
      const frames: string[] = [];
      for (let i = 0; i < FRAMES && duration > 0; i++) {
        video.currentTime = Math.min(duration - 0.01, (i + 0.5) * duration / FRAMES);
        await new Promise(r => { video.onseeked = r; setTimeout(r, 1500); });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL('image/jpeg', 0.6));
      }
      return { duration, frames };
    })().catch(() => ({ duration: 0, frames: [] }));
    filmstrips.set(src, job);
  }
  return job;
}

const fmt = (t: number) => `${t.toFixed(1)}s`;

/**
 * This keyframe's part of a video: a filmstrip of the whole video with the
 * segment From → To marked by two handles (drag them; the length shows in
 * between), how it starts here (from From, continuing, or a still) and what
 * happens at the end (hold the last frame, or loop). A drag previews locally
 * and commits once on release — one undo step.
 */
export const VideoTimeline: React.FC<{ element: ImageElement }> = ({ element }) => {
  const resource = usePresentationStore(s => element.resourceId ? s.presentation.resources[element.resourceId] : undefined);
  const update = useMultiSlideUpdate(element.id);
  const [strip, setStrip] = useState<{ duration: number; frames: string[] } | null>(null);
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    if (resource?.type === 'video') void filmstrip(resource.src).then(s => { if (live) setStrip(s); });
    return () => { live = false; };
  }, [resource?.src, resource?.type]);

  if (resource?.type !== 'video') return null;
  const duration = resource.duration && resource.duration > 0 ? resource.duration : strip?.duration ?? 0;
  const seg = draft ?? segmentOf(element, duration || undefined);
  const to = Number.isFinite(seg.to) ? seg.to : duration;
  const playback = element.playback ?? 'continue';
  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`;

  const drag = (end: 'from' | 'to') => (e: React.PointerEvent) => {
    if (!duration || !bar.current) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const rect = bar.current.getBoundingClientRect();
    let current = { from: seg.from, to };
    const at = (clientX: number) => Math.round(Math.min(duration, Math.max(0, (clientX - rect.left) / rect.width * duration)) / STEP) * STEP;
    const move = (ev: PointerEvent) => {
      const t = at(ev.clientX);
      current = end === 'from' ? { from: Math.min(t, current.to), to: current.to } : { from: current.from, to: Math.max(t, current.from) };
      setDraft(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraft(null);
      const round = (v: number) => Math.round(v * 1000) / 1000;
      update({ playFrom: round(current.from), playTo: round(current.to) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="space-y-2" data-video-timeline="">
      <div className="flex items-baseline justify-between text-xs text-gray-500">
        <span>Video on this slide</span>
        <span data-video-segment="">{fmt(seg.from)} → {fmt(to)} · {fmt(Math.max(0, to - seg.from))}</span>
      </div>
      {/* The handles sit outside the clipped filmstrip, so one at 0 s or at
          the very end is whole and grabbable. */}
      <div ref={bar} className="relative h-10 select-none" data-video-bar="">
        <div className="absolute inset-0 rounded overflow-hidden bg-gray-800">
          <div className="absolute inset-0 flex">
            {(strip?.frames ?? []).map((src, i) => <img key={i} src={src} alt="" className="h-full flex-1 object-cover" draggable={false} />)}
          </div>
          {/* Outside the segment: dimmed. */}
          <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(seg.from) }} />
          <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(to) }} />
          <div className="absolute inset-y-0 border-y-2 border-blue-500 pointer-events-none" style={{ left: pct(seg.from), width: `calc(${pct(to)} - ${pct(seg.from)})` }} />
        </div>
        {(['from', 'to'] as const).map(end => (
          <div key={end} data-video-handle={end} title={end === 'from' ? `Start ${fmt(seg.from)}` : `End ${fmt(to)}`}
            onPointerDown={drag(end)}
            className="absolute inset-y-0 w-2 -ml-1 bg-blue-500 rounded-sm cursor-ew-resize touch-none"
            style={{ left: pct(end === 'from' ? seg.from : to) }} />
        ))}
      </div>
      <div className="flex gap-4">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">Start
        <IconSelect<VideoPlayback>
          label="Start"
          value={playback}
          onChange={v => update({ playback: v })}
          columns={3}
          options={[
            { value: 'range', title: 'From start — play this segment from its start', preview: <StepForward size={16} aria-hidden="true" /> },
            { value: 'continue', title: 'Continue — keep playing from where it is', preview: <Play size={16} aria-hidden="true" /> },
            { value: 'still', title: 'Still — show the start frame', preview: <Pause size={16} aria-hidden="true" /> },
          ]}
        />
        </div>
        {playback !== 'still' && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">At end
          <IconSelect<'hold' | 'loop'>
            label="At end"
            value={element.atEnd ?? 'hold'}
            onChange={v => update({ atEnd: v })}
            columns={2}
            options={[
              { value: 'hold', title: 'Hold the last frame', preview: <Square size={16} aria-hidden="true" /> },
              { value: 'loop', title: 'Loop the segment', preview: <Repeat size={16} aria-hidden="true" /> },
            ]}
          />
          </div>
        )}
      </div>
    </div>
  );
};
