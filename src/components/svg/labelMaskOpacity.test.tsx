import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createShapeElement } from '../../utils/model/slideFactory';
import { RenderShape } from './ElementRenderer';
import type { ShapeElement } from '../../types/presentation';

describe('bound-label mask', () => {
  test('fades with its arrow rather than staying a solid hole', () => {
    // Fades run through element opacity. The mask used to be a sibling of the
    // faded group, so a half-faded arrow kept a full-strength background
    // rectangle over whatever lay behind its label.
    const arrow = {
      ...createShapeElement('path', { x: 0, y: 0, points: [0, 0, 200, 0], endHead: 'triangle' }),
      opacity: 0.3,
      _labelMask: { x: 80, y: -10, width: 40, height: 20, color: '#ffffff' },
    } as ShapeElement;
    const svg = renderToStaticMarkup(<svg><RenderShape element={arrow} /></svg>);
    const doc = new DOMParserLite(svg);
    const mask = doc.rect('#ffffff');
    expect(mask, 'mask not rendered').toBeTruthy();
    // The mask's own ancestors must carry the arrow's opacity — exactly once,
    // so the shaft and the mask fade together instead of the shaft showing
    // through a half-transparent mask.
    expect(doc.opacitiesAbove(mask!)).toEqual([0.3]);
  });
});

/** Just enough of an SVG tree walk for static markup, without a DOM. */
class DOMParserLite {
  private readonly tags: { tag: string; attrs: Record<string, string>; close: boolean; self: boolean; at: number }[] = [];
  constructor(markup: string) {
    for (const m of markup.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([\w-:]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      this.tags.push({ tag: m[2], attrs, close: m[1] === '/', self: m[4] === '/', at: m.index! });
    }
  }
  rect(fill: string): number | undefined {
    const i = this.tags.findIndex(t => t.tag === 'rect' && t.attrs.fill === fill);
    return i < 0 ? undefined : i;
  }
  opacitiesAbove(index: number): number[] {
    const stack: (typeof this.tags)[number][] = [];
    for (let i = 0; i < index; i++) {
      const t = this.tags[i];
      if (t.self) continue;
      if (t.close) stack.pop(); else stack.push(t);
    }
    return stack.filter(t => t.attrs.opacity !== undefined).map(t => Number(t.attrs.opacity));
  }
}
