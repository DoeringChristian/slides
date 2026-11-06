import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas-modifiers.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
  for(const collab of [false,true]) {
    await setup({mode:'production',collab,snap:true,creationProperties:true,subject:{shapeType:'dot',x:100,y:100,width:24,height:24,stroke:'none',strokeWidth:0},targets:[{id:'line',shapeType:'path',x:300,y:100,width:200,height:200,points:[0,0,200,200],fill:'none'}]});
    await drag(await screen(112,112),await screen(400,203));
    const dot=await evaluate('canvasTest.snapshot().slide.elements.subject');
    assert(Math.abs(dot.x-dot.y-200)<.01,JSON.stringify(dot));assert.equal(dot.width,24);assert.equal(dot.height,24);
    const panel=await evaluate("document.querySelector('#creation-properties').textContent");assert(panel.includes('Diameter'));assert(panel.includes('Stroke Width'));assert(panel.includes('Fill Style'));assert(!panel.includes('Corner Radius'));
    await evaluate('if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()');await wait(100);
    assert.equal(await evaluate('canvasTest.snapshot().slide.elements.subject.x'),100);
    console.log('PASS dot centre drag snapping, controls, undo collab='+collab);
    // Exercise the same paint swatches and border-width editor as other shapes.
    const paint=await evaluate(`(()=>{const buttons=[...document.querySelectorAll('[aria-label="Stroke colors"] button')];const b=buttons.find(b=>b.getAttribute('aria-label')?.startsWith('Stroke: #'));if(!b)throw Error('missing shared stroke palette');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(paint);
    const width=await evaluate(`(()=>{const row=document.querySelector('[data-property="strokeWidth"]');const input=row?.querySelector('.cursor-ew-resize');if(!input)throw Error('missing shared stroke width');input.scrollIntoView();const r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(width);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65});
    await send('Input.insertText',{text:'4'});await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(100);
    const bordered=await evaluate('canvasTest.snapshot().slide.elements.subject');assert.equal(bordered.strokeWidth,4);assert(bordered.stroke&&bordered.stroke!=='none');
    const painted=await evaluate(`(()=>{const el=[...document.querySelectorAll('.canvas-scroll-parent svg ellipse')].find(e=>e.getAttribute('stroke-width')==='4');return el?.getAttribute('stroke')})()`);assert(painted&&painted!=='none');
    console.log('PASS dot shared stroke palette and visible border collab='+collab);

    await setup({mode:'production',collab,snap:true,empty:true,targets:[{id:'line',shapeType:'path',x:300,y:100,width:200,height:200,points:[0,0,200,200],fill:'none'}]});
    await evaluate("canvasTest.editor.getState().setTool('line')");await wait(100);
    const p=await screen(400,203);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1,modifiers:2});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1,modifiers:2});await wait(100);
    const made=await evaluate("Object.values(canvasTest.snapshot().slide.elements).find(e=>e.shapeType==='dot')");assert(made,'Ctrl-click creates dot');assert(Math.abs(made.x-made.y-200)<.01,JSON.stringify(made));assert(made.width>=6);
    console.log('PASS dot creation centred on line collab='+collab);
  }
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
