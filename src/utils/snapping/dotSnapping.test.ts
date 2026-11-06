import { describe, it, expect } from 'vitest';
import { snapDotCenter } from './dotSnapping';
import { createShapeElement } from '../model/slideFactory';
const line = createShapeElement('path', {x:100,y:100,width:100,height:100,points:[0,0,100,100]});
describe('dot centre snapping', () => {
  it('projects onto diagonal centreline and endpoints', () => {
    expect(snapDotCenter({x:150,y:154},[line],5)).toEqual({x:152,y:152});
    expect(snapDotCenter({x:98,y:98},[line],5)).toEqual({x:100,y:100});
    expect(snapDotCenter({x:150,y:170},[line],5)).toBeUndefined();
  });
  it('ignores hidden lines and offscreen snap points', () => {
    expect(snapDotCenter({x:150,y:150},[{...line,visible:false}],5)).toBeUndefined();
    expect(snapDotCenter({x:150,y:150},[line],5,{x:0,y:0,width:120,height:120})).toBeUndefined();
  });
  it('uses rotated paths', () => {
    expect(snapDotCenter({x:150,y:154},[{...line,rotation:90}],5)).toEqual({x:148,y:152});
  });
});

it('preserves dot identity through save schema and Yjs round trips', async () => {
  const { createPresentation } = await import('../model/slideFactory');
  const { composeLineDot } = await import('../editor/userShapeCreation');
  const { assertPresentation } = await import('../model/currentPresentation');
  const { jsonToYDoc, yDocToJson } = await import('../../collab/ySchema');
  const deck = createPresentation(), dot = composeLineDot(100, 200);
  const slide = deck.slides[deck.slideOrder[0]];
  slide.elements[dot.id] = dot; slide.elementOrder.push(dot.id);
  const saved = assertPresentation(JSON.parse(JSON.stringify(deck)));
  const doc = jsonToYDoc(saved);
  expect(yDocToJson(doc).slides[slide.id].elements[dot.id]).toEqual(dot);
  doc.destroy();
});

it('uses only the dot centre for alignment, in both directions', async () => {
  const {computeGuides,computePointSnap}=await import('../../hooks/useAlignmentGuides');
  const dot={x:100,y:100,width:24,height:24,shapeType:'dot'};
  expect(computePointSnap({x:101,y:101},[dot],3)).toMatchObject({snapX:null,snapY:null});
  expect(computePointSnap({x:113,y:113},[dot],3)).toMatchObject({snapX:112,snapY:112});
  expect(computeGuides(dot,[{x:113,y:113,width:0,height:0}],3)).toMatchObject({snapX:101,snapY:101});
  expect(computeGuides(dot,[{x:101,y:101,width:0,height:0}],3)).toMatchObject({snapX:null,snapY:null});
});
it('binds connectors to the dot centre with the normal optional gap', async () => {
  const {bindingForDrop,resolveBinding,connectorDockCue}=await import('../paths/connectorUtils');
  const dot=createShapeElement('dot',{id:'dot',x:100,y:100,width:24,height:24});
  const binding=bindingForDrop({x:101,y:109},dot);
  expect(binding.fixedPoint).toEqual([.5,.5]);
  expect(resolveBinding(binding,dot,{x:212,y:112})).toEqual({x:112,y:112});
  expect(resolveBinding({...binding,gap:8},dot,{x:212,y:112})).toEqual({x:120,y:112});
  expect(resolveBinding(binding,{...dot,x:200,width:48,height:48},{x:0,y:0})).toEqual({x:224,y:124});
  expect(connectorDockCue({x:108,y:112},dot)?.point).toEqual({x:112,y:112});
  // Ordinary ellipse attachment still resolves to its outline.
  const ellipse={...dot,shapeType:'ellipse' as const};
  expect(resolveBinding(binding,ellipse,{x:212,y:112})).toEqual({x:124,y:112});
});
