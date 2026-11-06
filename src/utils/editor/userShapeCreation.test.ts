import { afterEach, expect, it, vi } from 'vitest';
import { composeUserShape, composeLineDot } from './userShapeCreation';
import { createShapeElement } from '../model/slideFactory';
import { readCreationPreferences, useCreationPreferences } from '../../store/creationPreferences';

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

it('line dots use stroke paint and size without consuming ellipse preferences', () => {
  useCreationPreferences.getState().remember('line', {stroke:'#123456',strokeWidth:8});
  useCreationPreferences.getState().remember('ellipse', {fill:'#abcdef',strokeWidth:20});
  expect(composeLineDot(100,200)).toMatchObject({shapeType:'dot',x:88,y:188,width:24,height:24,fill:'#123456',stroke:'none',strokeWidth:0,opacity:1});
  expect(useCreationPreferences.getState().styles.ellipse?.fill).toBe('#abcdef');
});
