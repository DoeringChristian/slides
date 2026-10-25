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
const evidence = process.env.BSPLINE_EXTENSION_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-bspline-extension/native-final`;
await mkdir(evidence,{recursive:true});
const records=[];
try {
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(500);
 for(const collab of [false,true]) for(const end of ['start','end']) for(const variant of ['flat','curved2','curved3']) for(const binding of ['none','pinned','aim']) {
  const rotation=binding==='pinned'?37:0,curve=variant==='curved3'?'bspline3':'bspline2';
  const fixture=await evaluate(`(async()=>{
   const {bindingFor,resolveBinding}=await import('/src/utils/connectorUtils.ts');
   const {createShapeElement}=await import('/src/utils/slideFactory.ts');
   const {pathGeometryUpdate,slidePointToPath}=await import('/src/utils/pathEditing.ts');
   const targets=${binding==='none'?'[]':`[createShapeElement('rect',{id:'left',x:180,y:220,width:100,height:100}),createShapeElement('rect',{id:'right',x:700,y:220,width:100,height:100})]`};
   const points=${variant==='flat'?'[300,300,500,300,680,300]':'[300,300,370,370,440,250,520,340,600,260,680,300]'};
   let startBinding,endBinding;
   if(targets.length){startBinding=bindingFor({x:300,y:300},targets[0],'${binding}');endBinding=bindingFor({x:680,y:300},targets[1],'${binding}');const p=resolveBinding(startBinding,targets[0],{x:points[2],y:points[3]}),q=resolveBinding(endBinding,targets[1],{x:points.at(-4),y:points.at(-3)});points.splice(0,2,p.x,p.y);points.splice(-2,2,q.x,q.y);}
   const el=createShapeElement('path',{id:'subject',x:300,y:300,width:380,height:120,rotation:${rotation},curve:'${curve}',startBinding,endBinding,startHead:'diamond',endHead:'triangle-outline',stroke:'#a02555',fill:'transparent',cornerRadius:${variant==='curved3'?37:0},transitions:${JSON.stringify(rotation?{position:'const',size:'ease',controlPoints:'ease'}:{position:'linear',size:'linear'})}});
   const local=[];for(let i=0;i<points.length;i+=2){const p=slidePointToPath(el,points[i],points[i+1]);local.push(p.x,p.y)}
   return {targets,subject:{...el,...pathGeometryUpdate(el,local)}};
  })()`);
  await setup({mode:'production',collab,zoom:.8,snap:false,...fixture});
  await evaluate(`(()=>{window.sourceID=canvasTest.snapshot().slide.id;const b=canvasTest.store.getState().duplicateSlide(sourceID);canvasTest.editor.getState().setActiveSlide(b);})()`);await wait(70);
  await evaluate(`canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);
  const before=await snapshot(),old=await world();
  await click(...await center('[aria-label="Extend '+end+'"]'));
  await mouse('mouseMoved',...await screen(end==='start'?140:900,end==='start'?160:440));await key('Enter');
  const after=await snapshot(),next=await world();
  assert.equal(after.slide.elements.subject.id,before.slide.elements.subject.id);assert.equal(after.undo,1);
  (end==='start'?next.slice(2):next.slice(0,-2)).forEach((v,i)=>near(v,old[i],'entire retained world chain'));
  const record=await evaluate(`(async()=>{
   const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');
   const {bsplineExtensionPair}=await import('/src/utils/bsplineExtension.ts');
   const {pathArrowGeometry}=await import('/src/utils/pathShapes.ts');
   const a=canvasTest.store.getState().presentation.slides[sourceID],b=canvasTest.snapshot().slide;
   const pair=bsplineExtensionPair(a.elements.subject,b.elements.subject);if(!pair)throw Error('native pair rejected');
   return {a,b,pair,frames:[true,false].flatMap(forward=>[0,.000001,.001,.25,.5,.75,.999,.999999,1].map(t=>{const el=composeSlideFrame({slideA:forward?a:b,slideB:forward?b:a,isForward:forward,animProgress:t,isAnimating:true}).renderedElements.find(el=>el.id==='subject');return {forward,t,el,geo:pathArrowGeometry(el),world:canvasTest.pathPointsInSlide(el),markup:canvasTest.arrowMarkup(el,'presenter')};}))};
  })()`);
  assert.deepEqual(record.a.elements.subject,before.slide.elements.subject);
  for(const f of record.frames){
   const atSource=f.forward?f.t===0:f.t===1;
   if(f.t===0||f.t===1)assert.deepEqual(f.el.points,(atSource?record.a:record.b).elements.subject.points);
   else if(f.el.curve==='linear') {
    assert(f.el._pathExtension,'shared transient native spline policy');
    record.pair.a.forEach((v,i)=>{if(Math.abs(v-record.pair.b[i])<1e-8)near(f.world[i],v,'unaffected native sample');});
   }
   const i=end==='start'?f.world.length-2:0,j=end==='start'?old.length-2:0;
   near(f.world[i],old[j],'far head x');near(f.world[i+1],old[j+1],'far head y');
   assert(f.markup.includes('clipPath')&&f.markup.includes('path'),'headed shared renderer');
  }
  const mid=record.frames.find(f=>f.forward&&f.t===.5),reverse=record.frames.find(f=>!f.forward&&f.t===.5);
  mid.world.forEach((v,i)=>near(v,reverse.world[i],'reverse midpoint'));
  await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide,before.slide);
  await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide,after.slide);
  records.push({collab,end,variant,binding,rotation,...record});
  await writeFile(`${evidence}/frames.json`,JSON.stringify(records,null,2));
  console.log('PASS native B-spline extension + rendered frames + exact same-ID undo',collab,end,variant,binding);
 }
 // Rasterize the actual shared shaft, heads and clip paths, including cap guards.
 const raster=await evaluate(`(async()=>{
  const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');
  const cases=${JSON.stringify(records.map(r=>({a:r.a,b:r.b,end:r.end,variant:r.variant,binding:r.binding,collab:r.collab})))};
  const pixels=async el=>{const markup=canvasTest.arrowMarkup(el,'presenter').replace('width="400" height="400"','width="1200" height="800"');const url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);URL.revokeObjectURL(url);return ctx.getImageData(0,0,1200,800).data};
  const results=[];
  for(const c of cases){for(const t of [.000001,.999999]){const native=t<.5?c.a.elements.subject:c.b.elements.subject;const el=composeSlideFrame({slideA:c.a,slideB:c.b,isForward:true,animProgress:t,isAnimating:true}).renderedElements.find(el=>el.id==='subject');const a=await pixels(native),b=await pixels(el);let diff=0,ink=0;for(let i=3;i<a.length;i+=4){diff+=Math.abs(a[i]-b[i]);ink+=a[i]}results.push({end:c.end,variant:c.variant,binding:c.binding,collab:c.collab,t,relativeAlphaDifference:diff/ink});}}
  return results;
 })()`);
 await writeFile(`${evidence}/near-end-raster.json`,JSON.stringify(raster,null,2));
 for(const r of raster)assert(r.relativeAlphaDifference<.02,'native rendered near-end continuity including clips '+JSON.stringify(r));
 // Deterministic live PresenterView and freshly rebuilt standalone player.
 const example=records.find(r=>!r.collab&&r.variant==='curved3'&&r.binding==='none'&&r.end==='start');
 await setup({mode:'properties',subject:example.a.elements.subject});
 const deck=await evaluate(`(()=>{const deck=structuredClone(canvasTest.store.getState().presentation);deck.slides={...deck.slides,a:${JSON.stringify(example.a)},b:${JSON.stringify(example.b)}};deck.slides.a.id='a';deck.slides.b.id='b';deck.slides.a.transition.duration=2000;deck.slides.b.transition.duration=2000;deck.slideOrder=['a','b'];return deck})()`);
 const signature=`svg=>[...svg.querySelectorAll('path,polygon')].map(p=>Object.fromEntries(['d','points','fill','stroke','stroke-width','fill-opacity'].map(k=>[k,p.getAttribute(k)])))`;
 const expected=await evaluate(`(async()=>{const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');const deck=${JSON.stringify(deck)};return [0,.001,.25,.5,.999,1].map(t=>{const el=t===0?deck.slides.a.elements.subject:t===1?deck.slides.b.elements.subject:composeSlideFrame({slideA:deck.slides.a,slideB:deck.slides.b,isForward:true,animProgress:t,isAnimating:true}).renderedElements[0];return (${signature})(new DOMParser().parseFromString(canvasTest.arrowMarkup(el,'presenter'),'image/svg+xml'));});})()`);
 await evaluate(`(async()=>{canvasTest.store.setState({presentation:${JSON.stringify(deck)}});canvasTest.editor.getState().setPresentingSlideIndex(0);const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {PresenterView}=await import('/src/components/presenter/PresenterView.tsx');const node=document.createElement('div');node.id='bspline-presenter';document.body.append(node);createRoot(node).render(React.createElement(PresenterView));canvasTest.editor.getState().setPresenting(true);})()`);await wait(250);
 const clock=`window.__clock=0;window.__raf=new Map();window.__rid=0;performance.now=()=>window.__clock;window.requestAnimationFrame=fn=>{const id=++window.__rid;window.__raf.set(id,fn);return id};window.cancelAnimationFrame=id=>window.__raf.delete(id);window.__step=t=>{window.__clock=t;const callbacks=[...window.__raf.values()];window.__raf.clear();callbacks.forEach(fn=>fn(t));}`;
 async function liveFrames(selector) {
  await evaluate(clock);
  const result=[await evaluate(`(${signature})(document.querySelector(${JSON.stringify(selector)}))`)];
  await key('ArrowRight','ArrowRight');
  for(const t of [.001,.25,.5,.999,1]) {await evaluate(`__step(${t*2000})`);await wait(50);result.push(await evaluate(`(${signature})(document.querySelector(${JSON.stringify(selector)}))`));}
  return result;
 }
 const live=await liveFrames('#bspline-presenter svg');assert.deepEqual(live,expected,'actual PresenterView equals compose/shared leaf');
 // Use the production exporter, intercept only its download Blob.
 const html=await evaluate(`(async()=>{const {exportStandaloneHtml}=await import('/src/utils/exportStandaloneHtml.ts');const old=HTMLAnchorElement.prototype.click;let output;HTMLAnchorElement.prototype.click=function(){output=fetch(this.href).then(r=>r.text())};try{await exportStandaloneHtml(${JSON.stringify(deck)},{mode:'viewer'});return await output}finally{HTMLAnchorElement.prototype.click=old}})()`);
 await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-import-export-repair/bspline-extension.html`,html);
 await send('Page.navigate',{url:base+'/__import-export-fixture/bspline-extension.html'});await wait(1000);
 for(let i=0;i<80&&!await evaluate(`!!document.querySelector('svg')`);i++)await wait(100);
 await key('ArrowRight','ArrowRight');await wait(100);
 const standalone=await liveFrames('svg');assert.deepEqual(standalone,expected,'fresh standalone boot frames equal live PresenterView/shared leaf');
 await writeFile(`${evidence}/live-standalone-equivalence.json`,JSON.stringify({expected,live,standalone},null,2));
 assert.deepEqual(runtimeErrors,[]);console.log('BSPLINE EXTENSION BOUNDED REGRESSION PASSED');
} finally {ws.close();}
