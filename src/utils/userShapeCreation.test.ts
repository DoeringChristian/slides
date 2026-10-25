import { afterEach, expect, it, vi } from 'vitest';
import { composeUserShape } from './userShapeCreation';
import { createShapeElement } from './slideFactory';
import { readCreationPreferences, useCreationPreferences } from '../store/creationPreferences';

afterEach(() => { useCreationPreferences.setState({ styles: {} }); vi.unstubAllGlobals(); });

it.each(['line', 'arrow'] as const)('%s two-point gestures have endpoints despite remembered closure, without forgetting style', tool => {
  let saved = '';
  vi.stubGlobal('localStorage', { setItem: (_key: string, value: string) => { saved = value; }, getItem: () => saved });
  const style = { closed: true, curve: 'smooth' as const, startHead: 'circle' as const, endHead: 'arrow' as const, stroke: '#123456', strokeWidth: 5 };
  useCreationPreferences.getState().remember(tool, style);
  useCreationPreferences.setState({ styles: readCreationPreferences() });
  expect(composeUserShape(tool)).toMatchObject({ ...style, closed: false });
  expect(composeUserShape(tool, { points: [0, 0, 180, 100] })).toMatchObject({ ...style, closed: false });
  expect(composeUserShape(tool, { points: [0, 0, 100, 80, 180, 100] })).toMatchObject(style);
  expect(useCreationPreferences.getState().styles[tool]).toEqual(style);
  expect(readCreationPreferences()[tool]).toEqual(style);
});

it('explicit authored closure and other multipoint families are not forced open', () => {
  expect(composeUserShape('arrow', { closed: true, points: [0, 0, 100, 80] }).closed).toBe(true);
  expect(createShapeElement('path', { closed: true, points: [0, 0, 100, 80] }).closed).toBe(true);
  for (const [key, tool] of [['curve', 'bspline'], ['polygon', 'polygon']] as const) {
    useCreationPreferences.getState().remember(key, { closed: true });
    expect(composeUserShape(tool).closed).toBe(true);
  }
});
