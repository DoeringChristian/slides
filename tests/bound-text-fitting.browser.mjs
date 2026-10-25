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
const pausedRequests = new Set();
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Fetch.requestPaused') pausedRequests.add(msg.params.requestId);
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
  await wait(30);
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


const evidence=process.env.BOUND_FITTING_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/bound-review-fixes/focused`;
const style={fontFamily:'Arial',fontSize:20,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'center',verticalAlign:'middle',lineHeight:1.25};
async function capture(name){
  await writeFile(`${evidence}/${name}.json`,JSON.stringify(await snapshot(),null,2));
  const png=await send('Page.captureScreenshot');await writeFile(`${evidence}/${name}.png`,Buffer.from(png.data,'base64'));
}
async function replace(text){await key('a','KeyA',4);await send('Input.insertText',{text});await wait(200);}
async function until(check, description) {
 for(let i=0;i<150;i++){if(await check())return;await wait(50);}throw new Error('Timed out: '+description);
}
async function center(selector){return evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);}
async function releaseMath(){for(const requestId of pausedRequests)await send('Fetch.continueRequest',{requestId});pausedRequests.clear();await send('Fetch.disable');}
try {
 await mkdir(evidence,{recursive:true});
 await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(1500);
 for(const collab of [false,true])for(const shapeType of ['rect','ellipse'])for(const rotation of [0,30]){
  const name=`${collab?'yjs':'json'}-${shapeType}-${rotation}`;
  await check(name+' live fit and one undo',async()=>{
   await setup({mode:'production',collab,subject:{shapeType,x:200,y:180,width:200,height:190,rotation}});
   await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;
     const e={...createBoundLabel(s.elements.subject),id:'label',text:'Hi',style:${JSON.stringify(style)}};
     canvasTest.store.getState().addElement(s.id,e);})()`);await wait(300);
   await evaluate(`canvasTest.editor.getState().setEditingTextId('label')`);await wait(300);
   const before=await snapshot();await capture(name+'-short');
   await replace('a long measured bound label with enough words to overflow the manual baseline '.repeat(10));
   const mid=await snapshot();assert.deepEqual(mid.slide,before.slide);assert.equal(mid.undo,before.undo);
   assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"]').length`),0,'bound container actions unmounted during live text growth');
   const longHeight=await evaluate(`document.querySelector('[contenteditable]').parentElement.style.height`);
   assert(parseFloat(longHeight)>190,longHeight);await capture(name+'-long-live');
   await replace('Hi');await capture(name+'-short-live');
   assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);
   const shortHeight=await evaluate(`parseFloat(document.querySelector('[contenteditable]').parentElement.style.height)`);
   assert(shortHeight<40,shortHeight);
   await key('Escape');await wait(400);
   assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"]').length`),1,'bound container actions restored after final geometry');
   const after=await snapshot();assert.equal(after.undo,before.undo+1);
   assert.equal(after.slide.elements.label.text,'Hi');assert(after.slide.elements.subject.height<100);
   assert.equal(after.slide.elements.subject.x,200);assert.equal(after.slide.elements.subject.y,180);
   assert.equal(after.slide.elements.label.boundTextBaselineHeight,190);await capture(name+'-finished');
   await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo();})()`);await wait(150);
   assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  });
 }
 for(const collab of [false,true])await check(`${collab?'Yjs':'JSON'} native manual baseline and width, labeled connector follows live fit`,async()=>{
  await setup({mode:'production',collab,subject:{x:200,y:180,width:200,height:40},targets:[{id:'arrow',shapeType:'path',x:400,y:200,width:150,height:0,points:[0,0,150,0],startBinding:{elementId:'subject',mode:'pinned',fixedPoint:[1,.5]}}]});
  await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;canvasTest.store.getState().addElements(s.id,[{...createBoundLabel(s.elements.subject),id:'label',text:'Hi',style:${JSON.stringify(style)}},{...createBoundLabel(s.elements.arrow),id:'arrowLabel',text:'Arrow',style:${JSON.stringify(style)}}]);})()`);await until(()=>evaluate(`!!document.querySelector('[data-resize-handle="bottom-center"]')`),'resize handles');await wait(300);
  let p=await center('[data-resize-handle="bottom-center"]');
  const beforeResize=await snapshot();await mouse('mousePressed',...p);await mouse('mouseMoved',p[0],p[1]+150);
  assert.deepEqual((await snapshot()).slide,beforeResize.slide);await mouse('mouseReleased',p[0],p[1]+150);await wait(200);
  let snap=await snapshot();assert.equal(snap.slide.elements.subject.height,190);assert.equal(snap.slide.elements.label.boundTextBaselineHeight,190);
  p=await center('[data-resize-handle="middle-right"]');await drag(...p,p[0]+50,p[1]);await wait(200);
  snap=await snapshot();assert.equal(snap.slide.elements.subject.width,250);assert.equal(snap.slide.elements.label.boundTextBaselineHeight,190);
  await evaluate(`canvasTest.editor.getState().setEditingTextId('label')`);await wait(300);
  const before=await snapshot();const arrowBefore=await evaluate(`document.querySelector('[data-element-id="arrow"]').outerHTML`);
  await key('a','KeyA',4);await send('Input.insertText',{text:'Long bound label with overflow and connectors '.repeat(12)});await wait(300);
  assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);
  assert.notEqual(await evaluate(`document.querySelector('[data-element-id="arrow"]').outerHTML`),arrowBefore);
  await key('a','KeyA',4);await send('Input.insertText',{text:'Hi'});await wait(250);
  await key('Escape');await wait(400);assert.equal((await snapshot()).undo,before.undo+1);await capture(`${collab?'yjs':'json'}-native-manual-width-connector`);
 });
 // Actual first-use MathJax network delay: pending A must not suppress B's resize fit.
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 for(const collab of [false,true])await check(`${collab?'Yjs':'JSON'} pending A MathJax allows unrelated B native resize fit`,async()=>{
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);
  await setup({mode:'production',collab,subject:{x:200,y:180,width:200,height:100},targets:[{id:'boxB',x:550,y:180,width:230,height:190}]});
  await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;canvasTest.store.getState().addElements(s.id,[
    {...createBoundLabel(s.elements.subject),id:'labelA',text:'Hi',style:${JSON.stringify(style)}},
    {...createBoundLabel(s.elements.boxB),id:'labelB',text:'unrelated label wraps independently '.repeat(3),style:${JSON.stringify(style)}}]);})()`);
  await wait(400);
  await send('Fetch.enable',{patterns:[{urlPattern:'*mathjax*',requestStage:'Request'}]});
  await evaluate(`canvasTest.editor.getState().setEditingTextId('labelA')`);
  await until(()=>evaluate(`!!document.activeElement?.isContentEditable`),'A edit focus');
  await replace('Math $\\sqrt{x}$');await key('Escape');
  await until(()=>pausedRequests.size>0,'actual MathJax request paused');
  const isPending=()=>evaluate(`import('/src/store/textEditSession.ts').then(m=>m.hasPendingTextFinish(canvasTest.snapshot().slide.id,'labelA'))`);
  assert(await isPending());assert.equal((await snapshot()).slide.elements.labelA.text,'Hi');
  await writeFile(`${evidence}/${collab?'yjs':'json'}-paused-math-requests.json`,JSON.stringify({count:pausedRequests.size,requestIds:[...pausedRequests]},null,2));
  await evaluate(`canvasTest.editor.getState().setSelectedElements(['boxB'])`);await wait(150);
  const before=await snapshot();await capture(`${collab?'yjs':'json'}-pending-A-before-B-resize`);
  const p=await center('[data-resize-handle="middle-right"]');
  await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]-130,p[1]);
  assert.deepEqual((await snapshot()).slide,before.slide,'resize preview does not mutate doc');
  await mouse('mouseReleased',p[0]-130,p[1]);
  await until(async()=> (await snapshot()).slide.elements.labelB.height>before.slide.elements.labelB.height,'B refitted while A is pending');
  const resized=await snapshot();assert.equal(resized.slide.elements.boxB.width,100);
  assert.equal(resized.slide.elements.labelA.text,'Hi');assert(await isPending());
  await capture(`${collab?'yjs':'json'}-pending-A-after-B-refit`);
  await releaseMath();await until(()=>isPending().then(p=>!p),'A accepted finish complete');await wait(500);
  const finished=await snapshot();assert.equal(finished.slide.elements.labelA.text,'Math $\\sqrt{x}$');
  assert.equal(finished.undo,resized.undo+1,'A adds exactly its atomic finish, not a background-fit undo');
  assert.deepEqual(finished.slide.elements.boxB,resized.slide.elements.boxB);
  assert.deepEqual(finished.slide.elements.labelB,resized.slide.elements.labelB);
  await capture(`${collab?'yjs':'json'}-A-finished-B-stable`);
 });
 await send('Network.setCacheDisabled',{cacheDisabled:false});
 assert.deepEqual(runtimeErrors,[]);
}finally{await releaseMath();await writeFile(`${evidence}/runtime-errors.json`,JSON.stringify(runtimeErrors));ws.close();}
