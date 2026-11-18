import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// A shape with text offers the same text controls as text: selecting the
// shape shows its label's settings in the Properties panel and the format
// bar, and a font-size change re-fits the label, centred in its shape.
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
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await setup({ mode: 'layout', empty: true });
  // A rect with a label, made the way the editor makes one (double-click → type).
  await evaluate(`(async()=>{const f=await import('/src/utils/model/slideFactory.ts');const st=canvasTest.store.getState();const sid=canvasTest.editor.getState().activeSlideId;
    const r=f.createShapeElement('rect',{id:'box',x:300,y:200,width:400,height:200});st.addElement(sid,r);
    canvasTest.editor.getState().setSelectedElements(['box']);})()`); await wait(300);
  const p = await screen(500, 300);
  await mouse('mousePressed', p, 1); await mouse('mouseReleased', p, 1); await mouse('mousePressed', p, 2); await mouse('mouseReleased', p, 2); await wait(500);
  await send('Input.insertText', { text: 'Label text' }); await wait(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(500);
  await evaluate(`canvasTest.editor.getState().setSelectedElements(['box'])`); await wait(400);
  const label = () => evaluate(`(()=>{const s=canvasTest.snapshot().slide;const l=Object.values(s.elements).find(e=>e.containerId==='box');return l&&{fs:l.style.fontSize,x:Math.round(l.x),y:Math.round(l.y),w:Math.round(l.width),h:Math.round(l.height),layout:l.boundTextLayout,bh:l.boundTextBaselineHeight}})()`);
  const before = await label();
  assert.equal(before?.fs, 24, 'the shape got a label');
  assert.ok(await evaluate(`!!document.querySelector('[data-shape-label-properties]')`), 'the panel shows the label\'s text settings');
  assert.ok(await evaluate(`[...document.querySelectorAll('select')].some(s=>s.value==='Inter')`), 'the format bar shows for the shape');
  await evaluate(`(async()=>{const {updateElementFromCurrent}=await import('/src/store/currentMutation.ts');const s=canvasTest.snapshot().slide;const l=Object.values(s.elements).find(e=>e.containerId==='box');
    updateElementFromCurrent(canvasTest.editor.getState().activeSlideId,l,c=>({style:{...c.style,fontSize:72}}))})()`); await wait(800);
  void ( JSON.stringify(await evaluate(`(()=>{const s=canvasTest.snapshot().slide;const l=Object.values(s.elements).find(e=>e.containerId==='box');const g=document.querySelector('.content-layer [data-element-id="'+l.id+'"]');if(!g)return null;const rs=[...g.querySelectorAll('path')].map(p=>p.getBoundingClientRect()).filter(r=>r.width>0);const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {glyphH:Math.round((Math.max(...rs.map(r=>r.bottom))-Math.min(...rs.map(r=>r.top)))/m.d),glyphW:Math.round((Math.max(...rs.map(r=>r.right))-Math.min(...rs.map(r=>r.left)))/m.a)}})()`)));
  const after = await label();
  assert.equal(after.fs, 72, 'the label took the new size');
  assert.ok(after.w > before.w * 2.5, `the label re-fitted to its text ${JSON.stringify([before, after])}`);
  assert.ok(Math.abs(after.x + after.w / 2 - 500) < 1 && Math.abs(after.y + after.h / 2 - 300) < 1, `and stays centred in its shape ${JSON.stringify(after)}`);
  assert.deepEqual(runtimeErrors, [], 'no runtime errors');
  console.log('PASS a shape with text offers its label\'s text controls; a size change re-fits the label');
} finally { ws.close(); }
