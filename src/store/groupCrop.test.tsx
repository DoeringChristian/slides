import { afterEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { usePresentationStore as store } from './presentationStore';
import { useEditorStore as editor } from './editorStore';
import { createPresentation, createShapeElement, createImageElement, duplicateElements } from '../utils/model/slideFactory';
import { attachGroupCrops, cropGroupOf, groupCropClips, selectionCropAction, type GroupCropElement } from '../utils/model/groupCrop';
import { groupCropRegions } from '../utils/model/cropRegions';
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
  store.getState().setCrop(slide.id,'media',['boundary']);
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
  store.getState().setCrop(slide.id,'media',null);
  expect(read().elements.media.objectGroupIds).toEqual(boundary.objectGroupIds);
  expect(attachGroupCrops(Object.values(read().elements))).toBeTruthy();
  expect(Object.values(read().elements).some(el=>(el as GroupCropElement)._groupClips)).toBe(false);
  // Ungrouping disables the group property without rewriting the image.
  store.getState().setCrop(slide.id,'media',['boundary']);
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

it('shapes of one crop group union; nested crop groups intersect', () => {
  const a=createShapeElement('rect',{id:'a',objectGroupIds:['g'],cropGroupId:'g'});
  const b=createShapeElement('ellipse',{id:'b',objectGroupIds:['g'],cropGroupId:'g'});
  const image=createImageElement(null,200,100,{id:'i',objectGroupIds:['g']});
  const clipped=attachGroupCrops([a,b,image]).find(e=>e.id==='i')!;
  expect(groupCropClips(clipped)).toEqual([{group:'g',shapes:[a,b]}]);
  // Crop shapes are not cut by their own group's other shapes (an outline
  // on one would otherwise show only where it overlaps the others).
  const painted=attachGroupCrops([a,b,image]);
  expect(groupCropClips(painted.find(e=>e.id==='a')!)).toEqual([]);
  expect(groupCropClips(painted.find(e=>e.id==='b')!)).toEqual([]);
  const outer=createShapeElement('rect',{id:'o',objectGroupIds:['outer'],cropGroupId:'outer'});
  const inner=createShapeElement('rect',{id:'n',objectGroupIds:['outer','inner'],cropGroupId:'inner'});
  const nested=createImageElement(null,200,100,{id:'m',objectGroupIds:['outer','inner']});
  expect(groupCropClips(attachGroupCrops([outer,inner,nested]).find(e=>e.id==='m')!).map(c=>c.group)).toEqual(['outer','inner']);
  // ...but a nested group's crop shape is still cut by the outer crop.
  expect(groupCropClips(attachGroupCrops([outer,inner,nested]).find(e=>e.id==='n')!).map(c=>c.group)).toEqual(['outer']);
});

it('offers crop for one image, image + shapes, or exactly one crop group', () => {
  const image=createImageElement(null,200,100,{id:'i'});
  const rect=createShapeElement('rect',{id:'r'});
  const other=createImageElement(null,200,100,{id:'j'});
  const text={...createShapeElement('rect',{id:'t'}),type:'text'} as never;
  const label={...createShapeElement('rect',{id:'l'}),type:'text',containerId:'r'} as never;
  let els: Record<string, never>={i:image,r:rect,j:other,t:text,l:label} as never;
  expect(selectionCropAction(els,['i'])).toEqual({kind:'start',imageId:'i'});
  expect(selectionCropAction(els,['i','r'])).toEqual({kind:'make',imageId:'i',shapeIds:['r']});
  expect(selectionCropAction(els,['i','j'])).toBeNull();
  // Free text crops by its glyphs; a bound label is not offered.
  expect(selectionCropAction(els,['i','t'])).toEqual({kind:'make',imageId:'i',shapeIds:['t']});
  expect(selectionCropAction(els,['i','l'])).toEqual({kind:'start',imageId:'i'});
  expect(selectionCropAction(els,['r'])).toBeNull();
  const cropped={...image,objectGroupIds:['g']}, boundary={...rect,objectGroupIds:['g'],cropGroupId:'g'}, extra=createShapeElement('rect',{id:'x',objectGroupIds:['g']});
  els={i:cropped,r:boundary,x:extra,j:other} as never;
  expect(selectionCropAction(els,['i','r','x'])).toEqual({kind:'edit',imageId:'i',group:'g'});
  expect(selectionCropAction(els,['i'])).toEqual({kind:'edit',imageId:'i',group:'g'});
  expect(selectionCropAction(els,['i','r'])).toBeNull();
  expect(selectionCropAction(els,['i','r','x','j'])).toBeNull();
});

it.each([false,true])('crop mode: drawn shapes become crop shapes in one undo step; an emptied crop dissolves (collab=%s)', collab => {
  const p=createPresentation(), slide=p.slides[p.slideOrder[0]];
  const image=createImageElement(null,200,100,{id:'media',x:50,y:50,width:200,height:100,objectGroupIds:['outer']});
  const sibling=createShapeElement('rect',{id:'sib',objectGroupIds:['outer']});
  slide.elements={media:image,sib:sibling};slide.elementOrder=['media','sib'];
  store.setState({presentation:structuredClone(p)});store.temporal.getState().clear();
  editor.setState({activeSlideId:slide.id,activeObjectGroupId:null,selectedElementIds:[],autoDrawMode:false,selectedSlideIds:[]});
  const doc=collab?jsonToYDoc(p):null;setActiveDoc(doc);
  const undo=doc?createUndoManagerFor(doc):null;setActiveUndoManager(undo);
  const read=()=> (doc?yDocToJson(doc):store.getState().presentation).slides[slide.id];
  const group=store.getState().addCropShape(slide.id,'media',createShapeElement('rect',{id:'c1',x:60,y:60,width:50,height:50}))!;
  let s=read();
  expect(s.elements.media.objectGroupIds).toEqual(['outer',group]);
  expect(s.elements.c1.objectGroupIds).toEqual(['outer',group]);
  expect(s.elements.c1.type==='shape'&&s.elements.c1.cropGroupId).toBe(group);
  expect(s.elements.sib.objectGroupIds).toEqual(['outer']);
  expect(store.getState().addCropShape(slide.id,'media',createShapeElement('ellipse',{id:'c2'}))).toBe(group);
  s=read();expect(cropGroupOf(s.elements,'media')).toBe(group);
  expect(groupCropClips(attachGroupCrops(Object.values(s.elements)).find(e=>e.id==='media')!)[0].shapes).toHaveLength(2);
  // Each drawn shape is one undo step, image regrouping included.
  if(undo) undo.undo();else store.temporal.getState().undo();
  expect(read().elements.c2).toBeUndefined();
  if(undo) undo.undo();else store.temporal.getState().undo();
  expect(read()).toEqual(slide);
  if(undo) undo.redo();else store.temporal.getState().redo();
  // Hiding the last crop shape and cleaning up dissolves the crop group.
  store.getState().hideElements(slide.id,['c1']);
  store.getState().cleanupCrop(slide.id,group);
  s=read();
  expect(s.elements.media.objectGroupIds).toEqual(['outer']);
  expect(cropGroupOf(s.elements,'media')).toBeUndefined();
});

it('crop shapes combine in layer order: add, subtract, intersect', async () => {
  const { cropSteps } = await import('../utils/model/groupCrop');
  const { selectionResizeBounds } = await import('../utils/geometry/resizeGeometry');
  const shape = (id: string, x: number, op?: 'add' | 'subtract' | 'intersect') =>
    createShapeElement('rect', { id, x, y: 0, width: 100, height: 100, objectGroupIds: ['g'], cropGroupId: 'g', ...(op ? { cropOp: op } : {}) });
  expect(cropSteps([shape('a', 0), shape('b', 50)])).toMatchObject({ full: false, union: true });
  // A first subtracting shape cuts from the whole image; a first intersect adds.
  expect(cropSteps([shape('a', 0, 'subtract')])).toMatchObject({ full: true, union: false });
  expect(cropSteps([shape('a', 0, 'intersect')]).steps[0].op).toBe('add');
  // Selection bounds: the image counts only where its crop shows it; the crop
  // shapes themselves are selected objects and frame as such.
  const image = createImageElement(null, 400, 100, { id: 'i', x: 0, y: 0, width: 400, height: 100, objectGroupIds: ['g'] });
  const sel = (shapes: ReturnType<typeof shape>[]) => selectionResizeBounds(attachGroupCrops([image, ...shapes]));
  expect(sel([shape('a', 0), shape('b', 200)])).toMatchObject({ x: 0, width: 300 });
  expect(sel([shape('a', 0), shape('b', 50, 'intersect')])).toMatchObject({ x: 0, width: 150 });
  // Starting from the whole image (a first subtract), the image frames in full.
  expect(sel([shape('a', 150, 'subtract')])).toMatchObject({ x: 0, width: 400 });
});

it('a crop shape on only one keyframe moves with its media, not at its own place', async () => {
  const { followCropMedia } = await import('../utils/model/groupCrop');
  const image = (x: number) => createImageElement(null, 200, 100, { id: 'i', x, y: 0, width: 200, height: 100, objectGroupIds: ['g'] });
  // Drawn only on the destination keyframe, 20 units into the image.
  const crop = createShapeElement('rect', { id: 'c', x: 520, y: 10, width: 50, height: 50, objectGroupIds: ['g'], cropGroupId: 'g' });
  const slideA = { elements: { i: image(0) } }, slideB = { elements: { i: image(500), c: crop } };
  // Mid-transition the image is at x=250; the crop rides along at +20.
  const frame = followCropMedia([image(250), crop], slideA, slideB, 0.5, (_e, _g, t) => t);
  expect(frame.find(el => el.id === 'c')!.x).toBeCloseTo(270);
  // Present on both keyframes: unchanged behaviour (relative pose interpolated).
  const both = followCropMedia([image(250), crop], { elements: { i: image(0), c: { ...crop, x: 20 } } }, slideB, 0.5, (_e, _g, t) => t);
  expect(both.find(el => el.id === 'c')!.x).toBeCloseTo(270);
});

it("a crop shape's own easings drive its motion; its preview shows it with its crop group", async () => {
  const { followCropMedia, cropContext } = await import('../utils/model/groupCrop');
  const { TransitionPreview } = await import('../components/properties/TransitionPreview');
  const image = createImageElement(null, 200, 100, { id: 'i', x: 0, y: 0, width: 200, height: 100, objectGroupIds: ['g'] });
  const at = (x: number) => createShapeElement('rect', { id: 'c', x, y: 10, width: 50, height: 50, objectGroupIds: ['g'], cropGroupId: 'g', transitions: { position: 'linear' } });
  const seen: string[] = [];
  const frame = followCropMedia([image, at(50)], { elements: { i: image, c: at(0) } }, { elements: { i: image, c: at(100) } }, 0.25,
    (el, group, t) => { seen.push(`${el.id}:${group}`); return group === 'position' ? t * 2 : t; });
  expect(seen).toEqual(['c:position', 'c:size', 'c:rotation']);
  // Position eased by the crop shape's own easing (here doubled), not the image's.
  expect(frame.find(el => el.id === 'c')!.x).toBeCloseTo(50);
  // Alone a crop shape draws nothing; with its context the preview shows the cropped image.
  const elements = { i: image, c: at(0) };
  const [context] = cropContext([elements], ['c']);
  expect(context.map(el => el.id)).toEqual(['i']);
  // A crop drawn on the later keyframe: the earlier one has the image (not
  // yet in the group) — it is still the context there.
  const plainImage = { ...image, objectGroupIds: [] };
  const [before, after] = cropContext([{ i: plainImage }, elements], ['c']);
  expect(before.map(el => el.id)).toEqual(['i']);
  expect(after.map(el => el.id)).toEqual(['i']);
  const markup = renderToStaticMarkup(<TransitionPreview sourceElements={[at(0)]} targetElements={[at(100)]} sourceContext={context} targetContext={context}
    group="position" easing="linear" width={120} height={80} active={false} />);
  expect(markup).toContain('data-group-crop');
  expect(Number(/data-preview-elements="(\d+)"/.exec(markup)![1])).toBe(2);
});

it('mid-transition, an image is in the crop group of a crop shape in the frame (even if only one keyframe has the group)', async () => {
  const { followCropMedia } = await import('../utils/model/groupCrop');
  const image = (path: string[]) => createImageElement(null, 200, 100, { id: 'i', x: 0, y: 0, width: 200, height: 100, objectGroupIds: path });
  const crop = createShapeElement('rect', { id: 'c', x: 20, y: 10, width: 50, height: 50, objectGroupIds: ['g'], cropGroupId: 'g' });
  // The frame's image still carries keyframe A's membership (no group).
  const frame = followCropMedia([image([]), crop], { elements: { i: image([]) } }, { elements: { i: image(['g']), c: crop } }, 0.75, (_e, _g, t) => t);
  const framed = frame.find(el => el.id === 'i')!;
  expect(framed.objectGroupIds).toEqual(['g']);
  expect((attachGroupCrops(frame).find(el => el.id === 'i') as GroupCropElement)._groupClips?.map(s => s.id)).toEqual(['c']);
});

it('snap targets: a cropped object aligns by what its crop shows (except the image in crop mode)', async () => {
  const { cropSnapTargets } = await import('../utils/model/groupCrop');
  const image = createImageElement(null, 300, 200, { id: 'i', x: 100, y: 100, width: 300, height: 200, objectGroupIds: ['g'] });
  const a = createShapeElement('rect', { id: 'a', x: 150, y: 120, width: 50, height: 50, objectGroupIds: ['g'], cropGroupId: 'g' });
  const b = createShapeElement('rect', { id: 'b', x: 250, y: 200, width: 100, height: 60, objectGroupIds: ['g'], cropGroupId: 'g' });
  const other = createShapeElement('rect', { id: 'o', x: 500, y: 100, width: 40, height: 40 });
  const box = (els: ReturnType<typeof cropSnapTargets>, id: string) => { const e = els.find(el => el.id === id)!; return [e.x, e.y, e.width, e.height]; };
  const targets = cropSnapTargets([image, a, b, other]);
  expect(box(targets, 'i')).toEqual([150, 120, 200, 140]);   // union of the crop shapes
  expect(box(targets, 'o')).toEqual([500, 100, 40, 40]);     // uncropped: unchanged
  expect(box(cropSnapTargets([image, a, b, other], 'i'), 'i')).toEqual([100, 100, 300, 200]); // in crop mode: whole
  // An intersecting crop shape narrows it.
  const c = createShapeElement('rect', { id: 'c', x: 180, y: 100, width: 300, height: 300, objectGroupIds: ['g'], cropGroupId: 'g', cropOp: 'intersect' });
  expect(box(cropSnapTargets([image, a, b, c]), 'i')).toEqual([180, 120, 170, 140]);
});
