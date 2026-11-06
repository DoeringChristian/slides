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
  await setup({mode:'production',collab,objectList:true,subject:{objectGroupIds:['g'],cropGroupId:'g'},targets:[{id:'child',x:240,y:150,objectGroupIds:['g']}]});
  await evaluate(`(()=>{const s=canvasTest.store.getState(),e=canvasTest.editor.getState();window.sourceGroupSlide=e.activeSlideId;const id=s.addEmptySlide();e.setActiveSlide(id)})()`);await wait(150);
  assert(await evaluate("!!document.querySelector('[data-object-group-id=g]')"),'missing group stays a single tile');
  const p=await evaluate(`(()=>{const b=document.querySelector('[title="Show group on this slide"]');if(!b)throw Error('missing group show');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(p);await wait(100);
  const slide=await evaluate('canvasTest.snapshot().slide');assert.deepEqual(new Set(slide.elementOrder),new Set(['subject','child']));assert.equal(slide.elements.subject.cropGroupId,'g');assert.equal(slide.elements.child.visible,true);
  assert(await evaluate("!!document.querySelector('[data-object-group-id=g] clipPath')"),'group tile shows crop');
  await evaluate('if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()');await wait(100);assert.equal((await evaluate('canvasTest.snapshot().slide.elementOrder')).length,0);
  console.log('PASS show entire crop group on empty slide and undo collab='+collab);
 }
 assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
