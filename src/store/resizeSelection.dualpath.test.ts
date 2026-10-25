import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../utils/keyboard', () => ({ isShiftHeld: () => false, isCtrlHeld: () => false }));
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { setActiveDoc } from '../collab/yDocAdapter';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { createPresentation, createShapeElement } from '../utils/slideFactory';
import { bindingFor, resolveBinding } from '../utils/connectorUtils';
import { pathPointsInSlide } from '../utils/pathEditing';
import { resizeBounds, resizeSelection, selectionResizeBounds } from '../utils/resizeGeometry';
import type { ShapeElement } from '../types/presentation';

afterEach(() => setActiveDoc(null));

function fixture(collab: boolean, locked = false) {
  const p = createPresentation(), sid = p.slideOrder[0];
  const a = createShapeElement('rect', { id: 'a', x: 0, y: 0, width: 100, height: 100, cornerRadius: 0 });
  const b = createShapeElement('rect', { id: 'b', x: 200, y: 0, width: 100, height: 100, cornerRadius: 0 });
  const startBinding = bindingFor({ x:95, y:20 }, a, 'aim');
  const endBinding = bindingFor({ x:205, y:80 }, b, 'aim');
  const start = resolveBinding(startBinding, a, { x:205, y:80 });
  const end = resolveBinding(endBinding, b, { x:95, y:20 });
  const bound = { startBinding, endBinding, absPoints:[start.x,start.y,end.x,end.y] };
  const arrow = createShapeElement('path', {
    id: 'arrow', x: bound.absPoints[0], y: bound.absPoints[1], width: 100,
    height: bound.absPoints[3] - bound.absPoints[1], rotation: 0,
    points: [0, 0, 100, bound.absPoints[3] - bound.absPoints[1]],
    startBinding: bound.startBinding, endBinding: bound.endBinding,
  });
  b.locked = locked;
  p.slides[sid].elements = { a, b, arrow }; p.slides[sid].elementOrder = ['a', 'b', 'arrow'];
  store.setState({ presentation: p }); editor.setState({ activeSlideId: sid, selectedSlideIds: [] });
  const doc = collab ? jsonToYDoc(p) : null; setActiveDoc(doc);
  return {
    sid,
    read: () => (doc ? yDocToJson(doc) : store.getState().presentation).slides[sid].elements,
    dispose: () => { setActiveDoc(null); doc?.destroy(); },
  };
}

describe.each([false,true])('bbox uniform group resize collab=%s',collab=>{
  it.each(['both','one','none'])('%s targets preserve exact uniform path geometry and binding policy',targets=>{
    const f=fixture(collab);
    try {
      const before=f.read();
      const ids=targets==='both'?['arrow','a','b']:targets==='one'?['arrow','a']:['arrow'];
      const selected=ids.map(id=>before[id]);
      const b=selectionResizeBounds(selected), c={x:b.x+b.width/2,y:b.y+b.height/2};
      const next=resizeBounds(b,'bottom-right',{x:b.width/4,y:b.height/4},true,true);
      const updates=resizeSelection(selected,b,next);
      store.getState().updateElements(f.sid,updates);
      const after=f.read(), arrow=after.arrow as ShapeElement;
      const points=pathPointsInSlide(before.arrow as ShapeElement);
      pathPointsInSlide(arrow).forEach((v,i)=>expect(v).toBeCloseTo((points[i]-(i%2?c.y:c.x))*1.5+(i%2?c.y:c.x),9));
      expect(arrow.startBinding).toEqual(targets==='none'?null:(before.arrow as ShapeElement).startBinding);
      expect(arrow.endBinding).toEqual(targets==='both'?(before.arrow as ShapeElement).endBinding:null);
    }finally{f.dispose();}
  });
});


describe.each([false,true])('nonuniform pinned co-target resize collab=%s',collab=>{
  it.each([45,135])('rotated %s° target and moved connector remain attached',rotation=>{
    const p=createPresentation(),sid=p.slideOrder[0];
    const target=createShapeElement('rect',{id:'target',x:150,y:150,width:100,height:100,rotation});
    const binding={elementId:'target',mode:'pinned' as const,fixedPoint:[1,.5] as [number,number]};
    const pin=resolveBinding(binding,target,{x:400,y:200});
    const arrow=createShapeElement('path',{id:'arrow',x:pin.x,y:pin.y,width:100,height:1,points:[0,0,100,0],startBinding:binding});
    p.slides[sid].elements={target,arrow};p.slides[sid].elementOrder=['target','arrow'];
    store.setState({presentation:p});editor.setState({activeSlideId:sid,selectedSlideIds:[]});
    const doc=collab?jsonToYDoc(p):null;setActiveDoc(doc);
    try {
      const b=selectionResizeBounds([target,arrow]);
      const updates=resizeSelection([target,arrow],b,{...b,width:b.width*2});
      const raw={...arrow,...updates.find(u=>u.elementId==='arrow')!.changes};
      store.getState().updateElements(sid,updates);
      const after=(doc?yDocToJson(doc):store.getState().presentation).slides[sid].elements;
      const out=after.arrow as ShapeElement,points=pathPointsInSlide(out);
      const expected=resolveBinding(binding,after.target,{x:points[2],y:points[3]});
      expect(points[0]).toBeCloseTo(expected.x,9);expect(points[1]).toBeCloseTo(expected.y,9);
      expect(Math.hypot(points[0]-pathPointsInSlide(raw)[0],points[1]-pathPointsInSlide(raw)[1])).toBeGreaterThan(1);
      expect(out.startBinding).toEqual(binding);
    }finally{setActiveDoc(null);doc?.destroy();}
  });
});
