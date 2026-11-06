import {afterEach,it,expect} from 'vitest';
import {usePresentationStore as store} from './presentationStore';
import {useEditorStore as editor} from './editorStore';
import {createPresentation,createSlide,createShapeElement,createImageElement} from '../utils/model/slideFactory';
import {jsonToYDoc,yDocToJson} from '../collab/ySchema';
import {setActiveDoc} from '../collab/yDocAdapter';
import {createUndoManagerFor,setActiveUndoManager} from '../collab/activeUndo';
import {objectListElements} from '../utils/model/groupTransfer';
import {attachGroupCrops,type GroupCropElement} from '../utils/model/groupCrop';
afterEach(()=>{setActiveDoc(null);setActiveUndoManager(null)});
it.each([false,true])('transfers complete crop groups, preserves other target fields and undoes atomically (%s)',collab=>{
 const p=createPresentation(),s=p.slides[p.slideOrder[0]],t=createSlide();p.slides[t.id]=t;p.slideOrder.push(t.id);
 s.elements={mask:createShapeElement('ellipse',{id:'mask',objectGroupIds:['g'],cropGroupId:'g'}),image:createImageElement(null,100,100,{id:'image',objectGroupIds:['g']}),hidden:createShapeElement('dot',{id:'hidden',objectGroupIds:['g','nested'],visible:false})};s.elementOrder=['image','mask','hidden'];
 for(const id of s.elementOrder)p.objects[id]={id,name:id,type:s.elements[id].type==='image'?'image':'shape'};
 t.elements.image={...s.elements.image,x:400,opacity:.3,visible:false,objectGroupIds:[]};t.elementOrder=['image'];
 store.setState({presentation:structuredClone(p)});store.temporal.getState().clear();editor.setState({activeSlideId:s.id,selectedSlideIds:[],autoDrawMode:false});
 const doc=collab?jsonToYDoc(p):null;setActiveDoc(doc);const undo=doc?createUndoManagerFor(doc):null;setActiveUndoManager(undo);
 const read=()=>doc?yDocToJson(doc):store.getState().presentation;
 const before=structuredClone(read().slides[t.id]);
 store.getState().syncElementsToSlides(s.id,['image'],[t.id],['visible']);
 const copied=read().slides[t.id];expect(copied.elementOrder).toEqual(['image','mask','hidden']);expect(copied.elements.image).toMatchObject({x:400,opacity:.3,visible:true,objectGroupIds:['g']});expect(copied.elements.hidden.visible).toBe(false);
 expect((attachGroupCrops(Object.values(copied.elements)).find(e=>e.id==='image') as GroupCropElement)._groupClips?.[0].id).toBe('mask');
 if(undo)undo.undo();else store.temporal.getState().undo();expect(read().slides[t.id]).toEqual(before);
 if(undo)undo.redo();else store.temporal.getState().redo();expect(read().slides[t.id]).toEqual(copied);
 // Empty target uses one source keyframe, carries nested children and crop metadata.
 const empty=store.getState().addEmptySlide();store.getState().unhideElement(empty,'image',{x:600,y:700});
 const restored=read().slides[empty];expect(restored.elementOrder).toHaveLength(3);expect(restored.elements.image).toMatchObject({x:600,y:700,objectGroupIds:['g']});expect(restored.elements.mask.type==='shape'&&restored.elements.mask.cropGroupId).toBe('g');
 expect(objectListElements(p.slides,p.slideOrder,t.id).mask.objectGroupIds).toEqual(['g']);
});
