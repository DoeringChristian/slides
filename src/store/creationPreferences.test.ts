import { afterEach, expect, it, vi } from 'vitest';
import { creationKeyForShape, CREATION_PREFERENCES_KEY, readCreationPreferences, sanitizeCreationStyle, useCreationPreferences } from './creationPreferences';
import { composeUserShape, creationBox } from '../utils/userShapeCreation';
import { CURATED_ICONS } from '../utils/curatedIcons';
import { createShapeElement } from '../utils/slideFactory';
afterEach(() => { useCreationPreferences.setState({ styles: {}, iconId: 'house' }); vi.unstubAllGlobals(); });
it('versioned hydration sanitizes keys, colors, numbers and applicability; unavailable storage is harmless', () => {
  const getItem = vi.fn(() => JSON.stringify({ version: 1, styles: { rect: { id: 'bad', x: 88, width: 90, opacity: .2, transitions: {}, cornerRadius: 999, strokeWidth: -3, fill: 'url(bad)', stroke: '#1234' }, icon: { curve: 'smooth' }, unknown: { fill: '#fff' } } }));
  vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() });
  expect(readCreationPreferences()).toEqual({ rect: { cornerRadius: 100, strokeWidth: 0, stroke: '#1234' }, icon: {} });
  expect(getItem).toHaveBeenCalledWith(CREATION_PREFERENCES_KEY);
  getItem.mockReturnValue('{bad'); expect(readCreationPreferences()).toEqual({});
  getItem.mockReturnValue('{"version":2}'); expect(readCreationPreferences()).toEqual({});
  vi.stubGlobal('localStorage', { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
  expect(readCreationPreferences()).toEqual({});
  expect(() => useCreationPreferences.getState().remember('icon', { stroke: '#f00' })).not.toThrow();
});
it('user composer preserves the pure factory and learns only applicable style per family', () => {
  useCreationPreferences.getState().remember('rect', { cornerRadius: 22, stroke: '#f00', fillStyle: 'hachure', points: [1, 2], x: 4, width: 33 });
  expect(composeUserShape('rect')).toMatchObject({ cornerRadius: 22, stroke: '#f00', x: 100, width: 200, fillStyle: 'hachure' });
  expect(createShapeElement('rect')).toMatchObject({ cornerRadius: 8, stroke: '#000000' });
  expect(composeUserShape('ellipse').stroke).toBe('#000000');
  useCreationPreferences.getState().remember('arrow', { curve: 'bezier', startHead: 'circle', endHead: 'arrow', strokeWidth: 4 });
  expect(composeUserShape('arrow')).toMatchObject({ curve: 'bezier', startHead: 'circle', endHead: 'arrow', strokeWidth: 4 });
  expect(composeUserShape('line').endHead).toBe('none');
  expect(creationKeyForShape(composeUserShape('arrow', { endHead: 'none' }))).toBe('arrow');
  expect(sanitizeCreationStyle('icon', { strokeWidth: NaN, cornerRadius: 44, curve: 'linear', id: 'bad' })).toEqual({});
});
it('icons share styles, not geometry/identity/size; click placement is centered and ignores drag and Shift', () => {
  useCreationPreferences.getState().remember('icon', { stroke: '#ff000080', fill: '#00ff0080', geometry: {}, rotation: 90 });
  const a = composeUserShape('icon');
  useCreationPreferences.getState().chooseIcon('settings');
  const b = composeUserShape('icon');
  expect(b.id).not.toBe(a.id); expect(b.geometry).not.toEqual(a.geometry);
  expect(b).toMatchObject({ stroke: a.stroke, fill: a.fill, rotation: 0, width: 100, height: 100 });
  for (const [ex, ey] of [[20, 40], [-20, 40], [20, -40], [-20, -40]]) {
    for (const shift of [false, true]) {
      expect(creationBox('icon', 200, 300, ex, ey, shift)).toEqual({ x: ex - 32, y: ey - 32, width: 64, height: 64 });
    }
  }
});

it('icon placement fits the selected definition ratio, without learning dimensions or changing factory/imports', () => {
  const definition = CURATED_ICONS[0], original = definition.aspectRatio;
  try {
    for (const [ratio, width, height] of [[2, 64, 32], [.5, 32, 64]]) {
      definition.aspectRatio = ratio;
      expect(creationBox('icon', 0, 0, 100, 200, true)).toEqual({ x: 100 - width / 2, y: 200 - height / 2, width, height });
    }
  } finally { definition.aspectRatio = original; }
  useCreationPreferences.getState().remember('icon', { width: 321, height: 123, fill: '#12345680' });
  expect(useCreationPreferences.getState().styles.icon).toEqual({ fill: '#12345680' });
  expect(composeUserShape('icon', { width: 321, height: 123 })).toMatchObject({ width: 321, height: 123 });
  expect(creationBox('rect', 10, 20, 180, 90)).toEqual({ x: 10, y: 20, width: 170, height: 70 });
});
