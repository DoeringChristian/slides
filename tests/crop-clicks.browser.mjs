import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Clicks on cropped images and videos land on what shows: hidden parts (by
// the crop's adds, intersects and subtracts) pass through, crop shapes take
// no clicks outside crop mode, and a double-click opens crop mode (a cropped
// image is one object, not a group to open onto its bare image).
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
const RES = `canvasTest.store.getState().addResource(canvasTest.mediaResource({id:'red',name:'red',type:'image',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>'),originalWidth:300,originalHeight:200}));`;
const VID = `(async()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');const rec=new MediaRecorder(c.captureStream(30),{mimeType:'video/webm'});const ch=[];rec.ondataavailable=e=>ch.push(e.data);rec.start();for(let i=0;i<20;i++){ctx.fillStyle='#0a0';ctx.fillRect(0,0,160,90);await new Promise(r=>setTimeout(r,33));}await new Promise(r=>{rec.onstop=r;rec.stop();});canvasTest.store.getState().addResource(canvasTest.mediaResource({id:'vid',name:'v',type:'video',blob:new Blob(ch,{type:'video/webm'}),originalWidth:160,originalHeight:90,duration:1}));})()`;
const clickAt = async (x, y, count = 1) => { const p = await screen(x, y); for (let i = 1; i <= count; i++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: i }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: i }); await wait(60); } await wait(150); };
const st = () => evaluate(`({ sel: canvasTest.editor.getState().selectedElementIds.slice().sort(), scope: canvasTest.editor.getState().activeObjectGroupId, crop: canvasTest.editor.getState().croppingElementId })`);
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const kind of ['image', 'video']) for (const op of ['add', 'intersect']) {
    // Behind: a shape at the image's right part (hidden by the crop).
    await setup({ mode: 'production', targets: [
      { id: 'behind', x: 420, y: 160, width: 70, height: 70, fill: '#3366cc' },
      { id: 'img', type: 'image', x: 200, y: 150, width: 300, height: 200, resourceId: kind === 'image' ? 'red' : 'vid', objectGroupIds: ['g'] },
      { id: 'crop', x: 210, y: 160, width: 150, height: 120, stroke: '', objectGroupIds: ['g'], cropGroupId: 'g' },
      ...(op === 'intersect' ? [{ id: 'crop2', x: 210, y: 160, width: 100, height: 180, stroke: '', objectGroupIds: ['g'], cropGroupId: 'g', cropOp: 'intersect' }] : []),
    ], empty: true });
    await evaluate(RES); if (kind === 'video') await evaluate(VID); await wait(300);
    const r = {};
    await evaluate("canvasTest.editor.getState().clearSelection()"); await clickAt(250, 200); r.visible = await st();
    await evaluate("canvasTest.editor.getState().clearSelection()"); await clickAt(450, 190); r.hiddenOverBehind = await st();
    await evaluate("canvasTest.editor.getState().clearSelection()"); await clickAt(340, 200); r.hiddenByIntersect = await st();
    await evaluate("canvasTest.editor.getState().clearSelection()"); await clickAt(250, 200, 2); r.dbl = await st();
    await evaluate("canvasTest.editor.getState().exitCropMode()"); await wait(100);
    console.log('CLICK', kind, op, JSON.stringify(r));
    const group = op === 'intersect' ? ['crop', 'crop2', 'img'] : ['crop', 'img'];
    assert.deepEqual(r.visible.sel, group, `${kind}/${op}: a click on the visible picture selects the cropped ${kind}`);
    assert.deepEqual(r.hiddenOverBehind.sel, ['behind'], `${kind}/${op}: a click on its hidden part reaches the object behind`);
    if (op === 'intersect') assert.deepEqual(r.hiddenByIntersect.sel, [], `${kind}: what an intersect crops away takes no clicks`);
    assert.equal(r.dbl.crop, 'img', `${kind}/${op}: a double-click opens crop mode, not the bare image under the crop`);
  }
  // A video in the editor is a still with a badge: no play button to land on,
  // so a press anywhere on it (badge and centre included) drags it.
  await setup({ mode: 'production', targets: [{ id: 'v', type: 'image', x: 200, y: 150, width: 300, height: 200, resourceId: 'vid' }], empty: true });
  await evaluate(VID); await evaluate("canvasTest.editor.setState({ snapToGrid: false })"); await wait(300);
  const badge = await evaluate(`(()=>{const b=document.querySelector('[data-video-badge]');return b&&getComputedStyle(b).pointerEvents})()`);
  assert.equal(badge, 'none', 'a video carries a badge that takes no clicks');
  await drag(await screen(350, 250), await screen(350, 250)); await drag(await screen(350, 250), await screen(380, 270));
  const pos = () => evaluate(`(({x,y})=>({x,y}))(canvasTest.store.getState().presentation.slides[canvasTest.editor.getState().activeSlideId].elements.v)`);
  const centre = await pos();
  assert.deepEqual(centre, { x: 230, y: 170 }, 'a press on the centre (where the play button was) moves the video');
  await drag(await screen(232, 182), await screen(252, 192));
  const moved = await evaluate(`(()=>{const s=canvasTest.store.getState();const el=s.presentation.slides[canvasTest.editor.getState().activeSlideId].elements.v;return {x:el.x,y:el.y,circles:document.querySelectorAll('[data-element-id="v"] ~ g circle').length}})()`);
  assert.equal(moved.x, 250, `a press on the badge moves the video: ${JSON.stringify(moved)}`);
  assert.equal(moved.circles, 0, 'no play button');
  // A plain group of two rects.
  await setup({ mode: 'production', targets: [{ id: 'a', x: 200, y: 150, width: 100, height: 100, fill: '#c33', objectGroupIds: ['p'] }, { id: 'b', x: 350, y: 150, width: 100, height: 100, fill: '#3c3', objectGroupIds: ['p'] }], empty: true });
  await evaluate("canvasTest.editor.getState().clearSelection()"); await clickAt(250, 200, 2);
  const plain = await st();
  assert.deepEqual([plain.scope, plain.sel], ['p', ['a']], 'a double-click enters a plain group');
  console.log('PASS clicks on cropped images and videos land on what shows; double-click enters with the picture selected');
} finally { ws.close(); }
