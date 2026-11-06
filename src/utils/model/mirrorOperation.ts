import type { Slide, SlideElement } from '../../types/presentation';
import { resizeElementBounds, resizeSelection, rotateDelta, rotateSelection, selectionResizeBounds, type ResizeUpdate } from '../geometry/resizeGeometry';
import { planElementTranslation } from '../geometry/elementTranslation';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Remove unchanged siblings carried by full-object and nested style patches. */
function changed(before: Record<string, unknown>, patch: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key,value] of Object.entries(patch)) {
    if (equal(before[key],value)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && before[key] && typeof before[key] === 'object')
      result[key] = {...(target[key] as object), ...changed(before[key] as Record<string,unknown>,value as Record<string,unknown>,(target[key]??{}) as Record<string,unknown>)};
    else result[key]=value;
  }
  return result;
}
const record = (e: object) => e as Record<string, unknown>;
const geometry = new Set(['x','y','width','height','rotation','points','tangents','startBinding','endBinding','style','textSizing']);

/** Replay a geometric operation on each keyframe's OWN objects. Never ship
 * active-slide points, paint, visibility or binding snapshots to another slide. */
export function mirrorOperation(source: Slide, target: Slide, updates: readonly ResizeUpdate[]): ResizeUpdate[] {
  const pairs=updates.flatMap(u=>{
    const before=source.elements[u.elementId], other=target.elements[u.elementId];
    if(!before || !other || before.type!==other.type || other.locked)return [];
    const diff=changed(record(before),record(u.changes),record(other));
    return [{before,other,diff,after:{...before,...u.changes} as SlideElement}];
  });
  if(!pairs.length)return [];
  const keys=new Set(pairs.flatMap(p=>Object.keys(p.diff)));
  if([...keys].every(k=>['x','y','startBinding','endBinding'].includes(k)) && (keys.has('x')||keys.has('y'))) {
    const delta={x:pairs[0].after.x-pairs[0].before.x,y:pairs[0].after.y-pairs[0].before.y};
    if(pairs.every(p=>Math.abs(p.after.x-p.before.x-delta.x)<1e-8&&Math.abs(p.after.y-p.before.y-delta.y)<1e-8))
      return planElementTranslation(target.elements,new Map(pairs.map(p=>[p.other.id,{x:p.other.x,y:p.other.y}])),delta);
  }
  const geometric=[...keys].every(k=>geometry.has(k)) && pairs.every(p=>{
    if (!p.diff.style) return true;
    if (p.before.type !== 'text' || p.after.type !== 'text') return false;
    const before = record(p.before.style), after = record(p.after.style);
    return Object.keys(after).filter(k=>!equal(before[k],after[k])).every(k=>k==='fontSize');
  });
  if(geometric && keys.has('rotation') && !keys.has('width')&&!keys.has('height')) {
    const delta=pairs[0].after.rotation-pairs[0].before.rotation;
    const bounds=selectionResizeBounds(pairs.map(p=>p.other));
    return rotateSelection(pairs.map(p=>p.other),{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2},delta);
  }
  if(geometric && (keys.has('width')||keys.has('height'))) {
    const old=pairs.length===1?resizeElementBounds(pairs[0].before):selectionResizeBounds(pairs.map(p=>p.before));
    const next=pairs.length===1?resizeElementBounds(pairs[0].after):selectionResizeBounds(pairs.map(p=>p.after));
    const dest=pairs.length===1?resizeElementBounds(pairs[0].other):selectionResizeBounds(pairs.map(p=>p.other));
    const width=old.width?dest.width*next.width/old.width:dest.width;
    const height=old.height?dest.height*next.height/old.height:dest.height;
    const dx=next.width-old.width,dy=next.height-old.height;
    const box={x:dest.x+(next.x-old.x)*(Math.abs(dx)>1e-8?(width-dest.width)/dx:1),
      y:dest.y+(next.y-old.y)*(Math.abs(dy)>1e-8?(height-dest.height)/dy:1),width,height};
    if (pairs.length === 1) {
      const local = rotateDelta({x:next.x+next.width/2-old.x-old.width/2,y:next.y+next.height/2-old.y-old.height/2},-pairs[0].before.rotation);
      const shift = rotateDelta({x:local.x*(Math.abs(dx)>1e-8?(width-dest.width)/dx:1),y:local.y*(Math.abs(dy)>1e-8?(height-dest.height)/dy:1)},pairs[0].other.rotation);
      box.x=dest.x+(dest.width-width)/2+shift.x;
      box.y=dest.y+(dest.height-height)/2+shift.y;
    }
    const resized=resizeSelection(pairs.map(p=>p.other),dest,box);
    return resized.map((u,i)=>{
      const p=pairs[i];
      if(p.before.type==='text' && p.after.type==='text' && p.other.type==='text'){
        if(p.diff.style)u.changes={...u.changes,style:{...p.other.style,fontSize:p.other.style.fontSize*p.after.style.fontSize/p.before.style.fontSize}};
        if('textSizing' in p.diff)u.changes={...u.changes,textSizing:p.after.textSizing};
      }
      return u;
    });
  }
  // Explicit one-field commands (e.g. Show) still apply when the active value
  // already matches. Multi-field snapshots only carry their actual delta.
  return pairs.map(p=>({elementId:p.other.id,changes:Object.keys(p.diff).length?p.diff:
    Object.keys(updates.find(u=>u.elementId===p.other.id)!.changes).length===1 && !geometry.has(Object.keys(updates.find(u=>u.elementId===p.other.id)!.changes)[0])
      ? updates.find(u=>u.elementId===p.other.id)!.changes : {}}));
}
