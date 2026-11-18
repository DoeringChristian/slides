import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Gradient fills and crop tints: the SVG renderer (editor, presenter, PNG)
// and the canvas exporter (PDF) paint the same gradient, and a tinting crop
// shape darkens the image only inside the crop.
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
const RED = `canvasTest.store.getState().addResource(canvasTest.mediaResource({id:'red',name:'red',type:'image',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>'),originalWidth:300,originalHeight:200}))`;
const sample = (points) => evaluate(`(async()=>{
  const s=canvasTest.snapshot().slide, res=canvasTest.store.getState().presentation.resources;
  const {renderSlideToSVG}=await import('/src/utils/io/svgRenderer.ts');
  const img=new Image();img.src='data:image/svg+xml,'+encodeURIComponent(renderSlideToSVG(s,res,await canvasTest.mediaSources()));await img.decode();
  const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,960,540);
  const {preloadResources,renderSlide}=await import('/src/utils/io/exportPdf.ts');
  const pdf=renderSlide(s,res,await preloadResources([s],res),1).getContext('2d');
  const at=(g,[x,y])=>Array.from(g.getImageData(x,y,1,1).data);
  return ${JSON.stringify(points)}.map(p=>({svg:at(ctx,p),pdf:at(pdf,p)}));
})()`);
const close = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const collab of [false, true]) {
    // A linear gradient (top → bottom, red → blue) and a radial one.
    await setup({ mode: 'production', collab, snap: true, subject: { x: 100, y: 100, width: 200, height: 200, fill: '#ff0000', fillStyle: 'linear', fillTo: '#0000ff', stroke: '', strokeWidth: 0 },
      targets: [{ id: 'radial', x: 400, y: 100, width: 200, height: 200, fill: '#ffffff', fillStyle: 'radial', fillTo: '#000000', stroke: '', strokeWidth: 0 }] });
    await wait(150);
    const [top, bottom, mid, centre, corner] = await sample([[200, 103], [200, 297], [200, 200], [500, 200], [403, 103]]);
    for (const [name, p] of Object.entries({ top, bottom, mid, centre, corner })) assert(close(p.svg, p.pdf), `${name}: SVG and PDF agree ${p.svg} vs ${p.pdf}`);
    assert(top.svg[0] > 230 && top.svg[2] < 30, `linear starts at fill: ${top.svg}`);
    assert(bottom.svg[2] > 230 && bottom.svg[0] < 30, `linear ends at fillTo: ${bottom.svg}`);
    assert(Math.abs(mid.svg[0] - mid.svg[2]) < 30, `halfway is a blend: ${mid.svg}`);
    assert(centre.svg[0] > 230 && corner.svg[0] < 40, `radial: fill at the centre, fillTo at the corners: ${centre.svg} ${corner.svg}`);

    // On-canvas gradient handles: select the shape, drag the end handle near
    // its box's bottom-right corner — it snaps there (standard point snap) —
    // and one undo restores the line.
    await evaluate(`canvasTest.editor.getState().setSelectedElements(['subject'])`); await wait(150);
    const handle = await evaluate(`(()=>{const h=document.querySelector('[data-gradient-handle="end"]');if(!h)return null;const b=h.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    assert(handle, 'a selected gradient shape shows gradient handles');
    const nearCorner = await screen(297, 298);
    await mouse('mousePressed', handle); await mouse('mouseMoved', { x: (handle.x + nearCorner.x) / 2, y: (handle.y + nearCorner.y) / 2 }); await mouse('mouseMoved', nearCorner); await mouse('mouseReleased', nearCorner); await wait(150);
    const dragged = await evaluate(`canvasTest.snapshot().slide.elements.subject.fillLine`);
    assert(dragged && Math.abs(dragged[2] - 1) < 1e-6 && Math.abs(dragged[3] - 1) < 1e-6, `end handle snapped to the box corner: ${JSON.stringify(dragged)}`);
    assert.deepEqual(dragged.slice(0, 2), [0.5, 0], 'the start stays');
    await evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()"); await wait(120);
    assert.equal(await evaluate(`canvasTest.snapshot().slide.elements.subject.fillLine ?? null`), null, 'one undo restores the default line');
    // Shift constrains to 45° rays from the other end.
    const h2 = await evaluate(`(()=>{const b=document.querySelector('[data-gradient-handle="end"]').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    const off = await screen(262, 255);
    await mouse('mousePressed', h2); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: off.x, y: off.y, button: 'left', buttons: 1, modifiers: 8 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: off.x, y: off.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 }); await wait(150);
    const ray = await evaluate(`canvasTest.snapshot().slide.elements.subject.fillLine`);
    const ang = Math.atan2((ray[3] - ray[1]) * 200, (ray[2] - ray[0]) * 200) * 180 / Math.PI;
    assert(Math.abs(Math.round(ang / 45) * 45 - ang) < 0.5, `Shift keeps a 45° ray: ${ang}°`);
    await evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()"); await wait(120);

    // Crop tint: a tinting crop shape darkens the image inside the crop only.
    await setup({ mode: 'production', collab, subject: { type: 'image', x: 250, y: 150, width: 300, height: 200, resourceId: 'red', objectGroupIds: ['g'] },
      targets: [{ id: 'crop', x: 300, y: 180, width: 200, height: 140, fill: 'rgba(0, 0, 0, 0.5)', stroke: '', strokeWidth: 0, objectGroupIds: ['g'], cropGroupId: 'g' }] });
    await evaluate(RED); await wait(200);
    let [inside, outside] = await sample([[400, 250], [270, 160]]);
    assert(close(inside.svg, [255, 0, 0, 255]) && close(inside.pdf, [255, 0, 0, 255]), `untinted crop shows the image as is: ${inside.svg} ${inside.pdf}`);
    assert(close(outside.svg, [255, 255, 255, 255]), 'outside the crop is cut');
    await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'crop',{cropTint:true})`); await wait(150);
    [inside, outside] = await sample([[400, 250], [270, 160]]);
    for (const p of [inside.svg, inside.pdf]) assert(close(p, [128, 0, 0, 255], 16), `tint darkens the image inside the crop: ${p}`);
    assert(close(outside.svg, [255, 255, 255, 255]), 'the tint stays inside the crop');
    // Image tint: part of the image — painted over it, clipped by its crop.
    await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'crop',{cropTint:false});canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',{tint:'rgba(0, 0, 0, 1)',tintStyle:'linear',tintTo:'rgba(0, 0, 0, 0)',tintLine:[0.5,0,0.5,1]})`); await wait(150);
    const [high, low, cut] = await sample([[400, 185], [400, 315], [270, 330]]);
    for (const p of [high.svg, high.pdf]) assert(p[0] < 90, `tint dark at the gradient's start (top): ${p}`);
    for (const p of [low.svg, low.pdf]) assert(p[0] > 180, `tint faint at its end (bottom): ${p}`);
    assert(close(cut.svg, [255, 255, 255, 255]) && close(cut.pdf, [255, 255, 255, 255]), `the crop clips the tint with the picture: ${cut.svg} ${cut.pdf}`);
    // Crop operations, in layer order: subtract cuts a hole out of the crop;
    // intersect keeps only the overlap. Same pixels in SVG and PDF.
    await evaluate(`(()=>{const st=canvasTest.store.getState(), sl=canvasTest.editor.getState().activeSlideId;
      st.updateElement(sl,'subject',{tint:'',tintStyle:'solid'});
      st.addElements(sl,[{...canvasTest.snapshot().slide.elements.crop,id:'hole',x:380,y:230,width:40,height:40,cropOp:'subtract'}]);})()`); await wait(200);
    let [rim, hole] = await sample([[310, 190], [400, 250]]);
    for (const p of [rim.svg, rim.pdf]) assert(close(p, [255, 0, 0, 255]), `crop still shows around the hole: ${p}`);
    for (const p of [hole.svg, hole.pdf]) assert(close(p, [255, 255, 255, 255]), `subtract cuts a hole: ${p}`);
    await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'hole',{cropOp:'intersect'})`); await wait(200);
    [rim, hole] = await sample([[310, 190], [400, 250]]);
    for (const p of [rim.svg, rim.pdf]) assert(close(p, [255, 255, 255, 255]), `intersect drops what lies outside it: ${p}`);
    for (const p of [hole.svg, hole.pdf]) assert(close(p, [255, 0, 0, 255]), `intersect keeps the overlap: ${p}`);
    console.log('PASS gradient fills, handles, crop tint, image tint, crop add/subtract/intersect — SVG = PDF collab=' + collab);
  }
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
