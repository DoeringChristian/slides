import { expect, it } from 'vitest';
import { createShapeElement } from '../../utils/model/slideFactory';
import { isVisibilityFadeOut } from './transitionSide';
import { interpolateWithVisibility } from '../../utils/animation/interpolation';

it('disappearing arrows store visibility on the source even when the target exists but is hidden', () => {
  const arrow = createShapeElement('path', { id:'arrow', points:[0,0,100,0], width:100, height:0, endHead:'arrow', creationPreset:'arrow' });
  const hidden = { ...arrow, visible:false };
  expect(isVisibilityFadeOut(arrow,hidden,'visibility')).toBe(true);
  expect(isVisibilityFadeOut(arrow,undefined,'visibility')).toBe(true);
  expect(isVisibilityFadeOut(hidden,arrow,'visibility')).toBe(false);
  const frames = ['linear','create','extend','wipe','grow'].map(easing => {
    const source = { ...arrow, transitions:{ visibility:easing } } as typeof arrow;
    return interpolateWithVisibility(source,hidden,.25);
  });
  expect(new Set(frames.map(frame=>JSON.stringify(frame))).size).toBe(5);
  expect(frames[0]?.opacity).toBeCloseTo(.5);
});
