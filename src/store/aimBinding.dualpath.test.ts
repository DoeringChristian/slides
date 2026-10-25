import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createUndoManagerFor } from '../collab/activeUndo';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/slideFactory';
import { bindingAimPoint, bindingFor, bindDraftEndpoints, resolveBinding, silhouetteDistance } from '../utils/connectorUtils';
import { pathPointsInSlide } from '../utils/pathEditing';
import { pathBoundsFor } from '../utils/pathShapes';
import { projectGestureScene } from '../utils/gestureProjection';
import { planElementTranslation } from '../utils/elementTranslation';
import { resizeSelection } from '../utils/resizeGeometry';
import type { ShapeElement } from '../types/presentation';
afterEach(()=>setActiveDoc(null));
describe.each([false,true])('aim binding store collab=%s', collab=>{
 it.each(['translate','resize','rotate','focus','co-move','uniform resize','own move'])('%s persists normalized aim and shared projected border',operation=>{
  const p=createPresentation(), sid=p.slideOrder[0];
  const box=createShapeElement('rect',{id:'box',x:300,y:100,width:200,height:100,cornerRadius:0});
  const binding=bindingFor({x:360,y:130},box,'aim');
  const end=resolveBinding(binding,box,{x:0,y:0});
  const arrow=createShapeElement('path',{id:'arrow',...pathBoundsFor([0,0,end.x,end.y],'linear',false),endBinding:binding});
  p.slides[sid].elements={box,arrow};p.slides[sid].elementOrder=['box','arrow'];
  store.setState({presentation:p});editor.setState({activeSlideId:sid,selectedSlideIds:[]});
  const doc=collab?jsonToYDoc(p):null;setActiveDoc(doc);
  const read=()=> (doc?yDocToJson(doc):store.getState().presentation).slides[sid];
  try{
   expect((read().elements.arrow as ShapeElement).endBinding).toEqual(binding);
   const updates=operation==='co-move'||operation==='own move' ? planElementTranslation(read().elements,new Map((operation==='co-move'?['box','arrow']:['arrow']).map(id=>[id,{x:read().elements[id].x,y:read().elements[id].y}])),{x:20,y:30})
    : operation==='uniform resize'?resizeSelection([box,arrow],{x:0,y:0,width:500,height:200},{x:20,y:30,width:1000,height:400})
    :[{elementId:operation==='focus'?'arrow':'box',changes:operation==='translate'?{x:350,y:180}:operation==='resize'?{width:300,height:60}:operation==='rotate'?{rotation:45}:{endBinding:{...binding,fixedPoint:[.7,.7] as [number,number]}}}];
   const projected=projectGestureScene(read(),updates);
   expect(read().elements.arrow).toEqual(arrow);
   store.getState().updateElements(sid,updates);
   const result=read().elements.arrow as ShapeElement;
   expect(result).toEqual(projected.find(el=>el.id==='arrow'));
   if(operation==='own move'){expect(result.endBinding).toBeNull();return;}
   expect(result.endBinding?.fixedPoint).toEqual(operation==='focus'?[.7,.7]:[.3,.3]);
   const pts=pathPointsInSlide(result), target=read().elements.box;
   expect(Math.abs(silhouetteDistance(target,{x:pts[2],y:pts[3]}))).toBeLessThan(1e-7);
   expect(bindingAimPoint(result.endBinding!,target)).not.toEqual({x:pts[2],y:pts[3]});
  }finally{setActiveDoc(null);doc?.destroy();}
 });
});

// A paired aim depends on BOTH target transforms. Endpoint-local similarity
// verification alone must not exempt the end whose own target co-moves.
describe.each([false, true])('paired aim similarity guard collab=%s', collab => {
 it.each(['distinct translations', 'distinct uniform scales', 'exact translation', 'exact uniform scale'])('%s: shared projection, independent border math, atomic undo', operation => {
  const p = createPresentation(), sid = p.slideOrder[0];
  const a = createShapeElement('rect', {id:'a',x:0,y:0,width:100,height:100,cornerRadius:0});
  const b = createShapeElement('rect', {id:'b',x:400,y:100,width:100,height:100,cornerRadius:0});
  const bound = bindDraftEndpoints([30,35,470,165], [a,b]);
  const arrow = createShapeElement('path', {id:'arrow',...pathBoundsFor(bound.absPoints,'linear',false),startBinding:bound.startBinding,endBinding:bound.endBinding});
  p.slides[sid].elements = {a,b,arrow}; p.slides[sid].elementOrder = ['a','b','arrow'];
  store.setState({presentation:p}); editor.setState({activeSlideId:sid,selectedSlideIds:[]}); store.temporal.getState().clear();
  const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
  const undo = doc ? createUndoManagerFor(doc) : null;
  const read = () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid];
  try {
   const before = read();
   const scaling = operation.includes('scale');
   const updates = scaling
    ? resizeSelection([a,b,arrow],{x:0,y:0,width:500,height:200},{x:20,y:30,width:1000,height:400})
    : planElementTranslation(before.elements,new Map([a,b,arrow].map(el => [el.id,{x:el.x,y:el.y}])),{x:20,y:30});
   if(operation==='distinct translations') Object.assign(updates.find(u=>u.elementId==='b')!.changes,{y:b.y+130});
   if(operation==='distinct uniform scales') Object.assign(updates.find(u=>u.elementId==='b')!.changes,{x:20+b.x*1.5,y:30+b.y*1.5,width:b.width*1.5,height:b.height*1.5});
   const projected=projectGestureScene(before,updates);
   expect(read()).toEqual(before);
   store.getState().updateElements(sid,updates);
   const after=read(), result=after.elements.arrow as ShapeElement;
   expect(result).toEqual(projected.find(el=>el.id==='arrow'));
   const af=bindingAimPoint(result.startBinding!,after.elements.a), bf=bindingAimPoint(result.endBinding!,after.elements.b);
   const start=resolveBinding(result.startBinding!,after.elements.a,bf), end=resolveBinding(result.endBinding!,after.elements.b,af);
   const actual=pathPointsInSlide(result);
   [start.x,start.y,end.x,end.y].forEach((v,i)=>expect(actual[i]).toBeCloseTo(v,9));
   expect(result.startBinding?.fixedPoint).toEqual(arrow.startBinding?.fixedPoint);
   expect(result.endBinding?.fixedPoint).toEqual(arrow.endBinding?.fixedPoint);
   if(operation.startsWith('exact')) bound.absPoints.forEach((v,i)=>expect(actual[i]).toBeCloseTo(v*(scaling?2:1)+(i%2?30:20),9));
   else {
    const raw={...arrow,...updates.find(u=>u.elementId==='arrow')!.changes};
    expect(Math.hypot(actual[0]-pathPointsInSlide(raw)[0],actual[1]-pathPointsInSlide(raw)[1])).toBeGreaterThan(1);
   }
   expect(undo?.undoStack.length ?? store.temporal.getState().pastStates.length).toBe(1);
   if(undo) undo.undo(); else store.temporal.getState().undo();
   expect(read().elements).toEqual(before.elements);
   // Keyframes intentionally retain element IDs and local aim metadata, but
   // changing the copied target must not rebind the source slide.
   const copiedId = store.getState().duplicateSlide(sid);
   const presentation = () => doc ? yDocToJson(doc) : store.getState().presentation;
   expect((presentation().slides[copiedId].elements.arrow as ShapeElement).endBinding).toEqual(arrow.endBinding);
   store.getState().updateElement(copiedId,'b',{y:250});
   expect(presentation().slides[sid].elements).toEqual(before.elements);
   expect((presentation().slides[copiedId].elements.arrow as ShapeElement).endBinding?.fixedPoint).toEqual(arrow.endBinding?.fixedPoint);

  } finally {undo?.destroy();setActiveDoc(null);doc?.destroy();}
 });
});

// Independent ray: (0,-100) + t*(150,250), y=100 => t=.8 => x=120.
describe.each([false,true])('stationary aim endpoint resize collab=%s',collab=>{
 it.each(['startBinding','endBinding'] as const)('%s resolves changed incoming direction with unselected target',end=>{
  for(const group of [false,true]) {
   const p=createPresentation(),sid=p.slideOrder[0];
   const box=createShapeElement('rect',{id:'box',x:100,y:100,width:100,height:100,cornerRadius:0});
   const binding={elementId:'box',mode:'aim' as const,fixedPoint:[.5,.5] as [number,number],gap:0};
   const arrow=createShapeElement('path',{id:'arrow',x:0,y:0,width:100,height:100,points:end==='endBinding'?[0,0,100,100]:[100,100,0,0],[end]:binding});
   const unrelated=createShapeElement('rect',{id:'unrelated',x:20,y:20,width:10,height:10});
   p.slides[sid].elements={box,arrow,unrelated};p.slides[sid].elementOrder=['box','arrow','unrelated'];
   store.setState({presentation:p});editor.setState({activeSlideId:sid,selectedSlideIds:[]});store.temporal.getState().clear();
   const doc=collab?jsonToYDoc(p):null;setActiveDoc(doc);const undo=doc?createUndoManagerFor(doc):null;
   const read=()=> (doc?yDocToJson(doc):store.getState().presentation).slides[sid];
   try {
    const updates=resizeSelection(group?[arrow,unrelated]:[arrow],{x:0,y:0,width:100,height:100},{x:0,y:-100,width:100,height:200});
    const projected=projectGestureScene(read(),updates);store.getState().updateElements(sid,updates);
    const result=read().elements.arrow as ShapeElement;
    expect(result).toEqual(projected.find(el=>el.id==='arrow'));
    expect(result[end]).toEqual(binding);
    const expected=end==='endBinding'?[0,-100,120,100]:[120,100,0,-100];
    pathPointsInSlide(result).forEach((v,i)=>expect(v).toBeCloseTo(expected[i],9));
    expect(read().elements.box).toEqual(box);
    if(undo)undo.undo();else store.temporal.getState().undo();expect(read().elements.arrow).toEqual(arrow);
   }finally{undo?.destroy();setActiveDoc(null);doc?.destroy();}
  }
 });
});
