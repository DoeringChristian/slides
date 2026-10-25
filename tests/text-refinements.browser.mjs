import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/text-finish-race.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
const runtimeErrors = [];
const pausedRequests = new Set();
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Fetch.requestPaused') pausedRequests.add(msg.params.requestId);
  if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text=msg.params.args.map(arg=>arg.value??arg.description??'').join(' ');
    if (/order of Hooks|Rendered (more|fewer) hooks|getSnapshot/.test(text)) runtimeErrors.push(text);
  }
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(msg.error) : resolve(msg.result); }
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
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, a: 65, End: 35 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, commands: modifiers === 4 && key === 'a' ? ['selectAll'] : modifiers === 4 && key === 'End' ? ['moveToEndOfDocument'] : undefined, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
async function check(name, run) { await run(); console.log(`PASS ${name}`); }


const evidence = process.env.TEXT_REFINEMENTS_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-refinements/native`;
const style = { fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'right',verticalAlign:'bottom',lineHeight:1.2 };
async function center(selector) { return evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('missing '+${JSON.stringify(selector)});const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); }
async function capture(name) { const png=await send('Page.captureScreenshot');await writeFile(`${evidence}/${name}.png`,Buffer.from(png.data,'base64'));await writeFile(`${evidence}/${name}.json`,JSON.stringify(await snapshot(),null,2)); }
async function until(fn) { for(let i=0;i<80;i++){if(await fn())return;await wait(50);}throw Error('timed out'); }
function anchor(e) {const r=e.rotation*Math.PI/180,x=({left:-.5,center:0,right:.5}[e.style.align])*e.width,y=({top:-.5,middle:0,bottom:.5}[e.style.verticalAlign])*e.height;return [e.x+e.width/2+x*Math.cos(r)-y*Math.sin(r),e.y+e.height/2+x*Math.sin(r)+y*Math.cos(r)];}
async function reset(config) { await setup(config);await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('[data-element-id="subject"]').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x+r.width/2-b.x-b.width/2;p.scrollTop+=r.y+r.height/2-b.y-b.height/2;})()`);await wait(80); }
try {
 await mkdir(evidence,{recursive:true});await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(1000);
 const metrics=await evaluate(`(async()=>{const {loadFont}=await import('/src/utils/glyphPaths.ts');const {layoutSvgText,textRowMetrics}=await import('/src/utils/textLayout.ts');const result=[];for(const weight of ['normal','bold'])for(const italic of ['normal','italic']){const f=await loadFont(weight,italic),size=24,row=textRowMetrics(size,1.2),a=f.ascender*size/f.unitsPerEm,d=f.descender*size/f.unitsPerEm;const doc=await layoutSvgText('Agyp',${JSON.stringify(style)},500);const boxes=Array.from('Agyp',c=>f.charToGlyph(c).getPath(0,row.baseline,size).getBoundingBox());const ink={y1:Math.min(...boxes.map(b=>b.y1)),y2:Math.max(...boxes.map(b=>b.y2))};result.push({weight,italic,unitsPerEm:f.unitsPerEm,ascender:f.ascender,descender:f.descender,row,logicalHeight:doc.height,currentInk:ink,metricBaseline:(row.advance+a+d)/2,inkCenter:(ink.y1+ink.y2)/2,logicalCenter:row.advance/2});}return result})()`);
 await writeFile(`${evidence}/inter-baseline-before.json`,JSON.stringify(metrics,null,2));
 for(const collab of [false,true])for(const textSizing of [undefined,'user-width'])for(const editing of [false,true])for(const rotation of [0,35]){
  const text='authored newline\nvery long natural text that should unwrap';
  await reset({mode:'production',collab,zoom:1,subject:{type:'text',text,textSizing,width:180,height:120,x:400,y:300,rotation,style}});
  if(editing){await click(...await center('[data-element-id="subject"] > g:last-child rect'),2);await until(()=>evaluate(`!!document.querySelector('[contenteditable]') && document.activeElement?.isContentEditable`));await key('a','KeyA',4);await send('Input.insertText',{text:'fresh dirty draft\nwith explicit\n\nnewlines and longer text'});await wait(150);assert.equal((await snapshot()).slide.elements.subject.text,text);assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"],button[title="Hide from slide (Del)"]').length`),0);}
  const before=await snapshot(),old=before.slide.elements.subject,expectedText=editing?'fresh dirty draft\nwith explicit\n\nnewlines and longer text':text;
  const geometry=await evaluate(`(()=>{const g=document.querySelector('[data-text-auto-fit]'),r=g.querySelector('rect'),l=g.querySelector('line');return {width:+r.getAttribute('width'),height:+r.getAttribute('height'),length:+l.getAttribute('y2')-+l.getAttribute('y1'),stroke:+l.getAttribute('stroke-width'),alpha:+l.getAttribute('opacity')}})()`);
  assert.deepEqual(geometry,{width:10,height:18,length:16,stroke:1.5,alpha:.5});
  if(collab&&editing&&rotation===35)await capture('editing-dirty-before');
  await click(...await center('[data-text-auto-fit] rect'));await until(async()=> (await snapshot()).slide.elements.subject.textSizing==='auto-content');
  const after=await snapshot(),el=after.slide.elements.subject;
  assert.equal(el.text,expectedText);assert.deepEqual(el.style,old.style);assert.equal(el.rotation,rotation);assert.equal(after.undo,before.undo+1);assert.equal(after.editor.editing,null);
  const a=anchor(old),b=anchor(el);a.forEach((v,i)=>assert(Math.abs(v-b[i])<.001,`anchor ${a} ${b}`));
  assert.equal(await evaluate(`document.querySelectorAll('[data-text-auto-fit]').length`),0);
  if(collab&&editing&&rotation===35)await capture('editing-dirty-after');
  await evaluate(`canvasTest.getActiveUndoManager()?.undo() ?? canvasTest.store.temporal.getState().undo()`);await wait(60);assert.deepEqual((await snapshot()).slide.elements.subject,old);
  console.log(`PASS bar ${collab?'Yjs':'JSON'} ${textSizing??'user-width'} ${editing?'dirty-edit':'selected'} rotation=${rotation}`);
 }
 await reset({mode:'production',subject:{type:'text',text:'active',textSizing:'user-width',width:220,height:70,style},targets:[{id:'unrelated',x:450,y:450,width:100,height:100}]});
 await click(...await center('[data-element-id="subject"] > g:last-child rect'),2);await until(()=>evaluate(`!!document.querySelector('[contenteditable]') && document.activeElement?.isContentEditable`));await wait(100);
 await evaluate(`canvasTest.editor.getState().setSelectedElements(['subject','unrelated'])`);await wait(80);
 assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"],button[title="Hide from slide (Del)"]').length`),0,'no general actions for ANY active-edit multi-selection');
 assert.equal(await evaluate(`document.querySelectorAll('[data-text-auto-fit]').length`),1,'dedicated edit auto-fit remains');
 await click(...await center('[data-text-auto-fit] rect'));await until(async()=> (await snapshot()).slide.elements.subject.textSizing==='auto-content');
 await until(()=>evaluate(`document.querySelectorAll('button[title="Lock"]').length===1`));
 console.log('PASS active multi-selection hides every general bar and restores actions after auto-fit finish');
 // First-use MathJax blocks real measurement; a bar press must queue behind the accepted draft.
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 for(const collab of [false,true])for(const conflict of ['none','remote','docABA']){
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(150);
  await reset({mode:'production',collab,subject:{type:'text',text:'old',textSizing:'user-width',width:250,height:100,style:{...style,align:'left'}}});
  await send('Fetch.enable',{patterns:[{urlPattern:'*mathjax*',requestStage:'Request'}]});
  await click(...await center('[data-element-id="subject"] > g:last-child rect'),2);await until(()=>evaluate(`!!document.querySelector('[contenteditable]') && document.activeElement?.isContentEditable`));await key('a','KeyA',4);
  const draft='accepted $\\sqrt{x}$';await send('Input.insertText',{text:draft});await wait(100);await key('Escape');
  await click(...await center('[data-text-auto-fit] rect'));assert.equal((await snapshot()).slide.elements.subject.text,'old');
  if(conflict==='remote')await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',{text:'remote'})`);
  if(conflict==='docABA')await evaluate(`(async()=>{const m=await import('/src/collab/yDocAdapter.ts');if(canvasTest.doc){const doc=canvasTest.doc;m.setActiveDoc(null);m.setActiveDoc(doc);}else{const p=canvasTest.store.getState().presentation;canvasTest.store.setState({presentation:{...p,id:'other'}});canvasTest.store.setState({presentation:p});}})()`);
  for(const requestId of pausedRequests)await send('Fetch.continueRequest',{requestId});pausedRequests.clear();await send('Fetch.disable');await wait(650);
  if(conflict==='none'){await until(async()=> (await snapshot()).slide.elements.subject.textSizing==='auto-content');assert.equal((await snapshot()).slide.elements.subject.text,draft);assert.equal((await snapshot()).undo,2);}
  else{assert.equal((await snapshot()).slide.elements.subject.textSizing,'user-width');assert.equal((await snapshot()).slide.elements.subject.text,conflict==='remote'?'remote':'old');}
  console.log(`PASS delayed bar accepted draft ${collab?'Yjs':'JSON'} ${conflict}`);
 }
 await send('Network.setCacheDisabled',{cacheDisabled:false});
 for(const zoom of [.5,2]){await reset({mode:'production',zoom,subject:{type:'text',text:'small',width:280,height:70,style}});const g=await evaluate(`(()=>{const n=document.querySelector('[data-text-auto-fit] rect'),r=n.getBoundingClientRect();return [r.width,r.height]})()`);assert.deepEqual(g,[10,18]);await capture(`source-geometry-zoom-${zoom}`);}
 // Native hover follows the actual parent bounds, not the label; pointerdown/double-click stay label-owned.
 for(const shapeType of ['rect','ellipse','path'])for(const zoom of [.5,1.5]){
  await reset({mode:'production',zoom,subject:{shapeType,x:400,y:300,width:280,height:150,rotation:25,...(shapeType==='path'?{points:[0,0,280,150],closed:false}: {})},targets:[{id:'label',type:'text',containerId:'subject',text:'Bound label',width:120,height:35,x:480,y:350,rotation:25,style:{...style,align:'center',verticalAlign:'middle'}}]});
  await wait(150);await evaluate(`canvasTest.editor.getState().setSelectedElements([])`);await wait(50);
  const labelPoint=await center('[data-element-id="label"] > g:last-child rect');await mouse('mouseMoved',40,40);await mouse('mouseMoved',...labelPoint);await wait(60);
  const owner=await evaluate(`(()=>{const n=document.querySelector('.hover-outline rect');return {x:+n.getAttribute('x'),y:+n.getAttribute('y'),width:+n.getAttribute('width'),height:+n.getAttribute('height'),transform:n.parentElement.getAttribute('transform')}})()`);
  assert(owner.width>200,JSON.stringify(owner));assert(owner.transform.includes('25'));
  await capture(`hover-${shapeType}-${zoom}`);
  await evaluate(`canvasTest.editor.getState().setSelectedElements(['subject'])`);await wait(40);assert.equal(await evaluate(`document.querySelectorAll('.hover-outline').length`),0);
  await evaluate(`canvasTest.editor.getState().setSelectedElements(['label'])`);await wait(40);assert.equal(await evaluate(`document.querySelectorAll('.hover-outline').length`),0);
  await click(...labelPoint,2);await until(()=>evaluate(`canvasTest.editor.getState().editingTextId==='label'`));assert.equal(await evaluate(`document.querySelectorAll('[data-text-auto-fit]').length`),0);await key('Escape');
  console.log(`PASS actual hover ${shapeType} zoom=${zoom} parent-selected child-selected doubleclick`);
 }
 await reset({mode:'production',subject:{type:'text',text:'free',width:200,height:60,style}});await evaluate(`canvasTest.editor.getState().setSelectedElements([])`);await mouse('mouseMoved',...await center('[data-element-id="subject"] > g:last-child rect'));assert.equal(await evaluate(`document.querySelectorAll('.hover-outline').length`),1);
 assert.equal(runtimeErrors.length,0,JSON.stringify(runtimeErrors));console.log('PASS free hover and no runtime errors');
} finally { for(const requestId of pausedRequests)await send('Fetch.continueRequest',{requestId});await send('Fetch.disable');await send('Network.setCacheDisabled',{cacheDisabled:false});ws.close(); }
