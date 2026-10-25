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
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, a: 65 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, commands: modifiers === 4 && key === 'a' ? ['selectAll'] : undefined, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });

}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function check(name, run) { await run(); console.log(`PASS ${name}`); }

// Native key events (not textContent assignment or Input.insertText).
const evidence = process.env.TYPING_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-typing-repair/focused`;
async function type(text, delay = 0) {
  for (const char of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
    if (delay) await wait(delay);
  }
}
const source = () => evaluate(`Array.from(document.querySelectorAll('[contenteditable] [data-line]'),n=>n.textContent).join('\\n')`);
async function capture(name) {
  await writeFile(`${evidence}/${name}.json`, JSON.stringify(await evaluate(`({events:typingEvents, snapshot:canvasTest.snapshot()})`), null, 2));
  const png = await send('Page.captureScreenshot');
  await writeFile(`${evidence}/${name}.png`, Buffer.from(png.data, 'base64'));
}
try {
  await mkdir(evidence, { recursive: true });
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width:1200,height:950,deviceScaleFactor:1,mobile:false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(1200);
  await evaluate(`window.typingEvents=[];
    for(const name of ['beforeinput','input','selectionchange']) document.addEventListener(name,event=>{
      const e=document.querySelector('[contenteditable]');if(!e)return;const s=getSelection();
      typingEvents.push({event:name,data:event.data,type:event.inputType,cancelable:event.cancelable,isComposing:event.isComposing,
        source:[...e.querySelectorAll('[data-line]')].map(n=>n.textContent).join('\\n'),html:e.innerHTML,
        anchor:[s.anchorNode?.nodeName,s.anchorOffset],focus:[s.focusNode?.nodeName,s.focusOffset]});},true);
    new MutationObserver(()=>{const e=document.querySelector('[contenteditable]');if(!e)return;
      typingEvents.push({event:'render',source:e.textContent,transforms:[...e.parentElement.querySelectorAll('svg path')].map(p=>p.parentElement.getAttribute('transform'))});
    }).observe(document.getElementById('fixture'),{subtree:true,childList:true,attributes:true});`);
  for (const collab of [false,true]) for (const narrow of [false,true]) for (const delay of [65,0]) {
    const name = `${collab?'yjs':'json'}-${narrow?'narrow':'auto'}-${delay?'slow':'rapid'}`;
    await check(name, async () => {
      await setup({mode:'production',empty:true,tool:'text',collab});
      if(narrow) await drag(400,250,500,310); else await click(400,250);
      await wait(250); await evaluate('typingEvents=[]');
      await type('$x$',delay); assert.equal(await source(),'$x$');
      await type(' ',delay); await type('$$x$$',delay); assert.equal(await source(),'$x$ $$x$$');
      await type(' * _ ` [x]',delay); assert.equal(await source(),'$x$ $$x$$ * _ ` [x]');
      await wait(120); await capture(name+'-midtyping');
      if(!narrow) {
        const rows=await evaluate(`typingEvents.filter(e=>e.event==='render').map(e=>[...new Set(e.transforms.filter(Boolean).map(t=>t.split(',')[1]))]).filter(rows=>rows.length>1)`);
        assert.deepEqual(rows,[], 'auto-content must never paint a second wrapped glyph row');
      }
      await key('Enter'); await type('next',delay); assert.equal(await source(),'$x$ $$x$$ * _ ` [x]\nnext');
      // Native selected-range replacement spanning source lines.
      await key('a','KeyA',4); await type('[selected]',delay); assert.equal(await source(),'[selected]');
      await key('Enter'); await type('_tail_',delay); assert.equal(await source(),'[selected]\n_tail_');
      assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"]').length`),0,'no actions behind multiline free text');
      await key('Escape'); await wait(250);
      assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"]').length`),1,'actions restored at accepted multiline geometry');
      const done=await snapshot(); assert.equal(lastShape(done).text,'[selected]\n_tail_'); assert.equal(done.undo,2);
      await evaluate(`canvasTest.getActiveUndoManager()?.undo() ?? canvasTest.store.temporal.getState().undo()`); await wait(100);
      assert.equal(lastShape(await snapshot()).text,'');
      await capture(name+'-undo');
    });
  }
  await check('element/root endpoints and split descendants retain source positions',async()=>{
    await setup({mode:'production',empty:true,tool:'text'}); await click(400,250); await wait(250); await type('abcd');
    // Browser-valid endpoint shapes; source is still entirely native typing.
    await evaluate(`(()=>{const e=document.querySelector('[contenteditable]'),line=e.firstChild;line.firstChild.splitText(2);getSelection().collapse(line,2);})()`);
    await type('$x$'); assert.equal(await source(),'abcd$x$');
    await evaluate(`(()=>{const e=document.querySelector('[contenteditable]');getSelection().collapse(e,e.childNodes.length);})()`);
    await key('Enter'); await type('tail'); assert.equal(await source(),'abcd$x$\ntail');
    await evaluate(`(()=>{const e=document.querySelector('[contenteditable]');getSelection().setBaseAndExtent(e,0,e,e.childNodes.length);})()`);
    await type('$'); assert.equal(await source(),'$');
    await capture('endpoint-selection');
    await key('Escape'); await wait(250);
  });
  await check('structural caret does not steal a subsequent native arrow selection',async()=>{
    await setup({mode:'production',empty:true,tool:'text'}); await click(400,250); await wait(250);
    await type('$'); await key('ArrowLeft'); await type('x'); await wait(100);
    assert.equal(await source(),'x$$'); await capture('caret-ownership'); await key('Escape'); await wait(250);
  });
  await check('list Enter continuation retained without pairing other markdown characters',async()=>{
    await setup({mode:'production',empty:true,tool:'text'});await click(400,250);await wait(250);
    await type('* item');await key('Enter');await type('_next_');
    assert.equal(await source(),'* item\n* _next_'); await key('Escape');await wait(250);
  });
  await check('successive block pairs and new source lines do not confuse closers with openers',async()=>{
    await setup({mode:'production',empty:true,tool:'text'});await click(400,250);await wait(250);
    await type('$$x$$ $$y$$');assert.equal(await source(),'$$x$$ $$y$$');
    await key('Enter');await type('$$z$$');assert.equal(await source(),'$$x$$ $$y$$\n$$z$$');
    await key('Escape');await wait(250);
  });
  for(const align of ['center','right']) await check(`auto-content ${align} keeps math/raw rows aligned`,async()=>{
    const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align,verticalAlign:'top',lineHeight:1.2};
    await setup({mode:'production',subject:{type:'text',text:'',textSizing:'auto-content',width:29,height:60,style}});
    await evaluate(`canvasTest.editor.getState().setEditingTextId('subject')`);await wait(250);
    await type('$x$');await key('Enter');await type('longer raw _line_');await wait(300);
    assert.equal(await source(),'$x$\nlonger raw _line_');
    const metrics=await evaluate(`(async()=>{const {layoutUserText}=await import('/src/utils/userTextSizing.ts');const e=document.querySelector('[contenteditable]');const text=[...e.querySelectorAll('[data-line]')].map(n=>n.textContent).join('\\n');const doc=await layoutUserText({...canvasTest.snapshot().slide.elements.subject,text},new Set([1]));return {count:e.parentElement.querySelectorAll('svg path').length,expected:doc.paths.length,mathCount:doc.paths.filter(p=>p.lineIndex===0).length,transforms:doc.paths.map(p=>p.transform)};})()`);
    assert.equal(metrics.count,metrics.expected);assert(metrics.mathCount>0);
    assert(metrics.transforms.every(t=>!t.includes('Infinity')&&!t.includes('NaN')));
    await capture('alignment-'+align);await key('Escape');await wait(200);
  });
  assert.deepEqual(runtimeErrors,[]);
} finally { await writeFile(`${evidence}/runtime-errors.json`,JSON.stringify(runtimeErrors,null,2)); ws.close(); }
