import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/ui-reference.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
const runtimeErrors = [];

let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);

  if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text=msg.params.args.map(arg=>arg.value??arg.description??'').join(' ');
    if (/order of Hooks|Rendered (more|fewer) hooks|getSnapshot/.test(text)) runtimeErrors.push(text);
  }
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(msg.error) : resolve(msg.result); }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function setup(config) { await waitForCanvasFixture(evaluate); await evaluate(`canvasTest.setup(${JSON.stringify(config)})`); await wait(100); }
let pressed = false;
async function mouse(type, x, y, clickCount = 1, modifiers = 0) {
  if(type === 'mousePressed') pressed = true;
  if(type === 'mouseReleased') pressed = false;
  await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount, modifiers });
  await wait(12);
}
async function click(x, y, count = 1) { await mouse('mousePressed', x, y, count); await mouse('mouseReleased', x, y, count); }
async function drag(x, y, ex, ey) { await mouse('mousePressed', x, y); await mouse('mouseMoved', ex, ey); await mouse('mouseReleased', ex, ey); }
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, a: 65 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, commands: modifiers === 4 && key === 'a' ? ['selectAll'] : undefined, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });

}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function check(name, run) { await run(); console.log(`PASS ${name}`); }


const evidence=process.env.AIM_BINDING_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-aim-evidence/browser`;
const style={fontFamily:'Arial',fontSize:20,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'center',verticalAlign:'top',lineHeight:1.25};
async function center(selector){return evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);}
const content=()=>evaluate(`document.querySelector('.content-layer').innerHTML`);
const authoritative=()=>evaluate(`(async()=>{const {yDocToJson}=await import('/src/collab/ySchema.ts');const {getActiveDoc}=await import('/src/collab/yDocAdapter.ts');const doc=getActiveDoc();return JSON.stringify(doc?yDocToJson(doc):canvasTest.store.getState().presentation)})()`);
try {
 await mkdir(evidence,{recursive:true}); await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(1400);
 const matrix=[];
 for(const collab of [false,true])for(const zoom of [.5,1,2])for(const end of ['startBinding','endBinding']){
  const subject={shapeType:'path',x:250,y:220,width:250,height:80,points:end==='endBinding'?[0,0,250,80]:[250,80,0,0],endHead:'triangle',[end]:{elementId:'box',mode:'aim',fixedPoint:[.4,.4],gap:0}};
  await setup({mode:'production',collab,zoom,secondSlide:true,subject,targets:[{id:'box',x:500,y:250,width:220,height:160,fill:'#d8efec'},{id:'label',type:'text',containerId:'subject',text:'Aim label',x:340,y:260,width:90,height:30,style}]});
  await evaluate(`(()=>{const s=canvasTest.snapshot().slide;canvasTest.store.getState().updateElement(s.id,'subject',{points:s.elements.subject.points});})()`);await wait(250);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('[data-binding-focus] [data-focus-hit]').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x-b.x-b.width/2;p.scrollTop+=r.y-b.y-b.height/2;canvasTest.getActiveUndoManager()?.clear();canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.store.temporal.getState().clear();})()`);await wait(40);
  const before=await snapshot(),raw=await authoritative(),idle=await content();
  const selector=`[data-binding-focus="${end}"] [data-focus-hit]`;
  const [x,y]=await center(selector),ex=x+22*zoom,ey=y+16*zoom;
  await mouse('mousePressed',x+1,y+1);await mouse('mouseMoved',ex+1,ey+1);await wait(60);
  assert.equal(await authoritative(),raw,'no document write in focus preview');assert.equal((await snapshot()).undo,0);
  assert(await evaluate(`!!document.querySelector('.content-layer[data-gesture-preview]')`));
  const live=await content();assert.notEqual(live,idle);
  assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"],button[title="Hide from slide (Del)"]').length`),0,'actions hidden during focus gesture');
  const guide=await evaluate(`(()=>{const n=document.querySelector('[data-binding-focus="${end}"] line');return {width:+n.getAttribute('stroke-width'),x1:+n.getAttribute('x1'),y1:+n.getAttribute('y1'),x2:+n.getAttribute('x2'),y2:+n.getAttribute('y2')}})()`);
  assert(Math.abs(guide.width*zoom-1)<1e-6);assert(Math.hypot(guide.x2-guide.x1,guide.y2-guide.y1)>20);
  if(zoom===1)await writeFile(`${evidence}/live-${collab}-${end}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await mouse('mouseReleased',ex+1,ey+1);await wait(100);
  assert.equal(await content(),live,'shared live scene exactly equals committed render');
  const after=await snapshot(),binding=after.slide.elements.subject[end];
  assert(Math.abs(binding.fixedPoint[0]-.5)<1e-6);assert(Math.abs(binding.fixedPoint[1]-.5)<1e-6);
  const geometry=await evaluate(`(async()=>{const {silhouetteDistance}=await import('/src/utils/connectorUtils.ts');const s=canvasTest.snapshot().slide,a=s.elements.subject,pts=canvasTest.pathPointsInSlide(a),i=${end==='startBinding'?0:2};return silhouetteDistance(s.elements.box,{x:pts[i],y:pts[i+1]})})()`);assert(Math.abs(geometry)<1e-7,'visible endpoint is on actual boundary');
  assert.equal(after.undo,1);await key('z','KeyZ',2);await wait(80);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  const [cx,cy]=await center(selector);await mouse('mousePressed',cx,cy);await mouse('mouseMoved',cx+10,cy+10);await key('Escape');await mouse('mouseReleased',cx+10,cy+10);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  // Switching slide with same IDs invalidates the pointer ownership synchronously.
  await mouse('mousePressed',cx,cy);await mouse('mouseMoved',cx+10,cy+10);await evaluate(`canvasTest.editor.getState().setActiveSlide('other')`);await mouse('mouseReleased',cx+10,cy+10);assert.equal(await evaluate(`!!document.querySelector('.content-layer[data-gesture-preview]')`),false);
  matrix.push({collab,zoom,end,preview:'border plus interior focus',commit:'one undo',cancel:'escape and same-ID slide switch'});
  console.log('PASS focus',collab,zoom,end);
 }
 for(const collab of [false,true])for(const end of ['startBinding','endBinding'])for(const priorMode of ['aim','pinned']) for(const oppositeMode of ['aim','pinned']) {
  const opposite=end==='startBinding'?'endBinding':'startBinding';
  const binding={elementId:'box',mode:priorMode,fixedPoint:[.4,.4],...(priorMode==='aim'?{gap:0}:{})};
  const oppositeBinding=oppositeMode==='aim'?{elementId:'left',mode:'aim',fixedPoint:[.4,.4],gap:0}:{elementId:'left',mode:'pinned',fixedPoint:[.4,.4]};
  await setup({mode:'production',collab,subject:{shapeType:'path',x:250,y:220,width:250,height:80,points:end==='endBinding'?[0,0,250,80]:[250,80,0,0],endHead:'triangle',[end]:binding,[opposite]:oppositeBinding},targets:[{id:'left',x:150,y:140,width:160,height:160},{id:'box',x:500,y:250,width:220,height:160}]});
  await evaluate(`(()=>{const s=canvasTest.snapshot().slide;canvasTest.store.getState().updateElement(s.id,'subject',{points:s.elements.subject.points});})()`);await wait(100);
  const selector=priorMode==='aim'?`[data-binding-focus="${end}"] [data-focus-hit]`:'.path-handles circle[fill="#fff"]';
  const coords=await evaluate(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})];const n=nodes[${priorMode==='aim'?0:end==='startBinding'?0:1}],r=n.getBoundingClientRect();const p=document.querySelector('.canvas-scroll-parent'),b=p.getBoundingClientRect();p.scrollLeft+=r.x-b.x-550;p.scrollTop+=r.y-b.y-425;return true})()`);assert(coords);await wait(40);
  await evaluate(`canvasTest.getActiveUndoManager()?.clear();canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.store.temporal.getState().clear()`);
  const before=await snapshot(),raw=await authoritative();
  const from=await evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})][${priorMode==='aim'?0:end==='startBinding'?0:1}],r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  const to=await evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return [m.a*610+m.e,m.d*337+m.f]})()`);
  await mouse('mousePressed',...from);await mouse('mouseMoved',...to);
  const free=await content();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',modifiers:8});await wait(40);
  const constrained=await content();assert.notEqual(constrained,free,'stationary Shift updates actual shared render');
  const points=await evaluate(`[...document.querySelectorAll('.path-handles circle[fill="#fff"]')].map(c=>[+c.getAttribute('cx'),+c.getAttribute('cy')]).flat()`);
  const angle=Math.atan2(points[3]-points[1],points[2]-points[0])*180/Math.PI;
  assert(Math.abs(angle/45-Math.round(angle/45))<1e-6,'actual visible shaft is constrained');
  assert.equal(await authoritative(),raw);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',modifiers:0});await wait(40);assert.equal(await content(),free);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',modifiers:8});await wait(40);
  const finalPreview=await content();await mouse('mouseReleased',...to,1,8);await wait(80);
  const after=await snapshot();assert.equal(await content(),finalPreview);assert.deepEqual(after.slide.elements.subject[opposite],oppositeBinding);assert.equal(after.undo,1);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',modifiers:0});await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  if(priorMode==='aim') {
   const p=await center(selector);await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+20,p[1]+10);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Meta',code:'MetaLeft',modifiers:4});await wait(40);
   assert(await evaluate(`!!document.querySelector('.content-layer[data-gesture-preview]')`),'Cmd keeps focus gesture alive on viewport capture');
   await mouse('mouseReleased',p[0]+20,p[1]+10,1,4);await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Meta',code:'MetaLeft',modifiers:0});
   assert.equal((await snapshot()).slide.elements.subject[end],null,'Cmd detaches edited end');
  }
  matrix.push({collab,end,priorMode,oppositeMode,shift:'stationary press/release, actual shaft 45-degree angle, preserved opposite aim, one undo'});
  console.log('PASS paired Shift',collab,end,priorMode,oppositeMode);
 }
 // Compatible target: both bindings survive, and measure the actual leaf
 // shaft (not just the control circles) after stationary modifier replay.
 for(const collab of [false,true]) for(const end of ['startBinding','endBinding']) {
  const opposite=end==='startBinding'?'endBinding':'startBinding';
  const edge={elementId:'left',mode:'aim',fixedPoint:[.4,.4],gap:3};
  await setup({mode:'production',collab,subject:{shapeType:'path',x:300,y:220,width:200,height:180,points:end==='endBinding'?[0,0,200,180]:[200,180,0,0],endHead:'triangle',[opposite]:edge,[end]:{elementId:'box',mode:'aim',fixedPoint:[.4,.4],gap:0}},targets:[{id:'left',x:150,y:140,width:160,height:160},{id:'box',x:450,y:330,width:300,height:300}]});
  await evaluate(`(()=>{const s=canvasTest.snapshot().slide;canvasTest.store.getState().updateElement(s.id,'subject',{points:s.elements.subject.points});})()`);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('[data-binding-focus="${end}"] [data-focus-hit]').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x-b.x-550;p.scrollTop+=r.y-b.y-425})()`);await wait(30);
  const from=await center(`[data-binding-focus="${end}"] [data-focus-hit]`),to=await evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return [m.a*610+m.e,m.d*470+m.f]})()`);
  await mouse('mousePressed',...from);await mouse('mouseMoved',...to);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',modifiers:8});await wait(30);
  const live=await content();
  const angle=await evaluate(`(()=>{const p=document.querySelector('.content-layer [data-element-id="subject"] path[stroke="#000000"][fill="none"]'),a=p.getPointAtLength(0),b=p.getPointAtLength(p.getTotalLength());return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI})()`);
  assert(Math.abs(angle/45-Math.round(angle/45))<1e-6,'actual rendered shaft respects Shift with local aim');
  await mouse('mouseReleased',...to,1,8);assert.equal(await content(),live);
  const after=await snapshot();assert.deepEqual(after.slide.elements.subject[opposite],edge);assert.equal(after.slide.elements.subject[end].mode,'aim');
  await writeFile(`${evidence}/aim-shift-${collab}-${end}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',modifiers:0});
  matrix.push({collab,end,localAim:[.4,.4],actualRenderedAngle:angle,bothBindingsRetained:true});
  console.log('PASS aim Shift rendered shaft and both bindings',collab,end,angle);
 }
 // No capture reset here: setup edit, two rapid native focus gestures, then
 // unrelated edit must be independently undoable inside the global 500ms window.
 for(const collab of [false,true]) {
  await setup({mode:'production',collab,subject:{shapeType:'path',x:250,y:220,width:250,height:80,points:[0,0,250,80],endHead:'triangle',endBinding:{elementId:'box',mode:'aim',fixedPoint:[.4,.4],gap:0}},targets:[{id:'box',x:500,y:250,width:220,height:160}]});
  await evaluate(`(()=>{const s=canvasTest.snapshot().slide;canvasTest.store.getState().updateElement(s.id,'subject',{points:s.elements.subject.points});})()`);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('[data-focus-hit]').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x-b.x-550;p.scrollTop+=r.y-b.y-425})()`);await wait(30);
  const before=await snapshot(),states=[before];
  const started=Date.now();
  for(let i=0;i<2;i++) {
   const p=await center('[data-focus-hit]');await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+8,p[1]+6);await mouse('mouseReleased',p[0]+8,p[1]+6);
   states.push(await snapshot());assert.equal(states.at(-1).undo,before.undo+i+1);
  }
  await evaluate(`canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'box',{fill:'#ff0000'})`);
  assert(Date.now()-started<500,'rapid gestures/adjacent write fit original capture window');
  assert.equal((await snapshot()).undo,before.undo+3);
  for(const state of [states[2],states[1],states[0]]) {await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,state.slide.elements);}
  matrix.push({collab,undo:'two rapid native focus gestures plus adjacent edit, no capture reset',elapsed:Date.now()-started});
  console.log('PASS isolated rapid focus undo',collab);
 }
 for(const collab of [false,true])for(const context of ['pointercancel','lostcapture','tool-return','selection-return','remote','document','document-return','document-null']){
  await setup({mode:'production',collab,subject:{shapeType:'path',x:250,y:220,width:250,height:80,points:[0,0,250,80],endHead:'triangle',endBinding:{elementId:'box',mode:'aim',fixedPoint:[.4,.4],gap:0}},targets:[{id:'box',x:500,y:250,width:220,height:160}]});
  await evaluate(`(()=>{const s=canvasTest.snapshot().slide;canvasTest.store.getState().updateElement(s.id,'subject',{points:s.elements.subject.points});})()`);await wait(80);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('[data-focus-hit]').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x-b.x-550;p.scrollTop+=r.y-b.y-425;canvasTest.getActiveUndoManager()?.clear();canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.store.temporal.getState().clear();})()`);await wait(30);
  const raw=await authoritative(),from=await center('[data-focus-hit]');
  await mouse('mousePressed',...from);await mouse('mouseMoved',from[0]+20,from[1]+15);assert.equal(await authoritative(),raw);
  if(context==='pointercancel')await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))`);
  if(context==='lostcapture')await evaluate(`(()=>{const n=[...document.querySelectorAll('svg,svg *')].find(n=>n.hasPointerCapture?.(1));n.releasePointerCapture(1)})()`);
  if(context==='tool-return')await evaluate(`canvasTest.editor.getState().setTool('rect');canvasTest.editor.getState().setTool('select')`);
  if(context==='selection-return')await evaluate(`canvasTest.editor.getState().setSelectedElements([]);canvasTest.editor.getState().setSelectedElements(['subject'])`);
  if(context==='remote')await evaluate(`(async()=>{const id=canvasTest.editor.getState().activeSlideId;if(canvasTest.doc){const {getYElement}=await import('/src/collab/ySchema.ts');canvasTest.doc.transact(()=>getYElement(canvasTest.doc,id,'box').set('x',520),'remote')}else canvasTest.store.getState().updateElement(id,'box',{x:520})})()`);
  if(context.startsWith('document'))await evaluate(`(async()=>{const {setActiveDoc}=await import('/src/collab/yDocAdapter.ts');const {jsonToYDoc}=await import('/src/collab/ySchema.ts');window.focusReplacementDoc=jsonToYDoc(canvasTest.store.getState().presentation);setActiveDoc(window.focusReplacementDoc);if(${JSON.stringify(context)}==='document-return')setActiveDoc(canvasTest.doc);if(${JSON.stringify(context)}==='document-null')setActiveDoc(null)})()`);
  await wait(40);const current=await authoritative();await mouse('mouseReleased',from[0]+20,from[1]+15);await wait(40);
  assert.equal(await evaluate(`!!document.querySelector('.content-layer[data-gesture-preview]')`),false,'stale focus preview cleared '+context);
  assert.equal(await authoritative(),current,'late release did not overwrite '+context);
  if(context.startsWith('document'))await evaluate(`(async()=>{const {setActiveDoc}=await import('/src/collab/yDocAdapter.ts');setActiveDoc(canvasTest.doc);window.focusReplacementDoc.destroy()})()`);
  matrix.push({collab,context,cancel:'no late release write'});console.log('PASS focus cancellation',collab,context);
 }
 assert.deepEqual(runtimeErrors,[]);await writeFile(`${evidence}/matrix.json`,JSON.stringify(matrix,null,2));
} finally { ws.close(); }
