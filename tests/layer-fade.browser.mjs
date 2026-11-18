import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Objects fading together fade as one layer: pixels of real frames.
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
try {
  await send('Runtime.enable');
  await waitForCanvasFixture(evaluate);
  // Stacking c (red, bottom), b (green, stays), a (blue, top, covers b and c).
  // Slide 2 keeps only b. Sample the frame at t = 0.25 (the exit half way).
  const result = await evaluate(`(async()=>{
    const {createPresentation,createSlide,createShapeElement}=await import('/src/utils/model/slideFactory.ts');
    const {renderSlideSvg}=await import('/src/agent/renderSlide.ts');
    const {composeSlideFrame,FrameElements,renderPresenterElement}=await import('/src/components/presenter/presenterUtils.tsx');
    const {default:React}=await import('/node_modules/.vite/deps/react.js');
    const srv=await import('/node_modules/.vite/deps/react-dom_server.js');const renderToStaticMarkup=srv.renderToStaticMarkup??srv.default.renderToStaticMarkup;
    const r=(id,x,w,fill)=>createShapeElement('rect',{id,x,y:100,width:w,height:200,fill,stroke:'',strokeWidth:0,cornerRadius:0});
    const c=r('c',0,200,'#ff0000'),b=r('b',100,200,'#00ff00'),a=r('a',50,300,'#0000ff');
    const s1=createSlide({elements:{c,b,a},elementOrder:['c','b','a']});
    const s2=createSlide({elements:{b},elementOrder:['b']});
    const p={...createPresentation(),slides:{[s1.id]:s1,[s2.id]:s2},slideOrder:[s1.id,s2.id]};
    async function pixels(svg){const img=new Image();img.src=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));await img.decode();
      const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1920,1080);ctx.drawImage(img,0,0);
      const at=x=>[...ctx.getImageData(x,200,1,1).data].slice(0,3);return {aOverC:at(75),aOverB:at(250),cAlone:at(25),aAlone:at(325)};}
    const agent=await pixels(await renderSlideSvg(p,s2.id,{t:0.25}));
    // The presenter's React path: the same frame through FrameElements.
    const frame=composeSlideFrame({slideA:s1,slideB:s2,isForward:true,animProgress:0.25,isAnimating:true});
    const body=renderToStaticMarkup(React.createElement(FrameElements,{elements:frame.renderedElements,resources:{},background:frame.bgColor}));
    const presenter=await pixels('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="'+frame.bgColor+'"/>'+body+'</svg>');
    const old=await pixels('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#ffffff"/>'+renderToStaticMarkup(React.createElement(React.Fragment,null,frame.renderedElements.map(el=>renderPresenterElement(el,{}))))+'</svg>');
    return {agent,presenter,old,layers:(body.match(/data-layer-fade="(\\d+)"/)||[])[1]};
  })()`);
  console.log('PIXELS', JSON.stringify(result));
  const near = (p, q, tol = 3) => p.every((v, i) => Math.abs(v - q[i]) <= tol);
  for (const path of ['agent', 'presenter']) {
    const px = result[path];
    assert.ok(near(px.aOverC, [128, 128, 255]), `${path}: a fades over c to the background, never revealing c ${JSON.stringify(px.aOverC)}`);
    assert.ok(near(px.aOverB, [0, 128, 128]), `${path}: a fades into b, which stays ${JSON.stringify(px.aOverB)}`);
    assert.ok(near(px.cAlone, [255, 128, 128]), `${path}: c alone fades normally ${JSON.stringify(px.cAlone)}`);
    assert.ok(near(px.aAlone, [128, 128, 255]), `${path}: a alone fades normally ${JSON.stringify(px.aAlone)}`);
  }
  assert.equal(result.layers, '2', 'one layer of two members');
  // The old per-object fade showed c through a (red under half-transparent blue).
  assert.ok(result.old.aOverC[0] > result.old.aOverC[1] + 40, `the per-object fade revealed c ${JSON.stringify(result.old.aOverC)}`);
  assert.deepEqual(runtimeErrors, [], 'no runtime errors');
  console.log('PASS objects fading together fade as one layer: a fades into b, never into c (agent render and presenter path)');
} finally { ws.close(); }
