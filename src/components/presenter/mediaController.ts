import { useEffect, useRef } from 'react';
import type { Resource, Slide } from '../../types/presentation';
import { arriveAtSlide, clockTime, type MediaClock } from '../../utils/animation/mediaPlayback';

// The presenter's media controller: drives the mounted <video> elements by
// the playback clocks of utils/animation/mediaPlayback (see there).

/** Seconds a mounted video may drift from its clock before it is re-seeked. */
const DRIFT = 0.3;

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
        if (Number.isFinite(time) && Math.abs(video.currentTime - time) > DRIFT && video.readyState >= 1) video.currentTime = time;
        if (moving && video.paused) video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
        else if (!moving && !video.paused) video.pause();
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [container]);
}
