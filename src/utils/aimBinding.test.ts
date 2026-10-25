import { describe, expect, it } from 'vitest';
import { bindingAimPoint, bindingFor, bindDraftEndpoints, rebindAfterElementsMoved, resolveBinding, silhouetteDistance } from './connectorUtils';
import { createShapeElement } from './slideFactory';
import { pathBoundsFor } from './pathShapes';
import { pathPointsInSlide } from './pathEditing';
import type { ShapeElement } from '../types/presentation';

const target = createShapeElement('rect', { id:'box', x:200, y:100, width:200, height:100, cornerRadius:0 });
const aim = bindingFor({ x:260,y:130 },target,'aim');
const solve = (shape: ShapeElement, box = target) => {
 const elements = { arrow:shape, box };
 const patch = rebindAfterElementsMoved(elements,['arrow','box'],new Set(['arrow','box']))[0];
 return patch ? {...shape,...patch.changes} : shape;
};
describe('normalized interior aim border binding', () => {
 it.each([0,30,90,180])('normalized aim rotates with target %s', rotation => {
  const box={...target, rotation, x:300, width:400,height:70};
  const focus=bindingAimPoint(aim,box), recovered=bindingFor(focus,box,'aim');
  expect(recovered.fixedPoint![0]).toBeCloseTo(.3,10); expect(recovered.fixedPoint![1]).toBeCloseTo(.3,10);
  const end=resolveBinding(aim,box,{x:-500,y:-500});
  expect(Math.abs(silhouetteDistance(box,end))).toBeLessThan(1e-7);
  expect(Math.hypot(focus.x-end.x,focus.y-end.y)).toBeGreaterThan(1);
 });
 it.each(['rect','ellipse','triangle','star'] as const)('uses shared %s boundary', shapeType => {
  const box={...target,shapeType,cornerRadius:30};
  const binding=bindingFor({x:300,y:150},box,'aim');
  const point=resolveBinding(binding,box,{x:0,y:0});
  expect(Math.abs(silhouetteDistance(box,point))).toBeLessThan(1e-6);
 });
 it.each([0,1e-12,.001,1])('tiny target %s resolves finite and repeatably', size => {
  const box={...target,width:size,height:size};
  const binding=bindingFor({x:200,y:100},box,'aim');
  const p=resolveBinding(binding,box,{x:0,y:0});
  expect(Number.isFinite(p.x)&&Number.isFinite(p.y)).toBe(true);
  expect(resolveBinding(binding,box,{x:0,y:0})).toEqual(p);
 });
 it('two straight bound ends solve toward opposite aims, not old visible endpoints', () => {
  const a={...target,id:'a',x:0,y:0}, b={...target,id:'b',x:400,y:100};
  const bound=bindDraftEndpoints([60,30,460,170],[a,b]);
  const arrow=createShapeElement('path',{id:'arrow',...pathBoundsFor(bound.absPoints,'linear',false),startBinding:bound.startBinding,endBinding:bound.endBinding});
  const patch=rebindAfterElementsMoved({a,b,arrow},['arrow'],new Set(['arrow']))[0];
  const actual=pathPointsInSlide({...arrow,...patch.changes});
  actual.forEach((v,i)=>expect(v).toBeCloseTo(bound.absPoints[i],8));
 });
 it('multipoint/curves preserve adjacent vertex and manual tangents', () => {
  const arrow=createShapeElement('path',{id:'arrow',...pathBoundsFor([0,0,100,60,200,120],'bezier',false),curve:'bezier',tangents:[0,0,10,20,-10,-20,10,20,-10,-20,0,0],endBinding:aim});
  const result=solve(arrow);
  expect(pathPointsInSlide(result).slice(0,4)).toEqual([0,0,100,60]);
  expect(result.tangents).toEqual(arrow.tangents);
  expect(Math.abs(silhouetteDistance(target,{x:pathPointsInSlide(result)[4],y:pathPointsInSlide(result)[5]}))).toBeLessThan(1e-7);
 });
 it('target moving through overlap uses finite focus fallback, then restores border', () => {
  const a={...target,id:'a',x:0,y:0,width:100,height:100};
  for(const x of [300,80,0,-80,-300,300]){
   const b={...a,id:'b',x};
   const startBinding=bindingFor({x:50,y:50},a,'aim');
   const endBinding=bindingFor({x:x+50,y:50},b,'aim');
   const arrow=createShapeElement('path',{id:'arrow',points:[0,0,200,0],startBinding,endBinding});
   const run=()=>rebindAfterElementsMoved({a,b,arrow},['arrow'],new Set(['a','b']))[0];
   expect(run()).toEqual(run());
   const pts=pathPointsInSlide({...arrow,...run().changes});
   expect(pts.every(Number.isFinite)).toBe(true);
   expect((pts[2]-pts[0])*x).toBeGreaterThanOrEqual(0);
   if(Math.abs(x)>100)expect(Math.abs(silhouetteDistance(a,{x:pts[0],y:pts[1]}))).toBeLessThan(1e-7);
  }
 });
 it('co-moving own target cannot exempt a differently moving opposite aim', () => {
  const a={...target,id:'a',x:0,y:0,width:100,height:100}, b={...target,id:'b',x:300,y:0,width:100,height:100};
  const bound=bindDraftEndpoints([50,50,350,50],[a,b]);
  const arrow=createShapeElement('path',{id:'arrow',...pathBoundsFor(bound.absPoints,'linear',false),startBinding:bound.startBinding,endBinding:bound.endBinding});
  const before={a,b,arrow}, after={a:{...a,x:20},b:{...b,x:320,y:100},arrow:{...arrow,x:arrow.x+20}};
  const update=rebindAfterElementsMoved(after,['arrow'],new Set(['a','b','arrow']),before)[0];
  const pts=pathPointsInSlide({...after.arrow,...update.changes});
  expect(pts[1]).toBeGreaterThan(50);
  const focus=bindingAimPoint(bound.endBinding!,after.b), expected=resolveBinding(bound.startBinding!,after.a,focus);
  expect(pts[0]).toBeCloseTo(expected.x,8);expect(pts[1]).toBeCloseTo(expected.y,8);
 });
 it('interior pins remain inside and new bindings use aim', () => {
  const pin={...aim,mode:'pinned' as const};
  expect(resolveBinding(pin,target,{x:0,y:0})).toEqual({x:260,y:130});
  expect(bindingFor({x:190,y:120},target,'aim').mode).toBe('aim');
 });
});
