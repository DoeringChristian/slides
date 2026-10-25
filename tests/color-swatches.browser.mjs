import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/color-swatches.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
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
  const keyCodes = { ' ': 32, Tab: 9, Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers, ...(text ? { text, unmodifiedText: text } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
const evidence = process.env.COLOR_TEST_EVIDENCE_DIR ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-color-wave`;
async function shot(name) { const s = await send('Page.captureScreenshot'); await writeFile(`${evidence}/${name}.png`, Buffer.from(s.data, 'base64')); }
async function type(selector, text) {
  await click(...await center(selector));
  await send('Input.dispatchKeyEvent', { type:'keyDown',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65,commands:['selectAll'] });
  await send('Input.dispatchKeyEvent', { type:'keyUp',key:'a',code:'KeyA',modifiers:4,windowsVirtualKeyCode:65 });
  await send('Input.insertText', {text});
}
async function undo() { await evaluate('canvasTest.getActiveUndoManager() ? canvasTest.getActiveUndoManager().undo() : canvasTest.store.temporal.getState().undo()'); await wait(100); }
const prefs = () => evaluate(`JSON.stringify({styles:canvasTest.preferences(),storage:localStorage.getItem('slides.creation-preferences.v1')})`);
try {
  await mkdir(evidence,{recursive:true});
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate', {url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate); await wait(1500);
  await check('five actual presets + arbitrary current paint; independent alpha and one undo JSON/Yjs', async () => {
    for (const collab of [false,true]) {
      await evaluate('canvasTest.resetPreferences()');
      await setup({mode:'properties',collab,subject:{fill:'rgba(18, 52, 86, 0.4)',stroke:'rgba(86, 52, 18, 0.7)'}});
      for(const [field, colors] of [['Fill',['transparent','#ffc9c9','#b2f2bb','#a5d8ff','#ffec99']],['Stroke',['#1e1e1e','#e03131','#2f9e44','#1971c2','#f08c00']]]) {
        assert.equal(await evaluate(`document.querySelector('[aria-label="${field} colors"]').querySelectorAll('button').length`),6);
        for (const color of colors) {
          const before=await snapshot(),other=field==='Fill'?'stroke':'fill',f=field.toLowerCase();
          await click(...await center(`[aria-label="${field} colors"] button[aria-label="${field}: ${color==='transparent'?'No color':color}"]`));
          const after=await snapshot();assert.equal(after.undo,before.undo+1);assert.equal(after.slide.elements.subject[other],before.slide.elements.subject[other]);
          if(color==='transparent')assert.equal(after.slide.elements.subject[f],'transparent');
          else {
            const alpha=field==='Fill'?.4:.7;
            assert.equal(after.slide.elements.subject[f],`rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5),16)}, ${alpha})`);
          }
          assert.equal(await evaluate(`canvasTest.preferences().rect.${f}`),after.slide.elements.subject[f]);
          await undo();assert.equal((await snapshot()).slide.elements.subject[f],before.slide.elements.subject[f]);
        }
      }
      await shot(`presets-${collab?'yjs':'json'}`);
    }
  });
  await check('custom alpha hex accept, Escape then blur cancellation, preset replacing draft and native keyboard', async () => {
    for(const collab of [false,true]) {
      await evaluate('canvasTest.resetPreferences()');
      await setup({mode:'properties',collab,subject:{fill:'#123456',stroke:'#654321'}});
      const before=await snapshot(),remembered=await prefs();
      await click(...await center('button[title="Fill"]'));
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Fill color');
      await type('[aria-label="Fill color"]','#abcdef80');await key('Escape');
      assert.equal(await evaluate('document.activeElement.title'),'Fill');
      await click(400,30);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);assert.equal((await snapshot()).undo,0);assert.equal(await prefs(),remembered);
      await click(...await center('button[title="Fill"]'));await type('[aria-label="Fill color"]','#abcdef80');await key('Enter');
      let s=await snapshot();assert.equal(s.slide.elements.subject.fill,'#abcdef80');assert.equal(s.slide.elements.subject.stroke,'#654321');assert.equal(s.undo,1);
      await click(400,30);assert.equal((await snapshot()).undo,1,'blur cannot double accept');
      await undo();assert.equal((await snapshot()).slide.elements.subject.fill,'#123456');
      await click(...await center('button[title="Fill"]'));await type('[aria-label="Fill color"]','#aabbcc');
      await click(...await center('[role="dialog"] button[aria-label="Fill: #000000"]'));
      s=await snapshot();assert.equal(s.slide.elements.subject.fill,'#000000');assert.equal(s.undo,1,'preset replaces pending custom input with one accepted change');
      await undo();
      // Native Tab/Enter reaches the presets and activates an ordinary button.
      await evaluate(`document.querySelector('[aria-label="Stroke colors"] button').focus()`);await key('Tab');
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'),'Stroke: #e03131');await key('Enter');
      assert.equal((await snapshot()).slide.elements.subject.stroke,'#e03131');assert.equal((await snapshot()).undo,1);
      assert.deepEqual((await snapshot()).editor, before.editor, 'button Enter does not invoke canvas text editing');
      await undo();
      await key(' ', 'Space');
      assert.equal((await snapshot()).slide.elements.subject.stroke, '#e03131');assert.equal((await snapshot()).undo, 1);
      assert.deepEqual((await snapshot()).editor, before.editor, 'button Space keeps canvas selection/tool ownership');
      await shot(`custom-keyboard-${collab?'yjs':'json'}`);
    }
  });
  await check('alpha scrub cancellation never learns, acceptance learns exactly once JSON/Yjs', async () => {
    for(const collab of [false,true]) {
      await evaluate('canvasTest.resetPreferences()');await setup({mode:'properties',collab,subject:{fill:'#123456',stroke:'#654321'}});
      await click(...await center('button[title="Fill"]'));const p=await center('[aria-label="Fill alpha"] .cursor-ew-resize'),remembered=await prefs();
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]-60,p[1]);assert.equal(await prefs(),remembered);await key('Escape');await mouse('mouseReleased',p[0]-60,p[1]);
      assert.equal((await snapshot()).slide.elements.subject.fill,'#123456');assert.equal((await snapshot()).undo,0);assert.equal(await prefs(),remembered);
      await drag(...p,p[0]-60,p[1]);assert.equal((await snapshot()).slide.elements.subject.fill,'rgba(18, 52, 86, 0.7)');assert.equal((await snapshot()).undo,1);
      assert.equal(await evaluate('canvasTest.preferences().rect.fill'),'rgba(18, 52, 86, 0.7)');await undo();assert.equal((await snapshot()).slide.elements.subject.fill,'#123456');
    }
  });
  await check('portal-focused alpha scrubs track native Shift/Control transitions; fine/normal/snap deltas, single undo and cancellation JSON/Yjs', async () => {
    const modifier = async (key, down, modifiers) => {
      await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key,
        code: key === 'Shift' ? 'ShiftLeft' : 'ControlLeft',
        windowsVirtualKeyCode: key === 'Shift' ? 16 : 17, modifiers });
      await wait(40);
    };
    for (const collab of [false, true]) for (const cancel of [false, true]) {
      await evaluate('canvasTest.resetPreferences()');
      await setup({ mode: 'properties', collab, subject: { fill: '#123456', stroke: '#654321' } });
      const before = await snapshot(), remembered = await prefs();
      await click(...await center('button[title="Fill"]'));
      const p = await center('[aria-label="Fill alpha"] .cursor-ew-resize');
      const focusedHex = () => evaluate('document.activeElement.getAttribute("aria-label")');
      assert.equal(await focusedHex(), 'Fill color');
      await mouse('mousePressed', ...p);
      const move = async (dx, modifiers, alpha, label) => {
        await mouse('mouseMoved', p[0] + dx, p[1], 1, modifiers);
        assert.equal(await focusedHex(), 'Fill color', 'scrubbing retains portal hex focus');
        const state = await snapshot();
        assert.equal(state.slide.elements.subject.fill, `rgba(18, 52, 86, ${alpha})`, label);
        assert.equal(state.slide.elements.subject.stroke, '#654321');
        assert.equal(await prefs(), remembered, 'modifier previews never teach preferences');
      };
      await move(-20, 0, .9, 'normal: 20px subtracts 10%');
      await modifier('Shift', true, 8);
      await move(-40, 8, .89, 'Shift pressed during drag: 20px subtracts only 1%');
      await modifier('Shift', false, 0);
      await move(-60, 0, .79, 'Shift released during drag: normal 10% delta returns');
      await modifier('Control', true, 2);
      await move(-63, 2, .78, 'Control snaps the raw 77.5% preview to 78%');
      await modifier('Control', false, 0);
      await move(-65, 0, .765, 'Control release recovers the unrounded accumulator');
      await modifier('Shift', true, 8);
      await modifier('Control', true, 10);
      await move(-71, 10, .76, 'Control+Shift combines fine movement with whole-percent snapping');
      await modifier('Control', false, 8);
      await move(-73, 8, .761, 'Control release preserves Shift fine mode');
      await modifier('Shift', false, 0);
      await move(-75, 0, .751, 'both modifiers released: normal movement resumes');
      await shot(`alpha-modifiers-${collab ? 'yjs' : 'json'}-${cancel ? 'cancel' : 'accept'}`);
      if (cancel) await key('Escape');
      await mouse('mouseReleased', p[0] - 75, p[1]);
      const after = await snapshot();
      if (cancel) {
        assert.deepEqual(after.slide.elements, before.slide.elements);
        assert.equal(after.undo, 0);
        assert.equal(await prefs(), remembered, 'Escape/late pointerup cannot persist previews');
        assert(await evaluate('!!document.querySelector(\'[role="dialog"][aria-label="Fill custom color"]\')'), 'scrub Escape does not dismiss the picker');
      } else {
        assert.equal(after.slide.elements.subject.fill, 'rgba(18, 52, 86, 0.751)');
        assert.equal(after.undo, 1);
        assert.equal(await evaluate('canvasTest.preferences().rect.fill'), 'rgba(18, 52, 86, 0.751)');
        const accepted = await prefs();
        await undo();
        assert.deepEqual((await snapshot()).slide.elements, before.slide.elements);
        assert.equal(await prefs(), accepted, 'undo does not relearn creation preferences');
      }
    }
  });
  await check('pre-draw shared presets remember only accepted local changes, never write deck history',async()=>{
    await evaluate('canvasTest.resetPreferences()');await setup({mode:'icons',empty:true,tool:'rect'});
    const before=await snapshot(),remembered=await prefs();
    await click(...await center('button[title="Fill"]'));await type('[aria-label="Fill color"]','#abcdef80');await key('Escape');assert.equal(await prefs(),remembered);
    await click(...await center('[aria-label="Fill colors"] button[aria-label="Fill: #b2f2bb"]'));
    assert.equal(await evaluate('canvasTest.preferences().rect.fill'),'#b2f2bb');assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);assert.equal((await snapshot()).undo,0);
    await shot('creation-presets');
  });
  await check('responsive six controls use one full row or two narrow rows; popup stays viewport-safe',async()=>{
    for(const width of [232,120]) {
      await setup({mode:'properties',subject:{fill:'#12345678'}});await evaluate(`document.getElementById('properties').style.width='${width}px'`);
      const metrics=await evaluate(`(()=>{const g=document.querySelector('[aria-label="Fill colors"]'),r=g.getBoundingClientRect(),b=[...g.querySelectorAll('button')].map(x=>{const b=x.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,right:b.right}});return{r:{x:r.x,right:r.right},b,rows:new Set(b.map(x=>x.y)).size}})()`);
      assert.equal(metrics.rows,width===232?1:2);for(const b of metrics.b){assert.equal(b.w,28);assert.equal(b.h,28);assert(b.x>=metrics.r.x&&b.right<=metrics.r.right);}
      await shot(`palette-width-${width}`);
    }
    for(const [width,height] of [[375,667],[320,480]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await setup({mode:'properties',subject:{fill:'rgba(18, 52, 86, 0.4)'}});
      await evaluate(`document.getElementById('properties').style.cssText='width:232px;position:fixed;right:0;bottom:0;height:90px;overflow:auto'`);
      await click(...await center('button[title="Fill"]'));await wait(100);
      const r=await evaluate(`(()=>{const p=document.querySelector('[role="dialog"]').parentElement,b=p.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom}})()`);assert(r.x>=8&&r.right<=width-8&&r.y>=8&&r.bottom<=height-8);
      await shot(`popup-mobile-${width}`);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
    await setup({mode:'properties',formatBar:true,subject:{type:'text',text:'Text',style:{fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#123456',align:'left',verticalAlign:'top',lineHeight:1.2}}});
    assert.equal(await evaluate(`document.querySelector('#text-format-bar [aria-label="Text Color colors"]').querySelectorAll('button').length`),1);await shot('compact-text-toolbar');
  });
  await check('actual production adjustment glyph shares purple/white selection theme at every zoom, hit target separate, undo/cancel unchanged',async()=>{
    for(const collab of [false,true])for(const zoom of [.5,1,2]) {
      await setup({mode:'production',collab,zoom,subject:{x:400,y:300,width:180,height:100,cornerRadius:8}});
      const metrics=await evaluate(`(()=>{const p=document.querySelector('[data-adjustment-visual]'),c=document.querySelector('.corner-radius-handle circle'),s=document.querySelector('[data-resize-visual]'),b=p.getBoundingClientRect();return{w:b.width,h:b.height,stroke:p.getAttribute('stroke'),fill:p.getAttribute('fill'),sw:+p.getAttribute('stroke-width'),selection:s.getAttribute('stroke'),events:getComputedStyle(p).pointerEvents,hit:+c.getAttribute('r')}})()`);
      assert.equal(metrics.w,8);assert.equal(metrics.h,8);assert.equal(metrics.sw*zoom,1);assert.equal(metrics.stroke,metrics.selection);assert.equal(metrics.stroke,'#6965db');assert.equal(metrics.fill,'white');assert.equal(metrics.events,'none');assert(metrics.hit*zoom>4);
      const p=await center('.corner-radius-handle circle'),before=await snapshot();await mouse('mouseMoved',...p);await shot(`adjustment-hover-${zoom}-${collab}`);
      await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+20,p[1]);
      assert.equal(await evaluate(`document.querySelector('[data-adjustment-visual]').getAttribute('fill')`),'white');
      assert.equal(await evaluate(`+document.querySelector('.corner-radius-handle line').getAttribute('stroke-width')`)*zoom,1);
      await shot(`adjustment-active-${zoom}-${collab}`);await key('Escape');await mouse('mouseReleased',p[0]+20,p[1]);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);assert.equal((await snapshot()).undo,0);
      await drag(...p,p[0]+20,p[1]);assert.equal((await snapshot()).slide.elements.subject.cornerRadius,8+20/zoom);assert.equal((await snapshot()).undo,1);await undo();assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
    }
  });
  assert.deepEqual(runtimeErrors, []);
  console.log('COLOR SWATCHES / ADJUSTMENT THEME CHECKS PASSED');
} finally { ws.close(); }
