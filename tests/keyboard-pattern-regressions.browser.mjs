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
  for(const collab of [false,true]) {
    await setup({mode:'production',collab,subject:{shapeType:'path',points:[0,0,160,0],x:100,y:100,width:160,height:0,fill:'none'}});
    await evaluate(`canvasTest.editor.getState().setSelectedElements(['subject'])`);await wait(100);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...await screen(100,100)});await wait(100);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await wait(100);
    assert.equal(await evaluate('!!canvasTest.snapshot().slide.elements.subject?.visible'),false,'endpoint hover must not swallow hide');
    console.log('PASS endpoint Backspace collab='+collab);
    await setup({mode:'production',collab});
    const ids=await evaluate(`(()=>{const e=canvasTest.editor.getState(),s=canvasTest.store.getState();const a=e.activeSlideId;e.setClipboard([s.presentation.slides[a].elements.subject]);const b=s.duplicateSlide(a);e.setActiveSlide(b);return {a,b}})()`);await wait(100);
    await evaluate(`(()=>{const data=new DataTransfer();data.setData('text/plain','slides-internal-copy');window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);await wait(100);
    const counts=await evaluate(`(()=>{const p=canvasTest.store.getState().presentation;return [p.slides[${JSON.stringify(ids.a)}].elementOrder.length,p.slides[${JSON.stringify(ids.b)}].elementOrder.length]})()`);
    assert.deepEqual(counts,[1,2]);console.log('PASS paste after navigation collab='+collab);
    await evaluate(`(()=>{const data=new DataTransfer();data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'],'image.svg',{type:'image/svg+xml'}));window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));canvasTest.editor.getState().setActiveSlide(${JSON.stringify(ids.a)});})()`);await wait(400);
    assert.deepEqual(await evaluate(`(()=>{const p=canvasTest.store.getState().presentation;return [p.slides[${JSON.stringify(ids.a)}].elementOrder.length,p.slides[${JSON.stringify(ids.b)}].elementOrder.length,Object.keys(p.resources).length]})()`),[1,2,0]);
    console.log('PASS delayed image paste cancelled on navigation collab='+collab);
    await setup({mode:'production',collab,subject:{shapeType:'path',points:[0,0,80,40,160,0],x:100,y:100,width:160,height:40,fill:'none'}});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...await screen(180,140)});await wait(100);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await wait(100);
    assert.equal(await evaluate('canvasTest.snapshot().slide.elements.subject.points.length'),4);
    console.log('PASS removable vertex keeps Backspace ownership collab='+collab);

  }
  // A patterned shaft must retain its gaps throughout Create, including out frames.
  const paints=await evaluate(`(async()=>{
    const {createShapeElement}=await import('/src/utils/model/slideFactory.ts');
    const result=[];
    for(const strokeStyle of ['dashed','dotted']) for(const endHead of ['none','triangle']) {
      const el=createShapeElement('path',{x:30,y:100,width:300,height:0,points:[0,0,300,0],fill:'none',stroke:'#000000',strokeWidth:6,strokeStyle,endHead});
      const raster=async markup=>{const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);await img.decode();const c=document.createElement('canvas');c.width=c.height=400;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(0,100,400,1).data].filter((_,i)=>i%4===3)};
      const baseline=await raster(canvasTest.arrowMarkup(el));
      for(const t of [.1,.25,.6,.95]) {const pixels=await raster(canvasTest.arrowMarkup(el,'create',t));result.push({strokeStyle,endHead,t,leaks:pixels.slice(35,280).filter((a,i)=>a>100&&baseline[i+35]<10).length,ink:pixels.filter(a=>a>100).length});}
    }return result;
  })()`);
  for(const p of paints){assert.equal(p.leaks,0,JSON.stringify(p));assert(p.ink>0,JSON.stringify(p));}
  console.log('PASS patterned Create raster frames '+paints.length);
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
