import { afterEach, describe, expect, test } from 'vitest';
import { visibilityTypesFor } from './easingCatalog';
import { stickyTransitionsFor } from './stickyEasings';
import { createShapeElement } from '../model/slideFactory';
import { useEditorStore } from '../../store/editorStore';

const initial = useEditorStore.getState();
afterEach(() => useEditorStore.setState(initial, true));

describe('extend visibility easing', () => {
  // `extend` grows along a path's route; buildExtendFx has none on a rect or
  // ellipse, where it used to be offered and silently played a plain fade.
  test('is offered for paths only', () => {
    expect(visibilityTypesFor(createShapeElement('path', { points: [0, 0, 100, 0] }))).toContain('extend');
    for (const kind of ['rect', 'ellipse'] as const) {
      const types = visibilityTypesFor(createShapeElement(kind, {}));
      expect(types).not.toContain('extend');
      expect(types).toContain('create');
    }
  });

  test('a remembered extend does not follow onto a rect', () => {
    useEditorStore.setState({ lastEasings: { shape: { visibility: 'extend' } } });
    expect(stickyTransitionsFor(createShapeElement('path', { points: [0, 0, 100, 0] })).visibility).toBe('extend');
    expect(stickyTransitionsFor(createShapeElement('rect', {})).visibility).toBeUndefined();
  });
});
