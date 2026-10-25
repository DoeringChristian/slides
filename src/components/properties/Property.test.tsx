import { describe, expect, test, vi } from 'vitest';
import type { ComponentProps, ReactElement } from 'react';
vi.mock('../../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { NumberProperty } from './Property';
import { NumberEditor } from './scrubEditors';
import { applyScrubDelta, commitValue, parseInput } from '../../utils/scrub';

describe('NumberProperty display scale', () => {
  const property = new NumberProperty<{ opacity: number }>({ key: 'opacity', label: 'Opacity', transitionGroup: 'opacity',
    min: 0, max: 100, scale: 100, step: 1, scrubStep: 0.5, precision: 1 });
  const el = { opacity: 0.75 };
  const editor = property.renderEditor({ element: el, update: vi.fn() }) as ReactElement<ComponentProps<typeof NumberEditor<typeof el>>>;
  test('uses the standard scrub editor with display units and unchanged transition/sync metadata', () => {
    expect(editor.type).toBe(NumberEditor);
    expect(editor.props.value).toBe(75);
    expect(property.syncFields).toEqual(['opacity']);
    expect(property.transitionGroup).toBe('opacity');
    expect(editor.props.changesFor(el, 42.5)).toEqual({ opacity: 0.425 });
  });
  test('typed bounds, Shift fine and Ctrl whole numbers operate before conversion to stored units', () => {
    const spec = editor.props.spec;
    expect(editor.props.changesFor(el, parseInput('200', spec)!)).toEqual({ opacity: 1 });
    expect(editor.props.changesFor(el, parseInput('-1', spec)!)).toEqual({ opacity: 0 });
    const fine = applyScrubDelta(75, 10, spec, true);
    expect(fine).toBe(75.5);
    expect(editor.props.changesFor(el, commitValue(fine, spec))).toEqual({ opacity: 0.755 });
    expect(editor.props.changesFor(el, commitValue(fine, spec, 1))).toEqual({ opacity: 0.76 });
  });
  test('ordinary unscaled numbers and opt-in wrapping remain reusable', () => {
    const rotation = new NumberProperty<{ rotation: number }>({ key: 'rotation', label: 'Rotation', min: 0, wrap: 360, precision: 1 });
    const node = rotation.renderEditor({ element: { rotation: 359 }, update: vi.fn() });
    expect(node.props.spec.wrap).toBe(360);
    expect(node.props.value).toBe(359);
    expect(node.props.changesFor({ rotation: 359 }, commitValue(360, node.props.spec))).toEqual({ rotation: 0 });
  });
});
