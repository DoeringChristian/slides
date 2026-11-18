import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Free text: the font size and the box are one quantity, pinned by the
// alignment — a font-size change scales the box like a corner resize, and
// centred text stays centred (in its box, and about the same point).
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
// Screen rects of the box (stored geometry) and of the drawn glyphs.
const measure = () => evaluate(`(()=>{const svg=document.querySelector('.canvas-scroll-parent svg');const m=svg.getScreenCTM();
  const e=canvasTest.snapshot().slide.elements.subject;
  const g=document.querySelector('.content-layer [data-element-id="subject"]');
  const rs=[...g.querySelectorAll('path')].map(p=>p.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
  const gx0=Math.min(...rs.map(r=>r.left)),gx1=Math.max(...rs.map(r=>r.right));
  return {va:e.style.verticalAlign,box:{x0:m.a*e.x+m.e,x1:m.a*(e.x+e.width)+m.e,y0:m.d*e.y+m.f,y1:m.d*(e.y+e.height)+m.f},glyphs:{x0:gx0,x1:gx1},e:{x:e.x,y:e.y,w:e.width,h:e.height,fs:e.style.fontSize}}})()`);
const fontSize = v => evaluate(`(async()=>{const {updateElementFromCurrent}=await import('/src/store/currentMutation.ts');const e=canvasTest.snapshot().slide.elements.subject;
  updateElementFromCurrent(canvasTest.editor.getState().activeSlideId,e,c=>({style:{...c.style,fontSize:${v}}}))})()`);
try {
  await send('Runtime.enable');
  await waitForCanvasFixture(evaluate);
  const base = await evaluate(`(async()=>(await import('/src/utils/model/slideFactory.ts')).createTextElement().style)()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const collab of [false, true]) for (const sizing of ['auto-content', 'user-width']) for (const align of ['left', 'center', 'right']) {
    await setup({ mode: 'production', collab, subject: { type: 'text', text: 'Hello world\nhi', x: 300, y: 200, width: 400, height: 80, textSizing: sizing, style: { ...base, fontSize: 32, align } } });
    await wait(400);
    // Fit the box to its text first (as typing does): finish an edit.
    await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/text/userTextSizing.ts');const e=canvasTest.snapshot().slide.elements.subject;
      const s=await measureUserText(e);canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',s)})()`); await wait(300);
    const a = await measure();
    await evaluate('canvasTest.getActiveUndoManager()?.stopCapturing(); canvasTest.store.temporal.getState().clear()');
    await fontSize(64); await wait(500);
    await evaluate('canvasTest.getActiveUndoManager()?.stopCapturing()');
    const b = await measure();
    const tag = `${collab ? 'yjs' : 'json'} ${sizing} ${align}`;
    // The box scales with the font (×2) …
    assert.ok(Math.abs(b.e.w - 2 * a.e.w) < 1e-6 && Math.abs(b.e.h - 2 * a.e.h) < 1e-6, `${tag}: box scales with the font ${JSON.stringify([a.e, b.e])}`);
    // … pinned where the alignment pins it …
    const pin = e => align === 'left' ? e.x : align === 'right' ? e.x + e.w : e.x + e.w / 2;
    const vpin = e => a.va === 'top' ? e.y : a.va === 'bottom' ? e.y + e.h : e.y + e.h / 2;
    assert.ok(Math.abs(pin(b.e) - pin(a.e)) < 1e-6 && Math.abs(vpin(b.e) - vpin(a.e)) < 1e-6, `${tag}: pinned by its alignment ${JSON.stringify([a.va, a.e, b.e])}`);
    // … and the text is aligned within it (glyphs within 3% of the box width).
    for (const { box, glyphs } of [a, b]) {
      const tol = (box.x1 - box.x0) * 0.03 + 2;
      const off = align === 'left' ? glyphs.x0 - box.x0 : align === 'right' ? box.x1 - glyphs.x1 : (glyphs.x0 + glyphs.x1) / 2 - (box.x0 + box.x1) / 2;
      assert.ok(Math.abs(off) <= tol, `${tag}: text is ${align}-aligned in its box (off ${off.toFixed(1)}px) ${JSON.stringify({ box, glyphs })}`);
    }
    // One undo step restores font and box together.
    await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo()})()`); await wait(300);
    const u = (await measure()).e;
    assert.deepEqual([u.fs, u.x, u.w], [32, a.e.x, a.e.w], `${tag}: one undo step restores both`);
  }
  console.log('PASS font size scales the text box, pinned by alignment, text aligned in it; one undo step');
  // Typing: an auto-sized box grows around where its alignment pins it.
  for (const collab of [false, true]) for (const align of ['left', 'center', 'right']) {
    await setup({ mode: 'production', collab, subject: { type: 'text', text: 'Hi', x: 300, y: 200, width: 40, height: 40, textSizing: 'auto-content', style: { ...base, fontSize: 32, align, verticalAlign: 'top' } } });
    await wait(300);
    await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/text/userTextSizing.ts');const e=canvasTest.snapshot().slide.elements.subject;
      canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',await measureUserText(e))})()`); await wait(200);
    const a = (await measure()).e;
    await evaluate(`canvasTest.editor.getState().setSelectedElements(['subject'])`); await wait(100);
    await evaluate(`canvasTest.editor.getState().setEditingTextId('subject')`); await wait(50);
    await evaluate(`new Promise(r=>{const t=Date.now();(function w(){document.querySelector('[contenteditable]')||Date.now()-t>3000?r():setTimeout(w,50)})()})`);
    await evaluate(`(()=>{const ed=document.querySelector('[contenteditable]');const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
    await send('Input.insertText', { text: ' there, everyone' }); await wait(300);
    const live = await evaluate(`(()=>{const r=document.querySelector('[contenteditable]').parentElement.getBoundingClientRect();const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:(r.left-m.e)/m.a,w:r.width/m.a}})()`);
    await evaluate(`document.querySelector('[contenteditable]').blur()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(400);
    const b = (await measure()).e;
    const pin = e => align === 'left' ? e.x : align === 'right' ? e.x + e.w : e.x + e.w / 2;
    assert.ok(b.w > a.w * 2, `${align}: the box grew with the text ${JSON.stringify([a, b])}`);
    assert.ok(Math.abs(pin(b) - pin(a)) < 0.5 && Math.abs(b.y - a.y) < 0.5, `${align} (${collab ? 'yjs' : 'json'}): typing grows the box around its ${align} ${JSON.stringify([a, b])}`);
    assert.ok(Math.abs(pin({ x: live.x, w: live.w }) - pin(a)) < 2, `${align}: the editor grows the same way while typing ${JSON.stringify([a, live])}`);
  }
  // A content change with the Constant easing: the box animates between the
  // two contents' sizes, but the text must neither be revealed glyph by
  // glyph (clipped to the growing box — a typewriter look) nor slide off its
  // anchor. Render real interpolated frames on the canvas.
  for (const align of ['left', 'center', 'right']) {
    await setup({ mode: 'production', subject: { type: 'text', text: 'Hi', x: 300, y: 200, width: 40, height: 40, textSizing: 'auto-content', style: { ...base, fontSize: 32, align, verticalAlign: 'top' } } });
    await wait(300);
    const frames = await evaluate(`(async()=>{const {measureUserText}=await import('/src/utils/text/userTextSizing.ts');const {interpolateElement}=await import('/src/utils/animation/interpolation.ts');
      const e=canvasTest.snapshot().slide.elements.subject;const a={...e,...await measureUserText(e)};
      const long={...a,text:'Hello there, everyone'};const sb=await measureUserText(long);
      const pin=${JSON.stringify(align)}==='left'?a.x:${JSON.stringify(align)}==='right'?a.x+a.width:a.x+a.width/2;
      const k=${JSON.stringify(align)}==='left'?0:${JSON.stringify(align)}==='right'?1:.5;
      const b={...long,...sb,x:pin-sb.width*k,transitions:{content:'const'}};
      return {pin,b,frames:[.25,.75].map(t=>interpolateElement(a,b,t,true))}})()`);
    for (const frame of frames.frames) {
      await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',${JSON.stringify({ text: frame.text, x: frame.x, width: frame.width, height: frame.height })})`); await wait(300);
      const m = await measure();
      const clipped = await evaluate(`!!document.querySelector('.content-layer [data-element-id="subject"] [clip-path]')`);
      const slidePin = await evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return m.a*${frames.pin}+m.e})()`);
      const at = align === 'left' ? m.glyphs.x0 : align === 'right' ? m.glyphs.x1 : (m.glyphs.x0 + m.glyphs.x1) / 2;
      assert.ok(!clipped, `${align}: content-sized text is not clipped to its animating box`);
      assert.ok(Math.abs(at - slidePin) < 4, `${align} "${frame.text}" mid-transition stays at its ${align} anchor (${(at - slidePin).toFixed(1)}px off)`);
    }
  }
  console.log('PASS a Constant content change shows whole text at its anchor while the box animates');
  assert.deepEqual(runtimeErrors, [], 'no runtime errors');
  console.log('PASS typing grows an auto-sized text box around where its alignment pins it, live and committed');
} finally { ws.close(); }
