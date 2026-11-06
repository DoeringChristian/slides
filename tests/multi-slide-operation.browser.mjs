import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas-modifiers.browser.mjs
import assert from 'node:assert/strict';

const base = process.env.VITE_TEST_URL;
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
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text=msg.params.args.map(arg=>arg.value??arg.description??'').join(' ');
    if (/order of Hooks|Rendered (more|fewer) hooks|getSnapshot|same key/.test(text)) runtimeErrors.push(text);
  }
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
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

async function screen(x,y){return evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:m.a*${x}+m.e,y:m.d*${y}+m.f}})()`);}
async function mouse(type,p,count=1){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:count});await wait(30);}
async function click(p,count=1){await mouse('mousePressed',p,count);await mouse('mouseReleased',p,count);}
async function drag(a,b){await mouse('mousePressed',a);await mouse('mouseMoved',b);await mouse('mouseReleased',b);await wait(100);}
async function button(label){const point=await evaluate(`(()=>{const b=[...document.querySelectorAll('#creation-properties button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(point);await wait(100);}
try {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(const collab of [false,true]) for(const multi of [false,true]){
    await setup({mode:'production',collab,secondSlide:true,subject:{shapeType:'path',x:100,y:100,width:100,height:100,points:[0,0,40,40,100,100],curve:'linear'},targets:multi?[{id:'box',x:350,y:100,width:100,height:100}]:[]});
    await evaluate(`canvasTest.store.getState().updateAcrossSlides([{slideId:'other',elementId:'subject',changes:{x:30,y:40,width:200,height:100,points:[0,100,50,20,200,0],visible:false,stroke:'#abcdef',endHead:'circle'}}]);canvasTest.editor.setState({selectedSlideIds:[canvasTest.editor.getState().activeSlideId,'other'],selectedElementIds:${JSON.stringify(multi?['subject','box']:['subject'])}});canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);await wait(150);
    const other=()=>evaluate(`(async()=>{const {yDocToJson}=await import('/src/collab/ySchema.ts');return (canvasTest.doc?yDocToJson(canvasTest.doc):canvasTest.store.getState().presentation).slides.other})()`);
    const original=await other();
    await drag(await screen(130,130),await screen(155,150));
    let after=await other();
    assert.deepEqual(after.elements.subject,{...original.elements.subject,x:55,y:60});
    if(multi)assert.deepEqual(after.elements.box,{...original.elements.box,x:375,y:120});
    await evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()");await wait(100);
    assert.deepEqual(await other(),original);
    // Native resize must scale the earlier slide's three vertices, not replace them with two.
    const handle=await evaluate(`(()=>{const n=document.querySelector('[data-resize-handle="top-right"] [data-resize-visual]');const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await drag(handle,{x:handle.x+100,y:handle.y-50});
    after=await other();const path=after.elements.subject;
    assert.equal(path.visible,false);assert.equal(path.stroke,'#abcdef');assert.equal(path.endHead,'circle');
    assert.equal(path.points.length,6);assert.equal(path.points[0],0);assert.equal(path.points[5],0);
    assert(Math.abs(path.points[2]/path.points[4]-.25)<1e-8);
    assert(Math.abs(path.points[3]/path.points[1]-.2)<1e-8);
    assert(path.width>original.elements.subject.width);
    await evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()");await wait(100);
    assert.deepEqual(await other(),original);
    console.log('PASS native multi-slide move/resize retains topology, hidden state, style; atomic undo collab='+collab+' multi='+multi);
  }
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
