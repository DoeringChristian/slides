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
let pressed = false;
async function mouse(type, x, y, clickCount = 1, modifiers = 0) {
  if(type === 'mousePressed') pressed = true;
  if(type === 'mouseReleased') pressed = false;
  await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount, modifiers });
  await wait(30);
}
async function click(x, y, count = 1) { await mouse('mousePressed', x, y, count); await mouse('mouseReleased', x, y, count); }
async function drag(x, y, ex, ey) { await mouse('mousePressed', x, y); await mouse('mouseMoved', ex, ey); await mouse('mouseReleased', ex, ey); }
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
const near = (actual, expected, message = '') => assert(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);
async function screen(x,y) { return evaluate(`(() => { const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(); return [m.a*${x}+m.c*${y}+m.e,m.b*${x}+m.d*${y}+m.f]; })()`); }
async function world(id='subject') { return evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements[${JSON.stringify(id)}])`); }
async function select(ids) { await evaluate(`canvasTest.editor.getState().setSelectedElements(${JSON.stringify(ids)})`); await wait(60); }
async function modifier(type, keyName='Shift', modifiers=type==='keyDown'?8:0) {
  await send('Input.dispatchKeyEvent',{type,key:keyName,code:keyName==='Shift'?'ShiftLeft':'ControlLeft',windowsVirtualKeyCode:keyName==='Shift'?16:17,modifiers}); await wait(60);
}
async function guides() { return evaluate(`(() => { const g=document.querySelector('.alignment-guides'); return {hidden:g.getAttribute('visibility')==='hidden',markers:g.querySelectorAll('.snap-destination').length,html:g.outerHTML}; })()`); }
async function capture() { return evaluate(`Array.from(document.querySelectorAll('svg, svg *')).some(e=>e.hasPointerCapture?.(1))`); }
async function highlighted() { return evaluate(`!!document.querySelector('.ui-layer [stroke="#4285f4"][stroke-dasharray="6 3"]')`); }

const content = () => evaluate(`document.querySelector('.content-layer').innerHTML`);
const painted = id => `.content-layer [data-element-id="${id}"]`;
async function authoritative() { return evaluate(`(async()=>{const {yDocToJson}=await import('/src/collab/ySchema.ts');return JSON.stringify(canvasTest.doc?yDocToJson(canvasTest.doc):canvasTest.store.getState().presentation)})()`); }
async function active() {return evaluate(`!!document.querySelector('.content-layer[data-gesture-preview]')`);}
async function cancel() {await key('Escape');await mouse('mouseReleased',700,400);}
const evidence=`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-live-gesture`;
await mkdir(evidence, { recursive: true });
try {
  await send('Page.enable');await send('Runtime.discardConsoleEntries');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(1800);
  const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#ab2244',align:'left',verticalAlign:'top',lineHeight:1.2};
  for(const collab of [false,true]) {
    await check(`full scene body rendering alpha/z-order/dependents/no writes collab=${collab}`,async()=>{
      await setup({mode:'production',collab,subject:{x:400,y:250,width:180,height:100,fill:'#8844cc',fillStyle:'crosshatch',opacity:.37},targets:[
        {id:'arrow',shapeType:'path',x:580,y:300,width:200,height:50,points:[0,0,200,50],startBinding:{elementId:'subject',mode:'pinned',fixedPoint:[1,.5]},stroke:'#1259a0',strokeWidth:8,strokeStyle:'dotted',endHead:'diamond'},
        {id:'label',type:'text',text:'Label',containerId:'arrow',x:645,y:308,width:65,height:32,style},
        {id:'front',x:500,y:320,width:150,height:100,fill:'#dca700',opacity:.7}]});await wait(350);
      await evaluate(`canvasTest.getActiveUndoManager()?.clear();canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.store.temporal.getState().clear();window.previewTransactions=0;canvasTest.doc?.on('afterTransaction',()=>window.previewTransactions++);void 0`);
      const before=await snapshot(),raw=await authoritative(),idle=await content(),p=await screen(410,280);
      await evaluate(`window.liveNode=document.querySelector(${JSON.stringify(painted('subject'))});void 0`);
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+65,p[1]+35);
      assert(await active());assert.equal(await authoritative(),raw);assert.equal((await snapshot()).undo,before.undo);assert.equal(await evaluate(`window.previewTransactions`),0);
      assert(await evaluate(`window.liveNode===document.querySelector(${JSON.stringify(painted('subject'))})`));
      assert.deepEqual(await evaluate(`Array.from(document.querySelector('.content-layer').children).map(n=>n.dataset.elementId)`),['subject','arrow','label','front']);
      assert.equal(await evaluate(`document.querySelectorAll('[data-element-id="subject"]').length`),1);
      assert.equal(await evaluate(`+document.querySelector('${painted('subject')} rect').getAttribute('opacity')`),.37);
      const live=await content();assert.notEqual(live,idle);
      assert.notEqual(await evaluate(`document.querySelector('${painted('arrow')}').innerHTML`), '');
      await writeFile(`${evidence}/live-body-${collab}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      await mouse('mouseReleased',p[0]+65,p[1]+35);await wait(150);assert.equal(await content(),live,'last projected full scene equals committed scene including masks');
      assert.equal((await snapshot()).undo,before.undo+1);await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
    });
    await check(`styled rotated bezier endpoint/tangent/midpoint and radius collab=${collab}`,async()=>{
      for(const kind of ['endpoint','tangent','midpoint','radius']) {
        await setup({mode:'production',collab,subject:kind==='radius'?{x:400,y:250,width:200,height:130,rotation:25,fill:'#e23956',fillStyle:'crosshatch',strokeWidth:8}:{shapeType:'path',x:400,y:250,width:200,height:100,rotation:25,points:[0,0,200,100],curve:'bezier',tangents:[-30,-20,30,20,-30,-20,30,20],fill:'#dfa032',fillStyle:'hachure',stroke:'#6e219b',strokeStyle:'dotted',strokeWidth:9,startHead:'circle-outline',endHead:'diamond'},targets:kind==='radius'?[]:[{id:'path-label',type:'text',containerId:'subject',text:'Path label',x:455,y:285,width:85,height:30,style}]});
        await wait(200);
        // Initial async label fitting is fixture setup, not this gesture's history.
        await evaluate(`canvasTest.getActiveUndoManager()?.clear();canvasTest.getActiveUndoManager()?.stopCapturing();canvasTest.store.temporal.getState().clear()`);
        const undoBefore=(await snapshot()).undo;
        const raw=await authoritative();let p;
        if(kind==='radius') p=await center('.corner-radius-handle circle');
        else if(kind==='midpoint') p=await center('.path-handles > g:nth-of-type(1) circle:last-child');
        else {p=await center('.path-handles g[clip-path] circle:last-child').catch(()=>center('.path-handles > g:nth-of-type(2) circle:last-child'));}
        if(kind==='tangent') {await mouse('mouseMoved',...p);await wait(80);p=await center('.tangent-handles g:last-child circle:last-child');}
        await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+45,p[1]+30,1,kind==='endpoint'?14:0);await wait(80);
        assert(await active(),kind);assert.equal(await authoritative(),raw);assert.equal((await snapshot()).undo,undoBefore);
        const live=await content();await writeFile(`${evidence}/live-${kind}-${collab}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await mouse('mouseReleased',p[0]+45,p[1]+30,1,kind==='endpoint'?14:0);assert.equal(await content(),live,kind+' preview=commit');assert.equal((await snapshot()).undo,undoBefore+1);
      }
    });
    await check(`body/path/radius context invalidation and late release collab=${collab}`,async()=>{
      for(const kind of ['body','path','radius']) for(const change of ['Escape','pointercancel','slide-return','selection-return','remote','delete']) {
        await setup({mode:'production',collab,secondSlide:true,subject:{x:400,y:250,width:200,height:100,fill:'#8899aa',...(kind==='path'?{shapeType:'path',points:[0,0,200,100],endHead:'triangle'}:{})}});
        const p=kind==='body'?await screen(430,290):kind==='radius'?await center('.corner-radius-handle circle'):await center('.path-handles > g:nth-of-type(2) circle:last-child');
        await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+40,p[1]+20);assert(await active(),kind+'/'+change);
        if(change==='Escape') await key('Escape');
        else if(change==='pointercancel') await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))`);
        else if(change==='slide-return') await evaluate(`(()=>{const e=canvasTest.editor.getState(),id=e.activeSlideId;e.setActiveSlide('other');e.setActiveSlide(id)})()`);
        else if(change==='selection-return') await evaluate(`(()=>{const e=canvasTest.editor.getState();e.setSelectedElements([]);e.setSelectedElements(['subject'])})()`);
        else if(change==='remote') await evaluate(`(async()=>{const id=canvasTest.editor.getState().activeSlideId;if(canvasTest.doc){const {getYElement}=await import('/src/collab/ySchema.ts');canvasTest.doc.transact(()=>getYElement(canvasTest.doc,id,'subject').set('x',430),'remote')}else canvasTest.store.getState().updateElement(id,'subject',{x:430})})()`);
        else await evaluate(`canvasTest.store.getState().deleteElements(canvasTest.editor.getState().activeSlideId,['subject'])`);
        await wait(60);assert(!await active(),kind+'/'+change);const after=await authoritative();await mouse('mouseReleased',p[0]+40,p[1]+20);assert.equal(await authoritative(),after,'late release inert');
        if(!['remote','delete'].includes(change))assert.equal((await snapshot()).undo,0);
      }
    });
  }
  await check('cropped image, text, vector and video retain real content and DOM instance during body move',async()=>{
    for(const kind of ['image','video','text','vector']) {
      const subject={x:400,y:250,width:200,height:130,opacity:.43};
      if(kind==='text')Object.assign(subject,{type:'text',text:'Live text\nsecond line',style});
      else if(kind==='vector')Object.assign(subject,{shapeType:'vector',fill:'#37a679',fillStyle:'crosshatch',geometry:{kind:'vector',version:1,contours:[{id:'a',start:[0,0],segments:[{kind:'line',to:[1,0]},{kind:'line',to:[1,1]},{kind:'line',to:[0,1]}],closed:true}],fills:[{contourIds:['a'],rule:'nonzero'}],strokes:['a']}});
      else Object.assign(subject,{type:'image',resourceId:'media',cropX:10,cropY:10,cropWidth:80,cropHeight:80});
      await setup({mode:'production',subject});
      if(['image','video'].includes(kind))await evaluate(`canvasTest.store.getState().addResource({id:'media',name:'media',type:${JSON.stringify(kind)},src:${JSON.stringify(kind==='image'?'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="130"><rect width="200" height="130" fill="%23b739ce"/></svg>':'data:video/mp4;base64,')},originalWidth:200,originalHeight:130})`);
      await wait(300);const raw=await authoritative(),p=await screen(435,285);
      await evaluate(`window.mediaNode=document.querySelector('${painted('subject')} ${kind==='video'?'video':kind==='image'?'img':kind==='text'?'path':'path'}');void 0`);
      assert(await evaluate('!!window.mediaNode'),kind+' actual content');
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+65,p[1]+30);assert(await active(),kind);assert.equal(await authoritative(),raw);
      assert(await evaluate(`window.mediaNode.isConnected && window.mediaNode===document.querySelector('${painted('subject')} ${kind==='video'?'video':kind==='image'?'img':'path'}')`),kind+' stable instance');
      const live=await content();await writeFile(`${evidence}/live-${kind}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));await mouse('mouseReleased',p[0]+65,p[1]+30);assert.equal(await content(),live);
    }
  });
  assert.deepEqual(runtimeErrors,[]);console.log('ALL LIVE GESTURE BROWSER CHECKS PASSED');
} finally {ws.close();}
