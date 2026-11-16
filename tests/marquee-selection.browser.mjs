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
try {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for (const collab of [false, true]) {
    await waitForCanvasFixture(evaluate);
    await evaluate(`canvasTest.setup(${JSON.stringify({mode:'production',collab,subject:{x:100,y:100,width:100,height:100},targets:[{id:'b',x:300,y:100,width:100,height:100},{id:'c',x:100,y:300,width:100,height:100}]})})`);
    await wait(100);
    const state = () => evaluate(`({sel:[...canvasTest.editor.getState().selectedElementIds].sort(),outlines:[...document.querySelectorAll('[data-selection-outline]')].map(n=>n.getAttribute('data-selection-outline')).sort(),box:document.querySelector('[data-selection-box]')?.getAttribute('data-selection-box')??null})`);
    // Drag from empty space; keep the button down and inspect as it grows.
    await mouse('mousePressed', await screen(80, 80));
    await mouse('mouseMoved', await screen(250, 160));
    let s = await state();
    assert.deepEqual(s.sel, [], 'touching is not selecting');
    await mouse('mouseMoved', await screen(250, 250));
    s = await state();
    assert.deepEqual(s, { sel: ['subject'], outlines: [], box: 'solid' }, 'wholly inside → selected at once; one object: solid box, no outlines');
    await mouse('mouseMoved', await screen(450, 250));
    s = await state();
    assert.deepEqual(s, { sel: ['b', 'subject'], outlines: ['b', 'subject'], box: 'dashed' }, 'several: dashed box, an outline each');
    await mouse('mouseMoved', await screen(250, 250));
    s = await state();
    assert.deepEqual(s, { sel: ['subject'], outlines: [], box: 'solid' }, 'shrinking drops it again');
    await mouse('mouseMoved', await screen(450, 450));
    await mouse('mouseReleased', await screen(450, 450)); await wait(120);
    s = await state();
    assert.deepEqual(s, { sel: ['b', 'c', 'subject'], outlines: ['b', 'c', 'subject'], box: 'dashed' }, 'release keeps what is covered');
    console.log(`PASS selection rectangle selects only what it wholly contains, live, with outlines collab=${collab}`);
  }
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
