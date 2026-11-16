import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
import assert from 'node:assert/strict';
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && (!process.env.CDP_TARGET_ID || p.id === process.env.CDP_TARGET_ID));
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
const runtimeErrors = [];
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function screen(x,y){return evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:m.a*${x}+m.e,y:m.d*${y}+m.f}})()`);}
async function mouse(type,p,count=1){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:count});await wait(30);}
async function click(p,count=1){await mouse('mousePressed',p,count);await mouse('mouseReleased',p,count);}
async function drag(a,b){await mouse('mousePressed',a);for(let i=1;i<=5;i++)await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/5,y:a.y+(b.y-a.y)*i/5});await mouse('mouseReleased',b);await wait(150);}
async function button(label){const point=await evaluate(`(()=>{const b=[...document.querySelectorAll('#creation-properties button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(point);await wait(100);}
const handle = name => evaluate(`(()=>{const h=document.querySelector('.selection-transformer [data-resize-handle=${name}]');if(!h)return null;const r=(h.querySelector('[data-resize-visual]')??h).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const RED = `canvasTest.store.getState().addResource({id:'red',name:'red',type:'image',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>'),originalWidth:300,originalHeight:200})`;
try {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for (const collab of [false, true]) {
    await waitForCanvasFixture(evaluate);
    await evaluate(`canvasTest.setup(${JSON.stringify({mode:'production',collab,creationProperties:true,objectList:true,subject:{type:'image',x:250,y:150,width:300,height:200,cropX:0,cropY:0,cropWidth:300,cropHeight:200,resourceId:'red'},targets:[{id:'boundary',shapeType:'ellipse',x:300,y:180,width:150,height:120,stroke:'#000000',strokeWidth:4,fill:'#00ff00'}]})})`);
    await wait(100);
    await evaluate(`${RED};canvasTest.editor.getState().setSelectedElements(['subject','boundary'])`);
    await wait(150); await button('Crop to shape');
    await evaluate(`canvasTest.editor.getState().clearSelection()`); await wait(50);
    // Select the crop group by clicking what is visible of it.
    await click(await screen(375, 240)); await wait(120);
    assert.deepEqual((await evaluate('canvasTest.editor.getState().selectedElementIds')).sort(), ['boundary', 'subject']);

    // The group acts as one object: its handles frame what is visible (the
    // crop), not the uncropped image behind it.
    const corner = await handle('bottom-right');
    const visibleCorner = await screen(450, 300);
    assert(Math.abs(corner.x - visibleCorner.x) < 12 && Math.abs(corner.y - visibleCorner.y) < 12, `handle at the crop corner, got ${JSON.stringify(corner)} vs ${JSON.stringify(visibleCorner)}`);

    // Resizing scales image and crop together (it used to do nothing: the
    // gesture guard rejected the crop group's render hints).
    await drag(corner, { x: corner.x + 75, y: corner.y + 60 });
    const after = await evaluate('canvasTest.snapshot().slide.elements');
    const sx = after.boundary.width / 150, sy = after.boundary.height / 120;
    assert(sx > 1.3 && sy > 1.3, `crop grew: ${sx}, ${sy}`);
    assert(Math.abs(after.subject.width / 300 - sx) < 1e-6 && Math.abs(after.subject.height / 200 - sy) < 1e-6, 'image scaled like its crop');
    // The visible top-left (the crop's) stays where it was.
    assert(Math.abs(after.boundary.x - 300) < 1e-6 && Math.abs(after.boundary.y - 180) < 1e-6, 'anchored at the visible corner');
    assert(Math.abs((after.boundary.x - after.subject.x) / sx - 50) < 1e-6, 'crop keeps its place on the image');
    console.log(`PASS crop group resizes as one object from its visible bounds collab=${collab}`);
  }

  // Presenter: a clipped image keeps its DOM node through a transition in
  // which another element enters ahead of it (it used to remount and flash).
  await evaluate(RED);
  const ids = await evaluate(`(()=>{
    const img = {id:'img',type:'image',x:100,y:100,width:300,height:200,rotation:0,opacity:1,locked:false,visible:true,resourceId:'red',cropX:0,cropY:0,cropWidth:300,cropHeight:200,objectGroupIds:['g']};
    const mask = {id:'mask',type:'shape',shapeType:'ellipse',creationPreset:'ellipse',x:150,y:120,width:150,height:120,rotation:0,opacity:1,locked:false,visible:true,fill:'',stroke:'#000',strokeWidth:2,cornerRadius:0,objectGroupIds:['g'],cropGroupId:'g'};
    const other = {...mask,id:'other',objectGroupIds:undefined,cropGroupId:undefined,x:600,y:50};
    const slide = (els) => ({id:'s'+els.length,elements:Object.fromEntries(els.map(e=>[e.id,e])),elementOrder:els.map(e=>e.id),background:{type:'solid',color:'#fff'},transition:{duration:300},notes:''});
    const a = slide([img, mask]), b = slide([other, {...img,x:300}, {...mask,x:350}]);
    return canvasTest.presenterMediaIdentity(a, b, canvasTest.store.getState().presentation.resources, [0, 0.25, 0.45, 0.55, 0.75, 0.95]);
  })()`);

  // Exit: when a transition starts, exiting elements move to the end of the
  // frame. A clipped video must survive that reorder, or it blanks (reloads)
  // while its crop outline is still fading out.
  const exitIds = await evaluate(`(()=>{
    const img = {id:'img',type:'image',x:100,y:100,width:300,height:200,rotation:0,opacity:1,locked:false,visible:true,resourceId:'red',cropX:0,cropY:0,cropWidth:300,cropHeight:200,objectGroupIds:['g']};
    const mask = {id:'mask',type:'shape',shapeType:'ellipse',creationPreset:'ellipse',x:150,y:120,width:150,height:120,rotation:0,opacity:1,locked:false,visible:true,fill:'',stroke:'#000',strokeWidth:2,cornerRadius:0,objectGroupIds:['g'],cropGroupId:'g'};
    const other = {...mask,id:'other',objectGroupIds:undefined,cropGroupId:undefined,x:600,y:50};
    const slide = (els) => ({id:'s'+els.length,elements:Object.fromEntries(els.map(e=>[e.id,e])),elementOrder:els.map(e=>e.id),background:{type:'solid',color:'#fff'},transition:{duration:300},notes:''});
    // t=1 renders the steady slide A (as before the transition starts).
    return canvasTest.presenterMediaIdentity(slide([img, mask, other]), slide([other]), canvasTest.store.getState().presentation.resources, [1, 0, 0.2, 0.4]);
  })()`);
  console.log('IDENTITY', JSON.stringify({ enter: ids, exit: exitIds }));
  assert.deepEqual(ids, [0, 0, 0, 0, 0, 0], `media node identity per frame: ${JSON.stringify(ids)}`);
  console.log('PASS clipped media is not remounted during a transition');
  assert.deepEqual(exitIds, [0, 0, 0, 0], `media node identity through an exit: ${JSON.stringify(exitIds)}`);
  console.log('PASS clipped media is not remounted when its exit starts');
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
