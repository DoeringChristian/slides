import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Align and Match Size work against the object selected last (the target).
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
const btn = title => evaluate(`(()=>{const b=document.querySelector('button[title^=${JSON.stringify(title)}]');if(!b)throw Error('missing '+${JSON.stringify(title)});b.click();})()`).then(() => wait(200));
const els = () => evaluate('canvasTest.snapshot().slide.elements');
const shiftClick = async (x, y) => { const p = await screen(x, y); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, modifiers: 8 }); await wait(120); };
const undo = () => evaluate('(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo()})()').then(() => wait(200));
const RED = `(()=>{const c=document.createElement('canvas');c.width=40;c.height=20;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,40,20);canvasTest.store.getState().addResource(canvasTest.mediaResource({id:'red',name:'r',type:'image',src:c.toDataURL(),originalWidth:40,originalHeight:20}));})()`;
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const collab of [false, true]) {
    await setup({ mode: 'layout', collab, empty: true, targets: [
      { id: 'small', x: 100, y: 100, width: 60, height: 40, fill: '#3366cc' },
      // A cropped image: the image is 400×200, its crop shows 100×100 of it.
      { id: 'img', type: 'image', x: 300, y: 80, width: 400, height: 200, resourceId: 'red', objectGroupIds: ['g'] },
      { id: 'crop', x: 400, y: 100, width: 100, height: 100, stroke: '', objectGroupIds: ['g'], cropGroupId: 'g' },
      { id: 'target', x: 200, y: 400, width: 160, height: 90, fill: '#cc3333' },
    ] });
    await evaluate(RED); await evaluate("canvasTest.editor.setState({ snapToGrid: false })"); await wait(200);
    // Select in order: small, the cropped image, then the target last.
    await evaluate('canvasTest.editor.getState().clearSelection()');
    await shiftClick(130, 120); await shiftClick(450, 150); await shiftClick(280, 445);
    const order = await evaluate('canvasTest.editor.getState().selectedElementIds');
    assert.equal(order[order.length - 1], 'target', `the target is selected last ${JSON.stringify(order)}`);
    await evaluate('canvasTest.getActiveUndoManager()?.stopCapturing(); canvasTest.store.temporal.getState().clear()');
    await btn('Match Size');
    let e = await els();
    assert.deepEqual([e.small.x, e.small.y, e.small.width, e.small.height], [100, 100, 160, 90], 'the rect takes the target size at its corner');
    assert.deepEqual([e.crop.x, e.crop.y, e.crop.width, e.crop.height], [400, 100, 160, 90], 'the cropped image’s visible area takes the target size');
    assert.ok(Math.abs(e.img.width - 640) < 1e-6 && Math.abs(e.img.height - 180) < 1e-6, `the image stretches with its crop ${JSON.stringify([e.img.width, e.img.height])}`);
    assert.deepEqual([e.target.x, e.target.y, e.target.width, e.target.height], [200, 400, 160, 90], 'the target is unchanged');
    await btn('Align Left');
    e = await els();
    assert.equal(e.small.x, 200, 'align left moves to the target’s left edge');
    assert.equal(e.crop.x, 200, 'the cropped image aligns by its visible edge');
    assert.equal(e.target.x, 200, 'the target stays');
    await btn('Align Top');
    e = await els();
    assert.deepEqual([e.small.y, e.crop.y, e.target.y], [400, 400, 400], 'align top to the target');
    // Each is one undo step.
    await undo(); await undo();
    e = await els();
    assert.deepEqual([e.small.x, e.crop.x, e.small.width], [100, 400, 160], 'undo restores the alignment, one step each');
    await undo();
    e = await els();
    assert.deepEqual([e.small.width, e.crop.width, e.img.width], [60, 100, 400], 'and the size match in one step');
    console.log(`PASS match size and align to the last-selected target, one undo step each collab=${collab}`);
  }
  assert.deepEqual(runtimeErrors, [], 'no runtime errors');
} finally { ws.close(); }
