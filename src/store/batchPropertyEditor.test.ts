import { afterEach, expect, it } from 'vitest';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createShapeElement } from '../utils/model/slideFactory';
import { jsonToYDoc, yDocToJson } from '../collab/ySchema';
import { setActiveDoc } from '../collab/yDocAdapter';
import { createUndoManagerFor, setActiveUndoManager, beginScrubCapture } from '../collab/activeUndo';
import { rotateSelection, selectionResizeBounds } from '../utils/geometry/resizeGeometry';
import { batchPropertyEditor } from './batchPropertyEditor';
import { runScrubSession } from '../components/controls/useScrubCommit';
import type { CurrentChange } from './currentMutation';
import type { SlideElement } from '../types/presentation';

afterEach(() => { setActiveUndoManager(null); setActiveDoc(null); });
it.each([false, true])('shared batch controls scrub, cancel and undo all members (collab=%s)', collab => {
  const p = createPresentation(), slide = p.slides[p.slideOrder[0]];
  slide.elements = { a: createShapeElement('rect', { id:'a', x:100,y:100,width:100,height:100,rotation:0 }), b:createShapeElement('rect', {id:'b',x:300,y:130,width:60,height:160,rotation:20}) };
  slide.elementOrder = ['a','b'];
  const doc = collab ? jsonToYDoc(p) : null;
  store.setState({presentation:p}); store.temporal.getState().clear();
  editor.setState({activeSlideId:slide.id, selectedSlideIds:[slide.id], selectedElementIds:['a','b'], autoDrawMode:false});
  setActiveDoc(doc); const undo=doc ? createUndoManagerFor(doc) : null; setActiveUndoManager(undo);
  const read=()=> (doc ? yDocToJson(doc) : store.getState().presentation).slides[slide.id].elements;
  const before=structuredClone(read());
  const edit=batchPropertyEditor(slide.id,['a','b'],true,()=>true);
  let finish: (cancelled:boolean)=>void = ()=>{};
  const session=runScrubSession<CurrentChange<SlideElement>>({
    snapshot:()=>edit.snapshot(['rotation']), apply:edit, commit:edit.commit,
    pause:()=>{store.temporal.getState().pause();finish=beginScrubCapture(undo);},
    resume:()=>store.temporal.getState().resume(), finish:cancelled=>finish(cancelled),
  });
  session.begin(); session.preview({rotation:30}); session.preview({rotation:60});
  expect(read().a.rotation).toBe(60);expect(read().b.rotation).toBe(80);
  const bounds = selectionResizeBounds(Object.values(before));
  for (const expected of rotateSelection(Object.values(before), {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2},60)) {
    expect(read()[expected.elementId].x).toBeCloseTo(expected.changes.x!);
    expect(read()[expected.elementId].y).toBeCloseTo(expected.changes.y!);
  }
  session.cancel(); expect(read()).toEqual(before);
  session.begin();session.preview({rotation:30});session.end({rotation:90});
  expect(read().a.rotation).toBe(90);expect(read().b.rotation).toBe(110);
  if(undo) undo.undo(); else store.temporal.getState().undo();
  expect(read()).toEqual(before);
  // Different transition storage sides must still produce one undo entry.
  const originalPresentation=doc ? yDocToJson(doc) : store.getState().presentation;
  const updates=[{slideId:slide.id,elementId:'a',changes:{transitions:{position:'ease' as const}}},{slideId:slide.id,elementId:'b',changes:{transitions:{position:'ease' as const}}}];
  undo?.stopCapturing();store.getState().updateAcrossSlides(updates);undo?.stopCapturing();
  expect(read().a.transitions?.position).toBe('ease');expect(read().b.transitions?.position).toBe('ease');
  if(undo) undo.undo();else store.temporal.getState().undo();
  expect(read()).toEqual(originalPresentation.slides[slide.id].elements);
  setActiveUndoManager(null);setActiveDoc(null);doc?.destroy();
});
