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
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function check(name, run) { await run(); console.log(`PASS ${name}`); }


try {
  await mkdir(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-milestone1`, { recursive: true });
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate); await wait(1200);
  for (const collab of [false,true]) {
    await check(`${collab?'Yjs':'JSON'} click empty focused typing and one commit`, async () => {
      await setup({mode:'production',empty:true,tool:'text',collab});
      await click(400,250); await wait(250);
      let snap=await snapshot(); let el=lastShape(snap);
      assert.equal(el.text,''); assert.equal(el.textSizing,'auto-content'); assert.equal(snap.editor.tool,'select');
      assert(await evaluate(`document.activeElement?.isContentEditable`));
      await send('Input.insertText',{text:'Hello canvas'}); await wait(250);
      const live = await evaluate(`(() => { const e=document.querySelector('[contenteditable]'); return {width:e.parentElement.getBoundingClientRect().width,paths:e.parentElement.querySelectorAll('path').length}; })()`);
      assert(live.width>100); assert(live.paths>0);
      await key('Escape'); await wait(250);
      snap=await snapshot(); el=lastShape(snap);
      assert.equal(el.text,'Hello canvas'); assert.equal(snap.undo,2); assert(el.width>100);
      const id=el.id;
      await evaluate(`canvasTest.editor.getState().setEditingTextId(${JSON.stringify(id)})`); await wait(250);
      await key('Escape'); await wait(150); assert.equal((await snapshot()).undo,2);
      await evaluate(`canvasTest.editor.getState().setEditingTextId(${JSON.stringify(id)})`); await wait(250);
      await send('Input.insertText',{text:'!'}); await wait(100);
      await evaluate(`document.querySelector('[contenteditable]').blur()`); await key('Escape'); await wait(200);
      assert.equal(lastShape(await snapshot()).text,'Hello canvas!'); assert.equal((await snapshot()).undo,3);
      await evaluate(`canvasTest.getActiveUndoManager()?.undo() ?? canvasTest.store.temporal.getState().undo()`); await wait(100);
      assert.equal(lastShape(await snapshot()).text,'Hello canvas');
    });
    await check(`${collab?'Yjs':'JSON'} drag width raw multiline and empty creation finish`,async()=>{
      await setup({mode:'production',empty:true,tool:'text',collab});
      await drag(400,250,550,310); await wait(250);
      assert.equal(lastShape(await snapshot()).text,'');
      await send('Input.insertText',{text:'one two three four five six seven eight nine ten'}); await wait(180);
      await key('Enter'); await send('Input.insertText',{text:'second line'}); await wait(180);
      await key('Escape'); await wait(200);
      const el=lastShape(await snapshot()); assert.equal(el.textSizing,'user-width'); assert.equal(el.width,150); assert(el.height>90); assert(el.text.includes('\nsecond line')); assert(!el.text.includes('Double-click'));
      await setup({mode:'production',empty:true,tool:'text',collab}); await click(400,250); await wait(250); await key('Escape'); await wait(180);
      assert.equal(Object.values((await snapshot()).slide.elements).filter(e=>e.visible).length,0);
    });
  }
  for (const collab of [false,true]) await check(`${collab?'Yjs':'JSON'} same-ID slide switch cleanup and bound finish`,async()=>{
    const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'left',verticalAlign:'top',lineHeight:1.2};
    await setup({mode:'production',collab,secondSlide:true,subject:{type:'text',text:'original',textSizing:'auto-content',style}});
    const sid=(await snapshot()).slide.id;
    await evaluate(`canvasTest.editor.getState().setEditingTextId('subject')`); await wait(250);
    await send('Input.insertText',{text:' edited'}); await wait(120);
    await evaluate(`canvasTest.editor.getState().setActiveSlide('other')`); await wait(300);
    assert.equal((await snapshot()).slide.elements.subject.text,'original');
    assert.equal(await evaluate(`canvasTest.store.getState().presentation.slides[${JSON.stringify(sid)}].elements.subject.text`),'original edited');
    await setup({mode:'production',collab,subject:{x:100,y:100,width:200,height:70}});
    await evaluate(`(() => { const s=canvasTest.snapshot().slide; import('/src/utils/syncDependents.ts').then(({createBoundLabel})=> {const e=createBoundLabel(s.elements.subject);canvasTest.store.getState().addElement(s.id,e);canvasTest.editor.getState().setEditingTextId(e.id);}); })()`); await wait(400);
    const before=(await snapshot()).undo;
    await send('Input.insertText',{text:'a long bound label that grows when the content is accepted'}); await wait(150);
    await key('Escape'); await wait(400);
    assert.equal((await snapshot()).undo,before+1);
  });
  await check('rotation/zoom glyph and caret share exactly one local transform; multiline LaTeX source preservation',async()=>{
    for(const zoom of [.5,1,2])for(const rotation of [30,90]){
      await setup({mode:'production',zoom,subject:{type:'text',text:'Hello',x:100,y:100,width:200,height:60,rotation,style:{fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'left',verticalAlign:'top',lineHeight:1.2}}});
      await evaluate(`canvasTest.editor.getState().setEditingTextId('subject')`); await wait(300);
      const metrics=await evaluate(`(() => { const e=document.querySelector('[contenteditable]'); const o=e.parentElement; const g=o.querySelector('svg > g:not([data-text-auto-fit])'); if(!g) throw new Error('Missing editing glyph renderer'); const range=document.createRange(); const line=e.querySelector('[data-line]'); range.setStart(line.firstChild,line.textContent.length); range.collapse(true); const r=range.getBoundingClientRect();return {outer:o.style.transform,inner:g.getAttribute('transform'),paths:g.querySelectorAll('path').length,caret:{x:r.x,y:r.y,h:r.height,w:r.width},input:e.getBoundingClientRect().toJSON()}; })()`);
      assert.equal(metrics.outer,`rotate(${rotation}deg)`); assert.equal(metrics.inner,null); assert(metrics.paths>0); assert(Math.hypot(metrics.caret.h,metrics.caret.w)>0);
      await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-milestone1/rotation-${zoom}-${rotation}.json`,JSON.stringify(metrics,null,2));
      const png=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-milestone1/rotation-${zoom}-${rotation}.png`,Buffer.from(png.data,'base64'));
    }
    await setup({mode:'production',empty:true,tool:'text'}); await click(400,250); await wait(250);
    await evaluate(`(() => { const e=document.querySelector('[contenteditable]'); const dt=new DataTransfer(); dt.setData('text/plain','Hello\\n$\\\\sqrt{x}$'); e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:dt})); })()`);
    await wait(200); await key('Escape'); await wait(600);
    assert(lastShape(await snapshot()).text.includes('sqrt'));
    assert(await evaluate(`document.querySelectorAll('.canvas-scroll-parent svg path').length>0`));
  });
  const final=await snapshot(); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-milestone1/final.json`,JSON.stringify(final,null,2));
  const png=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-milestone1/final.png`,Buffer.from(png.data,'base64'));
  await check('LaTeX glyphs survive the shared layout and canvas renderer',async()=>{
    const math=await evaluate(`(async()=>{const {layoutSvgText}=await import('/src/utils/textLayout.ts');const s=canvasTest.snapshot().slide;const el=s.elements[s.elementOrder.at(-1)];const doc=await layoutSvgText(el.text,el.style,el.width-28);return {mathPaths:doc.paths.filter(p=>p.lineIndex===1).length,paintedPaths:document.querySelectorAll('.canvas-scroll-parent svg path').length};})()`);
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-milestone1/math-glyph-smoke.json`,JSON.stringify({base,...math},null,2));
    assert(math.mathPaths>=2,'expected SVG math glyphs, not only preserved LaTeX source');
    assert(math.paintedPaths>=7);
  });
  assert.equal(runtimeErrors.length,0,JSON.stringify(runtimeErrors));
} finally { ws.close(); }
