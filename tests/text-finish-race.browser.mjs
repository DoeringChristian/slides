import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/text-finish-race.browser.mjs
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
  await wait(30);
}
async function click(x, y, count = 1) { await mouse('mousePressed', x, y, count); await mouse('mouseReleased', x, y, count); }
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, a: 65, End: 35 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, commands: modifiers === 4 && key === 'a' ? ['selectAll'] : modifiers === 4 && key === 'End' ? ['moveToEndOfDocument'] : undefined, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
async function check(name, run) { await run(); console.log(`PASS ${name}`); }


const evidence = process.env.TEXT_RACE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-text-finish-race/browser`;
async function until(check, description) {
  for(let i=0;i<100;i++){if(await check())return;await wait(50);}
  throw new Error('Timed out: '+description);
}
async function reopen() {
  const [x,y]=await evaluate(`(()=>{const r=document.querySelector('[data-element-id="subject"] > g:last-child rect').getBoundingClientRect();return [r.x+20,r.y+20];})()`);
  await click(x,y,2);
  await until(()=>evaluate(`!!document.querySelector('[contenteditable]') && document.activeElement?.isContentEditable`),'native double-click focus');
  await wait(80);
}
async function capture(name) {
  const png=await send('Page.captureScreenshot');
  await writeFile(`${evidence}/${name}.png`,Buffer.from(png.data,'base64'));
  await writeFile(`${evidence}/${name}.json`,JSON.stringify(await snapshot(),null,2));
}
async function releaseMath() {
  for(const requestId of pausedRequests) await send('Fetch.continueRequest',{requestId});
  pausedRequests.clear(); await send('Fetch.disable');
}
try {
  await mkdir(evidence,{recursive:true});
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(1500);
  // Warm Vite's dependency optimizer, NOT the subsequent page's module state.
  await evaluate(`import('/src/services/latexToSvg.ts').then(m=>m.texFragmentToSvg('x',false))`);
  for(const collab of [false,true])for(const mode of ['unchanged','queued-edit','editing-on-resolve']){
    const editAgain=mode!=='unchanged';
    await check(`${collab?'Yjs':'JSON'} delayed first-use math accept/reopen ${mode}`,async()=>{
      await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(500);
      await until(()=>evaluate(`!!window.canvasTest`),'fixture loaded');
      const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'left',verticalAlign:'top',lineHeight:1.2};
      await setup({mode:'production',collab,secondSlide:true,subject:{type:'text',text:'old',textSizing:'auto-content',width:150,height:60,style}});
      await send('Fetch.enable',{patterns:[{urlPattern:'*mathjax*',requestStage:'Request'}]});
      await reopen();
      assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"],button[title="Hide from slide (Del)"]').length`),0,'actions unmounted while editing');
      // Native selection and insertion, no session/layout mocks in production.
      await key('a','KeyA',4);
      const accepted='accepted $\\sqrt{x}$';
      await send('Input.insertText',{text:accepted});await wait(80);
      await key('Escape');
      await until(()=>pausedRequests.size>0,'MathJax network requests paused');
      assert.equal((await snapshot()).slide.elements.subject.text,'old');
      assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"]').length`),0,'actions remain unmounted while accepted math finish waits');
      await reopen();
      const reopened=await evaluate(`document.querySelector('[contenteditable]').textContent`);
      await capture(`${collab?'yjs':'json'}-${mode}-pending`);
      if(process.env.BASELINE){
        await writeFile(`${evidence}/baseline-race.json`,JSON.stringify({accepted,reopened,paused:pausedRequests.size},null,2));
        await key('Escape');await releaseMath();await wait(600);
        await capture('baseline-after-late-layout');
        assert.equal(reopened,accepted,'baseline must reproduce the accepted-draft handoff bug');
      }
      assert.equal(reopened,accepted);
      if(editAgain){
        // Move caret to end natively (the double-click location may be in the middle).
        await key('End','End',4); // Cmd+End on macOS.
        await send('Input.insertText',{text:' plus more'});
      }
      const expected=await evaluate(`document.querySelector('[contenteditable]').textContent`);
      assert.equal(expected,editAgain?accepted+' plus more':accepted);
      if(mode==='editing-on-resolve'){
        await releaseMath();
        await until(async()=> (await snapshot()).slide.elements.subject.text===accepted,'predecessor committed while typing');
        assert.equal(await evaluate(`document.querySelector('[contenteditable]').textContent`),expected);
      }
      await key('Escape');
      await reopen();
      assert.equal(await evaluate(`document.querySelector('[contenteditable]').textContent`),expected);
      await key('Escape');
      if(mode!=='editing-on-resolve') assert.equal((await snapshot()).undo,0);
      await releaseMath();
      await until(async()=> (await snapshot()).slide.elements.subject.text===expected,'accepted content committed');
      await wait(250);
      assert.equal(await evaluate(`document.querySelectorAll('button[title="Lock"]').length`),1,'finish completion restores actions without history polling');
      const done=await snapshot();
      assert.equal(done.undo,editAgain?2:1);
      assert(done.slide.elements.subject.width>28);
      assert.equal(await evaluate(`canvasTest.store.getState().presentation.slides.other.elements.subject.text`),'old');
      await capture(`${collab?'yjs':'json'}-${mode}-finished`);
      const undo=`canvasTest.getActiveUndoManager()?.undo() ?? canvasTest.store.temporal.getState().undo()`;
      await evaluate(undo);await wait(100);
      assert.equal((await snapshot()).slide.elements.subject.text,editAgain?accepted:'old');
      if(editAgain){await evaluate(undo);await wait(100);assert.equal((await snapshot()).slide.elements.subject.text,'old');}
    });
  }
  assert.deepEqual(runtimeErrors,[]);
  console.log('TEXT FINISH HANDOFF CHECKS PASSED');
} finally {
  await writeFile(`${evidence}/runtime-errors.json`,JSON.stringify(runtimeErrors,null,2));
  await releaseMath();
  await send('Network.setCacheDisabled',{cacheDisabled:false});
  ws.close();
}
