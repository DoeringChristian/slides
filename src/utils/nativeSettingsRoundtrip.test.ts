import { afterEach, expect, it, vi } from 'vitest';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { usePresentationStore } from '../store/presentationStore';
import type { FillStyle, Presentation, PropertyTransitions, SlideElement } from '../types/presentation';
import { assertPresentation } from './importPresentation';
import { exportStandaloneHtml } from './exportStandaloneHtml';
import { createPresentation, createShapeElement, createTextElement } from './slideFactory';

function authoredSettings(fillStyle: FillStyle | undefined): Presentation {
  const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
  const transitions: PropertyTransitions = {
    position: 'ease', size: 'linear', rotation: 'ease', opacity: 'fadeinout',
    fill: 'linear', stroke: 'ease', strokeWidth: 'linear', cornerRadius: 'ease',
    fontSize: 'linear', color: 'ease', lineHeight: 'linear', crop: 'ease', resource: 'dissolve',
    visibility: 'grow', content: 'write', controlPoints: 'ease', startArrow: 'linear', endArrow: 'ease', morph: 'linear',
    contentOptions: { write: { undoFirst: true }, typewriter: { undoFirst: false }, stagger: { lagRatio: .3 } },
    visibilityOptions: { wipe: { from: 'right' }, slidein: { from: 'bottom' }, grow: { anchor: 'top-left' },
      iris: { cx: .2, cy: .8 }, create: { tipDraw: true } },
  };
  const box = createShapeElement('rect', { id: 'box', creationPreset: 'rect', fill: '#12345678', fillStyle,
    stroke: '#abcdef99', strokeStyle: 'dotted', strokeWidth: 3.5, cornerRadius: 17,
    x: 73, y: 91, width: 431, height: 227, rotation: 13, opacity: .67, locked: true, visible: false, transitions });
  const label = createTextElement({ id: 'label', text: 'Authored **bold** $$x^2$$ </script> ü',
    containerId: 'box', boundTextLayout: 'measured', boundTextBaselineHeight: 227,
    textSizing: 'user-width', transitions,
    style: { fontFamily: 'serif', fontSize: 37, fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline',
      color: '#102030', align: 'right', verticalAlign: 'bottom', lineHeight: 1.7 } });
  const path = createShapeElement('path', { id: 'path', creationPreset: 'curve', fillStyle: 'crosshatch',
    points: [0, 0, 80, 30, 160, 0], tangents: [0, 0, 10, 5, -10, -5, 10, 5, -10, -5, 0, 0],
    closed: true, curve: 'bezier', startHead: 'diamond-outline', endHead: 'crowfoot-one-many', strokeStyle: 'dashed',
    startBinding: { elementId: 'box', mode: 'aim', fixedPoint: [.2, .7] },
    endBinding: { elementId: 'box', mode: 'aim', fixedPoint: [.5, .5], gap: 8 }, transitions });
  const vector = createShapeElement('vector', { id: 'vector', creationPreset: 'icon', geometry: {
    kind: 'vector', version: 1, contours: [{ id: 'outline', start: [0, 0], closed: true,
      segments: [{ kind: 'line', to: [1, 0] }, { kind: 'cubic', c1: [1, .2], c2: [.8, 1], to: [.5, 1] },
        { kind: 'arc', radii: [.5, .5], largeArc: false, sweep: true, to: [0, 0] }] }],
    fills: [{ contourIds: ['outline'], rule: 'evenodd' }], strokes: ['outline'],
    provenance: { library: 'fixture', version: '1', icon: 'outline', license: 'MIT', licenseNotice: 'Fixture only' },
  } });
  p.resources.video = { id: 'video', name: 'Embedded video', type: 'video', src: 'data:video/mp4;base64,AAAA',
    originalWidth: 640, originalHeight: 480, duration: 12, hash: 'fixture-hash' };
  const video: SlideElement = { id: 'video', type: 'image', resourceId: 'video', x: 50, y: 400,
    width: 500, height: 300, rotation: 23, opacity: .6, locked: false, visible: true,
    cropX: 5, cropY: 7, cropWidth: 600, cropHeight: 450, playing: true, loop: false, muted: true, startTime: 2.3, transitions };
  const group: SlideElement = { id: 'group', type: 'group', childIds: ['vector', 'video'], x: 5, y: 6,
    width: 800, height: 500, rotation: 4, opacity: .9, locked: true, visible: true, transitions };
  for (const el of [box, label, path, vector, video, group]) {
    slide.elements[el.id] = el; slide.elementOrder.push(el.id);
    if (el.type !== 'group') p.objects[el.id] = { id: el.id, name: `Authored ${el.id}`, type: el.type };
  }
  slide.notes = 'Notes $$y$$ </script> $&'; slide.transition.duration = 1732;
  slide.groupId = 'chain'; slide.autoAdvanceDelay = 3.2;
  slide.background = { type: 'gradient', from: '#010203', to: '#987654', direction: 73 };
  const next = structuredClone(slide); next.id = 'next'; next.hidden = true;
  next.background = { type: 'image', src: 'data:image/svg+xml,%3Csvg/%3E' };
  p.slides.next = next; p.slideOrder.push('next');
  p.templates.native = { id: 'native', name: 'Authored template', elements: structuredClone(slide.elements),
    elementOrder: [...slide.elementOrder], background: { type: 'solid', color: '#135790' } };
  p.theme = { name: 'Authored theme', colors: { primary: '#111111', secondary: '#222222', accent: '#333333',
    background: '#444444', text: '#555555', heading: '#666666' }, fonts: { heading: 'serif', body: 'monospace' } };
  p.width = 1440; p.height = 900; p.createdAt = 123; p.updatedAt = 456;
  // JSON is the persisted representation: absent optional keys are not undefined values.
  return JSON.parse(JSON.stringify(p)) as Presentation;
}

afterEach(() => vi.unstubAllGlobals());
for (const style of [undefined, 'solid', 'hachure', 'crosshatch'] as const) {
  it(`preserves all authored settings through both HTML payloads, loader and cold-start Y schema: ${style ?? 'legacy absent'}`, async () => {
    const source = authoredSettings(style);
    const payloads: Presentation[] = [];
    vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '<html><body><!--SLIDES_PAYLOAD--></body></html>' }));
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }), body: { appendChild: vi.fn(), removeChild: vi.fn() } });
    for (const mode of ['viewer', 'editor'] as const) {
      let blob: Blob | undefined;
      vi.stubGlobal('URL', { createObjectURL: (value: Blob) => { blob = value; return 'blob:test'; }, revokeObjectURL: vi.fn() });
      await exportStandaloneHtml(source, { mode, editorOrigin: 'https://example.test' });
      const html = await blob!.text();
      // Native DOMParser and the real templates are covered by html-style-roundtrip.browser.mjs.
      const json = html.match(/id="slides-payload" type="application\/json">([\s\S]*?)<\/script>/)![1];
      expect(json).not.toContain('<');
      const parsed = assertPresentation(JSON.parse(json));
      expect(parsed).toEqual(source); payloads.push(parsed);
      usePresentationStore.getState().loadPresentation(parsed);
      const loaded = usePresentationStore.getState().presentation;
      expect(loaded).toEqual(source);
      const doc = jsonToYDoc(loaded);
      try { expect(yDocToJson(doc)).toEqual(source); } finally { doc.destroy(); }
    }
    expect(payloads[0]).toEqual(payloads[1]);
  });
}
