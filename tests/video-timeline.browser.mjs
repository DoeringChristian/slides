import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// The video timeline: this keyframe's segment (drag From / To on a
// filmstrip), how it starts and what happens at the end — also for a cropped video.
//
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const collab of [false, true]) {
    await setup({ mode: 'production', collab, creationProperties: true, subject: { type: 'image', x: 200, y: 150, width: 320, height: 180, resourceId: 'vid' },
      targets: [{ id: 'crop', x: 200, y: 150, width: 160, height: 180, stroke: '', objectGroupIds: ['g'], cropGroupId: 'g' }] });
    await evaluate(`(async () => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const ctx = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
      const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
      for (let i = 0; i < 60; i++) { ctx.fillStyle = 'hsl(' + i * 6 + ',80%,50%)'; ctx.fillRect(0, 0, 160, 90); await new Promise(r => setTimeout(r, 33)); }
      await new Promise(r => { rec.onstop = r; rec.stop(); });
      canvasTest.store.getState().addResource({ id: 'vid', name: 'clip', type: 'video', src: URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), originalWidth: 160, originalHeight: 90, duration: 10 });
      canvasTest.editor.getState().setSelectedElements(['subject']);
    })()`);
    await wait(800);
    assert(await evaluate("!!document.querySelector('[data-video-timeline]')"), 'a selected video shows its timeline');
    assert.equal(await evaluate("document.querySelector('[data-video-segment]').textContent"), '0.0s → 10.0s · 10.0s', 'default segment: the whole video');
    // Drag the end handle to 60 % of the bar: To = 6 s.
    await evaluate("document.querySelector('[data-video-bar]').scrollIntoView({block:'center'})"); await wait(150);
    // The end handle is whole and on top at the bar's very end.
    const bar = await evaluate(`(()=>{const b=document.querySelector('[data-video-bar]').getBoundingClientRect();const h=document.querySelector('[data-video-handle="to"]').getBoundingClientRect();return {x:b.x,w:b.width,y:b.y+b.height/2,hx:h.x+h.width/2}})()`);
    await mouse('mousePressed', { x: bar.hx, y: bar.y }); await mouse('mouseMoved', { x: bar.x + bar.w * 0.8, y: bar.y }); await mouse('mouseMoved', { x: bar.x + bar.w * 0.6, y: bar.y }); await mouse('mouseReleased', { x: bar.x + bar.w * 0.6, y: bar.y }); await wait(200);
    let el = await evaluate('canvasTest.snapshot().slide.elements.subject');
    assert(Math.abs(el.playTo - 6) < 0.11, `dragging the end sets To: ${el.playTo}`);
    assert.equal(await evaluate("document.querySelector('[data-video-segment]').textContent"), `0.0s → ${el.playTo.toFixed(1)}s · ${el.playTo.toFixed(1)}s`);
    if (!collab) { const r = await evaluate(`(()=>{const b=document.querySelector('[data-video-timeline]').getBoundingClientRect();return {x:b.x-8,y:b.y-8,width:b.width+16,height:b.height+16,scale:2}})()`);
      await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/timeline.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: r })).data, 'base64')); }
    await evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()"); await wait(150);
    assert.equal(await evaluate('canvasTest.snapshot().slide.elements.subject.playTo ?? null'), null, 'one undo restores it');
    // Start mode: pick Still.
    await evaluate(`[...document.querySelectorAll('button[aria-label^="Start"]')][0].click()`); await wait(150);
    await evaluate(`[...document.querySelectorAll('[role=dialog][aria-label="Start"] [aria-label^="Still"]')][0].click()`); await wait(150);
    assert.equal(await evaluate('canvasTest.snapshot().slide.elements.subject.playback'), 'still', 'Start → Still');
    // The cropped video's group selected: the same timeline.
    await evaluate("canvasTest.editor.getState().setSelectedElements(['subject','crop'])"); await wait(300);
    assert.equal(await evaluate('canvasTest.editor.getState().selectedElementIds.length'), 2);
    assert(await evaluate("!!document.querySelector('[data-video-timeline]')"), 'the crop group shows the video timeline');
    console.log('PASS video timeline: filmstrip segment drag (one undo), start mode, also on the cropped video group collab=' + collab);
  }
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
