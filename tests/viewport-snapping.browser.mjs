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
  for(const collab of [false,true]) for(const visible of [false,true]) {
    await setup({mode:'production',collab,snap:true,subject:{x:250,y:180,width:100,height:80},targets:[{id:'target',x:453,y:visible?350:5000,width:50,height:40}]});
    const handle=await evaluate(`(()=>{const r=document.querySelector('[data-resize-handle="middle-right"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await drag(handle,{x:handle.x+101,y:handle.y});
    let state=await evaluate('canvasTest.snapshot().slide');assert(Math.abs(state.elements.subject.width-(visible?203:201))<.001,'resize only sees visible target');
    await setup({mode:'production',collab,snap:true,subject:{x:250,y:180,width:100,height:80},targets:[{id:'target',x:353,y:visible?350:5000,width:50,height:40}]});
    await drag(await screen(300,220),await screen(401,220));
    state=await evaluate('canvasTest.snapshot().slide');assert(Math.abs(state.elements.subject.x-(visible?353:351))<.001,'drag only sees visible target');
    await setup({mode:'production',collab,snap:true,empty:true,tool:'rect',targets:[{id:'target',x:453,y:visible?350:5000,width:50,height:40}]});
    await drag(await screen(250,180),await screen(451,260));
    state=await evaluate('canvasTest.snapshot().slide');const drawn=state.elements[state.elementOrder.at(-1)];
    assert.notEqual(drawn.id,'target');assert(Math.abs(drawn.width-(visible?203:201))<.001,'drawing only sees visible target');
    console.log('PASS viewport drag/resize/draw collab='+collab+' visible='+visible);
  }
  const scrolling=await evaluate(`(async()=>{const {snapViewport}=await import('/src/utils/snapViewport.ts');const svg=document.querySelector('.canvas-scroll-parent svg'),p=document.querySelector('.canvas-scroll-parent');const before=snapViewport(svg);p.scrollTop+=120;const after=snapViewport(svg);return {before,after}})()`);
  assert(Math.abs(scrolling.after.y-scrolling.before.y-120)<.01);
  console.log('PASS snap viewport follows scrollport rather than oversized SVG');
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
