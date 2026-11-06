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
  for(const collab of [false,true]) for(const text of ['First line\nSecond line','A long sentence that wraps over several lines in this narrow text box','$x_i^2 + y$']) {
    await setup({mode:'production',collab,snap:true,subject:{type:'text',x:120,y:400,width:180,text:'Next line'},targets:[{id:'target',type:'text',x:100,y:120,width:180,text}]});
    const metrics=await evaluate(`(async()=>{
      const {layoutUserText}=await import('/src/utils/userTextSizing.ts');
      const {textFlowSnapBounds}=await import('/src/utils/textFlowSnap.ts');
      const s=canvasTest.snapshot().slide;await Promise.all([layoutUserText(s.elements.subject),layoutUserText(s.elements.target)]);
      return {a:textFlowSnapBounds(s.elements.target),b:textFlowSnapBounds(s.elements.subject)};
    })()`);await wait(150);
    const state=await evaluate('canvasTest.snapshot().slide');const moving=state.elements.subject;
    const targetY=metrics.a.y+metrics.a.textFlow.bottom-metrics.b.textFlow.top;
    await evaluate('canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()');
    await drag(await screen(moving.x+15,moving.y+12),await screen(moving.x+15,targetY+14));
    const result=await evaluate('canvasTest.snapshot().slide.elements.subject');
    assert(Math.abs(result.y-targetY)<.01,'native text-flow snap '+JSON.stringify({targetY,result}));
    await evaluate('if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()');await wait(100);
    assert(Math.abs((await evaluate('canvasTest.snapshot().slide.elements.subject.y'))-moving.y)<.01);
    console.log('PASS text flow snap and undo collab='+collab+' text='+text);
  }
  // Extra box height and vertical alignment must not become extra line spacing.
  const layout=await evaluate(`(async()=>{
    const {createTextElement}=await import('/src/utils/slideFactory.ts');const {layoutUserText}=await import('/src/utils/userTextSizing.ts');const {textFlowSnapBounds}=await import('/src/utils/textFlowSnap.ts');
    const a=createTextElement({text:'Hello',height:200});const doc=await layoutUserText(a);const flow=textFlowSnapBounds(a);
    return {flow,docHeight:doc.height,rotated:textFlowSnapBounds({...a,rotation:30}),bound:textFlowSnapBounds({...a,containerId:'shape'})};
  })()`);
  assert.equal(layout.flow.textFlow.bottom-layout.flow.textFlow.top,layout.docHeight);
  assert(layout.flow.textFlow.bottom<200);assert(!layout.rotated.textFlow);assert(!layout.bound.textFlow);
  assert.deepEqual(runtimeErrors,[]);
} finally {ws.close();}
