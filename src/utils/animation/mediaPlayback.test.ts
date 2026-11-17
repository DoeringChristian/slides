import { describe, expect, it } from 'vitest';
import { arriveAt, arriveAtSlide, clockTime, segmentOf, type MediaClock } from './mediaPlayback';
import { createImageElement } from '../model/slideFactory';
import type { ImageElement, Resource, Slide } from '../../types/presentation';

const video = (over: Partial<ImageElement> = {}) => createImageElement('vid', 100, 100, { id: 'v', ...over });
const DURATION = 20;

describe('video playback across keyframes', () => {
  it("a keyframe's segment is From → To, the whole video by default", () => {
    expect(segmentOf(video(), DURATION)).toEqual({ from: 0, to: 20 });
    expect(segmentOf(video({ playFrom: 2, playTo: 12 }), DURATION)).toEqual({ from: 2, to: 12 });
    expect(segmentOf(video({ playFrom: 5, playTo: 99 }), DURATION)).toEqual({ from: 5, to: 20 });
  });

  it('continue: a video new on screen starts at From and plays', () => {
    const c = arriveAt(video({ playFrom: 2, playTo: 12 }), DURATION, undefined, 0);
    expect(c).toMatchObject({ anchor: 2, playing: true, to: 12 });
    expect(clockTime(c, 3000).time).toBeCloseTo(5);
  });

  it('continue: on the next keyframe it keeps playing from where it is — no restart — up to that keyframe\'s To', () => {
    const first = arriveAt(video(), DURATION, undefined, 0);
    const second = arriveAt(video({ playTo: 8 }), DURATION, first, 4000);
    expect(second.anchor).toBeCloseTo(4);
    expect(clockTime(second, 5000).time).toBeCloseTo(5);
    expect(clockTime(second, 9000)).toEqual({ time: 8, moving: false });
    // After a still, continue resumes from the still frame.
    const still = arriveAt(video({ playback: 'still', playFrom: 9 }), DURATION, second, 6000);
    expect(clockTime(still, 8000)).toEqual({ time: 9, moving: false });
    expect(arriveAt(video(), DURATION, still, 9000).anchor).toBeCloseTo(9);
  });

  it('from start: plays From → To, then holds the end or loops', () => {
    const hold = arriveAt(video({ playback: 'range', playFrom: 4, playTo: 6 }), DURATION, undefined, 0);
    expect(clockTime(hold, 1000)).toEqual({ time: 5, moving: true });
    expect(clockTime(hold, 5000)).toEqual({ time: 6, moving: false });
    const loop = arriveAt(video({ playback: 'range', playFrom: 4, playTo: 6, atEnd: 'loop' }), DURATION, undefined, 0);
    expect(clockTime(loop, 3000).time).toBeCloseTo(5);
    expect(clockTime(loop, 3000).moving).toBe(true);
  });

  it('a keyframe sets the clocks of its visible videos; videos not on it are dropped', () => {
    const slide = (els: ImageElement[]): Slide => ({ id: 's', elements: Object.fromEntries(els.map(e => [e.id, e])), elementOrder: els.map(e => e.id),
      background: { type: 'solid', color: '#fff' } } as Slide);
    const resources: Record<string, Resource> = { vid: { id: 'vid', name: 'v', type: 'video', src: 'x', originalWidth: 100, originalHeight: 100, duration: DURATION } };
    const a = arriveAtSlide(slide([video({ playFrom: 2 })]), resources, new Map(), 0);
    const b = arriveAtSlide(slide([video({ playFrom: 2 })]), resources, a, 3000);
    expect(b.get('v')!.anchor).toBeCloseTo(5);
    expect(arriveAtSlide(slide([video({ visible: false })]), resources, b, 4000).size).toBe(0);
    const back: MediaClock = arriveAtSlide(slide([video({ playFrom: 2 })]), resources, new Map(), 5000).get('v')!;
    expect(back.anchor).toBe(2);
  });
});
