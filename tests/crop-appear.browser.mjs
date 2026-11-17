import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// A crop shape appearing reveals the image the way its visibility easing
// says (wipe, grow, iris, fade, …), not all the same way.
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
  // A frame of: image on A; image + full-cover crop on
  // B, the crop appearing with `easing`. Rendered by the presenter's own
  // composition and element renderer, then rasterised.
  const mount = (easing, t, imageOnA = false) => evaluate(`(async () => {
    const { composeSlideFrame, renderPresenterElement } = await import('/src/components/presenter/presenterUtils.tsx');
    const ServerMod = await import('/@id/react-dom/server'); const renderToStaticMarkup = ServerMod.renderToStaticMarkup ?? ServerMod.default.renderToStaticMarkup;
    const ReactMod = await import('/@id/react'); const React = ReactMod.default ?? ReactMod;
    const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>');
    const resources = { red: { id: 'red', name: 'red', type: 'image', src, originalWidth: 200, originalHeight: 100 } };
    const base = { rotation: 0, opacity: 1, locked: false, visible: true };
    // The image cuts in (const) so only the crop's effect shapes the frame.
    const image = { ...base, id: 'i', type: 'image', resourceId: 'red', x: 100, y: 100, width: 400, height: 200, objectGroupIds: ['g'], transitions: { visibility: 'const' } };
    // Covering the image; for an image already on screen, its left half.
    const crop = { ...base, id: 'c', type: 'shape', shapeType: 'rect', creationPreset: 'rect', x: 100, y: 100, width: ${imageOnA} ? 200 : 400, height: 200,
      fill: '#000000', stroke: '', strokeWidth: 0, cornerRadius: 0, objectGroupIds: ['g'], cropGroupId: 'g', transitions: { visibility: ${JSON.stringify(easing)} } };
    const slide = (id, els) => ({ id, elements: Object.fromEntries(els.map(e => [e.id, e])), elementOrder: els.map(e => e.id), background: { type: 'solid', color: '#ffffff' } });
    const { renderedElements } = composeSlideFrame({ slideA: slide('A', ${imageOnA} ? [image] : []), slideB: slide('B', [image, crop]), isForward: true, animProgress: ${t}, isAnimating: true });
    const body = renderToStaticMarkup(React.createElement(React.Fragment, null, renderedElements.map(el => renderPresenterElement(el, resources))));
    // Mounted live (the presenter draws media as HTML in foreignObject,
    // which an SVG rasterised through <img> does not load).
    document.getElementById('crop-appear-frame')?.remove();
    const host = document.createElement('div');
    host.id = 'crop-appear-frame';
    host.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:540px;z-index:2147483647;background:white';
    host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">' + body + '</svg>';
    document.body.appendChild(host);
    await Promise.all([...host.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { n: renderedElements.length, ids: renderedElements.map(e => e.id + ':' + (e._writeFx?.mode ?? '') + ':' + e.opacity), body: body.slice(0, 1500) };
  })()`);
  // Pixels from a screenshot of the mounted frame (green channel: 255 white, 0 red).
  // Entrances play in the transition's second half: t = 0.75 is halfway.
  const frameAt = async (easing, t = 0.75, imageOnA = false) => {
    const info = await mount(easing, t, imageOnA);
    if (process.env.CROP_DEBUG) console.log('FRAME', easing, t, JSON.stringify(info));
    const shot = (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 960, height: 540, scale: 1 } })).data;
    return evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${shot}';await img.decode();const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      const at=(x,y)=>ctx.getImageData(x,y,1,1).data[1];document.getElementById('crop-appear-frame')?.remove();
      return {left:at(150,200),right:at(450,200),centre:at(300,200),corner:at(110,110)}})()`);
  };
  const shown = g => g < 60, hidden = g => g > 200;
  const wipe = await frameAt('wipe');
  assert(shown(wipe.left) && hidden(wipe.right), `wipe reveals from the left: ${JSON.stringify(wipe)}`);
  const grow = await frameAt('grow');
  assert(shown(grow.centre) && hidden(grow.corner), `grow reveals from the centre: ${JSON.stringify(grow)}`);
  const iris = await frameAt('iris');
  assert(shown(iris.centre) && hidden(iris.corner), `iris opens from the centre: ${JSON.stringify(iris)}`);
  // A fade on a crop that appears together with its image is the image's to
  // show (here the image cuts in): the crop is not faded a second time.
  const fade = await frameAt('linear');
  assert(shown(fade.centre) && shown(fade.corner), `appearing with its image, the crop is not faded twice: ${JSON.stringify(fade)}`);
  const done = await frameAt('wipe', 1);
  assert(shown(done.left) && shown(done.right), 'at the end the whole crop shows');
  // Cropping an image already on screen: it shows whole until the crop's
  // effect starts, the outside fades as the crop comes in, and is gone at
  // the end — no jump at the midpoint.
  const start = await frameAt('linear', 0.5, true);
  assert(shown(start.left) && shown(start.right) && shown(start.corner), `whole at the start: ${JSON.stringify(start)}`);
  const half = await frameAt('linear', 0.75, true);
  assert(shown(half.left) && half.right > 60 && half.right < 200, `the outside (right half) half faded: ${JSON.stringify(half)}`);
  const end = await frameAt('linear', 1, true);
  assert(shown(end.left) && hidden(end.right), `cropped at the end — the outside gone: ${JSON.stringify(end)}`);
  console.log('PASS crop appear: wipe, grow and iris shape the crop; no double fade with its image; cropping an on-screen image eases in');
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
