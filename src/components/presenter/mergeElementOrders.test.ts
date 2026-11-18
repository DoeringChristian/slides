import { describe, expect, it } from 'vitest';
import { mergeElementOrders } from './presenterUtils';
import type { Slide } from '../../types/presentation';

// `order` lists the slide's elements; those in `hidden` are on it but hidden.
const slide = (order: string[], hidden: string[] = []) => ({ elementOrder: order,
  elements: Object.fromEntries(order.map(id => [id, { id, visible: !hidden.includes(id) }])) }) as unknown as Slide;

describe('transition stacking order', () => {
  it('an element deleted on the next slide keeps its place, not on top', () => {
    // frame (deleted on B) sits under label (hidden on B): it stays under it.
    expect(mergeElementOrders(slide(['img', 'frame', 'label']), slide(['img', 'label', 'new']), true))
      .toEqual(['img', 'frame', 'label', 'new']);
  });
  it('a run of deleted elements keeps its order; one at the bottom stays at the bottom', () => {
    expect(mergeElementOrders(slide(['x', 'a', 'b', 'keep', 'c']), slide(['keep', 'n']), true))
      .toEqual(['x', 'a', 'b', 'keep', 'c', 'n']);
  });
  it('an element hidden on the next slide is placed where it is shown, even if moved there', () => {
    // On B the label is hidden and was moved below the arrow: during the
    // fade-out it keeps its place from A, above the frame deleted on B.
    expect(mergeElementOrders(slide(['img', 'arrow', 'frame', 'label']), slide(['img', 'label', 'arrow', 'new'], ['label']), true))
      .toEqual(['img', 'arrow', 'frame', 'label', 'new']);
  });
  it('backward: elements only on the target slide keep their place too', () => {
    expect(mergeElementOrders(slide(['bg', 'label']), slide(['bg', 'frame', 'label']), false))
      .toEqual(['bg', 'frame', 'label']);
  });
  it('identical orders stay as they are', () => {
    expect(mergeElementOrders(slide(['a', 'b']), slide(['a', 'b']), true)).toEqual(['a', 'b']);
  });
});
