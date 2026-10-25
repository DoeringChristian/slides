import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/path-move-marker.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page');
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
async function setup(config) { await waitForCanvasFixture(evaluate); await evaluate(`canvasTest.resetPreferences();canvasTest.setup(${JSON.stringify(config)})`); await wait(100); }
let pressed = false;
async function mouse(type, x, y, clickCount = 1, modifiers = 0) {
  if(type === 'mousePressed') pressed = true;
  if(type === 'mouseReleased') pressed = false;
  await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount, modifiers });
  await wait(30);
}
async function click(x, y, count = 1) { await mouse('mousePressed', x, y, count); await mouse('mouseReleased', x, y, count); }
async function drag(x, y, ex, ey) { await mouse('mousePressed', x, y); await mouse('mouseMoved', ex, ey); await mouse('mouseReleased', ex, ey); }
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
const near = (actual, expected, message = '') => assert(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);
async function screen(x,y) { return evaluate(`(() => { const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(); return [m.a*${x}+m.c*${y}+m.e,m.b*${x}+m.d*${y}+m.f]; })()`); }
async function world(id='subject') { return evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements[${JSON.stringify(id)}])`); }
async function select(ids) { await evaluate(`canvasTest.editor.getState().setSelectedElements(${JSON.stringify(ids)})`); await wait(60); }
async function paintedRectPoint(id) { return evaluate(`(()=>{const el=canvasTest.snapshot().slide.elements[${JSON.stringify(id)}],m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();const x=el.x+2/canvasTest.editor.getState().zoom,y=el.y+el.height/2;return [m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];})()`); }
async function modifier(type, keyName='Meta', modifiers=type==='keyDown'?4:0) {
  await send('Input.dispatchKeyEvent',{type,key:keyName,code:keyName+'Left',windowsVirtualKeyCode:keyName==='Shift'?16:keyName==='Meta'?91:17,modifiers}); await wait(60);
}
async function guides() { return evaluate(`(() => { const g=document.querySelector('.alignment-guides'); return {hidden:g.getAttribute('visibility')==='hidden',markers:g.querySelectorAll('.snap-destination').length,html:g.outerHTML}; })()`); }
async function capture() { return evaluate(`Array.from(document.querySelectorAll('svg, svg *')).some(e=>e.hasPointerCapture?.(1))`); }
async function highlighted() { return evaluate(`!!document.querySelector('.ui-layer [data-connector-highlight]')`); }
const bindingTargets = [{id:'left',x:260,y:240,width:160,height:120},{id:'right',x:700,y:240,width:160,height:120}];
const evidence=process.env.PATH_CORRESPONDENCE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-path-correspondence/native-regression`;
await mkdir(evidence,{recursive:true});
const records=[];
try {
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(1000);
 for(const collab of [false,true]) for(const end of ['start','end']) for(const rotation of [0,37]) for(const curve of ['linear','smooth','bezier']) {
  const fixture=await evaluate(`(async()=>{
   const {bindingFor,resolveBinding}=await import('/src/utils/connectorUtils.ts');
   const {createShapeElement}=await import('/src/utils/slideFactory.ts');
   const {pathGeometryUpdate,slidePointToPath}=await import('/src/utils/pathEditing.ts');
   const targets=[createShapeElement('rect',{id:'left',x:200,y:200,width:100,height:100}),createShapeElement('rect',{id:'right',x:400,y:200,width:100,height:100})];
   const p={x:295,y:220},q={x:405,y:280};
   const startBinding=bindingFor(p,targets[0],'aim'),endBinding=bindingFor(q,targets[1],'aim');
   const a=resolveBinding(startBinding,targets[0],q),b=resolveBinding(endBinding,targets[1],p);
   const el=createShapeElement('path',{id:'subject',x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y,rotation:${rotation},curve:'${curve}',points:[0,0,b.x-a.x,b.y-a.y],startBinding,endBinding,startHead:'dot',endHead:'triangle',stroke:'#a02555',fill:'transparent',cornerRadius:${curve==='linear'?12:0},transitions:${JSON.stringify(rotation?{position:'const',size:'ease',controlPoints:'ease'}:{position:'linear',size:'linear'})}});
   const pts=[a,b].flatMap(p=>{const l=slidePointToPath(el,p.x,p.y);return [l.x,l.y]});
   return {targets,subject:{...el,...pathGeometryUpdate(el,pts,${curve==='bezier'?'[0,0,24,-16,-24,16,0,0]':'undefined'})}};
  })()`);
  assert.deepEqual(fixture.subject.startBinding.fixedPoint,[.95,.2]);
  await setup({mode:'production',collab,zoom:.8,snap:false,...fixture});
  await evaluate(`(()=>{window.sourceID=canvasTest.snapshot().slide.id;const b=canvasTest.store.getState().duplicateSlide(sourceID);canvasTest.editor.getState().setActiveSlide(b);})()`);await wait(100);
  await evaluate(`canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);
  const before=await snapshot(),old=await world();
  await click(...await center('[aria-label="Extend '+end+'"]'));
  const destination=[end==='start'?140:660,end==='start'?150:380];await mouse('mouseMoved',...await screen(...destination));
  const preview=await evaluate(`(()=>{const paths=[...document.querySelectorAll('svg path[stroke="#a02555"]')];return paths.map(p=>p.getAttribute('d'));})()`);
  assert(preview.length>0,'actual styled extension preview is present');
  await key('Enter');const after=await snapshot(),next=await world();
  const committed=await evaluate(`Array.from(document.querySelectorAll('.content-layer path[stroke="#a02555"]')).map(p=>p.getAttribute('d'))`);
  assert.deepEqual(committed,preview,'shared preview shaft/head geometry equals committed geometry');
  assert.equal(after.slide.elements.subject.id,before.slide.elements.subject.id);assert.equal(after.undo,1);
  const retained=end==='start'?next.slice(2):next.slice(0,-2);retained.forEach((v,i)=>near(v,old[i],'retained world vertex'));
  assert.deepEqual(after.slide.elements.subject[end==='start'?'endBinding':'startBinding'],before.slide.elements.subject[end==='start'?'endBinding':'startBinding']);
  const frames=await evaluate(`(async()=>{
   const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');const {stationaryPathPair}=await import('/src/utils/pathInterpolation.ts');
   const a=canvasTest.store.getState().presentation.slides[sourceID],b=canvasTest.snapshot().slide;
   if(!stationaryPathPair(a.elements.subject,b.elements.subject))throw Error('stationary correspondence rejected');
   return {a,b,frames:[true,false].flatMap(forward=>[0,.001,.25,.5,.999,1].map(t=>{const el=composeSlideFrame({slideA:forward?a:b,slideB:forward?b:a,isForward:forward,animProgress:t,isAnimating:true}).renderedElements.find(el=>el.id==='subject');return {forward,t,el,world:canvasTest.pathPointsInSlide(el),markup:canvasTest.arrowMarkup(el,'presenter')};}))};
  })()`);
  assert.deepEqual(frames.a.elements.subject,before.slide.elements.subject,'source keyframe unchanged');
  for(const f of frames.frames) {
   const atSource=f.forward?f.t===0:f.t===1;
   const kept=atSource?f.world:end==='start'?f.world.slice(2):f.world.slice(0,-2);
   kept.forEach((v,i)=>near(v,old[i],`${curve}/${rotation}/${end}/${f.forward}/${f.t} retained vertex`));
   assert(f.markup.includes('path'),'actual shared shape rendered');
   if(f.t===0||f.t===1) {const expected=(atSource?frames.a:frames.b).elements.subject;assert.deepEqual(f.el.points,expected.points);assert.deepEqual(f.el.tangents,expected.tangents);}
  }
  // The rendered terminal geometry, not merely matching eligibility, is reversible.
  for(const f of frames.frames.filter(f=>f.forward&&f.t===.5)) {
   const reverse=frames.frames.find(r=>!r.forward&&r.t===.5);f.world.forEach((v,i)=>near(v,reverse.world[i],'reverse midpoint'));
  }
  await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide,before.slide);
  await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide,after.slide);
  records.push({collab,end,rotation,curve,preview,...frames});
  await writeFile(`${evidence}/frames.json`,JSON.stringify(records,null,2));
  console.log('PASS native same-ID extension, shared frames and exact undo',collab,end,rotation,curve);
 }
 assert.deepEqual(runtimeErrors,[]);console.log('PATH CORRESPONDENCE BOUNDED REGRESSION PASSED');
} finally {ws.close();}
