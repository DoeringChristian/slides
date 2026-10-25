import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Native interior insertion/deletion reproduction; use a dedicated Chrome profile.
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/interior-point-animation.browser.mjs
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
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
const evidence=process.env.INTERIOR_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-interior-point-animation/before`;
await mkdir(evidence,{recursive:true});
const records=[];
try {
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(500);
 for(const collab of [false,true]) for(const curve of ['linear','bezier','bspline2','bspline3']) {
  await setup({mode:'production',collab,zoom:1,snap:false,subject:{shapeType:'path',x:200,y:250,width:360,height:150,points:[0,0,180,0,260,150,360,80],curve,
   tangents:curve==='bezier'?[0,0,50,-30,-50,-30,35,25,-30,-10,30,0,-40,20,0,0]:undefined,
   stroke:'#a02555',fill:'transparent',strokeStyle:'dashed',strokeWidth:3,endHead:'triangle',startHead:'dot',cornerRadius:0,
   transitions:{position:'const',size:'ease',controlPoints:'linear'}}});
  const a=(await snapshot()).slide;
  await evaluate(`(()=>{const id=canvasTest.store.getState().duplicateSlide(canvasTest.snapshot().slide.id);canvasTest.editor.getState().setActiveSlide(id)})()`);await wait(100);
  const midpoint=await center('.path-handles circle[opacity="0.45"]');
  await drag(...midpoint,midpoint[0]+20,midpoint[1]-90);
  const b=(await snapshot()).slide;
  assert.equal(b.elements.subject.points.length,a.elements.subject.points.length+2,'native midpoint insertion committed');
  await evaluate(`(()=>{const id=canvasTest.store.getState().duplicateSlide(canvasTest.snapshot().slide.id);canvasTest.editor.getState().setActiveSlide(id)})()`);await wait(100);
  const beforeDelete=(await snapshot()).slide;
  await evaluate(`canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);
  const point=await evaluate(`(()=>{const el=document.querySelectorAll('.path-handles circle[fill="#fff"]')[1];const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  await mouse('mouseMoved',point[0]+35,point[1]+35);await mouse('mouseMoved',...point);await key('Backspace');
  const c=(await snapshot()).slide;
  assert.equal(c.elements.subject.points.length,a.elements.subject.points.length,'native hovered vertex deletion committed');
  await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide,beforeDelete,'delete undo is exact');
  await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide,c,'delete redo is exact');
  const persisted=await evaluate(`(async()=>{const {jsonToYDoc,yDocToJson}=await import('/src/collab/ySchema.ts');const p=canvasTest.store.getState().presentation;const doc=jsonToYDoc(JSON.parse(JSON.stringify(p)));const result=yDocToJson(doc);doc.destroy();return result.slides[canvasTest.snapshot().slide.id]})()`);
  assert.deepEqual(persisted,c,'JSON/Yjs serialization preserves current geometry');
  const frames=await evaluate(`(async()=>{
   const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');
   const {stationaryPathPair}=await import('/src/utils/pathInterpolation.ts');
   const slides=${JSON.stringify([a,b,c])};
   return [0,1].map(i=>({eligible:!!stationaryPathPair(slides[i].elements.subject,slides[i+1].elements.subject),frames:[true,false].flatMap(forward=>[0,.000001,.25,.499999,.5,.500001,.75,.999999,1].map(t=>{
    const el=composeSlideFrame({slideA:slides[forward?i:i+1],slideB:slides[forward?i+1:i],isForward:forward,animProgress:t,isAnimating:true}).renderedElements.find(el=>el.id==='subject');
    return {forward,t,el,world:canvasTest.pathPointsInSlide(el),markup:canvasTest.arrowMarkup(el,'presenter')};
   }))}));
  })()`);
  const original=await evaluate(`canvasTest.pathPointsInSlide(${JSON.stringify(a.elements.subject)})`);
  let maxSurvivorError=0;
  for(const pair of frames) for(const f of pair.frames) {
   assert(f.markup.includes('path'),'shared renderer exercised');
   assert(!/NaN|Infinity/.test(f.markup),'finite shared renderer geometry');
   assert(f.world.every(Number.isFinite),'finite points');
   const retained=f.world.length===original.length?f.world:[...f.world.slice(0,2),...f.world.slice(4)];
   retained.forEach((v,i)=>maxSurvivorError=Math.max(maxSurvivorError,Math.abs(v-original[i])));
  }
  records.push({collab,curve,a,b,c,frames,maxSurvivorError});
  await writeFile(`${evidence}/frames.json`,JSON.stringify(records,null,2));
  console.log('NATIVE',collab,curve,'eligibility',frames.map(f=>f.eligible),'maxSurvivorError',maxSurvivorError);
  if(process.env.EXPECT_FIXED==='1'&&['linear','bezier'].includes(curve)) assert(maxSurvivorError<1e-5,'linear survivors stay fixed');
 }
 assert.deepEqual(runtimeErrors,[]);
 console.log('INTERIOR NATIVE MATRIX COMPLETE');
} finally {ws.close();}
