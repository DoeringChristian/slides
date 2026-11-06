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
try {
  for (const kind of ['image']) {
    for (const crop of [{x:50,y:0,width:100,height:100}, {x:0,y:25,width:200,height:50}]) {
      await setup({mode:'production',subject:{type:'image',resourceId:'crop-media',x:200,y:150,width:crop.width,height:crop.height,cropX:crop.x,cropY:crop.y,cropWidth:crop.width,cropHeight:crop.height}});
      await evaluate(`canvasTest.store.getState().addResource({id:'crop-media',name:'crop-media',type:${JSON.stringify(kind)},src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>',originalWidth:200,originalHeight:100})`);
      await wait(100);
      const actual=await evaluate(`(()=>{const media=document.querySelector('.content-layer ${kind==='image'?'img':'video'}'); const s=getComputedStyle(media); return {width:parseFloat(s.width),height:parseFloat(s.height),left:parseFloat(s.left),top:parseFloat(s.top),overflow:getComputedStyle(media.parentElement).overflow};})()`);
      assert.deepEqual(actual,{width:200,height:100,left:-crop.x || 0,top:-crop.y || 0,overflow:'hidden'});
      console.log('PASS '+kind+' '+(crop.x?'horizontal':'vertical')+' crop preserves full media dimensions');
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  for (const collab of [false,true]) for (const anchor of ['bottom-right','middle-right','bottom-center']) for (const modifiers of [0,8]) {
    await setup({mode:'production',collab,subject:{type:'image',x:200,y:150,width:200,height:100,cropX:0,cropY:0,cropWidth:200,cropHeight:100}});
    const point=await evaluate(`(()=>{const r=(document.querySelector('[data-resize-handle="${anchor}"] [data-resize-visual]')??document.querySelector('[data-resize-handle="${anchor}"]')).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1,modifiers});
    const end={x:point.x+50,y:point.y+40};
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1,modifiers});await wait(40);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',buttons:0,clickCount:1,modifiers});await wait(80);
    const e=await evaluate('canvasTest.snapshot().slide.elements.subject');
    if (!modifiers) assert(Math.abs(e.width/e.height-2)<.001,'media aspect ratio preserved');
    else assert(Math.abs(e.width/e.height-2)>.01,'Shift allows stretching');
    assert.equal(e.cropWidth,200);assert.equal(e.cropHeight,100);
  }
  console.log('PASS media resize defaults and Shift override, corner/side handles, JSON/Yjs');
  for (const fontSize of [24,120]) {
    const result=await evaluate(`(async()=>{
      const {layoutUserText,measureUserText}=await import('/src/utils/userTextSizing.ts');
      const {createTextElement}=await import('/src/utils/slideFactory.ts');
      const e=createTextElement({text:'$x^2$',textSizing:'auto-content'});e.style.fontSize=${fontSize};
      const d=await layoutUserText(e),size=await measureUserText(e);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');document.body.append(svg);
      const g=document.createElementNS(svg.namespaceURI,'g');svg.append(g);
      for(const p of d.paths){const n=document.createElementNS(svg.namespaceURI,'path');n.setAttribute('d',p.d);n.setAttribute('transform',p.transform);g.append(n);}
      const ink=g.getBBox();const gap=size.height-ink.y-ink.height;svg.remove();return {gap,height:size.height,docHeight:d.height};
    })()`);
    assert.equal(result.height,result.docHeight);
    assert(result.gap>=0 && result.gap<fontSize*.2,JSON.stringify(result));
  }
  console.log('PASS large math text bounds follow rendered paths without extra descender strut');
  assert.deepEqual(runtimeErrors,[]);
} finally { ws.close(); }
