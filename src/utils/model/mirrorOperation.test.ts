import { expect, it } from 'vitest';
import { createShapeElement, createSlide, createTextElement } from './slideFactory';
import { mirrorOperation } from './mirrorOperation';
import { resizeBounds, resizeSelection, selectionResizeBounds } from '../geometry/resizeGeometry';
import type { SlideElement } from '../../types/presentation';
const slide=(el:SlideElement)=>({...createSlide(),elements:{[el.id]:el},elementOrder:[el.id]});
it('resizes around the corresponding rotated anchor using destination dimensions',()=>{
 const a=createShapeElement('rect',{id:'a',x:10,y:20,width:100,height:50,rotation:90});
 const b={...a,x:300,y:400,width:200,height:150,rotation:30,visible:false};
 const box=selectionResizeBounds([a]);
 const next=resizeBounds(box,'right',{x:50,y:0},false,false,a.rotation);
 const updates=resizeSelection([a],box,next);
 const actual=mirrorOperation(slide(a),slide(b),updates)[0].changes;
 const dest=selectionResizeBounds([b]);
 const expected=resizeSelection([b],dest,resizeBounds(dest,'right',{x:100,y:0},false,false,b.rotation))[0].changes;
 for(const key of ['x','y','width','height'] as const)expect(actual[key]).toBeCloseTo(expected[key]!,8);
 expect(actual).not.toHaveProperty('visible');
});
it('changes only the edited style field, retaining per-slide typography and hidden state',()=>{
 const a=createTextElement({id:'a'}), b={...a,visible:false,style:{...a.style,fontSize:70,color:'#abcdef'}};
 const updates=mirrorOperation(slide(a),slide(b),[{elementId:'a',changes:{style:{...a.style,fontWeight:'bold'}}}]);
 expect(updates[0].changes).toEqual({style:{...b.style,fontWeight:'bold'}});
});
