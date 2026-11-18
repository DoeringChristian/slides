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
  const mount = (easing, t, imageOnA = false, imageEasing = 'const', intersect = false) => evaluate(`(async () => {
    const { composeSlideFrame, renderPresenterElement } = await import('/src/components/presenter/presenterUtils.tsx');
    const ServerMod = await import('/@id/react-dom/server'); const renderToStaticMarkup = ServerMod.renderToStaticMarkup ?? ServerMod.default.renderToStaticMarkup;
    const ReactMod = await import('/@id/react'); const React = ReactMod.default ?? ReactMod;
    const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>');
    const resources = { red: canvasTest.mediaResource({ id: 'red', name: 'red', type: 'image', src, originalWidth: 200, originalHeight: 100 }) };
    const base = { rotation: 0, opacity: 1, locked: false, visible: true };
    // The image cuts in (const) unless told otherwise, so the crop's effect shapes the frame.
    const image = { ...base, id: 'i', type: 'image', resourceId: 'red', x: 100, y: 100, width: 400, height: 200, objectGroupIds: ['g'], transitions: { visibility: ${JSON.stringify(imageEasing)} } };
    // Covering the image; for an image already on screen, its left half.
    const crop = { ...base, id: 'c', type: 'shape', shapeType: 'rect', creationPreset: 'rect', x: 100, y: 100, width: ${imageOnA} ? 200 : 400, height: 200,
      fill: '#000000', stroke: '', strokeWidth: 0, cornerRadius: 0, objectGroupIds: ['g'], cropGroupId: 'g', transitions: { visibility: ${JSON.stringify(easing)} } };
    // The user's case: a rect crop (the whole image) on both keyframes, and on
    // the second an intersecting trapezoid (left half) appearing.
    const rectCrop = { ...base, id: 'r', type: 'shape', shapeType: 'rect', creationPreset: 'rect', x: 100, y: 100, width: 400, height: 200,
      fill: '#000000', stroke: '', strokeWidth: 0, cornerRadius: 0, objectGroupIds: ['g'], cropGroupId: 'g' };
    const trapezoid = { ...crop, width: 200, cropOp: 'intersect' };
    const slide = (id, els) => ({ id, elements: Object.fromEntries(els.map(e => [e.id, e])), elementOrder: els.map(e => e.id), background: { type: 'solid', color: '#ffffff' } });
    const { renderedElements } = composeSlideFrame({ slideA: ${intersect} ? slide('A', [image, rectCrop]) : slide('A', ${imageOnA} ? [{ ...image, objectGroupIds: [] }] : []),
      slideB: ${intersect} ? slide('B', [image, rectCrop, trapezoid]) : slide('B', [image, crop]), isForward: true, animProgress: ${t}, isAnimating: true });
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
  })()`);
  // Pixels from a screenshot of the mounted frame (green channel: 255 white, 0 red).
  // Entrances play in the transition's second half: t = 0.75 is halfway.
  const frameAt = async (easing, t = 0.75, imageOnA = false, imageEasing = 'const', intersect = false) => {
    await mount(easing, t, imageOnA, imageEasing, intersect);
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
  // Fades: with the image cutting in, the crop's own fade reveals it (half
  // way at t = 0.75 for linear, less for ease-in-out's slower start)…
  const fade = await frameAt('linear');
  assert(fade.centre > 100 && fade.centre < 160 && Math.abs(fade.centre - fade.corner) < 20, `linear fade: half revealed everywhere: ${JSON.stringify(fade)}`);
  const early = await frameAt('linear', 0.6), late = await frameAt('linear', 0.9);
  assert(early.centre > fade.centre + 30 && late.centre < fade.centre - 30, `the fade interpolates: ${early.centre} → ${fade.centre} → ${late.centre}`);
  // …fading together with its image, it fades once (half), not twice (a quarter).
  const both = await frameAt('linear', 0.75, false, 'linear');
  assert(both.centre > 100 && both.centre < 160, `crop and image fading together fade once: ${JSON.stringify(both)}`);
  const done = await frameAt('wipe', 1);
  assert(shown(done.left) && shown(done.right), 'at the end the whole crop shows');
  // (As in the editor: the crop group exists only on the later keyframe —
  // on the earlier one the image is not in it.)
  // Cropping an image already on screen: it shows whole until the crop's
  // effect starts, the outside fades as the crop comes in, and is gone at
  // the end — no jump at the midpoint.
  const start = await frameAt('linear', 0.5, true);
  assert(shown(start.left) && shown(start.right) && shown(start.corner), `whole at the start: ${JSON.stringify(start)}`);
  const half = await frameAt('linear', 0.75, true);
  assert(shown(half.left) && half.right > 60 && half.right < 200, `the outside (right half) half faded: ${JSON.stringify(half)}`);
  const end = await frameAt('linear', 1, true);
  assert(shown(end.left) && hidden(end.right), `cropped at the end — the outside gone: ${JSON.stringify(end)}`);
  // An intersecting crop shape appearing on an already-cropped image: what
  // it crops away (the right half) fades out linearly; the inside stays.
  const ix = t => frameAt('linear', t, false, 'const', true);
  const [i0, i1, i2] = [await ix(0.5), await ix(0.75), await ix(1)];
  assert(shown(i0.left) && shown(i0.right), `intersect, start: all shown: ${JSON.stringify(i0)}`);
  assert(shown(i1.left) && i1.right > 100 && i1.right < 160, `intersect, midway: the cut half faded: ${JSON.stringify(i1)}`);
  assert(shown(i2.left) && hidden(i2.right), `intersect, end: the cut half gone: ${JSON.stringify(i2)}`);

  // The easing picker's previews, through the real UI: a crop drawn on the
  // second keyframe (its image already on the first). Every preview must
  // move, and different easings must look different.
  await setup({ mode: 'production', creationProperties: true, secondSlide: true,
    subject: { type: 'image', x: 250, y: 150, width: 300, height: 200, resourceId: 'red' } });
  await evaluate(`canvasTest.store.getState().addResource(canvasTest.mediaResource({id:'red',name:'red',type:'image',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>'),originalWidth:300,originalHeight:200}))`);
  await evaluate(`(async()=>{const { createShapeElement } = await import('/src/utils/model/slideFactory.ts');
    canvasTest.editor.getState().setActiveSlide('other');
    canvasTest.store.getState().addCropShape('other','subject',createShapeElement('rect',{id:'crop',x:300,y:180,width:150,height:120,stroke:''}));
    canvasTest.editor.setState({activeObjectGroupId:canvasTest.store.getState().presentation.slides.other.elements.crop.cropGroupId});
    canvasTest.editor.getState().setSelectedElements(['crop']);})()`); await wait(300);
  const opened = await evaluate(`(()=>{const b=[...document.querySelectorAll('button[aria-label^="Incoming transition"]')][0];if(!b)return false;b.click();return true})()`);
  assert(opened, 'the crop shape has an incoming transition picker');
  await wait(300);
  const cards = () => evaluate(`Object.fromEntries([...document.querySelectorAll('[role=dialog][aria-label="Incoming transition"] [aria-label]')].map(o=>[o.getAttribute('aria-label'), o.querySelector('svg[data-preview-elements]')?.outerHTML ?? null]).filter(([k,v])=>v && k !== 'Incoming transition'))`);
  const first = await cards(); await wait(260); const second = await cards();
  const labels = Object.keys(first);
  assert(labels.length >= 3, `previews shown: ${labels}`);

  // Every easing but the cut ("Constant") moves between two moments.
  const moving = labels.filter(l => first[l] !== second[l]);
  const still = labels.filter(l => !moving.includes(l) && l !== 'Constant');
  assert(!still.length, `previews animate (still: ${still})`);
  // Entrances play in the transition's second half (before it every preview
  // rightly shows the whole image), so compare across a loop: every two
  // easings must differ at some moment.
  const norm = html => html.replace(/id="[^"]*"|url\(#[^)]*\)/g, '');
  const moments = [];
  for (let i = 0; i < 12; i++) { moments.push(await cards()); await wait(110); }
  const same = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    if (moments.every(m => norm(m[labels[i]]) === norm(m[labels[j]]))) same.push(`${labels[i]} = ${labels[j]}`);
  }
  assert(!same.length, `different easings preview differently (identical: ${same})`);
  // Each preview shows the crop with its image at some point of its loop (the
  // crop enters in the second half).
  const count = html => Number(/data-preview-elements="(\d+)"/.exec(html)[1]);
  for (const label of labels) assert(moments.some(m => count(m[label]) >= 2), `${label}: the preview shows the crop with its image`);
  console.log('PASS crop appear: wipe, grow, iris and fades shape the crop; one fade with its image; cropping an on-screen image eases in; the easing previews animate and differ');
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
