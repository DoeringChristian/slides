import type { ImageElement, ObjectMeta, Resource, Slide } from '../../types/presentation';

/**
 * Video playback across keyframes.
 *
 * A video object is ONE playback across the keyframes it is on: moving to the
 * next keyframe does not restart it. Each keyframe says what the video does
 * on arrival (ImageElement.playback): `continue` keeps playing from where it
 * is (from the trim start if it was not on screen before), `range` plays
 * `playFrom → playTo`, `still` shows `playFrom` paused; `atEnd` holds the last
 * frame or loops. The object's trim range (ObjectMeta.trimStart / trimEnd)
 * bounds every time.
 *
 * Each object has a clock — a media time anchored at a wall-clock moment —
 * that the controller keeps across keyframes. The <video> element that shows
 * it may be remounted between keyframes (a crop, tint or dissolve changes its
 * wrappers), so the DOM is never the source of truth: the controller drives
 * whatever <video data-media-id> is mounted to match the clock.
 */

export interface MediaClock {
  /** Media time (s) at `at`. */
  anchor: number;
  /** performance.now() (ms) when `anchor` held. */
  at: number;
  playing: boolean;
  /** The stretch being played: loops return to `from`, playback stops at `to`. */
  from: number;
  to: number;
  atEnd: 'hold' | 'loop';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The trimmed range of a video object (whole video when untrimmed). */
export function trimRange(meta: ObjectMeta | undefined, duration: number | undefined): { start: number; end: number } {
  const end = duration && duration > 0 ? duration : Infinity;
  const start = clamp(meta?.trimStart ?? 0, 0, end);
  return { start, end: clamp(meta?.trimEnd ?? end, start, end) };
}

/** The media time a clock shows at `now`, and whether it is still moving. */
export function clockTime(clock: MediaClock, now: number): { time: number; moving: boolean } {
  if (!clock.playing) return { time: clock.anchor, moving: false };
  const t = clock.anchor + (now - clock.at) / 1000;
  if (t < clock.to) return { time: t, moving: true };
  if (clock.atEnd === 'loop' && clock.to > clock.from) {
    return { time: clock.from + ((t - clock.from) % (clock.to - clock.from)), moving: true };
  }
  return { time: clock.to, moving: false };
}

/** The clock a video has after arriving at a keyframe: from its previous
 *  clock (absent when it was not on screen) and this keyframe's playback. */
export function arriveAt(el: ImageElement, meta: ObjectMeta | undefined, duration: number | undefined,
  previous: MediaClock | undefined, now: number): MediaClock {
  const trim = trimRange(meta, duration);
  const inTrim = (v: number | undefined, fallback: number) => clamp(v ?? fallback, trim.start, trim.end);
  const atEnd = el.atEnd ?? 'hold';
  switch (el.playback ?? 'continue') {
    case 'still':
      return { anchor: inTrim(el.playFrom, trim.start), at: now, playing: false, from: trim.start, to: trim.end, atEnd };
    case 'range': {
      const from = inTrim(el.playFrom, trim.start);
      return { anchor: from, at: now, playing: true, from, to: Math.max(from, inTrim(el.playTo, trim.end)), atEnd };
    }
    case 'continue':
    default: {
      // Keep going from where it is (a still or a held end resumes from
      // there); a video that was not on screen starts at its trim start.
      const at = previous ? clamp(clockTime(previous, now).time, trim.start, trim.end) : trim.start;
      return { anchor: at, at: now, playing: true, from: trim.start, to: trim.end, atEnd };
    }
  }
}

/** Clocks for the videos on a keyframe, carried over from the previous ones. */
export function arriveAtSlide(slide: Slide | null, resources: Record<string, Resource>, objects: Record<string, ObjectMeta>,
  previous: Map<string, MediaClock>, now: number): Map<string, MediaClock> {
  const next = new Map<string, MediaClock>();
  if (!slide) return next;
  for (const id of slide.elementOrder) {
    const el = slide.elements[id];
    if (el?.type !== 'image' || !el.visible || !el.resourceId) continue;
    const resource = resources[el.resourceId];
    if (resource?.type !== 'video') continue;
    next.set(id, arriveAt(el, objects[id], resource.duration, previous.get(id), now));
  }
  return next;
}
