import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Resize snapping with the aspect ratio kept (corner handles): the snapped
// edge lands exactly even when the other axis drives the scale — a snap that
// corrected one axis only was lost then. Free (Shift) resizes snap too.
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
const handle = name => evaluate(`(()=>{const r=document.querySelector('[data-resize-handle="${name}"] rect:last-child').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const collab of [false, true]) {
    // Subject 100×80 at (100,100); a target whose left edge is x=300.
    const run = async (dx, dy, modifiers = 0) => {
      await setup({ mode: 'production', collab, snap: true, subject: { x: 100, y: 100, width: 100, height: 80, fill: '#c33' },
        targets: [{ id: 'target', x: 300, y: 600, width: 100, height: 100, fill: '#36c' }] });
      const p = await handle('bottom-right');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
      for (let k = 1; k <= 4; k++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + dx * k / 4, y: p.y + dy * k / 4, button: 'left', buttons: 1, modifiers });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 0, clickCount: 1, modifiers }); await wait(150);
      return (await evaluate('canvasTest.snapshot()')).slide.elements.subject;
    };
    // The pointer moves more vertically (scale 2.0125) than horizontally
    // (1.95): the kept-ratio box's right edge comes to 301.25 — it snaps to 300.
    const kept = await run(95, 81);
    assert.ok(Math.abs(kept.x + kept.width - 300) < 1e-6, `aspect-kept corner snaps its right edge: ${JSON.stringify(kept)}`);
    assert.ok(Math.abs(kept.width / kept.height - 1.25) < 1e-6, 'and keeps the ratio');
    // Shift: free — the right edge snaps on its own.
    const free = await run(101, 30, 8);
    assert.ok(Math.abs(free.x + free.width - 300) < 1e-6, `free corner snaps its right edge: ${JSON.stringify(free)}`);
    console.log(`PASS resize snapping with the aspect ratio kept and free collab=${collab}`);
  }
} finally { ws.close(); }
