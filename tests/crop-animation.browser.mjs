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
  await waitForCanvasFixture(evaluate);
  await evaluate(`(async()=>{
    const ReactModule=await import('/node_modules/.vite/deps/react.js'); const React=ReactModule.default??ReactModule;
    const Client=await import('/node_modules/.vite/deps/react-dom_client.js'); const {createRoot}=Client.default??Client;
    const {createImageElement}=await import('/src/utils/slideFactory.ts');
    const {interpolateElement}=await import('/src/utils/interpolation.ts');
    const {renderPresenterElement}=await import('/src/components/presenter/presenterUtils.tsx');
    const host=document.createElement('div');Object.assign(host.style,{position:'fixed',inset:'0',background:'white',zIndex:99999});document.body.append(host);
    const root=createRoot(host);
    const resource={id:'photo',type:'image',name:'photo',originalWidth:200,originalHeight:100,src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><path fill="red" d="M0 0H200V100H0Z"/></svg>')};
    const a=createImageElement('photo',200,100,{x:50,y:50,width:200,height:100});
    window.cropFrame=(t,zoom,eased,reverse=false,lift=false)=>{
      const b={...a,x:100,y:75,width:zoom?200:100,height:zoom?100:50,cropX:50,cropY:25,cropWidth:100,cropHeight:50,transitions:{crop:lift?(eased?'cropliftease':'croplift'):(eased?'cropfadeease':'cropfade'),position:'linear',size:'linear'}};
      if(lift){b.x=350;b.y=200;}
      const el=reverse?interpolateElement(b,a,1-t,false):interpolateElement(a,b,t);
      root.render(React.createElement('svg',{width:600,height:400},renderPresenterElement(el,{photo:resource})));
      const point=(u,v)=>[el.x+(u-el.cropX)*el.width/el.cropWidth,el.y+(v-el.cropY)*el.height/el.cropHeight];
      return {kept:point(75,50),outside:lift?[75,60]:point(25,50)};
    };
  })()`);
  for(const zoom of [false,true]) for(const eased of [false,true]) for(const reverse of [false,true]) for(const t of [0,.25,.5,1]) {
    const points=await evaluate(`cropFrame(${t},${zoom},${eased},${reverse})`);
    await wait(120);
    const png=(await send('Page.captureScreenshot',{format:'png'})).data;
    const pixels=await evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${png}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Object.fromEntries(Object.entries(${JSON.stringify(points)}).map(([key,[x,y]])=>[key,Array.from(ctx.getImageData(Math.round(x*devicePixelRatio),Math.round(y*devicePixelRatio),1,1).data)]));})()`);
    const progress=eased?(t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2):t;
    assert.deepEqual(pixels.kept,[255,0,0,255],JSON.stringify({zoom,eased,reverse,t,pixels}));
    assert(Math.abs(pixels.outside[1]-255*progress)<=2,JSON.stringify({zoom,eased,reverse,t,pixels}));
    assert.equal(pixels.outside[0],255);
    if(t===.5&&!reverse) await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/crop-${zoom?'zoom':'fixed'}-${eased?'ease':'linear'}.png`,Buffer.from(png,'base64'));
  }
  for(const eased of [false,true]) for(const reverse of [false,true]) for(const t of [0,.25,.5,1]) {
    const points=await evaluate(`cropFrame(${t},true,${eased},${reverse},true)`);
    await wait(120);
    const png=(await send('Page.captureScreenshot',{format:'png'})).data;
    const pixels=await evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${png}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Object.fromEntries(Object.entries(${JSON.stringify(points)}).map(([key,[x,y]])=>[key,Array.from(ctx.getImageData(Math.round(x*devicePixelRatio),Math.round(y*devicePixelRatio),1,1).data)]));})()`);
    const progress=eased?(t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2):t;
    assert.deepEqual(pixels.kept,[255,0,0,255],JSON.stringify({eased,reverse,t,pixels}));
    assert(Math.abs(pixels.outside[1]-255*progress)<=2,JSON.stringify({eased,reverse,t,pixels}));
    if(t===.5&&!reverse) await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/crop-lift-${eased?'ease':'linear'}.png`,Buffer.from(png,'base64'));
  }
  console.log('PASS crop fade pixels: retained area opaque, surroundings fade, zoom, ease and reverse');
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
