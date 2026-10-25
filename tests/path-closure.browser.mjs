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
const evidence = process.env.PATH_CLOSURE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-path-closure/native-final`;
await mkdir(evidence, {recursive:true});
const records=[];
try {
 await send('Page.enable'); await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate); await wait(500);
 for(const collab of [false,true]) for(const curve of ['linear','bezier']) for(const closed of [false,true]) for(const controlPoints of ['linear','const']) {
  await setup({mode:'properties',collab,subject:{shapeType:'path',x:200,y:200,width:100,height:100,points:[0,0,100,0,100,100],curve,
   tangents:curve==='bezier'?[-20,10,30,0,-20,-10,0,30,10,-20,-30,10]:undefined,
   closed,fill:'#ff000080',fillStyle:controlPoints==='const'?'crosshatch':'solid',stroke:'#123456',strokeWidth:3,startHead:'dot',endHead:'triangle',cornerRadius:0,transitions:{controlPoints,fill:'ease'}}});
  await evaluate(`(()=>{window.sourceID=canvasTest.snapshot().slide.id;const b=canvasTest.store.getState().duplicateSlide(sourceID);canvasTest.editor.getState().setActiveSlide(b);})()`);await wait(100);
  const p=await evaluate(`(()=>{const label=[...document.querySelectorAll('div')].find(e=>e.textContent==='Closed path');const input=label.parentElement.parentElement.querySelector('input[type=checkbox]');input.scrollIntoView();const b=input.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);await click(...p);
  assert.equal((await snapshot()).slide.elements.subject.closed,!closed);
  const record=await evaluate(`(async()=>{
   const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');
   const {pathArrowGeometry,pathD}=await import('/src/utils/pathShapes.ts');
   const a=canvasTest.store.getState().presentation.slides[sourceID],b=canvasTest.snapshot().slide;
   return {a,b,frames:[true,false].flatMap(forward=>[0,.001,.25,.5,.999,1].map(t=>{
    const el=composeSlideFrame({slideA:forward?a:b,slideB:forward?b:a,isForward:forward,animProgress:t,isAnimating:true}).renderedElements.find(el=>el.id==='subject');
    return {forward,t,el,geo:pathArrowGeometry(el),world:canvasTest.pathPointsInSlide(el),markup:canvasTest.arrowMarkup(el,'presenter')};
   }))};})()`);
  for(const f of record.frames) {
   assert.deepEqual(f.el.points,[0,0,100,0,100,100],'all authored vertices retained, no global resampling');
   assert.deepEqual(f.world,[200,200,300,200,300,300],'native same-point toggle preserves chain');
   const effective=controlPoints==='const'?(f.t<.5?0:1):f.t;
   const fromClosed=f.forward?closed:!closed;
   const progress=fromClosed?1-effective:effective;
   assert.deepEqual(f.geo.startGeo,record.frames[0].geo.startGeo,'authored start head stable');
   assert.deepEqual(f.geo.endGeo,record.frames[0].geo.endGeo,'authored end head stable');
   if(curve==='linear') {
    const chain='M 0.00 0.00 L 100.00 0.00 L 100.00 100.00';
    assert.equal(f.geo.originalD,chain+(progress===0?'':progress===1?' Z':` L ${(100*(1-progress)).toFixed(2)} ${(100*(1-progress)).toFixed(2)}`),'last-to-first tip/length');
   }
   if(f.t===0||f.t===1) {
    assert.equal(f.el._pathClosure,undefined);
    assert.equal(f.el.closed,!!progress);
   } else {
    near(f.el._pathClosure.progress,progress);
    const paint=f.t<.5?4*f.t**3:1-(-2*f.t+2)**3/2;
    near(f.el._pathClosure.fillOpacity,fromClosed?1-paint:paint,'independent fill timing');
    assert(f.markup.includes('fill-opacity='));
   }
  }
  records.push({collab,curve,closed,controlPoints,...record});
  await writeFile(`${evidence}/frames.json`,JSON.stringify(records,null,2));
  console.log('PASS native duplicate + Closed path, shared frames',collab,curve,closed,controlPoints);
 }
 // Deterministic live PresenterView and freshly rebuilt standalone player.
 const example=records.find(r=>!r.collab&&r.curve==='linear'&&!r.closed&&r.controlPoints==='linear');
 await setup({mode:'properties',subject:example.a.elements.subject});
 const deck=await evaluate(`(()=>{const deck=structuredClone(canvasTest.store.getState().presentation);deck.slides={...deck.slides,a:${JSON.stringify(example.a)},b:${JSON.stringify(example.b)}};deck.slides.a.id='a';deck.slides.b.id='b';deck.slides.a.transition.duration=2000;deck.slides.b.transition.duration=2000;deck.slideOrder=['a','b'];return deck})()`);
 const signature=`svg=>[...svg.querySelectorAll('path,polygon')].map(p=>Object.fromEntries(['d','points','fill','stroke','stroke-width','fill-opacity'].map(k=>[k,p.getAttribute(k)])))`;
 const expected=await evaluate(`(async()=>{const {composeSlideFrame}=await import('/src/components/presenter/presenterUtils.tsx');const deck=${JSON.stringify(deck)};return [0,.001,.25,.5,.999,1].map(t=>{const el=t===0?deck.slides.a.elements.subject:t===1?deck.slides.b.elements.subject:composeSlideFrame({slideA:deck.slides.a,slideB:deck.slides.b,isForward:true,animProgress:t,isAnimating:true}).renderedElements[0];return (${signature})(new DOMParser().parseFromString(canvasTest.arrowMarkup(el,'presenter'),'image/svg+xml'));});})()`);
 await evaluate(`(async()=>{canvasTest.store.setState({presentation:${JSON.stringify(deck)}});canvasTest.editor.getState().setPresentingSlideIndex(0);const {default:React}=await import('/node_modules/.vite/deps/react.js');const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');const {PresenterView}=await import('/src/components/presenter/PresenterView.tsx');const node=document.createElement('div');node.id='closure-presenter';document.body.append(node);createRoot(node).render(React.createElement(PresenterView));canvasTest.editor.getState().setPresenting(true);})()`);await wait(250);
 const clock=`window.__clock=0;window.__raf=new Map();window.__rid=0;performance.now=()=>window.__clock;window.requestAnimationFrame=fn=>{const id=++window.__rid;window.__raf.set(id,fn);return id};window.cancelAnimationFrame=id=>window.__raf.delete(id);window.__step=t=>{window.__clock=t;const callbacks=[...window.__raf.values()];window.__raf.clear();callbacks.forEach(fn=>fn(t));}`;
 async function liveFrames(selector) {
  await evaluate(clock);
  const result=[await evaluate(`(${signature})(document.querySelector(${JSON.stringify(selector)}))`)];
  await key('ArrowRight','ArrowRight');
  for(const t of [.001,.25,.5,.999,1]) {await evaluate(`__step(${t*2000})`);await wait(50);result.push(await evaluate(`(${signature})(document.querySelector(${JSON.stringify(selector)}))`));}
  return result;
 }
 const live=await liveFrames('#closure-presenter svg');assert.deepEqual(live,expected,'actual PresenterView equals compose/shared leaf');
 // Use the production exporter, intercept only its download Blob.
 const html=await evaluate(`(async()=>{const {exportStandaloneHtml}=await import('/src/utils/exportStandaloneHtml.ts');const old=HTMLAnchorElement.prototype.click;let output;HTMLAnchorElement.prototype.click=function(){output=fetch(this.href).then(r=>r.text())};try{await exportStandaloneHtml(${JSON.stringify(deck)},{mode:'viewer'});return await output}finally{HTMLAnchorElement.prototype.click=old}})()`);
 await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-import-export-repair/path-closure.html`,html);
 await send('Page.navigate',{url:base+'/__import-export-fixture/path-closure.html'});await wait(1000);
 for(let i=0;i<80&&!await evaluate(`!!document.querySelector('svg')`);i++)await wait(100);
 await key('ArrowRight','ArrowRight');await wait(100);
 const standalone=await liveFrames('svg');assert.deepEqual(standalone,expected,'fresh standalone boot frames equal live PresenterView/shared leaf');
 await writeFile(`${evidence}/live-standalone-equivalence.json`,JSON.stringify({expected,live,standalone},null,2));
 assert.deepEqual(runtimeErrors,[]);console.log('PATH CLOSURE BOUNDED REGRESSION PASSED; live presenter + fresh standalone equivalent');
} finally {ws.close();}
