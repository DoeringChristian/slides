import { useEffect, useRef } from 'react';
import type { Resource, Slide } from '../../types/presentation';
import { arriveAtSlide, clockTime, type MediaClock } from '../../utils/animation/mediaPlayback';

// The presenter's media controller: drives the mounted <video> elements by
// the playback clocks of utils/animation/mediaPlayback (see there).

/** Seconds between a video and its clock beyond which the clock moved on
 *  its own (a new keyframe, a manual seek): the video jumps there. Closer than
 *  that, a playing video sets the time — it is never rushed or jumped while it
 *  plays, which shows as stutter. */
const JUMP = 1;
/** Seconds a still (paused) video may be off its frame before it jumps. */
const STILL_DRIFT = 1 / 60;
/** Within this, a playing video and its clock count as in step. */
const IN_STEP = 0.05;

/**
 * Drive the videos mounted under `container` by keyframe: when `slide`
 * changes, each video's clock moves on (arriveAtSlide), and every frame the
 * <video data-media-id> elements are seeked / played / paused to match.
 * `command` applies a manual play / pause / seek (presenter controls) to
 * every clock.
 */
export function useMediaController(
  container: React.RefObject<HTMLElement | null>,
  slide: Slide | null,
  resources: Record<string, Resource>,
  command?: { action: 'play' | 'pause' | 'seek'; currentTime?: number } | null,
): void {
  const clocks = useRef(new Map<string, MediaClock>());
  const live = useRef(resources);
  useEffect(() => { live.current = resources; }, [resources]);

  // A new keyframe: each video's clock moves on by that keyframe's playback.
  useEffect(() => {
    clocks.current = arriveAtSlide(slide, live.current, clocks.current, performance.now());
  }, [slide]);

  // Manual controls apply to every video on screen.
  useEffect(() => {
    if (!command) return;
    const now = performance.now();
    for (const [id, clock] of clocks.current) {
      const time = command.currentTime ?? clockTime(clock, now).time;
      clocks.current.set(id, { ...clock, anchor: time, at: now,
        playing: command.action === 'play' ? true : command.action === 'pause' ? false : clock.playing });
    }
  }, [command]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      container.current?.querySelectorAll<HTMLVideoElement>('video[data-media-id]').forEach(video => {
        const clock = clocks.current.get(video.dataset.mediaId!);
        if (!clock) { if (!video.paused) video.pause(); return; }
        const { time, moving } = clockTime(clock, now);
        if (Number.isFinite(time) && video.readyState >= 1) {
          const id = video.dataset.mediaId!;
          const off = Math.abs(time - video.currentTime);
          // Past the end of its stretch while the clock looped back: jump too.
          const wrapped = moving && video.currentTime >= clock.to - 1e-3 && off > IN_STEP;
          if (!video.seeking && (off > (moving ? JUMP : STILL_DRIFT) || wrapped)) {
            // The clock moved on by itself (a new keyframe, a loop, a manual
            // seek): the video jumps there, once.
            video.currentTime = time;
          } else if (moving && (video.seeking || video.readyState < 3)) {
            // Still getting there (decoding from the keyframe before it) or
            // buffering: the clock waits, so the video then plays at its own
            // speed instead of rushing to catch up.
            clocks.current.set(id, { ...clock, anchor: video.currentTime, at: now });
          } else if (moving && off > IN_STEP) {
            // Playing, a little off: the video is the time.
            clocks.current.set(id, { ...clock, anchor: video.currentTime, at: now });
          }
        }
        if (moving && video.paused) video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
        else if (!moving && !video.paused) video.pause();
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [container]);
}
