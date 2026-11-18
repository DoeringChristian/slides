import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Zoom reaches 1600% for fine alignment: store, Ctrl+wheel, keys, slider.
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
async function mouse(type,p){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});await wait(30);}
const zoom = () => evaluate('canvasTest.editor.getState().zoom');
const key = async (k, code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: process.platform === 'darwin' ? 4 : 2 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: process.platform === 'darwin' ? 4 : 2 }); await wait(80); };
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await setup({ mode: 'production', subject: { x: 400, y: 300, width: 100, height: 60, fill: '#3366cc' } });
  await evaluate("canvasTest.editor.setState({ snapToGrid: false })");
  // The store clamps to the new limit.
  await evaluate('canvasTest.editor.getState().setZoom(50)'); assert.equal(await zoom(), 16, 'zoom clamps at 1600%');
  await evaluate('canvasTest.editor.getState().setZoom(1)'); await wait(150);
  // Ctrl+wheel goes past the old 300% and stops at 1600%.
  const over = await screen(450, 330);
  for (let i = 0; i < 12; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...over, deltaX: 0, deltaY: -400, modifiers: 2 }); await wait(40); }
  await wait(200);
  assert.equal(await zoom(), 16, `Ctrl+wheel reaches 1600% (${await zoom()})`);
  // Keys step by ×1.25 in both directions.
  await evaluate('canvasTest.editor.getState().setZoom(4)');
  await key('=', 'Equal'); assert.ok(Math.abs(await zoom() - 5) < 1e-9, `Ctrl+= steps ×1.25 (${await zoom()})`);
  await key('-', 'Minus'); assert.ok(Math.abs(await zoom() - 4) < 1e-9, `Ctrl+− steps back (${await zoom()})`);
  // At 1600% a 16px drag moves an object by one slide pixel.
  await evaluate('canvasTest.editor.getState().setZoom(16)'); await wait(300);
  await evaluate(`(()=>{const sp=document.querySelector('.canvas-scroll-parent');const svg=sp.querySelector('svg');const m=svg.getScreenCTM();const r=sp.getBoundingClientRect();sp.scrollLeft+=(m.a*450+m.e)-(r.left+r.width/2);sp.scrollTop+=(m.d*330+m.f)-(r.top+r.height/2);})()`); await wait(200);
  const a = await screen(450, 330), b = { x: a.x + 16, y: a.y + 32 };
  await mouse('mousePressed', a); await mouse('mouseMoved', { x: a.x + 8, y: a.y + 16 }); await mouse('mouseMoved', b); await mouse('mouseReleased', b); await wait(200);
  const moved = await evaluate('(({x,y})=>({x,y}))(canvasTest.snapshot().slide.elements.subject)');
  assert.deepEqual(moved, { x: 401, y: 302 }, `a 16px drag at 1600% moves one slide pixel ${JSON.stringify(moved)}`);
  assert.deepEqual(runtimeErrors, [], 'no runtime errors');
  console.log('PASS zoom reaches 1600% (store, Ctrl+wheel, ×1.25 keys) and drags move in fine steps');
} finally { ws.close(); }
