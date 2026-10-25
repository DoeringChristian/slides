import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/gesture-action-bar.browser.mjs
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
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
const near = (actual, expected, message = '') => assert(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);
async function screen(x,y) { return evaluate(`(() => { const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(); return [m.a*${x}+m.c*${y}+m.e,m.b*${x}+m.d*${y}+m.f]; })()`); }
async function select(ids) { await evaluate(`canvasTest.editor.getState().setSelectedElements(${JSON.stringify(ids)})`); await wait(60); }


const evidence=process.env.ACTION_BAR_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-gesture-action-bar`;
await mkdir(evidence, { recursive: true });
const actions='button[title="Lock"],button[title="Unlock"],button[title="Crop"],button[title="Change image"],button[title="Hide from slide (Del)"]';
async function bars() {return evaluate(`Array.from(document.querySelectorAll('button[title="Lock"],button[title="Unlock"]')).map(b=>{const box=b.parentElement.getBoundingClientRect(),outer=b.parentElement.parentElement.parentElement;return {x:box.x,y:box.y,w:box.width,h:box.height,left:+parseFloat(outer.style.left),top:+parseFloat(outer.style.top),width:+parseFloat(outer.style.width),height:+parseFloat(outer.style.height),transform:outer.style.transform}})`);}
async function assertRestored(count) {
  const actual=await bars();assert.equal(actual.length,count);
  const expected=await evaluate(`(async()=>{const {elementVisualBounds}=await import('/src/utils/shapeVisualBounds.ts');const {CANVAS_PADDING}=await import('/src/utils/constants.ts');const e=canvasTest.editor.getState(),s=canvasTest.snapshot().slide;return s.elementOrder.filter(id=>e.selectedElementIds.includes(id)&&s.elements[id].visible).map(id=>{const el=s.elements[id],b=elementVisualBounds(el),c={x:b.x+b.width/2,y:b.y+b.height/2};return {left:(c.x+CANVAS_PADDING)*e.zoom,top:(c.y+CANVAS_PADDING)*e.zoom,width:b.width*e.zoom,height:b.height*e.zoom,rotation:el.rotation}})})()`);
  expected.forEach((exp,i)=>{for(const name of ['left','top','width','height'])assert(Math.abs(actual[i][name]-exp[name])<.02,`${name}: ${actual[i][name]} != ${exp[name]}`);assert(Math.abs(+actual[i].transform.match(/rotate\(([-.\d]+)deg\)/)[1]-exp.rotation)<.02,'rotation follows selection geometry');});
  return actual;
}
async function assertAbsent() {
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(actions)}).length`),0,'all native actions removed, not merely transparent');
  assert(await evaluate(`window.oldActions.every(node=>!node.isConnected)`),'previous action nodes detached');
  assert(await evaluate(`window.oldActionCenters.every(([x,y])=>!document.elementFromPoint(x,y)?.closest(${JSON.stringify(actions)}))`),'no stale native hit targets');
}
async function rememberActions() {await evaluate(`window.oldActions=Array.from(document.querySelectorAll(${JSON.stringify(actions)}));window.oldActionCenters=window.oldActions.map(n=>{const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]});void 0`);}
async function captureShot(name){await writeFile(`${evidence}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
async function configure(kind,collab) {
  const path=['endpoint','midpoint','tangent','extension'].includes(kind);
  await setup({mode:'production',collab,secondSlide:true,zoom:.8,subject:{x:400,y:250,width:200,height:120,fill:'#5599bb',...(kind==='image'?{type:'image',cropX:0,cropY:0,cropWidth:100,cropHeight:100}:{}),...(path?{shapeType:'path',points:[0,0,200,100],curve:'bezier',tangents:[-30,-20,30,20,-30,-20,30,20],endHead:'triangle',rotation:25}: {})},targets:kind==='group'?[{id:'other',x:650,y:250,width:120,height:100,fill:'#ddaa44'}]:[]});
  if(kind==='group')await select(['subject','other']);
}
async function acquire(kind) {
  if(kind==='resize')return center('[data-resize-handle="bottom-right"] [data-resize-visual]');
  if(kind==='rotate')return center('[data-rotation-visual]');
  if(kind==='radius')return center('.corner-radius-handle circle');
  if(kind==='midpoint')return center('.path-handles > g:nth-of-type(1) circle:last-child');
  if(['endpoint','tangent'].includes(kind)){
    const p=await center('.path-handles > g:nth-of-type(2) circle:last-child');
    if(kind==='tangent'){await mouse('mouseMoved',...p);return center('.tangent-handles g:last-child circle:last-child');}
    return p;
  }
  return screen(430,285);
}
try {
  await send('Page.enable');await send('Runtime.discardConsoleEntries');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(1600);
  for(const collab of [false,true]) {
    await check(`actions hide for every manipulation, restore final/original geometry, JSON/Yjs=${collab}`,async()=>{
      for(const kind of ['body','image','group','resize','rotate','endpoint','midpoint','tangent','radius'])for(const finish of ['release','Escape','pointercancel']) {
        console.log('CASE',collab,kind,finish);
        await configure(kind,collab);
        const count=kind==='group'?2:1,before=await snapshot(),beforeBars=await assertRestored(count),p=await acquire(kind),q=[p[0]+45,p[1]+30];
        assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(actions)}).length`),kind==='image'?4:count*2);
        if(kind==='image'&&finish==='release')await captureShot(`before-image-${collab}`);
        await rememberActions();await mouse('mousePressed',...p);
        if(['body','image','group'].includes(kind)){
          await mouse('mouseMoved',p[0]+1,p[1]+1);assert.deepEqual(await bars(),beforeBars,'armed/subslop leaves normal actions intact');
        }
        await mouse('mouseMoved',...q);await assertAbsent();assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,0);
        // Captured native movement through the old action region must remain a gesture.
        const old=await evaluate('window.oldActionCenters[0]');await mouse('mouseMoved',...old);await assertAbsent();await mouse('mouseMoved',...q);
        if(kind==='image'&&finish==='release'){await captureShot(`hidden-image-${collab}`);}
        if(finish==='Escape')await key('Escape');
        if(finish==='pointercancel')await evaluate(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))`);
        const escapeDeselected=finish==='Escape'&&['body','image','group'].includes(kind);
        if(finish!=='release'){await wait(60);if(escapeDeselected){assert.deepEqual((await snapshot()).editor.selected,[]);await assertAbsent();}else{await assertRestored(count);assert.deepEqual(await bars(),beforeBars,'cancel restores original coordinates before late release');}}
        await mouse('mouseReleased',...q);await wait(80);
        const after=await snapshot(),afterBars=await assertRestored(escapeDeselected?0:count);
        assert.equal(after.undo,finish==='release'?1:0,kind+'/'+finish);
        if(finish!=='release'){assert.deepEqual(after.slide,before.slide);if(escapeDeselected){await select(before.editor.selected);await assertRestored(count);assert.deepEqual(await bars(),beforeBars,'Escape reselect restores original bar location');}else assert.deepEqual(afterBars,beforeBars);}
        else if(['body','image','group'].includes(kind))afterBars.forEach((b,i)=>{near(b.x-beforeBars[i].x,45);near(b.y-beforeBars[i].y,30);});
        if(kind==='image'&&finish==='release')await captureShot(`restored-image-${collab}`);
      }
    });
    await check(`slide/selection invalidation cannot leave invisible actions or commit late, collab=${collab}`,async()=>{
      for(const kind of ['body','resize','rotate','endpoint','tangent','radius','group'])for(const change of ['slide-return','selection-return']) {
        await configure(kind,collab);const ids=kind==='group'?['subject','other']:['subject'],before=await snapshot(),p=await acquire(kind),beforeBars=await bars();
        if(kind==='image'&&finish==='release')await captureShot(`before-image-${collab}`);
        await rememberActions();await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+30,p[1]+20);await assertAbsent();
        if(change==='slide-return')await evaluate(`(()=>{const e=canvasTest.editor.getState(),id=e.activeSlideId;e.setActiveSlide('other');e.setActiveSlide(id);e.setSelectedElements(${JSON.stringify(ids)})})()`);
        else await evaluate(`canvasTest.editor.getState().setSelectedElements([]);canvasTest.editor.getState().setSelectedElements(${JSON.stringify(ids)})`);
        await wait(80);await assertRestored(ids.length);assert.deepEqual(await bars(),beforeBars);
        await mouse('mouseReleased',p[0]+30,p[1]+20);assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,0);
      }
    });
    await check(`extension hides actions until commit/cancel; ordinary lock/delete remain native, collab=${collab}`,async()=>{
      for(const finish of ['commit','Escape']){
        await configure('extension',collab);const before=await snapshot(),old=await bars();await rememberActions();
        await click(...await center('[aria-label="Extend end"]'));await wait(80);await assertAbsent();
        await mouse('mouseMoved',...await screen(750,450));await assertAbsent();
        if(finish==='commit'){await click(...await screen(750,450));await key('Enter');}else await key('Escape');
        await wait(80);await assertRestored(1);assert.equal((await snapshot()).undo,finish==='commit'?1:0);
        if(finish==='Escape'){assert.deepEqual((await snapshot()).slide,before.slide);assert.deepEqual(await bars(),old);}
      }
      await configure('body',collab);const p=await acquire('body'),old=await bars();await mouse('mousePressed',...p);await mouse('mouseReleased',...p);assert.deepEqual(await bars(),old);assert.equal((await snapshot()).undo,0);
      await click(...await center('button[title="Lock"]'));assert.equal((await snapshot()).slide.elements.subject.locked,true);
      await click(...await center('button[title="Unlock"]'));assert.equal((await snapshot()).slide.elements.subject.locked,false);
      await click(...await center('button[title="Hide from slide (Del)"]'));assert.equal((await snapshot()).slide.elements.subject.visible,false);assert.equal((await bars()).length,0);
    });
  }
  assert.deepEqual(runtimeErrors,[]);console.log('ALL GESTURE ACTION BAR BROWSER CHECKS PASSED');
} finally {ws.close();}
