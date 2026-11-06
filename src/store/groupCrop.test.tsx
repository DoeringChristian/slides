import { afterEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createShapeElement, createImageElement, duplicateElements } from '../utils/model/slideFactory';
import { attachGroupCrops, groupCropRegions, type GroupCropElement } from '../utils/model/groupCrop';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager } from '../collab/activeUndo';
import { RenderElement } from '../components/svg/ElementRenderer';
import { renderSlideToSVG } from '../utils/io/svgRenderer';
import { composeSlideFrame } from '../components/presenter/presenterUtils';

afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); });
it.each([false,true])('crop is an undoable ordinary group property (collab=%s)', collab => {
  const p=createPresentation(), slide=p.slides[p.slideOrder[0]];
  const shape=createShapeElement('ellipse',{id:'boundary',x:100,y:100,width:80,height:60,rotation:30,fill:'#00ff00',stroke:'#123456',strokeWidth:4});
  const image=createImageElement(null,200,100,{id:'media',x:50,y:50,width:200,height:100});
  slide.elements={boundary:shape,media:image};slide.elementOrder=['boundary','media'];
  store.setState({presentation:structuredClone(p)});store.temporal.getState().clear();
  editor.setState({activeSlideId:slide.id,activeObjectGroupId:null,selectedElementIds:['boundary','media'],autoDrawMode:false,selectedSlideIds:[]});
  const doc=collab?jsonToYDoc(p):null;setActiveDoc(doc);
  const undo=doc?createUndoManagerFor(doc):null;setActiveUndoManager(undo);
  const read=()=> (doc?yDocToJson(doc):store.getState().presentation).slides[slide.id];
  store.getState().setGroupCrop(slide.id,['boundary','media'],'boundary');
  const cropped=structuredClone(read()), boundary=cropped.elements.boundary;
  expect(boundary.type).toBe('shape');
  if(boundary.type!=='shape') throw Error('shape');
  expect(boundary.cropGroupId).toBe(boundary.objectGroupIds?.[0]);
  expect(cropped.elements.media.objectGroupIds).toEqual(boundary.objectGroupIds);
  expect(boundary.fill).toBe('#00ff00');expect(cropped.elements.media.x).toBe(50);
  const painted=attachGroupCrops(cropped.elementOrder.map(id=>cropped.elements[id]));
  expect(painted.map(el=>el.id)).toEqual(['media','boundary']);
  expect((painted[0] as GroupCropElement)._groupClips?.[0].x).toBe(100);
  const outline=renderToStaticMarkup(<RenderElement element={painted[1]}/>);
  expect(outline).toContain('fill="none"');expect(outline).toContain('stroke="#123456"');
  const frame=composeSlideFrame({slideA:cropped,slideB:null,isForward:true,animProgress:0,isAnimating:false});
  expect((frame.renderedElements.find(el=>el.id==='media') as GroupCropElement)._groupClips).toHaveLength(1);
  const markup=renderSlideToSVG(cropped,{});expect(markup).toContain('clipPathUnits="userSpaceOnUse"');expect(markup).toContain('rotate(30, 140, 130)');
  const copies=duplicateElements(Object.values(cropped.elements));
  const copiedBoundary=copies.find(el=>el.type==='shape');
  expect(copiedBoundary?.cropGroupId).toBe(copiedBoundary?.objectGroupIds?.[0]);
  expect(copiedBoundary?.cropGroupId).not.toBe(boundary.cropGroupId);
  const roundtrip=yDocToJson(jsonToYDoc({...p,slides:{...p.slides,[slide.id]:cropped}}));
  expect(roundtrip.slides[slide.id]).toEqual(cropped);
  if(undo) undo.undo();else store.temporal.getState().undo();expect(read()).toEqual(slide);
  if(undo) undo.redo();else store.temporal.getState().redo();expect(read()).toEqual(cropped);
  store.getState().setGroupCrop(slide.id,['boundary','media'],null);
  expect(read().elements.media.objectGroupIds).toEqual(boundary.objectGroupIds);
  expect(attachGroupCrops(Object.values(read().elements))).toBeTruthy();
  expect(Object.values(read().elements).some(el=>(el as GroupCropElement)._groupClips)).toBe(false);
  // Ungrouping disables the group property without rewriting the image.
  store.getState().setGroupCrop(slide.id,['boundary','media'],'boundary');
  store.getState().ungroupObjects(slide.id,['boundary','media']);
  const ungrouped=Object.values(read().elements);expect(attachGroupCrops(ungrouped)).toBe(ungrouped);
});
it('supports all primitive boundaries and nested crop intersections',()=>{
  for(const type of ['rect','ellipse','triangle','star','path'] as const){
    const shape=createShapeElement(type,{id:'s',objectGroupIds:['g'],cropGroupId:'g',points:[0,0,100,0,50,100],closed:true});
    expect(groupCropRegions(shape)[0].d.length).toBeGreaterThan(10);
  }
  const outer=createShapeElement('ellipse',{id:'a',objectGroupIds:['outer'],cropGroupId:'outer'});
  const inner=createShapeElement('rect',{id:'b',objectGroupIds:['outer','inner'],cropGroupId:'inner'});
  const image=createImageElement(null,200,100,{id:'i',objectGroupIds:['outer','inner']});
  const result=attachGroupCrops([outer,inner,image]);
  expect((result.find(e=>e.id==='i') as GroupCropElement)._groupClips).toHaveLength(2);
});
