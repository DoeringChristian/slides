import { expect, it, vi } from 'vitest';
import { assertPresentation, importPresentationFile } from './importPresentation';
import { createPresentation, createShapeElement } from './slideFactory';

it('accepts legitimate empty decks and preserves unknown optional fields and timestamps', () => {
  const p = { ...createPresentation(), slides: {}, slideOrder: [], optionalFutureField: { value: 1 } };
  expect(assertPresentation(p)).toBe(p);
});
for (const value of [null, [], {}, { slides: {}, slideOrder: [] }]) it(`rejects bad root ${JSON.stringify(value)}`, () => {
  expect(() => assertPresentation(value)).toThrow('Invalid presentation:');
});
it('rejects dangling, duplicate, omitted and mismatched slide IDs with actionable errors', () => {
  const p = createPresentation(), sid = p.slideOrder[0];
  expect(() => assertPresentation({ ...p, slideOrder: ['missing'] })).toThrow('missing ID "missing"');
  expect(() => assertPresentation({ ...p, slideOrder: [sid, sid] })).toThrow('unique string IDs');
  expect(() => assertPresentation({ ...p, slideOrder: [] })).toThrow('missing from its order');
  expect(() => assertPresentation({ ...p, slides: { [sid]: { ...p.slides[sid], id: 'wrong' } } })).toThrow('mismatched ID');
});
it('rejects malformed element order and non-text dangling references without sanitizing them away', () => {
  const p = createPresentation(), s = p.slides[p.slideOrder[0]];
  s.elementOrder = ['missing']; expect(() => assertPresentation(p)).toThrow('missing ID "missing"');
  const el = createShapeElement('path', { id: 'connector', endBinding: { elementId: 'missing', mode: 'aim', fixedPoint: [.5, .5] } });
  s.elements = { connector: el }; s.elementOrder = ['connector'];
  expect(() => assertPresentation(p)).toThrow('references missing element "missing"');
});
it('validates slide and template transitions in separate namespaces even when their IDs overlap', () => {
  const p = createPresentation(), s = p.slides[p.slideOrder[0]];
  p.templates[s.id] = { id: s.id, name: 'Same-key template', elements: {}, elementOrder: [], background: s.background };
  expect(assertPresentation(p)).toBe(p);
  expect(() => assertPresentation({ ...p, slides: { [s.id]: { ...s, transition: null } } })).toThrow(`transition of ${s.id}`);
});
it('imports native JSON without rewriting timestamps or project identity during parsing', async () => {
  const p = createPresentation();
  expect(await importPresentationFile({ name: 'deck.json', text: async () => JSON.stringify(p) } as File)).toEqual(p);
});
vi.mock('./importPptx', () => ({ importPptx: vi.fn(() => 'pptx-parser') }));
vi.mock('./importOdp', () => ({ importOdp: vi.fn(() => 'odp-parser') }));
for (const ext of ['pptx', 'odp']) it(`retains advertised ${ext} parser dispatch`, async () => {
  expect(await importPresentationFile({ name: `deck.${ext}` } as File)).toBe(`${ext}-parser`);
});
