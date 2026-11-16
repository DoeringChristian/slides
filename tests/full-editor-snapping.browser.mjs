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

const vault="(await import('/src/store/vaultStore.ts')).useVaultStore";
const editor="(await import('/src/store/editorStore.ts')).useEditorStore";
async function until(expression) {for(let i=0;i<100;i++){try{if(await evaluate(expression))return;}catch{}await wait(100);}throw Error('Timed out: '+expression+' '+await evaluate(`(async()=>({location:sessionStorage.getItem('slides.editor-location.v1'),active:${vault}.getState().activeProjectId,slide:${editor}.getState().activeSlideId,error:${vault}.getState().error,body:document.body.innerText.slice(0,900)}))()`));}
try {
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate("localStorage.setItem('slides-storage-config',JSON.stringify({mode:'local'}))");
 await send('Page.navigate',{url:base});await until(`(async()=>!${vault}.getState().isLoading && !!document.querySelector('button'))()`);
 await evaluate(`(async()=>{const {createPresentation,createShapeElement}=await import('/src/utils/model/slideFactory.ts');const p=createPresentation();const s=p.slides[p.slideOrder[0]];s.elements={subject:{...createShapeElement('rect'),x:250,y:180,width:100,height:80,id:'subject'},target:{...createShapeElement('rect'),x:353,y:350,width:50,height:40,id:'target'}};s.elementOrder=['subject','target'];await ${vault}.getState().importProject(p);${editor}.getState().setZoom(1);${editor}.getState().setSelectedElements(['subject']);})()`);
 await wait(700);
 await drag(await screen(300,220),await screen(401,220));
 const x=await evaluate(`(async()=>{const p=(await import('/src/store/presentationStore.ts')).usePresentationStore.getState().presentation;return p.slides[p.slideOrder[0]].elements.subject.x})()`);
 assert.equal(x,353,'full editor object drag aligns to visible rectangle');
 console.log('PASS full editor alignment');
}finally{ws.close();}
