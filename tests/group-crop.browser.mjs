import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas-modifiers.browser.mjs
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
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(const collab of [false,true]){
    await setup({mode:'production',collab,creationProperties:true,objectList:true,subject:{type:'image',x:250,y:150,width:300,height:200,resourceId:'red'},targets:[{id:'boundary',shapeType:'ellipse',x:300,y:180,width:150,height:120,stroke:'#000000',strokeWidth:4,fill:'#00ff00'}]});
    await evaluate(`canvasTest.store.getState().addResource({id:'red',name:'red',type:'image',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>'),originalWidth:300,originalHeight:200});canvasTest.editor.getState().setSelectedElements(['subject','boundary']);canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);
    await wait(150);await button('Crop to shapes');await evaluate('canvasTest.editor.getState().exitCropMode()');await wait(80);
    let state=await evaluate('canvasTest.snapshot().slide');const group=state.elements.boundary.cropGroupId;
    assert(group);assert.deepEqual(state.elements.subject.objectGroupIds,[group]);
    assert.equal(await evaluate("document.querySelectorAll('.content-layer [data-group-crop]').length"),1);
    assert.equal(await evaluate("document.querySelectorAll('[data-selection-action-bar]').length"),1);
    assert.equal(state.elements.boundary.fill,'#00ff00','original fill retained');
    await send('Page.captureScreenshot').then(p=>writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/crop-${collab?'yjs':'json'}.png`,Buffer.from(p.data,'base64')));
    assert.equal(await evaluate("document.querySelector('.content-layer [data-element-id=boundary] ellipse').getAttribute('fill')"),'none');
    // Group moves both, using the production pointer pipeline.
    await drag(await screen(375,230),await screen(405,250));
    const moved=await evaluate('canvasTest.snapshot().slide');
    assert.equal(moved.elements.subject.x-state.elements.subject.x,30);
    assert.equal(moved.elements.boundary.x-state.elements.boundary.x,30);
    // Double-click enters the ordinary group; moving media leaves boundary put.
    await click(await screen(405,250),2);await wait(100);
    assert.equal(await evaluate('canvasTest.editor.getState().activeObjectGroupId'),group);
    await drag(await screen(290,200),await screen(310,210));
    const edited=await evaluate('canvasTest.snapshot().slide');
    assert.equal(edited.elements.boundary.x,moved.elements.boundary.x);
    assert.equal(edited.elements.subject.x,moved.elements.subject.x+20);
    // Outside crop mode a click inside the crop reaches the picture; moving
    // the crop itself is done in crop mode.
    await evaluate("canvasTest.editor.getState().enterCropMode('subject')");await wait(100);
    await drag(await screen(405,250),await screen(420,260));
    await evaluate("canvasTest.editor.getState().exitCropMode()");await wait(100);
    const boundaryMoved=await evaluate('canvasTest.snapshot().slide');
    assert.equal(boundaryMoved.elements.subject.x,edited.elements.subject.x);
    assert.equal(boundaryMoved.elements.boundary.x,edited.elements.boundary.x+15);
    // The string export must clip pixels too, not just emit a clip attribute.
    const pixels=await evaluate(`(async()=>{const {renderSlideToSVG}=await import('/src/utils/io/svgRenderer.ts');const s=canvasTest.snapshot().slide;const svg=renderSlideToSVG(s,canvasTest.store.getState().presentation.resources);const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();const c=document.createElement('canvas');c.width=1920;c.height=1080;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const e=s.elements.boundary;return {inside:Array.from(ctx.getImageData(e.x+e.width/2,e.y+e.height/2,1,1).data),outside:Array.from(ctx.getImageData(e.x-10,e.y+e.height/2,1,1).data)}})()`);
    assert.deepEqual(pixels.inside,[255,0,0,255]);assert.deepEqual(pixels.outside,[255,255,255,255]);
    await evaluate("canvasTest.editor.getState().clearSelection();canvasTest.editor.getState().setSelectedElements(['subject'])");await wait(80);
    await button('Remove crop');
    state=await evaluate('canvasTest.snapshot().slide');assert.equal(state.elements.boundary.cropGroupId,null);assert.deepEqual(state.elements.subject.objectGroupIds,[group]);
    assert.equal(await evaluate("document.querySelectorAll('.content-layer [data-group-crop]').length"),0);
    await evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()");await wait(100);
    assert.equal((await evaluate('canvasTest.snapshot().slide')).elements.boundary.cropGroupId,group);
    console.log('PASS crop group UI, shared bounds, double-click editing, independent movement, export pixels, remove/undo collab='+collab);
  }
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
