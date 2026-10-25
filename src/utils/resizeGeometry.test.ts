import { describe, expect, it } from 'vitest';
import { resizeBounds, resizeSelection, selectionResizeBounds, rotateDelta, resizeElementBounds, verifiedUniformResize, resizeKeepsBinding } from './resizeGeometry';
import { createShapeElement, createTextElement } from './slideFactory';
import { pathPointsInSlide } from './pathEditing';
import { creationBox } from './userShapeCreation';

const anchors = ['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'];
const start = { x: 30, y: 80, width: 120, height: 60 };
const center = (b: typeof start) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
describe('resizeBounds original snapshot constraints', () => {
  it.each(anchors)('%s aspect and fixed center compose in rotated local axes', anchor => {
    for (const rotation of [0, 37, 90, 215]) for (const dx of [-210, -22, 48]) for (const dy of [-100, 12, 60]) {
      const b = resizeBounds(start, anchor, { x: dx, y: dy }, true, true, rotation);
      expect(b.width / b.height).toBeCloseTo(2, 12);
      expect(center(b)).toEqual(center(start));
      const fixed = resizeBounds(start, anchor, { x: dx, y: dy }, true, false, rotation);
      const sx = anchor.includes('left') ? 1 : anchor.includes('right') ? -1 : 0;
      const sy = anchor.includes('top') ? 1 : anchor.includes('bottom') ? -1 : 0;
      const oldOffset = rotateDelta({ x: sx * start.width / 2, y: sy * start.height / 2 }, rotation);
      const newOffset = rotateDelta({ x: sx * fixed.width / 2, y: sy * fixed.height / 2 }, rotation);
      expect(center(fixed).x + newOffset.x).toBeCloseTo(center(start).x + oldOffset.x, 10);
      expect(center(fixed).y + newOffset.y).toBeCloseTo(center(start).y + oldOffset.y, 10);
    }
  });
  it('plain images/text/free boxes resize without forced aspect; repeated modifiers have no accumulated delta', () => {
    expect(resizeBounds(start, 'bottom-right', { x: 60, y: 12 }, false, false)).toEqual({ ...start, width: 180, height: 72 });
    const text = createTextElement({ ...start, text: '$x^2$' });
    const next = resizeBounds(start, 'top-center', { x: 0, y: -40 }, true, true);
    const update = resizeSelection([text], start, next)[0];
    expect({ ...text, ...update.changes }).toMatchObject({ text: '$x^2$', style: text.style });
  });
  it.each(['rect','ellipse','triangle','star'] as const)('%s Shift creation uses standard square in every quadrant', tool => {
    for (const dx of [-120, 120]) for (const dy of [-30, 30]) {
      expect(creationBox(tool, 100, 100, 100+dx, 100+dy, true)).toEqual({ x: dx < 0 ? -20 : 100, y: dy < 0 ? -20 : 100, width: 120, height: 120 });
      expect(creationBox(tool, 100, 100, 100+dx, 100+dy).height).toBe(30);
    }
  });
});
describe('resizeSelection geometry', () => {
  it.each([0,37,90])('uniform group scaling is exact for off-box Bézier path at %s degrees', rotation => {
    const path = createShapeElement('path', { id: 'p', ...start, rotation, points: [-30,-20,60,90,170,40], curve: 'bezier', tangents: [0,0,30,-40,-20,-30,40,20,-10,40,0,0] });
    const target = createShapeElement('rect', { id: 't', x: 400, y: 200, width: 80, height: 50, rotation: 21 });
    const bounds = selectionResizeBounds([path, target]);
    const next = resizeBounds(bounds, 'bottom-right', { x: bounds.width / 4, y: bounds.height / 4 }, true, true);
    const updates = resizeSelection([path,target], bounds, next);
    const after = { ...path, ...updates[0].changes };
    const c = center(bounds);
    pathPointsInSlide(after).forEach((v,i) => expect(v).toBeCloseTo((pathPointsInSlide(path)[i] - (i%2 ? c.y : c.x))*1.5 + (i%2 ? c.y : c.x), 9));
    expect(verifiedUniformResize(path, after)?.scale).toBeCloseTo(1.5, 10);
    after.tangents!.forEach((v,i)=>expect(v).toBeCloseTo(path.tangents![i]*1.5,10));
  });
  it('nonuniform rotated group uses axis-length norms, not skew or signed sums', () => {
    const el = createShapeElement('rect', { ...start, rotation: 45 });
    const other = createShapeElement('rect', { x:400,y:300,width:40,height:40 });
    const b = selectionResizeBounds([el, other]);
    const changes = resizeSelection([el,other], b, {...b,width:b.width*2})[0].changes;
    expect(changes.width).toBeCloseTo(start.width*Math.sqrt(2.5),10);
    expect(changes.height).toBeCloseTo(start.height*Math.sqrt(2.5),10);
    expect(changes.rotation).toBeUndefined();
  });
  it.each([[0,0,120,0],[0,0,0,120]])('degenerate path remains finite: %s', (...points) => {
    const path = createShapeElement('path',{points,width:120,height:1,rotation:37});
    const b = resizeElementBounds(path);
    const next = resizeBounds(b,'bottom-right',{x:50,y:30},true,true,37);
    const changes = resizeSelection([path],b,next)[0].changes;
    expect(changes.points!.every(Number.isFinite)).toBe(true);
    expect(center(next).x).toBeCloseTo(center(b).x, 9); expect(center(next).y).toBeCloseTo(center(b).y, 9);
  });
  it('external stationary endpoint retains binding; moved endpoint detaches; parameter edits never exempt', () => {
    const target = createShapeElement('rect',{id:'t',x:0,y:0,width:100,height:100});
    const path = createShapeElement('path',{x:100,y:50,width:100,height:50,points:[0,0,100,50],startBinding:{elementId:'t',mode: 'pinned',fixedPoint: [1, .5]},endBinding:{elementId:'t',mode: 'aim',fixedPoint:[.5,.5],gap:0}});
    const b = resizeElementBounds(path), next = resizeBounds(b,'bottom-right',{x:40,y:20},true,false);
    const after = {...path,...resizeSelection([path],b,next)[0].changes};
    expect(after.startBinding).toEqual(path.startBinding); expect(after.endBinding).toBeNull();
    expect(resizeKeepsBinding(path,after,target,target,'startBinding')).toBe(true);
    expect(resizeKeepsBinding(path,{...after,strokeWidth:99},target,target,'startBinding')).toBe(false);
    expect(resizeKeepsBinding(path,{...after,tangents:Array(8).fill(1)},target,target,'startBinding')).toBe(false);
  });
});
