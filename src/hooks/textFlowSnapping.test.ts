import { expect, it } from 'vitest';
import { computeGuides, computePointSnap, computeResizeSnap } from './useAlignmentGuides';
const anchor = {x:100,y:100,width:200,height:100,textFlow:{top:10,bottom:70}};
const moving = {x:110,y:167,width:150,height:80,textFlow:{top:5,bottom:35}};
it('continues after rendered rows, not the outer text box; also snaps above',()=>{
 const below=computeGuides(moving,[anchor]);
 expect(below.snapY).toBe(165);expect(below.guides).toContainEqual({type:'horizontal',position:170});
 expect(computeGuides({...moving,y:77},[anchor]).snapY).toBe(75);
});
it('requires text in the same horizontal band and visible flow boundary',()=>{
 expect(computeGuides({...moving,textFlow:undefined},[anchor]).snapY).toBeNull();
 expect(computeGuides(moving,[{...anchor,textFlow:undefined}]).snapY).toBeNull();
 expect(computeGuides({...moving,x:500},[anchor]).snapY).toBeNull();
 expect(computeGuides(moving,[anchor],5,null,{x:0,y:0,width:500,height:160}).snapY).toBeNull();
 expect(computeGuides(moving,[anchor],1).snapY).toBeNull();
});
it('does not introduce text-flow targets for drawing or resize handles',()=>{
 expect(computePointSnap({x:110,y:167},[anchor]).snapY).toBeNull();
 const snap=computeResizeSnap(moving,[anchor]);
 expect(snap.topSnap).toBeNull();
});
