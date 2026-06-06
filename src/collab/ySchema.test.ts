import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { jsonToYDoc, yDocToJson, ROOT_KEY } from './ySchema';
import type { Presentation } from '../types/presentation';

// =============================================================================
// Fixture — exercises every corner of the schema we care about for round-trip:
//   - Text with markdown content + style + per-property transitions
//   - Shape (rect)
//   - Line w/ start binding (to a rect), no end binding (open arrow)
//   - Arrow with full points
//   - Image with crop + opacity + rotation
//   - Image element acting as a video (playback flags)
//   - Group element with child IDs
//   - Hidden element (visible: false)
//   - Hidden slide
//   - Auto-advance slide
//   - Three slides with non-trivial order
//   - Gradient + image backgrounds (across slides)
//   - Notes with markdown
//   - Resources: one image (data URL), one video (external URL)
//   - Templates: one populated
//   - Theme: non-default
// =============================================================================

function makeFixture(): Presentation {
  return {
    id: 'demo-deck',
    title: 'Demo deck — *with markdown*',
    width: 1920,
    height: 1080,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,

    theme: {
      name: 'Dark',
      colors: {
        primary: '#3b82f6',
        secondary: '#1e40af',
        accent: '#f97316',
        background: '#0b0f19',
        text: '#e5e7eb',
        heading: '#ffffff',
      },
      fonts: { heading: 'Inter', body: 'system-ui' },
    },

    objects: {
      'obj-title': { id: 'obj-title', name: 'Title', type: 'text' },
      'obj-logo': { id: 'obj-logo', name: 'Logo', type: 'image' },
    },

    resources: {
      'res-img': {
        id: 'res-img',
        name: 'cover.png',
        type: 'image',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        originalWidth: 1280,
        originalHeight: 720,
        hash: 'sha256:abc',
      },
      'res-vid': {
        id: 'res-vid',
        name: 'reel.mp4',
        type: 'video',
        src: 'https://example.com/reel.mp4',
        originalWidth: 1920,
        originalHeight: 1080,
        duration: 12.5,
      },
    },

    slides: {
      'slide-a': {
        id: 'slide-a',
        elements: {
          'el-title': {
            id: 'el-title',
            type: 'text',
            x: 100, y: 100, width: 800, height: 200,
            rotation: 0, opacity: 1, locked: false, visible: true,
            text: '# Hello **world**',
            style: {
              fontFamily: 'Inter', fontSize: 48,
              fontWeight: 'bold', fontStyle: 'normal',
              textDecoration: 'none',
              color: '#fff', align: 'left', verticalAlign: 'top',
              lineHeight: 1.2,
            },
            transitions: { position: 'ease', fontSize: 'linear', content: 'typewriter' },
          },
          'el-rect': {
            id: 'el-rect',
            type: 'shape', shapeType: 'rect',
            x: 100, y: 320, width: 400, height: 200,
            rotation: 0, opacity: 0.9, locked: false, visible: true,
            fill: '#3b82f6', stroke: '#1e40af', strokeWidth: 2, cornerRadius: 8,
          },
          'el-img': {
            id: 'el-img',
            type: 'image', resourceId: 'res-img',
            x: 600, y: 320, width: 320, height: 180,
            rotation: 15, opacity: 1, locked: false, visible: true,
            cropX: 120, cropY: 60, cropWidth: 1040, cropHeight: 600,
          },
          'el-hidden': {
            id: 'el-hidden',
            type: 'shape', shapeType: 'ellipse',
            x: 0, y: 0, width: 50, height: 50,
            rotation: 0, opacity: 1, locked: true, visible: false,
            fill: 'transparent', stroke: '#000', strokeWidth: 1, cornerRadius: 0,
          },
        },
        elementOrder: ['el-title', 'el-rect', 'el-img', 'el-hidden'],
        background: { type: 'solid', color: '#0b0f19' },
        transition: { duration: 400 },
        notes: 'Speaker notes with *emphasis* and a list:\n- one\n- two',
        autoAdvance: true,
        autoAdvanceDelay: 4,
      },

      'slide-b': {
        id: 'slide-b',
        elements: {
          'el-line': {
            id: 'el-line',
            type: 'shape', shapeType: 'line',
            x: 200, y: 200, width: 400, height: 0,
            rotation: 0, opacity: 1, locked: false, visible: true,
            fill: '', stroke: '#fff', strokeWidth: 3, cornerRadius: 0,
            points: [0, 0, 400, 0],
            startBinding: { elementId: 'el-rect', anchor: 'right' },
            endBinding: null,
          },
          'el-arrow': {
            id: 'el-arrow',
            type: 'shape', shapeType: 'arrow',
            x: 600, y: 400, width: 300, height: 50,
            rotation: 0, opacity: 1, locked: false, visible: true,
            fill: '', stroke: '#f97316', strokeWidth: 4, cornerRadius: 0,
            points: [0, 0, 300, 50],
          },
          'el-video': {
            id: 'el-video',
            type: 'image', resourceId: 'res-vid',
            x: 100, y: 500, width: 480, height: 270,
            rotation: 0, opacity: 1, locked: false, visible: true,
            cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 0,
            playing: true, loop: false, muted: true, startTime: 2.5,
          },
          'el-group': {
            id: 'el-group',
            type: 'group',
            x: 0, y: 0, width: 100, height: 100,
            rotation: 0, opacity: 1, locked: false, visible: true,
            childIds: ['el-line', 'el-arrow'],
          },
        },
        elementOrder: ['el-line', 'el-arrow', 'el-video', 'el-group'],
        background: {
          type: 'gradient',
          from: '#3b82f6', to: '#0b0f19', direction: 180,
        },
        transition: { duration: 600 },
        notes: '',
        hidden: false,
      },

      'slide-c-hidden': {
        id: 'slide-c-hidden',
        elements: {},
        elementOrder: [],
        background: { type: 'image', src: 'data:image/svg+xml,%3Csvg/%3E' },
        transition: { duration: 200 },
        notes: 'Hidden bonus slide.',
        hidden: true,
      },
    },

    // Order intentionally not alphabetical, to confirm the Y.Array preserves it.
    slideOrder: ['slide-b', 'slide-a', 'slide-c-hidden'],

    templates: {
      'tpl-title': {
        id: 'tpl-title',
        name: 'Title slide',
        elements: {
          'tpl-el-title': {
            id: 'tpl-el-title',
            type: 'text',
            x: 200, y: 400, width: 1520, height: 280,
            rotation: 0, opacity: 1, locked: false, visible: true,
            text: 'Title',
            style: {
              fontFamily: 'Inter', fontSize: 96,
              fontWeight: 'bold', fontStyle: 'normal',
              textDecoration: 'none',
              color: '#fff', align: 'center', verticalAlign: 'middle',
              lineHeight: 1.1,
            },
          },
        },
        elementOrder: ['tpl-el-title'],
        background: { type: 'solid', color: '#000' },
      },
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('jsonToYDoc → yDocToJson', () => {
  test('round-trips a fixture deck deep-equally', () => {
    const fixture = makeFixture();
    const doc = jsonToYDoc(fixture);
    const out = yDocToJson(doc);
    expect(out).toEqual(fixture);
  });

  test('produces the right Y type for each top-level slot', () => {
    const doc = jsonToYDoc(makeFixture());
    const root = doc.getMap(ROOT_KEY);
    expect(root.get('id')).toBe('demo-deck');
    expect(root.get('title')).toBeInstanceOf(Y.Text);
    expect(root.get('slides')).toBeInstanceOf(Y.Map);
    expect(root.get('slideOrder')).toBeInstanceOf(Y.Array);
    expect(root.get('resources')).toBeInstanceOf(Y.Map);
    expect(root.get('templates')).toBeInstanceOf(Y.Map);
    expect(root.get('theme')).toBeInstanceOf(Y.Map);
  });

  test('uses Y.Text for slide notes and text-element text', () => {
    const doc = jsonToYDoc(makeFixture());
    const root = doc.getMap(ROOT_KEY);
    const slides = root.get('slides') as Y.Map<Y.Map<unknown>>;
    expect(slides.get('slide-a')!.get('notes')).toBeInstanceOf(Y.Text);
    const elements = slides.get('slide-a')!.get('elements') as Y.Map<Y.Map<unknown>>;
    expect(elements.get('el-title')!.get('text')).toBeInstanceOf(Y.Text);
    // Shape element has no `text` field.
    expect(elements.get('el-rect')!.get('text')).toBeUndefined();
  });

  test('drops undefined optional fields rather than serialising them', () => {
    const fixture = makeFixture();
    // 'slide-a' has no `hidden` field.
    const doc = jsonToYDoc(fixture);
    const out = yDocToJson(doc);
    expect('hidden' in out.slides['slide-a']).toBe(false);
    expect(out.slides['slide-b'].hidden).toBe(false);
    expect(out.slides['slide-c-hidden'].hidden).toBe(true);
  });

  test('preserves slideOrder ordering exactly', () => {
    const fixture = makeFixture();
    const doc = jsonToYDoc(fixture);
    const out = yDocToJson(doc);
    expect(out.slideOrder).toEqual(['slide-b', 'slide-a', 'slide-c-hidden']);
  });

  test('preserves null bindings on connector shapes', () => {
    const fixture = makeFixture();
    const doc = jsonToYDoc(fixture);
    const out = yDocToJson(doc);
    const line = out.slides['slide-b'].elements['el-line'] as import('../types/presentation').ShapeElement;
    expect(line.startBinding).toEqual({ elementId: 'el-rect', anchor: 'right' });
    expect(line.endBinding).toBeNull();
  });
});

describe('Y-edit observation', () => {
  test('editing a text element\'s text via Y.Text propagates through yDocToJson', () => {
    const doc = jsonToYDoc(makeFixture());
    const root = doc.getMap(ROOT_KEY);
    const slides = root.get('slides') as Y.Map<Y.Map<unknown>>;
    const elements = slides.get('slide-a')!.get('elements') as Y.Map<Y.Map<unknown>>;
    const title = elements.get('el-title')!.get('text') as Y.Text;

    doc.transact(() => {
      title.delete(0, title.length);
      title.insert(0, '## Updated title');
    });

    const out = yDocToJson(doc);
    const updated = out.slides['slide-a'].elements['el-title'] as import('../types/presentation').TextElement;
    expect(updated.text).toBe('## Updated title');
  });

  test('reorderSlides via Y.Array delete+insert preserves new order', () => {
    const doc = jsonToYDoc(makeFixture());
    const root = doc.getMap(ROOT_KEY);
    const slideOrder = root.get('slideOrder') as Y.Array<string>;

    // Move 'slide-c-hidden' to the front.
    doc.transact(() => {
      slideOrder.delete(2, 1);
      slideOrder.insert(0, ['slide-c-hidden']);
    });

    expect(yDocToJson(doc).slideOrder).toEqual([
      'slide-c-hidden',
      'slide-b',
      'slide-a',
    ]);
  });
});
