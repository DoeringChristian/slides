import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/gesture-action-bar.browser.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
const near = (actual, expected, message = '') => assert(Math.abs(actual - expected) < .002, `${message}: ${actual} != ${expected}`);
async function screen(x,y) { return evaluate(`(() => { const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(); return [m.a*${x}+m.c*${y}+m.e,m.b*${x}+m.d*${y}+m.f]; })()`); }
async function select(ids) { await evaluate(`canvasTest.editor.getState().setSelectedElements(${JSON.stringify(ids)})`); await wait(60); }


const ring={kind:'vector',version:1,contours:[{id:'outer',start:[.1,.1],segments:[{kind:'line',to:[.9,.1]},{kind:'line',to:[.9,.9]},{kind:'line',to:[.1,.9]}],closed:true},{id:'inner',start:[.35,.35],segments:[{kind:'line',to:[.65,.35]},{kind:'line',to:[.65,.65]},{kind:'line',to:[.35,.65]}],closed:true}],fills:[{contourIds:['outer','inner'],rule:'evenodd'}],strokes:['outer','inner']};
try {
 await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/tests/canvas-fixture.html'});await waitForCanvasFixture(evaluate);await wait(1000);
 for(const collab of [false,true])for(const zoom of [.5,1,1.5])for(const rotation of [0,37]) {
  await check(`selected icon holes drag only while selected JSON/Yjs=${collab} zoom=${zoom} rotation=${rotation}`,async()=>{
   await setup({mode:'production',collab,zoom,subject:{shapeType:'vector',geometry:ring,x:300,y:200,width:200,height:160,rotation,fill:'#f00'}});
   const point=async(x,y)=>{const a=rotation*Math.PI/180,dx=x-100,dy=y-80;return screen(400+dx*Math.cos(a)-dy*Math.sin(a),280+dx*Math.sin(a)+dy*Math.cos(a));};
   await select([]);const hole=await point(100,80);await click(...hole);assert.deepEqual((await snapshot()).editor.selected,[]);
   await click(...await point(30,80));assert.deepEqual((await snapshot()).editor.selected,['subject']);
   const before=await snapshot();await mouse('mousePressed',...hole);await mouse('mouseMoved',hole[0]+24,hole[1]+18);
   assert.equal((await snapshot()).undo,0);await mouse('mouseReleased',hole[0]+24,hole[1]+18);const after=await snapshot();
   near(after.slide.elements.subject.x-before.slide.elements.subject.x,24/zoom);near(after.slide.elements.subject.y-before.slide.elements.subject.y,18/zoom);assert.equal(after.undo,1);
   await select([]);await click(hole[0]+24,hole[1]+18);assert.deepEqual((await snapshot()).editor.selected,[]);
  });
 }
 await check('higher stacked paint retains priority; locked selected hole cannot move',async()=>{
  await setup({mode:'production',subject:{shapeType:'vector',geometry:ring,x:300,y:200,width:200,height:160,fill:'#f00'},targets:[{id:'above',x:370,y:250,width:60,height:60,fill:'#00f'}]});
  await click(...await screen(400,280));assert.deepEqual((await snapshot()).editor.selected,['above']);
  await setup({mode:'production',subject:{shapeType:'vector',geometry:ring,x:300,y:200,width:200,height:160,fill:'#f00',locked:true}});
  const before=await snapshot(),p=await screen(400,280);await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+35,p[1]+20);await mouse('mouseReleased',p[0]+35,p[1]+20);assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,0);
 });
 for(const zoom of [.5,1,1.5])for(const kind of ['triangle','vector','path','image']) {
  await check(`shared precise bounds/actions/control clearance ${kind} zoom=${zoom}`,async()=>{
   await setup({mode:'production',zoom,subject:{x:400,y:200,width:300,height:450,rotation:20,fill:'#5599bb',shapeType:kind,...(kind==='vector'?{geometry:ring}:{}),...(kind==='path'?{points:[-60,-30,100,40,220,90]}:{}),...(kind==='image'?{type:'image'}:{})}});
   const result=await evaluate(`(async()=>{const {elementVisualBounds,selectionControlMetrics}=await import('/src/utils/shapeVisualBounds.ts');const e=canvasTest.snapshot().slide.elements.subject,z=canvasTest.editor.getState().zoom,b=elementVisualBounds(e),m=selectionControlMetrics(e,z),r=document.querySelector('.selection-transformer > rect'),bar=document.querySelector('button[title="Lock"]').parentElement.parentElement,outer=bar.parentElement;return {b,m,outline:{x:+r.getAttribute('x'),y:+r.getAttribute('y'),width:+r.getAttribute('width'),height:+r.getAttribute('height')},width:parseFloat(outer.style.width),height:parseFloat(outer.style.height),gap:parseFloat(bar.style.marginTop)}})()`);
   near(result.outline.x,result.b.x-result.m.padding);near(result.outline.y,result.b.y-result.m.padding);near(result.width,result.b.width*zoom);near(result.height,result.b.height*zoom);near(result.gap,(result.m.padding+result.m.pathCornerOffset+result.m.cornerTouchRadius+result.m.actionClearance)*zoom);
   if(kind==='triangle')assert(result.b.height<450,'inscribed triangle ignores oversized stored height');
  });
 }
 await setup({mode:'production',zoom:.8,subject:{shapeType:'triangle',x:400,y:200,width:300,height:450,rotation:20,fill:'#5599bb'}});
 await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/selection-ui/compact-after.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 for(const collab of [false,true])for(const zoom of [.5,1,2])for(const points of [[0,0,10,0,10,200],[-20,-20,0,0,10,0,10,200],[0,0,10,0,10,200,300,200],[10,200,10,0,0,0],[0,0,0,0,10,0,10,200]]) {
  await setup({mode:'production',collab,zoom,subject:{x:300,y:200,width:200,height:200,rotation:25,shapeType:'path',cornerRadius:0,points}});
  await evaluate(`document.querySelector('.corner-radius-handle circle').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
  const c=await evaluate(`(async()=>{const {cornerRadiusControl}=await import('/src/utils/cornerRadiusControl.ts');return cornerRadiusControl(canvasTest.snapshot().slide.elements.subject)})()`);
  if(await evaluate(`document.querySelector('.corner-radius-handle').getAttribute('visibility')==='hidden'`)) {
   assert(await evaluate(`(async()=>{const {cornerRadiusControl,cornerRadiusClearance,readRadiusControlObstacles}=await import('/src/utils/cornerRadiusControl.ts');const el=canvasTest.snapshot().slide.elements.subject,g=document.querySelector('.corner-radius-handle'),c=cornerRadiusControl(el);return cornerRadiusClearance({...c,x:el.x+c.x,y:el.y+c.y},${zoom},+g.querySelector('circle').getAttribute('r'),readRadiusControlObstacles(g,${zoom}))===null})()`),'only bounded explicit-control blockage may omit radius');
   assert(await evaluate(`document.querySelectorAll('.path-handles circle').length>0`),'path controls retained during property fallback');
   console.log('PASS bounded property fallback',collab,zoom,JSON.stringify(points));continue;
  }
  const p=await center('.corner-radius-handle circle');assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.corner-radius-handle')`),'on-screen knob owns native hit, not an endpoint/focus/resize control');
  const r=25*Math.PI/180,d=Math.min(8,c.maxRadius/2),q=[p[0]-(c.dx*Math.cos(r)-c.dy*Math.sin(r))*d*zoom,p[1]-(c.dx*Math.sin(r)+c.dy*Math.cos(r))*d*zoom];
  await mouse('mousePressed',...p);await mouse('mouseMoved',...q);assert.equal((await snapshot()).undo,0);await mouse('mouseReleased',...q);
  const after=await snapshot();assert(Math.abs(after.slide.elements.subject.cornerRadius-d)<.02,JSON.stringify({collab,zoom,points,actual:after.slide.elements.subject.cornerRadius,expected:d,p,q}));assert.equal(after.undo,1);
  console.log('PASS on-screen first-segment live radius',collab,zoom,JSON.stringify(points));
 }
 for(const coarse of [false,true]) {
  await send('Emulation.setTouchEmulationEnabled',{enabled:coarse,maxTouchPoints:1});await wait(80);
  assert.equal(await evaluate(`matchMedia('(pointer: coarse)').matches`),coarse);
  for(const collab of [false,true])for(const [zoom,rotation] of [[1,0],[.5,37],[2,37]]) {
   // 64px is the existing coarse midpoint eligibility boundary; a wider
   // body keeps rotation acquisition outside this bounded first-leg lane.
   const first=coarse?64/zoom:40/zoom,tail=coarse?400/zoom:240,points=[0,0,first,0,first,200,tail,200],radius=first/2;
   const config={mode:'production',collab,zoom,subject:{x:300,y:200,width:tail,height:200,rotation,shapeType:'path',cornerRadius:radius,points}};
   const nativeDrag=async(p,q)=>{
    if(coarse)for(const [type,point] of [['touchStart',p],['touchMove',q],['touchEnd',null]]){await send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:point[0],y:point[1],id:0}]:[]});await wait(40);}
    else {await mouse('mousePressed',...p);await mouse('mouseMoved',...q);await mouse('mouseReleased',...q);}
   };
   await setup(config);
   await evaluate(`document.querySelector('.path-handles > g:first-of-type circle:last-child').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
   let p=await center('.path-handles > g:first-of-type circle:last-child');
   assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.path-handles')`),'midpoint owns real native hit, not radius');
   await nativeDrag(p,[p[0]+15,p[1]+20]);let after=await snapshot();
   assert.equal(after.slide.elements.subject.points.length,10,'midpoint materializes/moves vertex');
   assert.equal(after.slide.elements.subject.cornerRadius,radius,'midpoint cannot change radius');assert.equal(after.undo,1);
   await setup(config);await evaluate(`document.querySelector('.corner-radius-handle circle').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
   if(await evaluate(`document.querySelector('.corner-radius-handle').getAttribute('visibility')==='hidden'`)){assert(first*zoom<=64,'short first leg fallback only');console.log('PASS finite short-leg fallback after independent midpoint acquisition',coarse,collab,zoom,rotation);continue;}
   p=await center('.corner-radius-handle circle');assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.corner-radius-handle')`),'radius owns native hit');
   const angle=rotation*Math.PI/180,q=[p[0]+8*zoom*Math.cos(angle),p[1]+8*zoom*Math.sin(angle)];
   const before=await snapshot(),normal=await evaluate(`+document.querySelector('.corner-radius-handle circle').getAttribute('cy')`);await nativeDrag(p,q);after=await snapshot();
   near(await evaluate(`+document.querySelector('.corner-radius-handle circle').getAttribute('cy')`),normal,'radius remains collinear throughout placement');
   assert.deepEqual(after.slide.elements.subject.points,before.slide.elements.subject.points,'radius cannot materialize/move points');
   assert(Math.abs(after.slide.elements.subject.cornerRadius-radius+8)<.02);assert.equal(after.undo,1);
   console.log('PASS nonzero radius vs midpoint native ownership',coarse,collab,zoom,rotation);
  }
 }

 // Tiny first segments still reserve endpoint acquisition on actual coarse input.
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await setup({mode:'production',subject:{x:300,y:200,width:240,height:200,rotation:37,shapeType:'path',cornerRadius:20,points:[0,0,2,0,2,200,240,200]}});
 await evaluate(`document.querySelector('.path-handles circle[cx="300"][cy="200"]').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
 let p=await center('.path-handles circle[cx="300"][cy="200"]');
 assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.path-handles')`),'tiny-leg vertex owns native touch acquisition');
 const tinyBefore=await snapshot();
 for(const [type,point] of [['touchStart',p],['touchMove',[p[0]+20,p[1]+15]],['touchEnd',null]]){await send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:point[0],y:point[1],id:0}]:[]});await wait(40);}
 let after=await snapshot();assert.notDeepEqual(after.slide.elements.subject.points,tinyBefore.slide.elements.subject.points);assert.equal(after.slide.elements.subject.cornerRadius,20);assert.equal(after.undo,1);
 await setup({mode:'production',subject:{x:300,y:200,width:240,height:200,rotation:37,shapeType:'path',cornerRadius:20,points:[0,0,2,0,2,200,240,200]}});
 await evaluate(`document.querySelector('.corner-radius-handle circle').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
 assert.equal(await evaluate(`document.querySelector('.corner-radius-handle').getAttribute('visibility')`),'hidden','2-unit first leg cannot host a finite coarse puck; endpoint still acquired above');

 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 // A visible aim focus and a resize edge also retain ownership near the first leg.
 for(const control of ['focus','resize']) {
  await setup({mode:'production',subject:{x:300,y:200,width:240,height:200,shapeType:'path',cornerRadius:20,points:[0,0,40,0,40,200,240,200],startBinding:{elementId:'target',mode:'aim',fixedPoint:[.5,.5]}},targets:[{id:'target',x:280,y:180,width:80,height:80,fill:'#f99'}]});
  const selector=control==='focus'?'[data-focus-hit]':'[data-resize-handle="top-center"]';
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center'})`);await wait(40);p=await center(selector);
  assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest(${JSON.stringify(control==='focus'?'[data-binding-focus]':'[data-resize-handle]')})`),control+' owns native hit');
  await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+8,p[1]+15);await mouse('mouseReleased',p[0]+8,p[1]+15);
  after=await snapshot();assert.equal(after.slide.elements.subject.cornerRadius,20);assert.equal(after.undo,1);
 }
 console.log('PASS tiny coarse endpoint, aim focus and resize ownership');

 await check('idle closed/curve/type changes invalidate clearance while radius-only updates keep the lane stable',async()=>{
  await setup({mode:'production',subject:{x:300,y:200,width:160,height:40,shapeType:'path',cornerRadius:20,points:[0,0,160,0,160,40]}});
  const update=async(changes)=>{await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',${JSON.stringify(changes)})`);await wait(80);};
  await update({closed:true});await update({cornerRadius:70});
  await evaluate(`document.querySelector('.path-handles > g:first-of-type circle:last-child').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
  let p=await center('.path-handles > g:first-of-type circle:last-child');assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.path-handles')`),'closed-path range reserves first midpoint');
  const hidden=await evaluate(`document.querySelector('.corner-radius-handle').getAttribute('visibility')==='hidden'`);
  if(hidden) {assert.equal((await snapshot()).slide.elements.subject.cornerRadius,70);console.log('PASS closed full-travel bounded property fallback');}
  else {
   p=await center('.corner-radius-handle circle');assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.corner-radius-handle')`));const before=await snapshot();
   await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+8,p[1]);await mouse('mouseReleased',p[0]+8,p[1]);
   const after=await snapshot();assert.equal(after.slide.elements.subject.cornerRadius,62);assert.deepEqual(after.slide.elements.subject.points,before.slide.elements.subject.points);assert.equal(after.undo,before.undo+1);
  }
  await update({curve:'smooth'});assert.equal(await evaluate(`document.querySelector('.corner-radius-handle')`),null);
  await update({curve:'linear'});assert(await evaluate(`!!document.querySelector('.corner-radius-handle circle')`));
  await update({shapeType:'rect'});assert.equal(await evaluate(`+document.querySelector('.corner-radius-handle circle').getAttribute('cy')`),200,'rect stays on its top edge after same-id path conversion');
 });

 assert.deepEqual(runtimeErrors,[]);console.log('SELECTION UI CHECKS PASSED');
}finally{await send('Emulation.setTouchEmulationEnabled',{enabled:false});ws.close();}
