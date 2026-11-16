import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
import assert from 'node:assert/strict';
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
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function screen(x,y){return evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:m.a*${x}+m.e,y:m.d*${y}+m.f}})()`);}
async function mouse(type,p,count=1){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:count});await wait(30);}
async function click(p,count=1){await mouse('mousePressed',p,count);await mouse('mouseReleased',p,count);}
async function drag(a,b){await mouse('mousePressed',a);for(let i=1;i<=5;i++)await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/5,y:a.y+(b.y-a.y)*i/5});await mouse('mouseReleased',b);await wait(150);}
async function button(label){const point=await evaluate(`(()=>{const b=[...document.querySelectorAll('#creation-properties button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(point);await wait(100);}
const handle = name => evaluate(`(()=>{const h=document.querySelector('.selection-transformer [data-resize-handle=${name}]');if(!h)return null;const r=(h.querySelector('[data-resize-visual]')??h).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const rect = sel => evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(sel)});if(!n)return null;const r=n.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})()`);
const center = async sel => { const r = await rect(sel); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
try {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await waitForCanvasFixture(evaluate);
  await evaluate(`localStorage.removeItem('slides.layout.v1');canvasTest.setup(${JSON.stringify({mode:'layout',subject:{x:100,y:100,width:120,height:80},targets:[{id:'b',x:300,y:100,width:100,height:100}]})})`);
  await wait(300);
  const canvas = () => rect('.canvas-scroll-parent');

  // Defaults: thumbnails, the right panel on Properties, objects hidden.
  assert.equal((await rect('[data-panel=slides]')).w, 240);
  assert.equal((await rect('[data-panel=side]')).w, 300);
  assert.equal((await rect('[data-panel=objects]')).h, 28, 'objects panel hidden by default');
  assert.equal(await evaluate(`document.querySelector('[role=tab][aria-selected=true]').textContent`), 'Properties');

  // Opening the objects panel: one fixed height; selecting objects then never
  // changes the canvas (the "N selected" bar lives inside the panel).
  await click(await center('[data-panel=objects] button'));
  await wait(150);
  assert.equal((await rect('[data-panel=objects]')).h, 240);
  const before = await canvas();
  await evaluate(`canvasTest.editor.getState().setSelectedElements(['subject','b'])`); await wait(150);
  assert(await evaluate(`[...document.querySelectorAll('[data-panel=objects] span')].some(s=>s.textContent==='2 selected')`), 'selection bar shown');
  assert.deepEqual(await canvas(), before, 'selecting does not resize the canvas');
  await evaluate(`canvasTest.editor.getState().clearSelection()`); await wait(150);
  assert.deepEqual(await canvas(), before, 'deselecting does not resize the canvas');

  // Slide panel: clicking its edge snaps to the strip, which has slide actions.
  await click(await center('[data-panel=slides] [data-snap-edge]')); await wait(150);
  assert.equal((await rect('[data-panel=slides]')).w, 56);
  assert(await evaluate(`!!document.querySelector('[data-slide-strip]')`), 'compact strip shown');
  const slidesBefore = await evaluate('canvasTest.store.getState().presentation.slideOrder.length');
  await click(await center('[aria-label="Copy of this slide below"]')); await wait(150);
  assert.equal(await evaluate('canvasTest.store.getState().presentation.slideOrder.length'), slidesBefore + 1, 'copy below adds a slide');
  assert.equal(await evaluate(`canvasTest.store.getState().presentation.slideOrder.indexOf(canvasTest.editor.getState().activeSlideId)`), 1, 'and goes to it');
  // Dragging the edge back past halfway snaps to full; a short drag snaps back.
  let edge = await center('[data-panel=slides] [data-snap-edge]');
  await drag(edge, { x: edge.x + 60, y: edge.y });
  assert.equal((await rect('[data-panel=slides]')).w, 56, 'short drag snaps back to the strip');
  edge = await center('[data-panel=slides] [data-snap-edge]');
  await mouse('mousePressed', edge);
  await mouse('mouseMoved', { x: edge.x + 70, y: edge.y });
  const mid1 = (await rect('[data-panel=slides]')).w;
  await mouse('mouseMoved', { x: edge.x + 140, y: edge.y });
  const mid2 = (await rect('[data-panel=slides]')).w;
  await mouse('mouseReleased', { x: edge.x + 140, y: edge.y }); await wait(150);
  assert(mid1 > 56 && mid2 > mid1, `the panel follows the pointer while dragging (${mid1}, ${mid2})`);
  assert.equal((await rect('[data-panel=slides]')).w, 240, 'long drag snaps to thumbnails');

  // Right panel: tabs, and hiding it by dragging its edge away.
  await click(await center('[role=tab]:nth-child(2)')); await wait(300);
  assert.equal(await evaluate(`document.querySelector('[role=tab][aria-selected=true]').textContent`), 'Assistant');
  assert(await evaluate(`!!document.querySelector('[data-testid=agent-panel]')`), 'assistant shown in the tab');
  edge = await center('[data-panel=side] [data-snap-edge]');
  await drag(edge, { x: edge.x + 250, y: edge.y });
  assert.equal((await rect('[data-panel=side]')).w, 8, 'hidden, with a sliver to grab');
  edge = await center('[data-panel=side] [data-snap-edge]');
  await click(edge); await wait(150);
  assert.equal((await rect('[data-panel=side]')).w, 300, 'click brings it back');

  // Remembered per browser.
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('slides.layout.v1'))`), { slides: 'full', sideOpen: true, sideTab: 'assistant', objectsOpen: true });
  console.log('PASS panels: fixed snapping sizes, tabs, compact slide strip, selection never resizes the canvas, remembered');
  assert.deepEqual(runtimeErrors.filter(e => !/Failed to fetch|NetworkError|ERR_CONNECTION/.test(JSON.stringify(e))), []);
} finally { ws.close(); }
