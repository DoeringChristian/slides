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
  // Exercise the actual text renderer: its pen must not grow with font size.
  for (const text of ['Large text', '$x_i^2 + y$']) for (const fontSize of [24,80,160]) {
    await evaluate(`(async()=>{
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {renderPresenterElement}=await import('/src/components/presenter/presenterUtils.tsx');
      const {createTextElement}=await import('/src/utils/model/slideFactory.ts');
      window.__penRoot?.unmount();document.getElementById('pen-probe')?.remove();
      const host=document.createElement('div');host.id='pen-probe';document.body.append(host);window.__penRoot=createRoot(host);
      const e=createTextElement({text:${JSON.stringify(text)},x:0,y:0,width:600,height:350});e.style.fontSize=${fontSize};
      __penRoot.render(React.createElement('svg',{width:600,height:400,viewBox:'0 0 600 400'},renderPresenterElement({...e,_writeFx:{mode:'write',t:.3}},{})));
    })()`);
    let widths=[];
    for(let i=0;i<80&&!widths.length;i++){
      await wait(50);
      widths=await evaluate(`Array.from(document.querySelectorAll('#pen-probe path[stroke-width]')).filter(p=>p.getAttribute('stroke')!=='none'&&+p.getAttribute('stroke-width')>0).map(p=>{const m=p.getCTM();return +p.getAttribute('stroke-width')*Math.sqrt(Math.abs(m.a*m.d-m.b*m.c));})`);
    }
    assert(widths.length>0,'rendered tracing strokes');
    assert(widths.every(w=>Math.abs(w-1.2)<.001),'constant text pen '+JSON.stringify({text,fontSize,widths}));
    console.log('PASS actual text writing pen remains 1.2 units fontSize='+fontSize+' text='+text);
  }
  await evaluate(`__penRoot.unmount();document.getElementById('pen-probe').remove()`);
  for(const mobile of [false,true]) for(const dpr of [1,3]) {
    await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1200,height:900,deviceScaleFactor:dpr,mobile});
    const results=await evaluate(`(async()=>{
      const {layoutUserText}=await import('/src/utils/text/userTextSizing.ts');
      const {createTextElement}=await import('/src/utils/model/slideFactory.ts');
      const element=createTextElement({text:'$x_i^2 + y$',textSizing:'auto-content'});element.style.fontSize=160;
      const doc=await layoutUserText(element);
      const raster=async(svg,width)=>{const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();const c=document.createElement('canvas');c.width=width;c.height=width*2/3;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;let alpha=0;for(let i=3;i<data.length;i+=4)alpha+=data[i]/255;return alpha;};
      const measures=[];
      for(const t of [.15,.3,1]){
        const full=await raster(canvasTest.writePathsMarkup(doc.paths,8,t,600),600);
        const small=await raster(canvasTest.writePathsMarkup(doc.paths,8,t,150),150);
        measures.push({t,ratio:small*16/full});
      }
      return {measures,paths:doc.paths.map(p=>({strokeScale:p.strokeScale,nonScalingStroke:p.nonScalingStroke,transform:p.transform}))};
    })()`);
    assert(results.paths.length>3,'actual MathJax glyphs including scripts');
    assert(results.paths.every(p=>!p.nonScalingStroke),'math traces scale with the slide viewport');
    for(const m of results.measures)assert(Math.abs(m.ratio-1)<.2,'large math stroke scales with viewport: '+JSON.stringify(m));
    console.log('PASS large MathJax write raster scales at reveal/fill/end mobile='+mobile+' DPR='+dpr);
  }
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
