import { describe, expect, it } from 'vitest';
import { arriveAt, arriveAtSlide, clockTime, trimRange, type MediaClock } from './mediaPlayback';
import { createImageElement } from '../model/slideFactory';
import type { ImageElement, Resource, Slide } from '../../types/presentation';

const video = (over: Partial<ImageElement> = {}) => createImageElement('vid', 100, 100, { id: 'v', ...over });
const DURATION = 20;
const meta = { id: 'v', name: 'v', type: 'image' as const, trimStart: 2, trimEnd: 12 };

describe('video playback across keyframes', () => {
  it('trim bounds everything; untrimmed is the whole video', () => {
    expect(trimRange(undefined, DURATION)).toEqual({ start: 0, end: 20 });
    expect(trimRange(meta, DURATION)).toEqual({ start: 2, end: 12 });
    expect(trimRange({ ...meta, trimEnd: 99 }, DURATION)).toEqual({ start: 2, end: 20 });
  });

  it('continue: a video new on screen starts at the trim start and plays', () => {
    const c = arriveAt(video(), meta, DURATION, undefined, 0);
    expect(c).toMatchObject({ anchor: 2, playing: true, to: 12 });
    expect(clockTime(c, 3000).time).toBeCloseTo(5);
  });

  it('continue: on the next keyframe it keeps playing from where it is — no restart', () => {
    const first = arriveAt(video(), meta, DURATION, undefined, 0);
    const second = arriveAt(video(), meta, DURATION, first, 4000);
    expect(second.anchor).toBeCloseTo(6);
    expect(clockTime(second, 5000).time).toBeCloseTo(7);
    // After a still, continue resumes from the still frame.
    const still = arriveAt(video({ playback: 'still', playFrom: 9 }), meta, DURATION, second, 6000);
    expect(clockTime(still, 8000)).toEqual({ time: 9, moving: false });
    expect(arriveAt(video(), meta, DURATION, still, 9000).anchor).toBeCloseTo(9);
  });

  it('range: plays From → To, then holds the end or loops', () => {
    const hold = arriveAt(video({ playback: 'range', playFrom: 4, playTo: 6 }), meta, DURATION, undefined, 0);
    expect(clockTime(hold, 1000)).toEqual({ time: 5, moving: true });
    expect(clockTime(hold, 5000)).toEqual({ time: 6, moving: false });
    const loop = arriveAt(video({ playback: 'range', playFrom: 4, playTo: 6, atEnd: 'loop' }), meta, DURATION, undefined, 0);
    expect(clockTime(loop, 3000).time).toBeCloseTo(5);
    expect(clockTime(loop, 3000).moving).toBe(true);
  });

  it('range and still times stay inside the trim', () => {
    const c = arriveAt(video({ playback: 'range', playFrom: 0, playTo: 99 }), meta, DURATION, undefined, 0);
    expect([c.from, c.to]).toEqual([2, 12]);
  });

  it('a keyframe sets the clocks of its visible videos; videos not on it are dropped', () => {
    const slide = (els: ImageElement[]): Slide => ({ id: 's', elements: Object.fromEntries(els.map(e => [e.id, e])), elementOrder: els.map(e => e.id),
      background: { type: 'solid', color: '#fff' } } as Slide);
    const resources: Record<string, Resource> = { vid: { id: 'vid', name: 'v', type: 'video', src: 'x', originalWidth: 100, originalHeight: 100, duration: DURATION } };
    const objects = { v: meta };
    const a = arriveAtSlide(slide([video()]), resources, objects, new Map(), 0);
    const b = arriveAtSlide(slide([video()]), resources, objects, a, 3000);
    expect(b.get('v')!.anchor).toBeCloseTo(5);
    expect(arriveAtSlide(slide([video({ visible: false })]), resources, objects, b, 4000).size).toBe(0);
    const back: MediaClock = arriveAtSlide(slide([video()]), resources, objects, new Map(), 5000).get('v')!;
    expect(back.anchor).toBe(2);
  });
});
