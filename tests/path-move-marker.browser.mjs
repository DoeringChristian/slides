import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/path-move-marker.browser.mjs
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
async function paintedRectPoint(id) { return evaluate(`(()=>{const el=canvasTest.snapshot().slide.elements[${JSON.stringify(id)}],m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();const x=el.x+2/canvasTest.editor.getState().zoom,y=el.y+el.height/2;return [m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];})()`); }
async function modifier(type, keyName='Meta', modifiers=type==='keyDown'?4:0) {
  await send('Input.dispatchKeyEvent',{type,key:keyName,code:keyName+'Left',windowsVirtualKeyCode:keyName==='Shift'?16:keyName==='Meta'?91:17,modifiers}); await wait(60);
}
async function guides() { return evaluate(`(() => { const g=document.querySelector('.alignment-guides'); return {hidden:g.getAttribute('visibility')==='hidden',markers:g.querySelectorAll('.snap-destination').length,html:g.outerHTML}; })()`); }
async function capture() { return evaluate(`Array.from(document.querySelectorAll('svg, svg *')).some(e=>e.hasPointerCapture?.(1))`); }
async function highlighted() { return evaluate(`!!document.querySelector('.ui-layer [data-connector-highlight]')`); }
const bindingTargets = [{id:'left',x:260,y:240,width:160,height:120},{id:'right',x:700,y:240,width:160,height:120}];
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(1500);
  const only=process.env.ONLY;
  if (!only || only==='move') await check('production rigid multi move, actual path body, negative vertices, curves, rotation, JSON/Yjs undo/redo',async()=>{
    for (const collab of [false,true]) for (const curve of ['linear','smooth','bezier']) for (const rotation of [0,37]) for (const driver of ['subject','target']) {
      await setup({mode:'production',collab,zoom:.5,subject:{x:700,y:300,shapeType:'path',points:curve==='linear'?[-100,-70,200,100]:[-100,-70,80,140,200,100],width:300,height:210,rotation,curve,endHead:'triangle',fill:'transparent',...(curve==='bezier'?{tangents:[0,0,40,-90,-30,-60,40,0,-30,40,0,0]}:{})},targets:[{id:'target',x:350,y:300,width:150,height:120}]});
      await select(['subject','target']);
      const before=await snapshot(), vertices=await world();
      // Click the actual rendered shaft, not the union of mismatched input/visual boxes.
      const p=driver==='target'?await paintedRectPoint('target'):await evaluate(`(() => { const el=document.querySelector('[data-element-id="subject"] path[stroke]'); const p=el.getPointAtLength(el.getTotalLength()*.4); const m=el.getScreenCTM(); return [m.a*p.x+m.c*p.y+m.e,m.b*p.x+m.d*p.y+m.f]; })()`);
      await mouse('mousePressed',...p); await mouse('mouseMoved',p[0]+43,p[1]+27);
      assert(await capture(),'capture retained during body drag');
      await mouse('mouseReleased',p[0]+43,p[1]+27);
      const after=await snapshot(), moved=await world();
      moved.forEach((v,i)=>near(v-vertices[i],i%2?54:86,`${collab}/${curve}/${rotation}/${driver} vertex ${i}`));
      near(after.slide.elements.target.x-before.slide.elements.target.x,86); near(after.slide.elements.target.y-before.slide.elements.target.y,54);
      assert.deepEqual(after.slide.elements.subject.points,before.slide.elements.subject.points);
      assert.deepEqual(after.slide.elements.subject.tangents,before.slide.elements.subject.tangents);
      assert.equal(after.undo,1); assert.deepEqual(after.editor.selected,['subject','target']);
      await key('z','KeyZ',2); assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
      await key('y','KeyY',2); assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
    const shot=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/path-move-after.png`,Buffer.from(shot.data,'base64'));
  });
  if (!only || only==='bindings') await check('co-moving aim/pinned bindings retained, stationary/locked targets detach, single JSON/Yjs history entry',async()=>{
    for(const collab of [false,true]) for(const mode of ['aim','pinned']) for(const targets of ['both','one','locked']) for(const driver of ['subject','left']) {
      const pinned=mode==='pinned';
      const startBinding={elementId:'left',mode,...(pinned?{fixedPoint:[1,.5]}:{fixedPoint:[.4,.4],gap:10})};
      const endBinding={elementId:'right',mode,...(pinned?{fixedPoint:[0,.5]}:{fixedPoint:[.4,.4],gap:10})};
      await setup({mode:'production',collab,zoom:.7,subject:{x:pinned?420:430,y:300,shapeType:'path',points:[0,0,pinned?280:260,0],width:pinned?280:260,height:0,startBinding,endBinding,endHead:'triangle'},targets:bindingTargets.map(t=>({...t,locked:targets==='locked'&&t.id==='right'}))});
      await select(targets==='one'?['subject','left']:['subject','left','right']);
      const before=await snapshot(), vertices=await world();
      const p=driver==='subject'?await center('[data-element-id="subject"]'):await paintedRectPoint(driver); await drag(...p,p[0]+42,p[1]+28);
      const after=await snapshot(), moved=await world(); moved.forEach((v,i)=>near(v-vertices[i],i%2?40:60));
      assert.deepEqual(after.slide.elements.subject.startBinding,startBinding);
      assert.deepEqual(after.slide.elements.subject.endBinding,targets==='both'?endBinding:null);
      near(after.slide.elements.left.x-before.slide.elements.left.x,60);
      near(after.slide.elements.right.x-before.slide.elements.right.x,targets==='both'?60:0);
      assert.equal(after.undo,1); await key('z','KeyZ',2); assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
      await key('y','KeyY',2); assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
  });
  if (!only || only==='rigid') await check('off-axis creation bindings: rigid preview/commit, repeated moves and undo/redo, both/one/locked targets and either driver',async()=>{
    for(const collab of [false,true]) for(const targets of ['both','one','locked']) for(const driver of ['subject','left']) {
      // Explicit normalized aim payload.
      const fixture=await evaluate(`(async()=>{
        const {bindingFor,resolveBinding}=await import('/src/utils/connectorUtils.ts');
        const {createShapeElement}=await import('/src/utils/slideFactory.ts');
        const targets=[createShapeElement('rect',{id:'left',x:0,y:0,width:100,height:100,cornerRadius:0}),createShapeElement('rect',{id:'right',x:200,y:0,width:100,height:100,cornerRadius:0})];
        const startBinding=bindingFor({x:95,y:20},targets[0],'aim');
        const endBinding=bindingFor({x:205,y:80},targets[1],'aim');
        const a=resolveBinding(startBinding,targets[0],{x:205,y:80}),z=resolveBinding(endBinding,targets[1],{x:95,y:20});
        const b={startBinding,endBinding,absPoints:[a.x,a.y,z.x,z.y]};
        return {targets,subject:{shapeType:'path',x:b.absPoints[0],y:b.absPoints[1],width:100,height:b.absPoints[3]-b.absPoints[1],points:[0,0,100,b.absPoints[3]-b.absPoints[1]],startBinding:b.startBinding,endBinding:b.endBinding,endHead:'triangle'}};
      })()`);
      assert.deepEqual(fixture.subject.startBinding.fixedPoint,[.95,.2]); assert.deepEqual(fixture.subject.endBinding.fixedPoint,[.05,.8]);
      near(fixture.subject.y,250/11); near(fixture.subject.y+fixture.subject.height,850/11);
      await setup({mode:'production',collab,zoom:1,snap:false,...fixture,targets:fixture.targets.map(t=>({...t,locked:targets==='locked'&&t.id==='right'}))});
      await select(targets==='one'?['subject','left']:['subject','left','right']);
      for(let move=0;move<3;move++) {
        const before=await snapshot(),vertices=await world();
        const p=driver==='left'?await paintedRectPoint('left'):await evaluate(`(() => { const el=document.querySelector('[data-element-id="subject"] path[stroke]'); const m=el.getScreenCTM(); for(const t of [.25,.4,.6,.75]) { const p=el.getPointAtLength(el.getTotalLength()*t); const x=Math.round(m.a*p.x+m.c*p.y+m.e), y=Math.round(m.b*p.x+m.d*p.y+m.f); if(document.elementFromPoint(x,y)?.closest('[data-element-id]')?.getAttribute('data-element-id')==='subject') return [x,y]; } throw new Error('No exposed shaft hit'); })()`);
        p[0]=Math.round(p[0]); p[1]=Math.round(p[1]);
        await mouse('mousePressed',...p); await mouse('mouseMoved',p[0]+60,p[1]+40);
        const preview=await evaluate(`document.querySelector('.content-layer [data-element-id="subject"]').innerHTML`);
        assert.notEqual(preview, '');
        assert.equal((await snapshot()).undo, move, 'preview is display-only');
        await mouse('mouseReleased',p[0]+60,p[1]+40);
        const after=await snapshot(),moved=await world();
        assert.equal(await evaluate(`document.querySelector('.content-layer [data-element-id="subject"]').innerHTML`),preview,'full styled preview equals commit');
        moved.forEach((v,i)=>near(v-vertices[i],i%2?40:60,`${collab}/${targets}/${driver}/${move} rigid translation ${i}`));
        assert.deepEqual(after.slide.elements.subject.points,before.slide.elements.subject.points);
        assert.deepEqual(after.slide.elements.subject.startBinding,fixture.subject.startBinding);
        assert.deepEqual(after.slide.elements.subject.endBinding,targets==='both'?fixture.subject.endBinding:null);
        near(after.slide.elements.left.x-before.slide.elements.left.x,60);
        near(after.slide.elements.right.x-before.slide.elements.right.x,targets==='both'?60:0);
        assert.equal(after.undo,move+1);
        await key('z','KeyZ',2); assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
        await key('y','KeyY',2); assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
      }
    }
  });
  if (!only || only==='markers') await check('physical viewport suppresses captured create/endpoint/interior guides; geometry keeps following; release/cancel/scroll/zoom',async()=>{
    for(const collab of [false,true]) for(const zoom of [.5,1,2]) for(const kind of ['create','endpoint','interior']) for(const finish of ['release','cancel','pointercancel']) {
      await setup({mode:'production',collab,zoom,empty:kind==='create',tool:kind==='create'?'line':'select',snap:true,subject:{x:480,y:270,shapeType:'path',points:[-100,0,0,0,100,0],width:200,height:1,fill:'transparent'}});
      const before=await snapshot();
      const p=kind==='create'?[550,420]:await screen(kind==='endpoint'?580:480,270);
      await mouse('mousePressed',...p,1,8); await mouse('mouseMoved',800,p[1]+1,1,8);
      let g=await guides(); assert(g.markers>0&&!g.hidden,`${kind} inside markers`); assert(await capture());
      await mouse('mouseMoved',1120,p[1]+1,1,8); g=await guides(); assert(g.markers>0&&g.hidden,'captured outside scrollport suppressed'); assert(await capture());
      const outside=g.html; await mouse('mouseMoved',1160,p[1]+1,1,8); assert.notEqual((await guides()).html,outside,'geometry/guides continue outside');
      await mouse('mouseMoved',800,p[1]+1,1,8); assert(!(await guides()).hidden,'reentry restores');
      // Scroll with held pointer; bounds are read afresh, no capture loss.
      await evaluate(`document.querySelector('.canvas-scroll-parent').scrollLeft+=30`); await wait(60);
      await mouse('mouseMoved',810,p[1]+1,1,8); assert(!(await guides()).hidden); assert(await capture());
      if(finish==='cancel') await key('Escape','Escape',8);
      if(finish==='pointercancel') await evaluate(`(() => { const target=Array.from(document.querySelectorAll('svg,svg *')).find(e=>e.hasPointerCapture?.(1)); target.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true,shiftKey:true})); })()`);
      await mouse('mouseReleased',810,p[1]+1,1,8);
      g=await guides(); assert(g.hidden||g.markers===0,'no stale markers after finish');
      const after=await snapshot(); assert.equal(after.undo,finish==='release'?1:0);
      if(finish!=='release') assert.deepEqual(after.slide.elements,before.slide.elements);
    }
  });
  if (!only || only==='shift') await check('Cmd raw placement, stationary toggle, edge/deep targets, extension/opposite binding, JSON/Yjs',async()=>{
    for(const collab of [false,true]) for(const tool of ['line','arrow','polygon']) for(const depth of [5,30]) for(const finishMeta of [false,true]) {
      await setup({mode:'production',collab,zoom:1,empty:true,tool,snap:true,targets:bindingTargets});
      const start=await screen(415,300), end=await screen(700+depth,310);
      await modifier('keyDown');
      if(tool==='polygon') { await mouse('mousePressed',...start,1,4); await mouse('mouseReleased',...start,1,4); }
      else await mouse('mousePressed',...start,1,4);
      await mouse('mouseMoved',...end,1,4);
      assert((await guides()).hidden||(await guides()).markers===0);
      // No movement between modifier changes: release restores target, held finish removes it again.
      await modifier('keyUp');
      assert(await highlighted(),'stationary release restores target highlight');
      if(finishMeta) await modifier('keyDown');
      if(finishMeta) assert(!(await highlighted()),'stationary Cmd clears target highlight');
      if(tool==='polygon') await key('Enter','Enter',finishMeta?4:0);
      else await mouse('mouseReleased',...end,1,finishMeta?4:0);
      const s=await snapshot(),el=lastShape(s); assert.equal(el.shapeType,'path'); assert.equal(s.undo,1);
      if(finishMeta) { assert.equal(el.startBinding,null); assert.equal(el.endBinding,null); const pts=await world(el.id); near(pts[0],415); near(pts[1],300); near(pts.at(-2),700+depth); near(pts.at(-1),310); }
      else { assert.equal(el.startBinding?.mode,'aim'); assert.equal(el.endBinding?.mode,'aim'); }
      await modifier('keyUp'); await key('z','KeyZ',2); assert.equal((await snapshot()).slide.elementOrder.length,2);
      await key('y','KeyY',2); assert.deepEqual(lastShape(await snapshot()),el);
    }
    for(const collab of [false,true]) for(const operation of ['endpoint','extension']) for(const endName of ['start','end']) for(const finishMeta of [true,false]) {
      const opposite={elementId:'left',mode:'pinned',fixedPoint:[1,.5]};
      await setup({mode:'production',collab,zoom:1,snap:true,subject:{x:420,y:300,shapeType:'path',points:[0,0,140,0],width:140,height:1,[endName==='end'?'startBinding':'endBinding']:opposite},targets:bindingTargets});
      const before=await snapshot(), dest=await screen(730,310);
      if(operation==='extension') { await evaluate(`canvasTest.editor.getState().beginPathExtension('subject','${endName}')`); await wait(60); }
      else { const p=await screen(endName==='end'?560:420,300); await mouse('mousePressed',...p); }
      await mouse('mouseMoved',...dest); await modifier('keyDown');
      assert((await guides()).hidden||(await guides()).markers===0);
      assert(!(await highlighted()),'editing/extension Cmd clears target highlight');
      if(!finishMeta) { await modifier('keyUp'); assert(await highlighted()); }
      if(operation==='extension') await key('Enter','Enter',finishMeta?4:0);
      else await mouse('mouseReleased',...dest,1,finishMeta?4:0);
      const after=await snapshot(),el=after.slide.elements.subject;
      assert.deepEqual(el[endName==='end'?'startBinding':'endBinding'],opposite,'untouched binding retained');
      assert.equal(el[endName==='end'?'endBinding':'startBinding']?.mode??null,finishMeta?null:'aim');
      if(finishMeta) { const pts=await world(); near(pts[endName==='end'?pts.length-2:0],730); near(pts[endName==='end'?pts.length-1:1],310); }
      assert.equal(after.undo,1); await modifier('keyUp'); await key('z','KeyZ',2); assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
      await key('y','KeyY',2); assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
  });
  if(!only || only==='modifiers') await check('Shift explicitly constrains angle even with Cmd; Meta binding suppression and stationary guide restoration preserved',async()=>{
    for(const collab of [false,true]) for(const operation of ['create','endpoint']) {
      await setup({mode:'production',collab,empty:operation==='create',tool:operation==='create'?'arrow':'select',zoom:1,snap:true,
        subject:{x:420,y:300,shapeType:'path',width:140,height:1,points:[0,0,140,0]},targets:bindingTargets});
      const p=await screen(operation==='create'?500:560,300),dest=await screen(731,319);
      await mouse('mousePressed',...p); await mouse('mouseMoved',...dest);
      await modifier('keyDown','Meta',4); await modifier('keyDown','Shift',12);
      await mouse('mouseReleased',...dest,1,12);
      const el=operation==='create'?lastShape(await snapshot()):(await snapshot()).slide.elements.subject;
      const points=await world(el.id); near(Math.atan2(points.at(-1)-points[1],points.at(-2)-points[0])*180/Math.PI,0); assert.equal(el.endBinding,null);
      await modifier('keyUp','Shift',4); await modifier('keyUp','Meta',0);
    }
    await setup({mode:'production',empty:true,tool:'line',snap:true,zoom:1});
    await mouse('mousePressed',550,420); await mouse('mouseMoved',750,422);
    assert.equal((await guides()).markers,0,'no passive angle magnet');
    await modifier('keyDown','Shift',8);assert((await guides()).markers>0&&!(await guides()).hidden);
    await modifier('keyDown','Meta',12);assert((await guides()).markers>0,'Cmd preserves explicit Shift');
    await modifier('keyUp','Meta',8);assert((await guides()).markers>0);
    await modifier('keyUp','Shift',0);assert.equal((await guides()).markers,0);
    await key('Escape'); await mouse('mouseReleased',750,422); assert.equal((await snapshot()).undo,0);
    for(const collab of [false,true]) {
      await setup({mode:'production',collab,empty:true,tool:'arrow',zoom:1,targets:bindingTargets});
      const start=await screen(415,300),end=await screen(730,310);
      await mouse('mousePressed',...start); await mouse('mouseMoved',...end);
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Meta',code:'MetaLeft',modifiers:4}); await wait(50);
      assert(!(await highlighted())); await mouse('mouseReleased',...end,1,4);
      const el=lastShape(await snapshot()); assert.equal(el.startBinding,null); assert.equal(el.endBinding,null);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Meta',code:'MetaLeft',modifiers:0});
    }
  });
  if(!only || only==='tolerance') await check('production creation/edit/extension screen-pixel acquisition at .25/.5/1/2/4, rotated target',async()=>{
    for(const zoom of [.25,.5,1,2,4]) for(const operation of ['create','endpoint','extension']) for(const offset of [31,33,-11,-13]) for(const dock of [false,true]) {
      const rotation=37,a=rotation*Math.PI/180;
      // Ordinary aim is explicitly away from all side-midpoint pins.
      const tangent=dock?0:70;
      const point=px=>[500+(200+px/zoom)*Math.cos(a)-tangent*Math.sin(a),270+(200+px/zoom)*Math.sin(a)+tangent*Math.cos(a)];
      const start=point(150),destination=point(offset),surface=point(0);
      const collab=offset===31||offset===-13;
      await setup({mode:'production',collab,zoom,empty:operation==='create',tool:operation==='create'?'arrow':'select',snap:false,
        subject:{x:start[0],y:start[1],width:30/zoom,height:1,shapeType:'path',points:[-30/zoom,0,0,0]},
        targets:[{id:'target',x:300,y:70,width:400,height:400,rotation}]});
      const p=await screen(...surface);
      await evaluate(`(() => { const s=document.querySelector('.canvas-scroll-parent'); s.scrollLeft+=${p[0]-550}; s.scrollTop+=${p[1]-425}; })()`); await wait(40);
      const from=await screen(...start),to=await screen(...destination);
      if(operation==='extension') { await evaluate(`canvasTest.editor.getState().beginPathExtension('subject','end')`); await wait(40); }
      else await mouse('mousePressed',...from);
      await mouse('mouseMoved',...to);
      assert.equal(await highlighted(),offset<=32,`${operation}/${zoom}/${offset} highlight acquisition`);
      if(operation==='extension') await key('Enter'); else await mouse('mouseReleased',...to);
      const state=await snapshot(),el=operation==='create'?lastShape(state):state.slide.elements.subject;
      assert.equal(el.endBinding?.mode??null,offset===33?null:dock&&offset>=0&&offset/zoom<=16?'pinned':'aim',`${operation}/${zoom}/${offset}/dock=${dock} binding mode`);
      if(el.endBinding?.mode==='aim') assert.equal(el.endBinding.gap,0,'new aim attachments end at the border');
      assert.equal(state.undo,1);
    }
  });
  if(!only || only==='lifecycle') await check('cold StrictMode tool/slide switch lifecycle is runtime-error-free',async()=>{
    for(const collab of [false,true]) {
      await setup({mode:'production',collab,secondSlide:true});
      for(const tool of ['line','arrow','polygon','bspline','select']) {
        await evaluate(`canvasTest.editor.getState().setTool('${tool}')`); await wait(40);
        await click(650,400); await mouse('mouseMoved',800,450); await key('Escape');
        await evaluate(`canvasTest.editor.getState().setActiveSlide('other')`); await wait(40);
        await evaluate(`canvasTest.editor.getState().setActiveSlide(canvasTest.store.getState().presentation.slideOrder[0])`); await wait(40);
      }
    }
  });
  assert.deepEqual(runtimeErrors,[],'no cold-load or interaction runtime exceptions');
  console.log('PATH MOVE / MARKER CHECKS PASSED');
} finally { ws.close(); }
