import { expect, it } from 'vitest';
import { createShapeElement } from '../model/slideFactory';
import { canJoinPaths, planJoinPaths } from './joinPaths';
import { pathPointsInSlide } from './pathEditing';
const line = (id: string, points: number[], extra = {}) => createShapeElement('path', {id, x:0,y:0,width:100,height:100,points,curve:'linear', ...extra});
it('joins nearest endpoints regardless of selection order and preserves outer heads', () => {
  const a=line('a',[10,0,20,0]), b=line('b',[30,0,20,0],{startHead:'triangle'}), c=line('c',[0,0,10,0],{startHead:'circle'});
  const updates=planJoinPaths([a,b,c],['a','b','c']);
  const result={...a,...updates[0].changes} as typeof a;
  expect(pathPointsInSlide(result)).toEqual([0,0,10,0,20,0,30,0]);
  expect(result.startHead).toBe('circle');expect(result.endHead).toBe('triangle');
  expect(updates.slice(1).map(u=>u.changes)).toEqual([{visible:false},{visible:false}]);
  expect(a.points).toEqual([10,0,20,0]);
});
it('preserves reversed rotated Bézier handles and makes gaps straight',()=>{
  const a=line('a',[0,0,100,0],{curve:'bezier', tangents:[0,0,20,30,-10,40,0,0]});
  const b=line('b',[0,0,100,0],{x:150,curve:'bezier',rotation:180,tangents:[0,0,20,30,-10,40,0,0]});
  const updates=planJoinPaths([a,b],['a','b']);
  const result={...a,...updates[0].changes} as typeof a;
  expect(pathPointsInSlide(result)).toEqual([0,0,100,0,150,100,250,100]);
  expect(result.tangents?.slice(0,8)).toEqual([0,0,20,30,-10,40,0,0]);
  expect(result.tangents?.[10]).toBeCloseTo(10);expect(result.tangents?.[11]).toBeCloseTo(-40);
  expect(result.tangents?.[12]).toBeCloseTo(-20);expect(result.tangents?.[13]).toBeCloseTo(-30);
});
it('rejects closed, locked, incomplete, mixed and rounded-polylines selections',()=>{
  const a=line('a',[0,0,100,0]);
  for(const overrides of [{closed:true},{locked:true},{visible:false},{points:[0,0]},{points:[0,0,NaN,0]},{points:[0,0,50,10,100,0],cornerRadius:10}])
    expect(canJoinPaths([a,{...line('b',[100,0,200,0]),...overrides}])).toBe(false);
  expect(planJoinPaths([a],['a','missing'])).toEqual([]);
  expect(canJoinPaths([a,a])).toBe(false);
});
