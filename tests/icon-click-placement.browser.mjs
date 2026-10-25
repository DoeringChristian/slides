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
async function touchDrag(x,y,ex,ey) {
  for (const [type,points] of [['touchStart',[{x,y}]],['touchMove',[{x:ex,y:ey}]],['touchEnd',[]]]) {
    await send('Input.dispatchTouchEvent',{type,touchPoints:points}); await wait(40);
  }
}
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
// Exercise the production padded/scrolled SVG, not the simplified drawing fixture.
async function production(config = {}) {
  await setup({ mode:'production', empty:true, tool:'icon', ...config });
  await evaluate(`(() => {const p=document.querySelector('.canvas-scroll-parent'); p.style.margin='47px 0 0 63px'; p.style.width='900px'; p.style.height='700px'; p.scrollLeft+=91; p.scrollTop+=57;})()`);
  await wait(80);
}
async function slidePoint(x,y) {
  return evaluate(`(() => {const svg=document.querySelector('.canvas-scroll-parent svg'), p=svg.createSVGPoint();p.x=${x};p.y=${y};const q=p.matrixTransform(svg.getScreenCTM().inverse());return {x:q.x,y:q.y};})()`);
}
async function assertPlacement(x,y,expectedUndo=1,epsilon=1e-6) {
  await wait(80);
  const p=await slidePoint(x,y),snap=await snapshot(),el=lastShape(snap);
  assert.equal(snap.slide.elementOrder.length,1);assert.equal(snap.undo,expectedUndo);
  assert.equal(snap.editor.tool,'select');assert.deepEqual(snap.editor.selected,[el.id]);
  assert.equal(el.width,64);assert.equal(el.height,64);
  assert(Math.abs(el.x-(p.x-32))<epsilon,JSON.stringify({el,p}));assert(Math.abs(el.y-(p.y-32))<epsilon);
  return el;
}
try {
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(1600);
  await evaluate('canvasTest.resetPreferences()');
  await check('stationary icon press: native Ctrl/Cmd wheel zoom, scroll/offset transforms, preview/release agreement JSON/Yjs',async()=>{
    const evidence=[];
    for(const collab of [false,true])for(const modifiers of [2,4])for(const initialZoom of [.5,1,2]){
      await production({collab,zoom:initialZoom});
      await evaluate(`(async()=>{const {useCreationPreferences:p}=await import('/src/store/creationPreferences.ts');p.getState().chooseIcon('plus');})()`);
      await mouse('mousePressed',421,363);
      await evaluate(`window.iconZoomMoves=0;window.iconZoomOnMove=()=>window.iconZoomMoves++;window.addEventListener('pointermove',window.iconZoomOnMove)`);
      await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:421,y:363,button:'none',buttons:1,modifiers,deltaX:0,deltaY:-120});await wait(160);
      const zoom=await evaluate('canvasTest.editor.getState().zoom');assert(zoom>initialZoom);
      const preview=()=>evaluate(`(()=>{const path=document.querySelector('.ui-layer path[stroke-linecap="round"]');if(!path)throw Error('missing icon preview');const b=path.getBBox(),p=path.ownerSVGElement.createSVGPoint();p.x=b.x+b.width/2;p.y=b.y+b.height/2;const q=p.matrixTransform(path.getScreenCTM());return {x:q.x,y:q.y,d:path.getAttribute('d')};})()`);
      const wheelPreview=await preview();
      // Scroll and layout offsets also change the mapping without a pointer event.
      await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent');p.scrollLeft+=37;p.scrollTop+=29;p.style.marginLeft='81px';p.style.width='860px';})()`);await wait(160);
      const transformedPreview=await preview(),before=await snapshot();
      assert.equal(before.undo,0);assert.equal(before.slide.elementOrder.length,0);
      const moves=await evaluate('window.iconZoomMoves');
      await evaluate(`window.removeEventListener('pointermove',window.iconZoomOnMove)`);
      await mouse('mouseReleased',421,363,1,modifiers);await wait(80);
      const snap=await snapshot(),el=lastShape(snap),point=await slidePoint(421,363);
      const row={collab,modifiers,initialZoom,zoom,moves,wheelPreview,transformedPreview,point,element:el};evidence.push(row);
      await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-icon-zoom/wheel-evidence.json`,JSON.stringify(evidence,null,2));
      for(const candidate of [wheelPreview,transformedPreview]){assert(Math.abs(candidate.x-421)<.05&&Math.abs(candidate.y-363)<.05,JSON.stringify(row));}
      assert.equal(moves,0,'no intervening pointermove, including browser-generated events');
      // SVG CTMs reflect fractional CSS size quantization at wheel zoom levels.
      await assertPlacement(421,363,1,.05);
      const committedD=await evaluate(`document.querySelector('.content-layer path[stroke-linecap="round"]').getAttribute('d')`);
      assert.equal(committedD,transformedPreview.d,'last visible preview is the committed native geometry');
      await key('z','KeyZ',4);assert.equal((await snapshot()).slide.elementOrder.length,0);
      await key('z','KeyZ',12);assert.deepEqual(lastShape(await snapshot()),el);
    }
    for(const collab of [false,true])for(const reason of ['escape','tool','slide','blur','pointercancel']){
      await production({collab,secondSlide:true});await mouse('mousePressed',421,363);
      await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:421,y:363,button:'none',buttons:1,modifiers:2,deltaX:0,deltaY:100});await wait(100);
      if(reason==='escape')await key('Escape');
      if(reason==='tool')await evaluate(`(()=>{const e=canvasTest.editor.getState();e.setTool('rect');e.setTool('icon');})()`);
      if(reason==='slide')await evaluate(`(()=>{const e=canvasTest.editor.getState(),id=e.activeSlideId;e.setActiveSlide('other');e.setActiveSlide(id);})()`);
      if(reason==='blur')await evaluate(`window.dispatchEvent(new Event('blur'))`);
      if(reason==='pointercancel')await evaluate(`document.querySelector('.canvas-scroll-parent svg').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'}))`);
      await wait(80);await mouse('mouseReleased',421,363);await wait(80);
      assert.equal((await snapshot()).undo,0,reason);assert.equal((await snapshot()).slide.elementOrder.length,0,reason);
      assert(!await evaluate(`!!document.querySelector('.ui-layer path[stroke-linecap="round"]')`),'cancelled preview cannot be revived by viewport replay');
    }
    await evaluate('canvasTest.resetPreferences()');
  });
  await check('production mouse and touch clicks at zoom .5/1/2 and scrolled offsets: fixed centered box, selection, one undo/redo JSON/Yjs',async()=>{
    for(const collab of [false,true])for(const zoom of [.5,1,2])for(const touch of [false,true]){
      await production({collab,zoom});
      if(touch){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:421,y:363}]});await wait(40);assert.equal((await snapshot()).undo,0);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      else {await mouse('mousePressed',421,363);assert.equal((await snapshot()).undo,0);await mouse('mouseReleased',421,363);}
      const el=await assertPlacement(421,363);
      await key('z','KeyZ',4);assert.equal((await snapshot()).slide.elementOrder.length,0);
      await key('z','KeyZ',12);assert.deepEqual(lastShape(await snapshot()),el);
      console.log(`  collab=${collab} zoom=${zoom} touch=${touch} center=421,363`);
    }
  });
  await check('rapid consecutive placements and adjacent edits have independent undo entries, JSON/Yjs',async()=>{
    for(const collab of [false,true]){
      await production({collab});await click(400,350);
      const first=lastShape(await snapshot());
      await evaluate(`canvasTest.editor.getState().setTool('icon')`);await wait(30);await click(500,450);
      let snap=await snapshot();assert.equal(snap.slide.elementOrder.length,2);assert.equal(snap.undo,2);
      const second=lastShape(snap);
      await key('z','KeyZ',4);snap=await snapshot();assert.deepEqual(snap.slide.elementOrder,[first.id]);assert.deepEqual(snap.slide.elements[first.id],first);
      await key('z','KeyZ',12);assert.deepEqual(lastShape(await snapshot()),second);
      await production({collab});await click(400,350);
      const placed=lastShape(await snapshot());
      await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,${JSON.stringify(placed.id)},{stroke:'#123456'})`);await wait(50);
      assert.equal((await snapshot()).undo,2);await key('z','KeyZ',4);assert.deepEqual(lastShape(await snapshot()),placed);
    }
  });
  await check('large mouse/touch motion places once at release, Shift never stretches; actual styled shared-renderer preview',async()=>{
    await evaluate(`(async()=>{const {useCreationPreferences:p}=await import('/src/store/creationPreferences.ts');p.getState().chooseIcon('sun');p.getState().remember('icon',{fill:'#ff000080',stroke:'#0000ff40',strokeWidth:4,fillStyle:'crosshatch',width:900,height:800});p.getState().remember('rect',{fill:'#00ff0080'});})()`);
    const prefs=await evaluate('JSON.stringify(canvasTest.preferences())');
    for(const collab of [false,true])for(const touch of [false,true]){
      await production({collab});
      if(touch) await touchDrag(210,240,611,533);
      else {
        await mouse('mousePressed',210,240);await mouse('mouseMoved',500,460,1,8);
        assert.equal((await snapshot()).undo,0);assert.equal((await snapshot()).slide.elementOrder.length,0);
        assert(await evaluate(`!!document.querySelector('svg path[stroke-linecap="round"]')`));
        await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-icon-click/preview-${collab}.png`,Buffer.from(r.data,'base64')));
        // Deliberately no move at this position: pointerup must use its OWN coordinates.
        await mouse('mouseReleased',611,533,1,8);
      }
      const el=await assertPlacement(611,533);
      assert.equal(el.geometry.provenance.icon,'sun');assert.equal(el.fill,'#ff000080');assert.equal(el.stroke,'#0000ff40');assert.equal(el.strokeWidth,4);assert.equal(el.fillStyle,'crosshatch');
      assert.equal(await evaluate('JSON.stringify(canvasTest.preferences())'),prefs);
      await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-icon-click/placed-${collab}-${touch}.png`,Buffer.from(r.data,'base64')));
    }
  });
  await check('escape, pointercancel, blur, context menu, tool/slide switches and outside/overlay release cancel without history JSON/Yjs',async()=>{
    for(const collab of [false,true])for(const reason of ['escape','pointercancel','blur','contextmenu','tool','slide','outside','overlay']){
      await production({collab,secondSlide:true});
      await mouse('mousePressed',400,350);await mouse('mouseMoved',450,400);
      if(reason==='escape')await key('Escape');
      if(['blur','contextmenu'].includes(reason))await evaluate(`window.dispatchEvent(new Event('${reason}'))`);
      if(reason==='pointercancel')await evaluate(`document.querySelector('.canvas-scroll-parent svg').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'}))`);
      if(reason==='tool')await evaluate(`(()=>{const e=canvasTest.editor.getState();e.setTool('rect');e.setTool('icon');})()`);
      if(reason==='slide')await evaluate(`(()=>{const e=canvasTest.editor.getState(),id=e.activeSlideId;e.setActiveSlide('other');e.setActiveSlide(id);})()`);
      if(reason==='overlay')await evaluate(`(()=>{const b=document.createElement('button');b.id='reference-overlay';b.style='position:fixed;left:420px;top:380px;width:100px;height:80px;z-index:9999';document.body.append(b)})()`);
      await mouse('mouseReleased',reason==='outside'?1100:450,400);
      console.log(`  cancellation collab=${collab} reason=${reason}`);
      assert.equal((await snapshot()).slide.elementOrder.length,0,reason);assert.equal((await snapshot()).undo,0,reason);
      await evaluate(`document.querySelector('#reference-overlay')?.remove()`);
    }
    // Native touch cancellation also uses the production pointercancel path.
    await production();await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:400,y:350}]});await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await wait(60);
    assert.equal((await snapshot()).undo,0);assert.equal((await snapshot()).slide.elementOrder.length,0);
  });
  await check('overlay presses never create; ordinary rectangle still drag-creates; Cmd bypasses icon center magnets while Shift preserves fixed size',async()=>{
    await production();
    await evaluate(`(()=>{const b=document.createElement('button');b.id='reference-overlay';b.style='position:fixed;left:420px;top:380px;width:100px;height:80px;z-index:9999';document.body.append(b)})()`);
    await click(450,400);assert.equal((await snapshot()).undo,0);assert.equal((await snapshot()).slide.elementOrder.length,0);
    await evaluate(`document.querySelector('#reference-overlay').remove()`);
    for(const collab of [false,true]){
      await production({tool:'rect',collab});await drag(250,250,470,350);
      let el=lastShape(await snapshot());assert.equal(el.shapeType,'rect');assert.equal(el.width,220);assert.equal(el.height,100);assert.equal(el.fill,'#00ff0080');
      await production({snap:true,collab});
      const p=await slidePoint(450,400);
      await evaluate(`canvasTest.store.getState().addElement(canvasTest.editor.getState().activeSlideId,{id:'magnet',type:'shape',shapeType:'rect',x:${p.x+3},y:${p.y-100},width:80,height:80,rotation:0,opacity:1,locked:false,visible:true,fill:'',stroke:'#000',strokeWidth:1,cornerRadius:0})`);await wait(80);
      await mouse('mousePressed',450,400,1,8);await mouse('mouseReleased',450,400,1,8);await wait(60);
      el=lastShape(await snapshot());assert(Math.abs(el.x-(p.x+3-32))<1e-6,'center magnet active with Shift');
      await key('z','KeyZ',4);assert((await snapshot()).slide.elements.magnet,'undo placement retains earlier target');await evaluate(`canvasTest.editor.getState().setTool('icon')`);await wait(60);
      await mouse('mousePressed',450,400,1,12);await mouse('mouseReleased',450,400,1,12);await wait(60);
      el=lastShape(await snapshot());assert.equal(el.width,64);assert.equal(el.height,64);assert(Math.abs(el.x-(p.x-32))<1e-6);
    }
  });
  await evaluate('canvasTest.resetPreferences()');
  console.log('PASS icon click placement production suite');
} finally {ws.close();}
