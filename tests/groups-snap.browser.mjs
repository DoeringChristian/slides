import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas.browser.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page');
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') console.error('BROWSER ERROR', JSON.stringify(msg.params.exceptionDetails));
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
async function drag(x, y, ex, ey) { await mouse('mousePressed', x, y); await mouse('mouseMoved', ex, ey); await mouse('mouseReleased', ex, ey); }
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
const absPoints = el => el.points.map((v, i) => v + (i % 2 ? el.y : el.x));
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
async function slidePoint(x, y) {
  return evaluate(`(() => { const m=document.querySelector('.svg-background').getScreenCTM(); const p=new DOMPoint(${x},${y}).matrixTransform(m); return [p.x,p.y]; })()`);
}
const markers = () => evaluate(`Array.from(document.querySelectorAll('.snap-destination')).filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>({x:+e.getAttribute('cx'),y:+e.getAttribute('cy'),r:+e.getAttribute('r'),pointer:getComputedStyle(e).pointerEvents}))`);
async function setupGroup(collab) {
  await setup({mode:'slides', collab});
  await evaluate(`(() => { const s=canvasTest.store.getState(); for(let i=0;i<4;i++) s.addSlide(); const order=canvasTest.doc ? canvasTest.doc.getMap('presentation').get('slideOrder').toArray() : canvasTest.store.getState().presentation.slideOrder; window.groupIds=order; s.groupSlides(order); s.toggleSlideHidden(order[2]); canvasTest.editor.getState().setActiveSlide(order[0]); canvasTest.editor.getState().setSelectedSlides([order[0]]); })()`);
  await wait(150);
  await evaluate('canvasTest.getActiveUndoManager()?.clear(); canvasTest.store.temporal.getState().clear()');
}
const deck = () => evaluate('structuredClone(canvasTest.store.getState().presentation)');
async function clickSlide(id, modifiers=0) {
  const selector=`[data-slide-id="${id}"]`;
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
  const p=await center(selector); await mouse('mousePressed',...p,1,modifiers); await mouse('mouseReleased',...p,1,modifiers);
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width:1100,height:850,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate); await wait(1500);
  assert(await evaluate('!!window.canvasTest'));
  await check('production SlidePanel local folding, hidden/active navigation, multi-select and no deck/undo mutation JSON/Yjs', async () => {
    for(const collab of [false,true]) {
      await setupGroup(collab);
      const before=await deck(), ids=before.slideOrder;
      await click(...await center('[data-slide-group]'));
      assert.equal(await evaluate('document.querySelectorAll("[data-slide-id]").length'),1);
      assert.match(await evaluate('document.querySelector("[data-slide-group]").textContent'),/5 slides.*active/);
      assert.equal((await snapshot()).undo,0); assert.deepEqual(await deck(),before);
      await evaluate('canvasTest.editor.getState().setActiveSlide(groupIds[2]); canvasTest.editor.getState().setSelectedSlides([groupIds[2]])'); await wait(80);
      assert.equal(await evaluate('document.querySelector("[data-slide-id]").dataset.slideId'),ids[2]);
      assert(await evaluate(`!!document.querySelector('button[title="Show slide"]')`),'persistently hidden member remains navigable');
      await click(...await center('[data-slide-group]'));
      await clickSlide(ids[0]); await clickSlide(ids[3],8);
      assert.deepEqual(await evaluate('canvasTest.editor.getState().selectedSlideIds'),ids.slice(0,4));
      await click(...await center('[data-slide-group]'));
      assert.match(await evaluate('document.querySelector("[data-slide-group]").textContent'),/4 selected/);
      assert.deepEqual(await deck(),before);
      const shot=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-groups-folded-${collab}.png`,Buffer.from(shot.data,'base64'));
    }
  });
  await check('production SlidePanel FIRST removal, split-before, context controls, singleton and undo JSON/Yjs', async () => {
    for(const collab of [false,true]) {
      await setupGroup(collab); const before=await deck(),ids=before.slideOrder;
      assert(await evaluate(`document.querySelector('[aria-label="Split group before active slide"]').disabled`));
      await click(...await center('[aria-label="Remove active slide from group"]'));
      let after=await deck(); assert.equal(after.slides[ids[0]].groupId,undefined); assert.equal(new Set(ids.slice(1).map(id=>after.slides[id].groupId)).size,1);
      assert.deepEqual(after.slideOrder,ids); assert.equal((await snapshot()).undo,1);
      for(const id of ids) { const {groupId:a,...x}=after.slides[id],{groupId:b,...y}=before.slides[id]; assert.deepEqual(x,y); }
      await evaluate('canvasTest.getActiveUndoManager() ? canvasTest.getActiveUndoManager().undo() : canvasTest.store.temporal.getState().undo()'); await wait(80);
      assert.deepEqual(await deck(),before);
      await clickSlide(ids[2]);
      await click(...await center('[aria-label="Split group before active slide"]'));
      after=await deck(); assert.equal(after.slides[ids[0]].groupId,after.slides[ids[1]].groupId); assert.equal(after.slides[ids[2]].groupId,after.slides[ids[4]].groupId); assert.notEqual(after.slides[ids[1]].groupId,after.slides[ids[2]].groupId);
      const p=await center(`[data-slide-id="${ids[2]}"]`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p[0],y:p[1],button:'right',buttons:2,clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p[0],y:p[1],button:'right',buttons:0,clickCount:1}); await wait(60);
      assert(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Remove slide from group')`));
      assert(await evaluate(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='Ungroup')`));
      await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Remove slide from group').click()`); await wait(80);
      assert.equal((await deck()).slides[ids[2]].groupId,undefined);
      await clickSlide(ids[0]); await click(...await center('[aria-label="Remove active slide from group"]'));
      after=await deck(); assert.equal(after.slides[ids[1]].groupId,undefined); assert.deepEqual(after.slideOrder,ids);
    }
  });
  await check('production SlidePanel drag sorting still works with folded run',async()=>{
    await setupGroup(false);
    const ids=(await deck()).slideOrder;
    await evaluate('canvasTest.store.getState().ungroupSlides([groupIds[0]]); canvasTest.store.getState().groupSlides(groupIds.slice(1,4))'); await wait(60);
    await click(...await center('[data-slide-group]'));
    const from=await center(`[data-slide-id="${ids[4]}"]`),to=await center(`[data-slide-id="${ids[0]}"]`);
    await mouse('mousePressed',...from); await mouse('mouseMoved',from[0],from[1]-10); await mouse('mouseMoved',...to); await mouse('mouseReleased',...to);
    assert.equal((await deck()).slideOrder[0],ids[4]);
  });
  await check('FULL production Shift-only creation markers: eight rays, zoom, Cmd and free pointer', async () => {
    for(const zoom of [.5,1,2]) for(const degrees of [0,45,90,135,180,225,270,315]) {
      await setup({mode:'production',empty:true,tool:'arrow',snap:false,zoom});
      const origin={x:400,y:240},angle=(degrees+1)*Math.PI/180;
      const raw={x:origin.x+60*Math.cos(angle),y:origin.y+60*Math.sin(angle)};
      const a=await slidePoint(origin.x,origin.y),b=await slidePoint(raw.x,raw.y);
      await mouse('mousePressed',...a);await mouse('mouseMoved',...b);assert.equal((await markers()).length,0);
      await mouse('mouseMoved',...b,1,8);const m=await markers();assert.equal(m.length,1);
      const guide=await evaluate(`(() => {const e=document.querySelector('.alignment-guides line');return [+e.getAttribute('x2'),+e.getAttribute('y2')];})()`);
      assert.deepEqual([m[0].x,m[0].y],guide);assert.equal(m[0].r*zoom,4);assert.equal(m[0].pointer,'none');
      assert(Math.abs(m[0].x-(origin.x+60*Math.cos(degrees*Math.PI/180)))<.1);
      assert(Math.abs(m[0].y-(origin.y+60*Math.sin(degrees*Math.PI/180)))<.1);
      await mouse('mouseMoved',...b,1,12);assert.equal((await markers()).length,1,'Cmd does not disable Shift');
      await mouse('mouseMoved',...b);assert.equal((await markers()).length,0);
      await mouse('mouseReleased',...b);const p=absPoints((await snapshot()).slide.elements[(await snapshot()).slide.elementOrder.at(-1)]);
      assert(Math.abs(p[2]-raw.x)<.1);assert(Math.abs(p[3]-raw.y)<.1);
      assert.equal((await snapshot()).editor.tool,'select');
    }
  });
  await check('FULL production Shift extension and control-point markers; no passive angular attraction', async () => {
    for(const end of ['start','end']) {
      await setup({mode:'production',subject:{shapeType:'path',points:[0,0,100,0,160,60],width:160,height:60}});
      await click(...await center(`[aria-label="Extend ${end}"]`));
      const target=end==='end'?[320,162]:[40,102],p=await slidePoint(...target);
      await mouse('mouseMoved',...p);assert.equal((await markers()).length,0);
      await mouse('mouseMoved',...p,1,8);const m=await markers();assert.equal(m.length,1);
      await mouse('mousePressed',...p,1,8);await mouse('mouseReleased',...p,1,8);await key('Enter','Enter',8);
      const el=(await snapshot()).slide.elements.subject,pts=absPoints(el),point=end==='end'?pts.slice(-2):pts.slice(0,2);
      assert(Math.abs(point[0]-m[0].x)<1e-6);assert(Math.abs(point[1]-m[0].y)<1e-6);
    }
    for(const idx of [0,1,2]) {
      await setup({mode:'production',subject:{shapeType:'path',points:[0,0,100,0,160,60],width:160,height:60}});
      const origin=idx===0?[100,100]:idx===1?[200,100]:[260,160];
      const target=idx===0?[140,102]:idx===1?[160,102]:[260,102],p=await slidePoint(...target);
      await mouse('mousePressed',...await slidePoint(...origin));await mouse('mouseMoved',...p);assert.equal((await markers()).length,0);
      await mouse('mouseMoved',...p,1,8);assert.equal((await markers()).length,1,`Shift vertex ${idx}`);
      await mouse('mouseMoved',...p,1,12);assert.equal((await markers()).length,1);
      await mouse('mouseMoved',...p);assert.equal((await markers()).length,0);
      await mouse('mouseReleased',...p);const pts=absPoints((await snapshot()).slide.elements.subject);
      assert(Math.abs(pts[idx*2]-target[0])<1e-6);assert(Math.abs(pts[idx*2+1]-target[1])<1e-6);
    }
  });
  await check('FULL production endpoint editing and both extension ends use winning alignment destination at every zoom',async()=>{
    for(const zoom of [.5,1,2]) for(const mode of ['edit','start','end']) {
      await setup({mode:'production',zoom,snap:true,
        subject:{shapeType:'path',x:350,y:200,points:[0,0,100,0],width:100,height:1},
        targets:[{id:'reference',x:500,y:400,width:100,height:50}]});
      if(mode==='edit') await mouse('mousePressed',...await slidePoint(450,200));
      else await click(...await center(`[aria-label="Extend ${mode}"]`));
      await mouse('mouseMoved',...await slidePoint(502,290));
      const m=await markers(); assert.equal(m.length,1,`${zoom}/${mode}`);
      assert.equal(m[0].x,500); assert.equal(m[0].y,290); assert.equal(m[0].r*zoom,4);
      if(mode==='edit') await mouse('mouseReleased',...await slidePoint(502,290));
      else { await click(...await slidePoint(502,290)); await key('Enter'); }
      const points=absPoints((await snapshot()).slide.elements.subject);
      assert.deepEqual(mode==='start'?points.slice(0,2):points.slice(-2),[500,290]);
      assert.equal((await markers()).length,0);
    }
  });
  await check('FULL production canvas winning alignment point, immediate Cmd, leave, pointercancel',async()=>{
    await setup({mode:'production',empty:true,tool:'arrow',snap:true,targets:[{id:'reference',x:250,y:300,width:100,height:50}]});
    await click(...await slidePoint(100,100)); await mouse('mouseMoved',...await slidePoint(252,190));
    let m=await markers(); assert.equal(m.length,1); assert.equal(m[0].x,250); assert.equal(m[0].y,190);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Meta',code:'MetaLeft',windowsVirtualKeyCode:91,modifiers:4}); await wait(40);
    assert.equal((await markers()).length,0);
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Meta',code:'MetaLeft',windowsVirtualKeyCode:91});
    await mouse('mouseMoved',...await slidePoint(252,190)); assert.equal((await markers()).length,1);
    await mouse('mouseMoved',1120,870); assert.equal((await markers()).length,0);
    await mouse('mouseMoved',...await slidePoint(252,190)); assert.equal((await markers()).length,1);
    const shot=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-snap-destination.png`,Buffer.from(shot.data,'base64'));
    await evaluate(`document.querySelector('.alignment-guides').ownerSVGElement.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}))`); await wait(40);
    assert.equal((await markers()).length,0);
  });
  console.log('ALL GROUPS/SNAP PRODUCTION BROWSER CHECKS PASSED');
} finally {ws.close();}
