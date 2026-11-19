import { useEffect, useRef } from 'react';
import type { Resource, Slide } from '../../types/presentation';
import { arriveAtSlide, clockTime, type MediaClock } from '../../utils/animation/mediaPlayback';
import { startDiag } from './diag';

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
/** Longest (ms) videos that start together wait for a slow one, once all
 *  are on screen. */
const START_WAIT = 1500;
/** Longest (ms) they wait for one to appear at all (loading). */
const MOUNT_WAIT = 10000;
/** Longest (ms) videos started together wait for all to be running. */
const PRIME_WAIT = 400;
/** Largest speed change (±) that brings a drifting video back in step. */
const MAX_NUDGE = 0.2;
/** Seconds a playing video may be off its clock before it is nudged back:
 *  under half a frame, so videos side by side (two halves of one picture)
 *  show the same frame. */
const DRIFT = 1 / 90;
/** Seconds within which a corrected video counts as back in step. */
const SETTLED = 0.004;
/** Seconds within which a video is at the frame it should show. */
const EXACT = 0.002;

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

  // Videos that start on this keyframe, until they have all got there.
  const starting = useRef<{ ids: Set<string>; since: number; allMounted: number; primed: number; seeked: WeakSet<HTMLVideoElement> }>({ ids: new Set(), since: 0, allMounted: 0, primed: 0, seeked: new WeakSet() });

  // A new keyframe: each video's clock moves on by that keyframe's playback.
  useEffect(() => {
    const now = performance.now();
    const before = clocks.current;
    clocks.current = arriveAtSlide(slide, live.current, before, now);
    const ids = new Set<string>();
    for (const [id, clock] of clocks.current) {
      // Starts here: was not on screen, was still, or jumps (a "from start").
      const prev = before.get(id) && clockTime(before.get(id)!, now);
      if (clock.playing && (!prev || !prev.moving || Math.abs(prev.time - clock.anchor) > IN_STEP)) ids.add(id);
    }
    starting.current = { ids, since: now, allMounted: 0, primed: 0, seeked: new WeakSet() };
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
    startDiag();
    let frame = 0;
    const correcting = new WeakSet<HTMLVideoElement>();
    const running = new WeakSet<HTMLVideoElement>();
    // Videos just started together, until they have all visibly moved.
    let settling: { ids: Set<string>; until: number; startAt: Map<string, number> } | null = null;
    const tick = () => {
      const now = performance.now();
      const mounted = [...(container.current?.querySelectorAll<HTMLVideoElement>('video[data-media-id]') ?? [])];
      // Videos that start together wait for one another: each one that is
      // not mounted, not loaded or still seeking holds them all at their
      // first frame, then they start on the same tick. (Up to START_WAIT; a
      // video already playing never waits.)
      const start = starting.current;
      if (start.ids.size) {
        const ready = (id: string) => {
          const clock = clocks.current.get(id);
          if (!clock) return true;
          const videos = mounted.filter(v => v.dataset.mediaId === id);
          return videos.length > 0 && videos.every(v => start.seeked.has(v) && !v.seeking && v.readyState >= 3 &&
            Math.abs(v.currentTime - clock.anchor) <= EXACT);
        };
        const onScreen = [...start.ids].every(id => !clocks.current.has(id) || mounted.some(v => v.dataset.mediaId === id && v.readyState >= 1));
        if (onScreen && !start.allMounted) start.allMounted = now;
        const members = mounted.filter(v => start.ids.has(v.dataset.mediaId!));
        const release = () => {
          settling = { ids: new Set(start.ids), until: now + 1000,
            startAt: new Map([...start.ids].flatMap(id => { const c = clocks.current.get(id); return c ? [[id, c.anchor] as [string, number]] : []; })) };
          for (const v of members) v.playbackRate = 1;
          for (const id of start.ids) { const c = clocks.current.get(id); if (c) clocks.current.set(id, { ...c, at: now }); }
          start.ids = new Set();
        };
        if (start.primed) {
          // Started at speed 0: once every one is really running, all go to
          // normal speed on the same frame. (A video that sat paused takes
          // tens of ms to get going; started one by one, they would be that
          // far apart.)
          if (members.every(v => running.has(v)) || now - start.primed > PRIME_WAIT) release();
          else for (const id of start.ids) { const c = clocks.current.get(id); if (c) clocks.current.set(id, { ...c, at: now }); }
        } else if ([...start.ids].every(ready)) {
          start.primed = now;
          for (const v of members) {
            running.delete(v);
            v.addEventListener('playing', () => running.add(v), { once: true });
            v.playbackRate = 0;
            v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
          }
          for (const id of start.ids) { const c = clocks.current.get(id); if (c) clocks.current.set(id, { ...c, at: now }); }
        } else if ((start.allMounted && now - start.allMounted > START_WAIT) || now - start.since > MOUNT_WAIT) release();
        else {
          for (const id of start.ids) {
            const clock = clocks.current.get(id);
            if (!clock) continue;
            clocks.current.set(id, { ...clock, at: now });
            for (const v of mounted) {
              if (v.dataset.mediaId !== id) continue;
              if (!v.paused) v.pause();
              // Each one is seeked to its first frame, even when it already
              // shows it: a video paused a while (at the end of its last
              // stretch) reports itself ready and playing at once, yet starts
              // moving a few hundred ms later. After a seek, "ready" is true.
              if (v.seeking) start.seeked.add(v);
              else if (v.readyState >= 1 && (!start.seeked.has(v) || Math.abs(v.currentTime - clock.anchor) > EXACT)) {
                start.seeked.add(v);
                v.currentTime = clock.anchor;
              }
            }
          }
        }
      }
      // Once all of a group started together are moving, their clocks take
      // the group's actual position: a delay they share (the decoder taking a
      // moment to get going) moves the clock, not the videos, so they are
      // never rushed to catch up with it.
      if (settling) {
        const group = mounted.filter(v => settling!.ids.has(v.dataset.mediaId!) && clocks.current.has(v.dataset.mediaId!));
        const leads = group.map(v => v.currentTime - clockTime(clocks.current.get(v.dataset.mediaId!)!, now).time);
        if (now > settling.until || !group.length) settling = null;
        else if (group.every(v => !v.paused && v.currentTime > (settling!.startAt.get(v.dataset.mediaId!) ?? 0) + EXACT)) {
          const lead = leads.reduce((a, b) => a + b, 0) / leads.length;
          for (const id of settling.ids) {
            const c = clocks.current.get(id);
            if (c) clocks.current.set(id, { ...c, anchor: clockTime(c, now).time + lead, at: now });
          }
          settling = null;
        }
      }
      mounted.forEach(video => {
        if (start.ids.has(video.dataset.mediaId!)) return;
        const clock = clocks.current.get(video.dataset.mediaId!);
        if (!clock) { if (!video.paused) video.pause(); return; }
        const { time, moving } = clockTime(clock, now);
        if (Number.isFinite(time) && video.readyState >= 1) {
          const id = video.dataset.mediaId!;
          const off = Math.abs(time - video.currentTime);
          // Past the end of its stretch while the clock looped back: jump too.
          const wrapped = moving && video.currentTime >= clock.to - 1e-3 && off > IN_STEP;
          if (!moving && clock.playing && !video.paused && !video.seeking && video.currentTime < clock.to - EXACT && off <= JUMP) {
            // Its clock reached the end a moment before it did: it plays on
            // to the last frame of its stretch (stopped below).
            return;
          } else if (!moving && clock.playing && !video.paused && !video.seeking && off <= JUMP) {
            // It just reached the end of its stretch: it stops on the frame it
            // shows. Seeking back the fraction of a frame it ran over decodes
            // from the last keyframe and shows as a stutter at the very end.
            video.pause();
            clocks.current.set(id, { ...clock, anchor: video.currentTime, at: now, playing: false });
          } else if (!video.seeking && (off > (moving ? JUMP : STILL_DRIFT) || wrapped)) {
            // The clock moved on by itself (a new keyframe, a loop, a manual
            // seek): the video jumps there, once.
            video.currentTime = time;
          } else if (moving && !video.seeking) {
            // Playing: the clock is the time, so videos that started together
            // stay together. A video that fell behind or ran ahead is brought
            // back by playing slightly faster or slower — never by a seek,
            // which would show as a stutter.
            const lead = video.currentTime - time;
            const fixing = correcting.has(video);
            if (Math.abs(lead) > DRIFT || (fixing && Math.abs(lead) > SETTLED)) {
              correcting.add(video);
              const rate = Math.min(1 + MAX_NUDGE, Math.max(1 - MAX_NUDGE, 1 - lead * 2));
              if (Math.abs(video.playbackRate - rate) > 0.02) video.playbackRate = rate;
            } else if (fixing || video.playbackRate !== 1) {
              correcting.delete(video);
              video.playbackRate = 1;
            }
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
