import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Video playback across keyframes (presenter media controller): a video is
// one playback — continue keeps going, still pauses on its frame, range plays and holds.
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
  await waitForCanvasFixture(evaluate);
  const r = await evaluate(`(async () => {
    // A 3 s WebM.
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const ctx = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data); rec.start();
    for (let i = 0; i < 90; i++) { ctx.fillStyle = 'hsl(' + i * 4 + ',80%,50%)'; ctx.fillRect(0, 0, 160, 90); await new Promise(r => setTimeout(r, 33)); }
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    const src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    // WebM from MediaRecorder lacks a duration until scanned; take a fixed one.
    const resources = { v: { id: 'v', name: 'clip', type: 'video', hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mime: 'video/webm', size: 1, originalWidth: 160, originalHeight: 90, duration: 3 } };
    const objects = { vid: { id: 'vid', name: 'clip', type: 'image' } };
    const el = over => ({ id: 'vid', type: 'image', resourceId: 'v', x: 0, y: 0, width: 160, height: 90, rotation: 0, opacity: 1, locked: false, visible: true, muted: true, ...over });
    const slide = (id, over) => ({ id, elements: { vid: el(over) }, elementOrder: ['vid'], background: { type: 'solid', color: '#fff' } });
    const slides = [slide('a', {}), slide('b', {}), slide('c', { playback: 'still', playFrom: 0.5 }), slide('d', { playback: 'range', playFrom: 1, playTo: 1.4 })];

    const ReactMod = await import('/@id/react'); const React = ReactMod.default ?? ReactMod;
    const DomMod = await import('/@id/react-dom/client'); const createRoot = DomMod.createRoot ?? DomMod.default.createRoot;
    const { useMediaController } = await import('/src/components/presenter/mediaController.ts');
    const host = document.createElement('div'); document.body.appendChild(host);
    let setIndex, setGen;
    function Player() {
      const [index, si] = React.useState(0); const [gen, sg] = React.useState(0); setIndex = si; setGen = sg;
      const ref = React.useRef(null);
      useMediaController(ref, slides[index], resources, objects);
      // gen remounts the <video> (as a changed crop or tint wrapper would).
      return React.createElement('div', { ref }, React.createElement('video', { key: gen, src, muted: true, playsInline: true, 'data-media-id': 'vid' }));
    }
    createRoot(host).render(React.createElement(Player));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const video = () => host.querySelector('video');
    const out = {};
    await wait(900);
    out.a = { t: video().currentTime, paused: video().paused };
    setIndex(1); await wait(500);
    out.b = { t: video().currentTime, paused: video().paused };              // continue: no restart
    setGen(1); await wait(500);
    out.remount = { t: video().currentTime, paused: video().paused };        // a new <video> takes over the clock
    setIndex(2); await wait(600);
    out.c = { t: video().currentTime, paused: video().paused };              // still at 0.5
    setIndex(3); await wait(1100);
    out.d = { t: video().currentTime, paused: video().paused };              // range 1 → 1.4, held
    return out;
  })()`);
  console.log('VIDEO', JSON.stringify(r));
  assert(!r.a.paused && r.a.t > 0.4, `keyframe 1: the video plays from the start (${JSON.stringify(r.a)})`);
  assert(!r.b.paused && r.b.t > r.a.t + 0.2, `keyframe 2 (continue): keeps playing, no restart (${r.a.t} → ${r.b.t})`);
  assert(!r.remount.paused && r.remount.t > r.b.t, `a remounted <video> continues the same playback (${r.b.t} → ${r.remount.t})`);
  assert(r.c.paused && Math.abs(r.c.t - 0.5) < 0.1, `still: paused at 0.5 s (${JSON.stringify(r.c)})`);
  assert(r.d.paused && Math.abs(r.d.t - 1.4) < 0.1, `range 1 → 1.4 then hold: stopped at 1.4 s (${JSON.stringify(r.d)})`);
  console.log('PASS video playback: continues across keyframes and remounts, still, range and hold');
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
