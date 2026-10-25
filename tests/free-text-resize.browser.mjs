import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/ui-reference.browser.mjs
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
  await wait(12);
}
async function click(x, y, count = 1) { await mouse('mousePressed', x, y, count); await mouse('mouseReleased', x, y, count); }
async function drag(x, y, ex, ey) { await mouse('mousePressed', x, y); await mouse('mouseMoved', ex, ey); await mouse('mouseReleased', ex, ey); }
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, a: 65 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, commands: modifiers === 4 && key === 'a' ? ['selectAll'] : undefined, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });

}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function check(name, run) { await run(); console.log(`PASS ${name}`); }


const evidence=process.env.FREE_TEXT_RESIZE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/free-text-resize/browser`;
const style={fontFamily:'Arial',fontSize:20,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'center',verticalAlign:'top',lineHeight:1.25};
const anchors=['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'];
const near=(a,b)=>assert(Math.abs(a-b)<.015,`${a} != ${b}`);
async function center(anchor){return evaluate(`(()=>{const n=document.querySelector('[data-resize-handle="${anchor}"] [data-resize-visual]')??document.querySelector('[data-resize-handle="${anchor}"]');const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);}
async function normalize(config){await setup(config);await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/userTextSizing.ts');const s=canvasTest.snapshot().slide,e=s.elements.subject;canvasTest.store.getState().updateElements(s.id,[{elementId:e.id,changes:await measureUserText(e)}]);canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear();})()`);await wait(45);await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('.selection-transformer').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x+r.width/2-b.x-b.width/2;p.scrollTop+=r.y+r.height/2-b.y-b.height/2;})()`);await wait(30);}
function fixed(e,a,centered){const hx=centered?0:a.includes('left')?1:a.includes('right')?-1:0,hy=centered?0:a.includes('top')?1:a.includes('bottom')?-1:0,r=e.rotation*Math.PI/180;return [e.x+e.width/2+hx*e.width/2*Math.cos(r)-hy*e.height/2*Math.sin(r),e.y+e.height/2+hx*e.width/2*Math.sin(r)+hy*e.height/2*Math.cos(r)];}
try{
 await mkdir(evidence,{recursive:true});await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(1200);
 const results=[];
 const staleResults=[];
 for(const collab of [false,true])for(const zoom of [.5,1,2])for(const rotation of [0,30,90])for(const anchor of ['bottom-right','top-left','top-center','middle-right'])for(const staleKind of ['auto-padding','auto-height','user-height']){
  const mode=staleKind==='user-height'?'user-width':'auto-content';
  const subject={type:'text',text:'hello **bold** world\nshort $x^2$',textSizing:mode,x:400,y:280,width:220,height:60,rotation,style};
  // Measure the source only. NEVER write a normalized fixture or clear its history.
  const baseline=await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/userTextSizing.ts');return measureUserText(${JSON.stringify(subject)})})()`);
  subject.width=baseline.width+(staleKind==='auto-padding'?28:0);subject.height=baseline.height+(staleKind==='auto-padding'?28:80);
  await setup({mode:'production',collab,zoom,subject});
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),r=document.querySelector('.selection-transformer').getBoundingClientRect(),b=p.getBoundingClientRect();p.scrollLeft+=r.x+r.width/2-b.x-b.width/2;p.scrollTop+=r.y+r.height/2-b.y-b.height/2;})()`);await wait(30);
  const before=await snapshot(),a=before.slide.elements.subject;
  const modifiers=[0,2,8,10][(['bottom-right','top-left','top-center','middle-right'].indexOf(anchor)+[0,30,90].indexOf(rotation))%4],shift=!!(modifiers&8),centered=!!(modifiers&2),scaling=shift||!anchor.startsWith('middle-');
  const [cx,cy]=await center(anchor),r=rotation*Math.PI/180;
  // Off-center physical grab inside the visible corner (not just its center).
  const offset=anchor.includes('left')||anchor.includes('right')?1.5:0,x=cx+offset*Math.cos(r),y=cy+offset*Math.sin(r);
  const dx=anchor.includes('left')?-baseline.width*.2:anchor.includes('right')?baseline.width*.2:0,dy=anchor.includes('top')?-baseline.height*.2:anchor.includes('bottom')?baseline.height*.2:0;
  const ex=x+(dx*Math.cos(r)-dy*Math.sin(r))*zoom,ey=y+(dx*Math.sin(r)+dy*Math.cos(r))*zoom;
  await mouse('mousePressed',x,y,1,modifiers);await mouse('mouseMoved',ex,ey,1,modifiers);await wait(80);
  assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);
  if(zoom===1&&rotation===30&&anchor==='middle-right'){
   for(const [keyName,keyCode,eventType,mods] of [['Shift','ShiftLeft','keyDown',8],['Control','ControlLeft','keyDown',10],['Shift','ShiftLeft','keyUp',2],['Control','ControlLeft','keyUp',0]]){
    await send('Input.dispatchKeyEvent',{type:eventType,key:keyName,code:keyCode,modifiers:mods});await wait(80);
    const scalingNow=!!(mods&8),centeredNow=!!(mods&2),scaleNow=1+(centeredNow?.4:.2);
    const candidate={...a,width:baseline.width*scaleNow,textSizing:scalingNow?a.textSizing:'user-width',style:{...a.style,fontSize:a.style.fontSize*(scalingNow?scaleNow:1)}};
    const measured=await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/userTextSizing.ts');return measureUserText(${JSON.stringify(candidate)})})()`);
    const oldFixed=fixed(a,anchor,centeredNow),cxNew=oldFixed[0]+(centeredNow?0:measured.width/2*Math.cos(r)),cyNew=oldFixed[1]+(centeredNow?0:measured.width/2*Math.sin(r));
    const expected=[cxNew-measured.width/2-4/zoom,cyNew-measured.height/2-4/zoom,measured.width+8/zoom,measured.height+8/zoom];
    const actual=await evaluate(`(()=>{const n=document.querySelector('.selection-transformer > rect');return ['x','y','width','height'].map(k=>+n.getAttribute(k))})()`);actual.forEach((v,i)=>near(v,expected[i]));
    assert.deepEqual((await snapshot()).slide,before.slide);
   }
  }
  const liveBox=await evaluate(`(()=>{const n=document.querySelector('.selection-transformer > rect');return ['x','y','width','height'].map(k=>+n.getAttribute(k))})()`);
  await mouse('mouseReleased',ex,ey,1,modifiers);await wait(100);
  const after=await snapshot(),b=after.slide.elements.subject,scale=1+(centered?.4:.2);
  const result={collab,zoom,rotation,anchor,staleKind,modifiers,baseline,before:a,after:b};staleResults.push(result);
  await writeFile(`${evidence}/stale-matrix.json`,JSON.stringify(staleResults,null,2));
  assert.equal(after.undo,before.undo+1);assert.equal(b.text,a.text);
  if(scaling){near(b.style.fontSize,a.style.fontSize*scale);near(b.width,baseline.width*scale);near(b.height,baseline.height*scale);assert.equal(b.textSizing,a.textSizing);assert(b.width>baseline.width);assert(b.height>baseline.height);}else{near(b.width,baseline.width*scale);assert.equal(b.style.fontSize,a.style.fontSize);assert.equal(b.textSizing,'user-width');}
  fixed(a,anchor,centered).forEach((v,i)=>near(v,fixed(b,anchor,centered)[i]));
  if(zoom===1&&rotation===30&&anchor==='bottom-right'){
   const png=await send('Page.captureScreenshot');await writeFile(`${evidence}/${collab?'yjs':'json'}-stale-${staleKind}.png`,Buffer.from(png.data,'base64'));
  }
  const size=await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/userTextSizing.ts');return measureUserText(canvasTest.snapshot().slide.elements.subject)})()`);assert.deepEqual(size,{width:b.width,height:b.height});
  const finalBox=await evaluate(`(()=>{const n=document.querySelector('.selection-transformer > rect');return ['x','y','width','height'].map(k=>+n.getAttribute(k))})()`);liveBox.forEach((v,i)=>near(v,finalBox[i]));
  await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo();})()`);await wait(35);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.redo();else canvasTest.store.temporal.getState().redo();})()`);await wait(35);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
  console.log('PASS stale baseline',collab,zoom,rotation,anchor,staleKind,modifiers);
 }
 if(!process.env.FREE_TEXT_BASELINE_ONLY){
 for(const collab of [false,true])for(const zoom of [.5,1,2])for(const rotation of [0,30,90])for(const anchor of anchors){
  // Full handle/zoom/rotation coverage; modifier routes cycle across the matrix.
  const modifiers=[0,2,8,10][(anchors.indexOf(anchor)+[0,30,90].indexOf(rotation))%4],shift=!!(modifiers&8),centered=!!(modifiers&2);
  await normalize({mode:'production',collab,zoom,subject:{type:'text',text:'hello **bold** world\nshort $x^2$',textSizing:anchors.indexOf(anchor)%2?'user-width':'auto-content',x:160,y:160,width:220,height:60,rotation,style:{...style,align:anchors.indexOf(anchor)%2?'right':'center'}}});
  const before=await snapshot(),a=before.slide.elements.subject,[x,y]=await center(anchor),r=rotation*Math.PI/180;
  const dx=anchor.includes('left')?-28:anchor.includes('right')?28:0,dy=anchor.includes('top')?-10:anchor.includes('bottom')?10:0;
  const ex=x+(dx*Math.cos(r)-dy*Math.sin(r))*zoom,ey=y+(dx*Math.sin(r)+dy*Math.cos(r))*zoom;
  await mouse('mousePressed',x,y,1,modifiers);await mouse('mouseMoved',ex,ey,1,modifiers);await wait(50);
  const live=await snapshot();assert.deepEqual(live.slide,before.slide);assert.equal(live.undo,before.undo);
  const liveBox=await evaluate(`(()=>{const n=document.querySelector('.selection-transformer > rect');return ['x','y','width','height'].map(k=>+n.getAttribute(k))})()`);
  await mouse('mouseReleased',ex,ey,1,modifiers);await wait(90);
  const after=await snapshot(),b=after.slide.elements.subject;
  assert.equal(after.undo,before.undo+1,JSON.stringify({collab,zoom,rotation,anchor,modifiers}));assert.equal(a.text,b.text);
  const scaling=shift||!anchor.startsWith('middle-');if(scaling){assert(b.style.fontSize>a.style.fontSize);near(b.width/a.width,b.style.fontSize/a.style.fontSize);near(b.height/a.height,b.style.fontSize/a.style.fontSize);assert.equal(b.textSizing,a.textSizing);}else{assert.equal(b.style.fontSize,a.style.fontSize);assert.equal(b.textSizing,'user-width');}
  fixed(a,anchor,centered).forEach((v,i)=>near(v,fixed(b,anchor,centered)[i]));
  const size=await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/userTextSizing.ts');return measureUserText(canvasTest.snapshot().slide.elements.subject)})()`);assert.deepEqual(size,{width:b.width,height:b.height});
  const finalBox=await evaluate(`(()=>{const n=document.querySelector('.selection-transformer > rect');return ['x','y','width','height'].map(k=>+n.getAttribute(k))})()`);liveBox.forEach((v,i)=>near(v,finalBox[i]));
  await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo();})()`);await wait(35);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.redo();else canvasTest.store.temporal.getState().redo();})()`);await wait(35);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
  results.push({collab,zoom,rotation,anchor,modifiers,before:a,after:b});console.log('PASS native',collab,zoom,rotation,anchor,modifiers);
 }
 for(const collab of [false,true]){
  await setup({mode:'production',collab,subject:{type:'text',text:'current user-width text',textSizing:'user-width',width:200,height:80,style}});
  const before=await snapshot();await wait(100);assert.deepEqual((await snapshot()).slide,before.slide);
  let [x,y]=await center('middle-right');await click(x,y);assert.equal((await snapshot()).undo,before.undo);assert.equal((await snapshot()).slide.elements.subject.textSizing,'user-width');
  await drag(x,y,x-70,y);await wait(100);assert.equal((await snapshot()).slide.elements.subject.textSizing,'user-width');assert.equal((await snapshot()).undo,before.undo+1);
  await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo();})()`);await wait(40);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  [x,y]=await center('bottom-right');await mouse('mousePressed',x,y);await mouse('mouseMoved',x+50,y+20);await key('Escape');await mouse('mouseReleased',x+50,y+20);await wait(100);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  console.log('PASS user-width resize/no-op/undo/cancel',collab);
 }
 for(const collab of [false,true]){
  await normalize({mode:'production',collab,subject:{type:'text',text:'several words that will wrap into many lines',textSizing:'auto-content',x:400,y:300,width:300,height:50,rotation:30,style}});
  const before=await snapshot(),a=before.slide.elements.subject,[x,y]=await center('middle-right'),dx=(90-a.width)*Math.cos(Math.PI/6),dy=(90-a.width)*Math.sin(Math.PI/6);
  await mouse('mousePressed',x,y);await mouse('mouseMoved',x+dx,y+dy);await wait(60);
  // Modifier swaps use original snapshot, never accumulate from the preview.
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',modifiers:8});await wait(60);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Control',code:'ControlLeft',modifiers:10});await wait(60);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',modifiers:2});await wait(60);
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',modifiers:0});await wait(60);
  assert.deepEqual((await snapshot()).slide,before.slide);
  await mouse('mouseReleased',x+dx,y+dy);await wait(100);
  const after=await snapshot(),b=after.slide.elements.subject;near(b.width,90);assert(b.height>a.height*2);assert.equal(b.style.fontSize,a.style.fontSize);assert.equal(b.textSizing,'user-width');assert.equal(b.text,a.text);assert.equal(after.undo,before.undo+1);
  fixed(a,'middle-right',false).forEach((v,i)=>near(v,fixed(b,'middle-right',false)[i]));
  const png=await send('Page.captureScreenshot');await writeFile(`${evidence}/${collab?'yjs':'json'}-wrapped-rotated.png`,Buffer.from(png.data,'base64'));console.log('PASS narrow wrap + modifier swaps',collab);
 }
 for(const collab of [false,true])for(const outcome of ['finish','corner-finish','escape','width-change','source-change','doc-change','json-doc-change','slide-switch','hide','no-op','return-to-grab']){
  await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.reload',{ignoreCache:true});await waitForCanvasFixture(evaluate);await wait(300);
  await send('Fetch.enable',{patterns:[{urlPattern:'*mathjax*',requestStage:'Request'}]});
  await setup({mode:'production',collab,secondSlide:true,subject:{type:'text',text:'delayed $\\sqrt{x}$',textSizing:'user-width',x:500,y:300,width:200,height:50,style}});
  for(let n=0;n<100&&!pausedRequests.size;n++)await wait(20);assert(pausedRequests.size>0,'real math request delayed');
  const before=await snapshot(),[x,y]=await center(outcome==='corner-finish'?'bottom-right':'middle-right');await mouse('mousePressed',x,y);
  if(outcome==='corner-finish')await mouse('mouseMoved',x+40,y+20);
  else if(outcome!=='no-op'){await mouse('mouseMoved',x-80,y);await mouse('mouseMoved',x-60,y);}
  if(outcome==='return-to-grab')await mouse('mouseMoved',x,y);
  await mouse('mouseReleased',outcome==='corner-finish'?x+40:outcome==='no-op'||outcome==='return-to-grab'?x:x-60,outcome==='corner-finish'?y+20:y);
  assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);
  if(outcome==='escape')await key('Escape');
  if(outcome==='source-change')await evaluate(`canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'subject',{text:'new source wins'})`);
  if(outcome==='doc-change')await evaluate(`(async()=>{const {setActiveDoc}=await import('/src/collab/yDocAdapter.ts');const {jsonToYDoc,yDocToJson}=await import('/src/collab/ySchema.ts');window.baselineReplacementDoc=jsonToYDoc(canvasTest.store.getState().presentation);window.baselineReplacementBefore=yDocToJson(window.baselineReplacementDoc).slides[canvasTest.snapshot().slide.id];setActiveDoc(window.baselineReplacementDoc);})()`);
  if(outcome==='json-doc-change')await evaluate(`canvasTest.store.setState({presentation:{...canvasTest.store.getState().presentation,id:'replacement-presentation'}})`);
  if(outcome==='width-change')await evaluate(`canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'subject',{width:333})`);
  if(outcome==='slide-switch')await evaluate(`canvasTest.editor.getState().setActiveSlide('other')`);
  if(outcome==='hide')await evaluate(`canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'subject',{visible:false})`);
  const cancelled=await snapshot();
  for(const requestId of pausedRequests)await send('Fetch.continueRequest',{requestId});pausedRequests.clear();await send('Fetch.disable');await wait(750);
  const after=await snapshot();
  if(outcome==='corner-finish'){
   const original=before.slide.elements.subject,baseline=await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/userTextSizing.ts');return measureUserText(${JSON.stringify(before.slide.elements.subject)})})()`),scale=1+Math.max(40/baseline.width,20/baseline.height),out=after.slide.elements.subject;
   near(out.style.fontSize,original.style.fontSize*scale);near(out.width,baseline.width*scale);near(out.height,baseline.height*scale);assert.equal(out.text,original.text);assert.equal(after.undo,before.undo+1);
  }else if(outcome==='finish'){assert.equal(after.slide.elements.subject.width,140);assert.equal(after.undo,before.undo+1);assert.equal(after.slide.elements.subject.text,before.slide.elements.subject.text);}
  else {assert.deepEqual(after.slide,cancelled.slide);assert.equal(after.undo,cancelled.undo);}
  if(outcome==='doc-change'){
   assert.deepEqual(await evaluate(`(async()=>{const {yDocToJson}=await import('/src/collab/ySchema.ts');return yDocToJson(window.baselineReplacementDoc).slides[canvasTest.snapshot().slide.id]})()`),await evaluate('window.baselineReplacementBefore'));
   await evaluate(`(async()=>{const {setActiveDoc}=await import('/src/collab/yDocAdapter.ts');setActiveDoc(canvasTest.doc);window.baselineReplacementDoc.destroy();delete window.baselineReplacementDoc;delete window.baselineReplacementBefore;})()`);
  }
  console.log('PASS delayed original baseline MathJax',collab,outcome);
 }
 }
 await send('Network.setCacheDisabled',{cacheDisabled:false});
 await writeFile(`${evidence}/matrix.json`,JSON.stringify(results,null,2));assert.deepEqual(runtimeErrors,[]);console.log('PASS runtime errors empty');
}finally{await send('Fetch.disable').catch(()=>{});ws.close();}
