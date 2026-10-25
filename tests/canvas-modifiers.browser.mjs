import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas-modifiers.browser.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page');
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
async function setup(config) { await waitForCanvasFixture(evaluate); await evaluate(`canvasTest.resetPreferences();canvasTest.setup(${JSON.stringify(config)})`); await wait(100); }
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
async function highlighted() { return evaluate(`!!document.querySelector('.ui-layer [data-connector-highlight]')`); }

const anchors=['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'];
const resizeHandle = name => center(name.includes('center')||name.startsWith('middle') ? `[data-resize-handle="${name}"]` : `[data-resize-handle="${name}"] rect:last-child`);
const mods = async (type,name,bits) => { await send('Input.dispatchKeyEvent',{type,key:name,code:name+'Left',windowsVirtualKeyCode: name==='Shift'?16:name==='Control'?17:91,modifiers:bits}); await wait(40); };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate); await wait(1500);
  await check('every outside handle: Shift aspect, Ctrl center, combos; rotated JSON/Yjs and single undo',async()=>{
    for(const collab of [false,true]) for(const rotation of [0,37]) for(const anchor of anchors) for(const bits of [2,8,10]) {
      await setup({mode:'production',collab,zoom:.5,subject:{x:500,y:300,width:200,height:100,rotation}});
      const before=(await snapshot()).slide.elements.subject;
      const p=await resizeHandle(anchor),a=rotation*Math.PI/180;
      const dx=(anchor.includes('left')?-24:24),dy=(anchor.includes('top')?-18:18);
      const end=[p[0]+dx*Math.cos(a)-dy*Math.sin(a),p[1]+dx*Math.sin(a)+dy*Math.cos(a)];
      await mouse('mousePressed',...p); await mouse('mouseMoved',...end,1,bits); await mouse('mouseReleased',...end,1,bits);
      const after=await snapshot(),el=after.slide.elements.subject;
      assert.equal(after.undo,1,JSON.stringify({collab,rotation,anchor,bits,p,end,el})); assert(el.width!==before.width||el.height!==before.height);
      if(bits&8) near(el.width/el.height,2,'ratio');
      if(bits&2) {near(el.x+el.width/2,600,'center x');near(el.y+el.height/2,350,'center y');}
      await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements.subject,before);
      await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide.elements.subject,el);
    }
  });
  await check('stationary Shift/Ctrl recompute original snapshot; Escape; zoom',async()=>{
    for(const zoom of [.5,1,2]) {
      await setup({mode:'production',zoom,subject:{x:400,y:200,width:120,height:60},snap:true,targets:[{id:'target',x:800,y:500,width:100,height:100}]});
      const before=(await snapshot()).slide.elements.subject,p=await resizeHandle('bottom-right');
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+40,p[1]+8);
      const free=await evaluate(`document.querySelector('.content-layer').innerHTML`);
      await mods('keyDown','Shift',8); const square=await evaluate(`document.querySelector('.content-layer').innerHTML`);assert.notEqual(free,square);
      await mods('keyDown','Control',10);assert.notEqual(await evaluate(`document.querySelector('.content-layer').innerHTML`),square);
      await mods('keyUp','Control',8);await mods('keyUp','Shift',0);assert.equal(await evaluate(`document.querySelector('.content-layer').innerHTML`),free);
      await key('Escape');await mouse('mouseReleased',p[0]+40,p[1]+8);assert.deepEqual((await snapshot()).slide.elements.subject,before);assert.equal((await snapshot()).undo,0);
    }
  });
  await check('uniform centered group resize preserves rotated off-box path actual vertices, tangents and undo',async()=>{
    for(const collab of [false,true]) {
      await setup({mode:'production',collab,zoom:.5,subject:{shapeType:'path',x:600,y:300,width:150,height:80,rotation:37,curve:'bezier',points:[-40,-20,60,90,180,30],tangents:[0,0,30,-40,-20,0,40,30,-10,20,0,0]},targets:[{id:'target',x:350,y:200,width:100,height:90,rotation:23}]});
      await select(['subject','target']);const before=await snapshot(),points=await world(),p=await resizeHandle('bottom-right');
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+40,p[1]+20,1,10);await mouse('mouseReleased',p[0]+40,p[1]+20,1,10);
      const after=await snapshot(),el=after.slide.elements.subject,pts=await world();
      const scale=el.tangents[2]/before.slide.elements.subject.tangents[2];assert(scale>1);
      const tx=pts[0]-points[0]*scale,ty=pts[1]-points[1]*scale;
      pts.forEach((v,i)=>near(v,points[i]*scale+(i%2?ty:tx),'uniform path'));
      const a=before.slide.elements.target,b=after.slide.elements.target;near(b.width/a.width,scale);near(b.x+b.width/2,(a.x+a.width/2)*scale+tx);near(b.y+b.height/2,(a.y+a.height/2)*scale+ty);
      assert.equal(after.undo,1);await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
    }
  });
  await check('Shift body move axis applies to group; Shift+Meta and Ctrl pointer modifiers',async()=>{
    for(const collab of [false,true]) for(const bits of [8,12,2]) {
      await setup({mode:'production',collab,zoom:.5,snap:true,subject:{x:500,y:300,width:100,height:80},targets:[{id:'target',x:750,y:310,width:120,height:80}]});
      await select(['subject','target']);const before=await snapshot(),p=await screen(504,340);
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+40,p[1]+13,1,bits);await mouse('mouseReleased',p[0]+40,p[1]+13,1,bits);
      const after=await snapshot();for(const id of ['subject','target']){near(after.slide.elements[id].x-before.slide.elements[id].x,80);near(after.slide.elements[id].y-before.slide.elements[id].y,bits&8?0:26);}
      assert.equal(after.undo,1);
    }
  });
  await check('Shift standard shape drag and fixed icon placement in reverse quadrants JSON/Yjs',async()=>{
    for(const collab of [false,true]) for(const tool of ['rect','ellipse','triangle','star','icon']) {
      await setup({mode:'production',collab,empty:true,tool,zoom:1});const p=await screen(650,400),q=await screen(530,350);
      await mouse('mousePressed',...p);await mouse('mouseMoved',...q);await mods('keyDown','Shift',8);await mouse('mouseReleased',...q,1,8);await mods('keyUp','Shift',0);
      const snap=await snapshot(),el=lastShape(snap);near(el.width,tool==='icon'?64:120);near(el.height,tool==='icon'?64:120);near(el.x,tool==='icon'?498:530);near(el.y,tool==='icon'?318:280);assert.equal(snap.undo,1);assert.equal(snap.editor.tool,'select');
    }
  });
  await check('compact geometry bounds/1px lines/8px corners/whole-side hits and action isolation at zoom/rotation',async()=>{
    for(const shapeType of ['rect','triangle','vector']) for(const zoom of [.5,1,2]) for(const rotation of [0,37]) {
      await setup({mode:'production',zoom,subject:{shapeType:shapeType==='vector'?'rect':shapeType,x:420,y:200,width:160,height:120,rotation}});
      if(shapeType==='vector') { await evaluate(`(async()=>{const {CURATED_ICONS}=await import('/src/utils/curatedIcons.ts');const p=canvasTest.store.getState().presentation,sid=p.slideOrder[0];canvasTest.store.getState().updateElement(sid,'subject',{shapeType:'vector',geometry:CURATED_ICONS.find(i=>i.id==='house').geometry});})()`); await wait(80); }
      const metrics=await evaluate(`(()=>{const selection=document.querySelector('.selection-transformer'), box=selection.querySelector('rect'), node=document.querySelector('[data-element-id="subject"] > g'), b=node.getBBox(),r=box.getBBox();return {b:{x:b.x,y:b.y,width:b.width,height:b.height},r:{x:r.x,y:r.y,width:r.width,height:r.height},stroke:+box.getAttribute('stroke-width'),corners:selection.querySelectorAll('g[data-resize-handle] rect[fill="white"]').length,corner:+selection.querySelector('g[data-resize-handle] rect[fill="white"]').getAttribute('width'),sideVisible:selection.querySelectorAll('rect[data-resize-handle][stroke]').length};})()`);
      const pad=4/zoom;
      near(metrics.r.x,metrics.b.x-pad,'left geometry gap'); near(metrics.r.y,metrics.b.y-pad,'top geometry gap');near(metrics.r.width,metrics.b.width+2*pad);near(metrics.r.height,metrics.b.height+2*pad);
      near(metrics.stroke*zoom,1);near(metrics.corner*zoom,8);assert.equal(metrics.corners,4);assert.equal(metrics.sideVisible,0);
      for(const anchor of anchors) {const p=await resizeHandle(anchor);assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]}).closest('[data-resize-handle]')`),JSON.stringify({shapeType,zoom,rotation,anchor,p})+' hit isolated');}
      if(zoom===1&&rotation===37){const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/modifiers-compact-`+shapeType+'.png',Buffer.from(shot.data,'base64'));}
    }
  });
  await check('P1 Shift ray rejects incompatible binding in creation, endpoints and both extensions; stationary toggles and undo JSON/Yjs',async()=>{
    for(const collab of [false,true]) for(const operation of ['create-line','create-arrow','create-polygon','endpoint-start','endpoint-end','extension-start','extension-end']) for(const compatible of [false,true]) {
      const extension=operation.startsWith('extension'),startEnd=operation.endsWith('start'),create=operation.startsWith('create');
      const subject=extension?{x:200,y:250,width:100,height:1,shapeType:'path',points:startEnd?[100,0,0,0]:[0,0,100,0]}:{x:300,y:250,width:80,height:1,shapeType:'path',points:startEnd?[80,0,0,0]:[0,0,80,0]};
      await setup({mode:'production',collab,empty:create,tool:create?operation.slice(7):'select',subject,targets:[{id:'target',x:400,y:compatible?200:270,width:100,height:100,cornerRadius:0}]});
      const before=await snapshot(),dest=await screen(450,250);
      if(extension){await evaluate(`canvasTest.editor.getState().beginPathExtension('subject','${startEnd?'start':'end'}')`);await wait(60);}
      else if(operation==='create-polygon') await click(...await screen(300,250));
      else await mouse('mousePressed',...await screen(create?300:380,250));
      await mouse('mouseMoved',...dest);assert(await highlighted(),'unconstrained target acquired');
      await mods('keyDown','Shift',8);assert.equal(await highlighted(),compatible,'Shift target compatibility');
      await mods('keyUp','Shift',0);assert(await highlighted(),'stationary Shift release reacquires target');
      await mods('keyDown','Shift',8);
      const previewRay=await evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(!create&&!extension?'.content-layer [data-element-id="subject"] path[stroke="#000000"][fill="none"]':'.ui-layer path[stroke="#000000"][fill="none"]')});if(!p)throw new Error('missing live shaft');const m=p.getScreenCTM(),inverse=document.querySelector('.canvas-scroll-parent svg').getScreenCTM().inverse();return [0,p.getTotalLength()].map(t=>{const q=p.getPointAtLength(t);return new DOMPoint(q.x,q.y).matrixTransform(m).matrixTransform(inverse).y});})()`);
      previewRay.forEach(y=>near(y,250,'live preview remains on constrained ray'));
      if(extension||operation==='create-polygon') await key('Enter','Enter',8);else await mouse('mouseReleased',...dest,1,8);
      await mods('keyUp','Shift',0);
      const after=await snapshot(),el=create?lastShape(after):after.slide.elements.subject,points=await world(el.id);
      const i=startEnd?0:points.length-2,adj=startEnd?2:points.length-4;
      near(points[i+1],250,'endpoint stays on constrained ray');near(points[adj+1],250,'adjacent ray origin');
      near(points[i],compatible?400:450,'compatible aim ends at border; rejected attachment keeps raw endpoint');
      assert.equal(!!el[startEnd?'startBinding':'endBinding'],compatible);assert.equal(after.undo,1);
      await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
      await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
  });
  await check('P1 rotated pinned co-target nonuniform resize resolves preview exactly like JSON/Yjs commit and undo',async()=>{
    for(const collab of [false,true]) {
      const pin=200+50/Math.sqrt(2);
      await setup({mode:'production',collab,subject:{x:pin,y:pin,width:100,height:1,shapeType:'path',points:[0,0,100,0],startBinding:{elementId:'target',mode:'pinned',fixedPoint:[1,.5]}},targets:[{id:'target',x:150,y:150,width:100,height:100,rotation:45}]});
      await select(['subject','target']);const before=await snapshot(),p=await resizeHandle('middle-right');
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+150,p[1]);
      const preview=await evaluate(`document.querySelector('.content-layer [data-element-id="subject"] > g').outerHTML`);
      await mouse('mouseReleased',p[0]+150,p[1]);const after=await snapshot(),points=await world();
      const expected=await evaluate(`(async()=>{const {resolveBinding}=await import('/src/utils/connectorUtils.ts');const s=canvasTest.snapshot().slide;return resolveBinding(s.elements.subject.startBinding,s.elements.target,{x:${points[2]},y:${points[3]}})})()`);
      near(points[0],expected.x);near(points[1],expected.y);
      assert.equal(await evaluate(`document.querySelector('[data-element-id="subject"] > g').outerHTML`),preview,'shared solved preview equals committed renderer');
      assert.equal(after.undo,1);await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
  });
  await check('P1 locked modifier click and cancelled armed modifier clicks never leak selection toggles',async()=>{
    for(const collab of [false,true]) for(const mode of ['locked','pointercancel','Escape']) {
      await setup({mode:'production',collab,subject:{x:400,y:250,width:100,height:80,locked:mode==='locked'},targets:[{id:'other',x:650,y:250,width:100,height:80}]});
      const p=await screen(402,290),q=await screen(652,290);
      await mouse('mousePressed',...p,1,8);
      if(mode==='pointercancel') await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))`);
      if(mode==='Escape') await key('Escape');
      await mouse('mouseReleased',...p,1,8);
      if(mode==='locked')assert.deepEqual((await snapshot()).editor.selected,[],'locked toggle applied immediately');
      await click(...q);assert.deepEqual((await snapshot()).editor.selected,['other']);assert.equal((await snapshot()).undo,0);
    }
  });
  await check('P1 resize context guard cancels identical keyframe switches and complete selection changes, including same-tick return',async()=>{
    for(const collab of [false,true]) for(const change of ['slide','slide-return','add','add-return','add-locked']) {
      await setup({mode:'production',collab,secondSlide:true,subject:{x:400,y:250,width:100,height:80},targets:[{id:'other',x:600,y:250,width:100,height:80},{id:'extra',x:800,y:250,width:100,height:80,locked:change==='add-locked'}]});
      await select(['subject','other']);const before=await evaluate(`structuredClone(canvasTest.store.getState().presentation.slides)`),p=await resizeHandle('bottom-right');
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+40,p[1]+25,1,10);
      assert(await evaluate(`!!document.querySelector('.content-layer[data-gesture-preview]')`));
      if(change.startsWith('slide')) await evaluate(`(()=>{const e=canvasTest.editor.getState(),original=e.activeSlideId;e.setActiveSlide('other');${change==='slide-return'?"e.setActiveSlide(original)":""}})()`);
      else await evaluate(`(()=>{const e=canvasTest.editor.getState();e.setSelectedElements(['subject','other','extra']);${change==='add-return'?"e.setSelectedElements(['subject','other'])":""}})()`);
      await wait(70);assert.equal(await evaluate(`document.querySelectorAll('.content-layer[data-gesture-preview]').length`),0);
      await mouse('mouseReleased',p[0]+40,p[1]+25,1,10);assert.equal((await snapshot()).undo,0);
      assert.deepEqual(await evaluate(`canvasTest.store.getState().presentation.slides`),before,'neither keyframe mutated');
    }
  });
  await check('actual stationary Cmd resize bypass and restoration; pointercancel aborts without undo',async()=>{
    for(const collab of [false,true]) {
      await setup({mode:'production',collab,snap:true,subject:{x:400,y:200,width:120,height:60},targets:[{id:'target',x:640,y:500,width:100,height:80}]});
      const before=await snapshot(),p=await resizeHandle('middle-right');
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+118,p[1]);
      const width=()=>evaluate(`+document.querySelector('.content-layer [data-element-id="subject"] rect').getAttribute('width')`);
      near(await width(),240);await mods('keyDown','Meta',4);near(await width(),238);assert((await guides()).hidden||(await guides()).markers===0);
      await mods('keyUp','Meta',0);near(await width(),240);
      await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))`);await wait(60);assert.equal(await evaluate(`document.querySelectorAll('.content-layer[data-gesture-preview]').length`),0);
      await mouse('mouseReleased',p[0]+118,p[1]);assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,0);
    }
  });
  await check('actual stationary Shift body-axis and Cmd magnet toggles replay raw pointer before JSON/Yjs commit',async()=>{
    for(const collab of [false,true]) {
      await setup({mode:'production',collab,snap:true,subject:{x:400,y:250,width:100,height:80},targets:[{id:'target',x:620,y:600,width:100,height:80}]});
      const before=await snapshot(),p=await screen(402,290),q=await screen(520,320);
      await mouse('mousePressed',...p);await mouse('mouseMoved',...q);
      const xy=()=>evaluate(`(()=>{const r=document.querySelector('.content-layer [data-element-id="subject"] rect');return [+r.getAttribute('x'),+r.getAttribute('y')]})()`);
      assert.deepEqual(await xy(),[520,280]);await mods('keyDown','Shift',8);assert.deepEqual(await xy(),[520,250]);
      await mods('keyDown','Meta',12);assert.deepEqual(await xy(),[518,250]);await mods('keyUp','Meta',8);assert.deepEqual(await xy(),[520,250]);
      await mods('keyUp','Shift',0);assert.deepEqual(await xy(),[520,280]);await mouse('mouseReleased',...q);
      const after=await snapshot();near(after.slide.elements.subject.x,520);near(after.slide.elements.subject.y,280);assert.equal(after.undo,1);
      await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
  });
  assert.deepEqual(runtimeErrors,[]); console.log('ALL MODIFIER BROWSER CHECKS PASSED');
} finally {ws.close();}
