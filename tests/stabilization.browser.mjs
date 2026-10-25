import './browser-gate-required.mjs';
import { terminalStrokePaintOracle, assertTerminalStrokeInflight } from './terminalStrokePaintOracle.mjs';
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
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate);
  await wait(1500);
  assert(await evaluate('!!window.canvasTest'), 'fixture loaded');


  const only = process.env.ONLY;
  if (!only || only === 'A') await check('P1A production extension context lifecycle', async () => {
    for (const collab of [false,true]) for (const change of ['select', 'slide']) {
      await setup({ mode: 'production', collab, secondSlide: true, subject: { shapeType: 'path', points: [0,0,100,0], width: 100, height: 1 } });
      const before = await evaluate(`JSON.stringify(canvasTest.store.getState().presentation)`);
      await evaluate(`canvasTest.editor.getState().beginPathExtension('subject','end')`); await wait(100);
      // Add a vertex through the full production canvas event path.
      await click(700,400);
      if (change === 'select') await evaluate(`canvasTest.editor.getState().setTool('select'); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
      else await evaluate(`canvasTest.editor.getState().setActiveSlide('other'); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
      await wait(100);
      const expected = await evaluate(`JSON.stringify(canvasTest.store.getState().presentation)`);
      await key('Enter');
      assert.equal(await evaluate(`JSON.stringify(canvasTest.store.getState().presentation)`), expected, 'stale Enter must not write');
      assert.equal((await snapshot()).undo, 0);
      assert.equal(await evaluate(`document.querySelectorAll('[data-element-id="subject"]').length`), 1, 'original interactive node restored');
      if(change === 'select') {
        assert.equal(expected,before);
        const body=await center('[data-element-id="subject"]');
        await drag(...body,body[0]+30,body[1]+20);
        const moved=await snapshot(); assert.equal(moved.slide.elements.subject.x,130); assert.equal(moved.undo,1,'original is draggable, not a pointer-inert ghost');
      }
    }
  });
  if (!only || only === 'B') await check('P1B actual property scrub, local formatting/programmatic writes, remote, undo and lifecycle', async () => {
    const subject = { type:'text', text:'Hello', style:{fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000',align:'left',verticalAlign:'top',lineHeight:1.2} };
    const opacityControl = `(() => { const label=Array.from(document.querySelectorAll('div')).find(e=>e.textContent==='Opacity'); return label.parentElement.querySelector('.cursor-ew-resize'); })()`;
    for (const collab of [false,true]) for (const other of ['bold','programmatic','history','slide','remote']) {
      if (!collab && other === 'remote') continue;
      await setup({mode:'properties',subject,collab,secondSlide:true});
      const p=await evaluate(`(() => { const b=(${opacityControl}).getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`);
      await mouse('mousePressed',...p); await mouse('mouseMoved',p[0]-25,p[1]); await wait(650);
      assert((await snapshot()).slide.elements.subject.opacity < 1, 'live preview reached store');
      if(other === 'bold') await key('b','KeyB',2);
      if(other === 'programmatic') await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',{x:321})`);
      if(other === 'history') await key('z','KeyZ',2);
      if(other === 'slide') await evaluate(`canvasTest.editor.getState().setActiveSlide('other')`);
      if(other === 'remote') await evaluate(`canvasTest.doc.transact(() => canvasTest.doc.getMap('presentation').get('slides').get(canvasTest.editor.getState().activeSlideId).get('elements').get('subject').set('x',321),'remote')`);
      await wait(80);
      // Even another move after invalidation must not write, nor may release.
      if(other !== 'remote') assert.equal((await snapshot()).slide.elements.subject.opacity,1);
      await mouse('mouseMoved',p[0]-40,p[1]);
      if(other === 'remote' || other === 'bold') await key('Escape');
      await mouse('mouseReleased',p[0]-40,p[1]);
      let s=await snapshot(); assert.equal(s.slide.elements.subject.opacity,1);
      assert.equal(s.undo,['bold','programmatic'].includes(other)?1:0);
      if(other === 'bold') assert.equal(s.slide.elements.subject.style.fontWeight,'bold');
      if(['programmatic','remote'].includes(other)) assert.equal(s.slide.elements.subject.x,321);
      if(['bold','programmatic'].includes(other)) {
        await key('z','KeyZ',2); s=await snapshot(); assert.equal(s.slide.elements.subject.opacity,1);
        assert.equal(s.slide.elements.subject.style.fontWeight,'normal'); assert.equal(s.slide.elements.subject.x,100);
        await key('y','KeyY',2); s=await snapshot(); assert.equal(s.undo,1);
      }
    }
  });
  if (!only || only === 'nested') await check('nested style scrub cancellation never resurrects Size/Line Height through Ctrl+B/I/U', async () => {
    const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000',align:'left',verticalAlign:'top',lineHeight:1.2};
    for (const collab of [false,true]) for (const [label,field] of [['Size','fontSize'],['Line Height','lineHeight']]) for (const [shortcut,format,value] of [['b','fontWeight','bold'],['i','fontStyle','italic'],['u','textDecoration','underline']]) {
      await setup({mode:'properties',collab,subject:{type:'text',text:'Hello',style}});
      const p=await evaluate(`(() => { const label=Array.from(document.querySelectorAll('div')).find(e=>e.textContent===${JSON.stringify(label)}); const b=label.parentElement.querySelector('.cursor-ew-resize').getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`);
      await mouse('mousePressed',...p); await mouse('mouseMoved',p[0]+20,p[1]); await wait(650);
      assert.notEqual((await snapshot()).slide.elements.subject.style[field],style[field], 'preview must reach Zustand before shortcut');
      await key(shortcut,'Key'+shortcut.toUpperCase(),2);
      const expected={...style,[format]:value};
      assert.deepEqual((await snapshot()).slide.elements.subject.style,expected,`${collab?'Yjs':'JSON'} ${label} Ctrl+${shortcut}: cancelled nested value must not return`);
      await mouse('mouseMoved',p[0]+35,p[1]); await key('Escape'); await mouse('mouseReleased',p[0]+35,p[1]);
      let state=await snapshot(); assert.deepEqual(state.slide.elements.subject.style,expected); assert.equal(state.undo,1);
      await key('z','KeyZ',2); assert.deepEqual((await snapshot()).slide.elements.subject.style,style);
      await key('y','KeyY',2); assert.deepEqual((await snapshot()).slide.elements.subject.style,expected);
    }
  });
  if (!only || only === 'nested-ui') await check('nested property palette/keyframe/toolbar callbacks use authoritative post-cancel siblings', async () => {
    const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000',align:'left',verticalAlign:'top',lineHeight:1.2};
    for (const collab of [false,true]) for (const action of ['font-palette','keyframe-color','toolbar-bold','toolbar-italic','toolbar-underline','toolbar-font']) {
      await setup({mode:'properties',collab,formatBar:true,secondSlide:true,nextStyle:{color:'#ff0000'},subject:{type:'text',text:'Hello',style}});
      const p=await evaluate(`(() => { const label=Array.from(document.querySelectorAll('div')).find(e=>e.textContent==='Size'); const b=label.parentElement.querySelector('.cursor-ew-resize').getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`);
      await mouse('mousePressed',...p); await mouse('mouseMoved',p[0]+20,p[1]); await wait(650);
      assert.equal((await snapshot()).slide.elements.subject.style.fontSize,34);
      let expected={...style};
      // Keep the original pointer held and invoke actual rendered controls.
      // Their handlers have props from the synchronized preview render.
      if(action === 'font-palette') {
        await evaluate(`document.querySelector('button[aria-label^="Font:"]').click()`); await wait(50);
        await evaluate(`document.querySelector('[role="radio"][aria-label="Georgia"]').click()`); expected.fontFamily='Georgia';
      } else if(action === 'keyframe-color') {
        await evaluate(`(() => { const label=Array.from(document.querySelectorAll('div.break-words')).find(e=>e.textContent==='Color'); label.parentElement.querySelector('button[title="Reset to next keyframe"]').click(); })()`); expected.color='#ff0000';
      } else if(action === 'toolbar-font') {
        await evaluate(`(() => { const select=document.querySelector('#text-format-bar select'); select.value='Georgia'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`); expected.fontFamily='Georgia';
      } else {
        const title={'toolbar-bold':'Bold (Ctrl+B)','toolbar-italic':'Italic (Ctrl+I)','toolbar-underline':'Underline (Ctrl+U)'}[action];
        await evaluate(`document.querySelector('#text-format-bar button[title="${title}"]').click()`);
        if(action === 'toolbar-bold') expected.fontWeight='bold';
        if(action === 'toolbar-italic') expected.fontStyle='italic';
        if(action === 'toolbar-underline') expected.textDecoration='underline';
      }
      await wait(70); assert.deepEqual((await snapshot()).slide.elements.subject.style,expected,`${collab?'Yjs':'JSON'} ${action}`);
      await mouse('mouseMoved',p[0]+35,p[1]); await key('Escape'); await mouse('mouseReleased',p[0]+35,p[1]);
      let state=await snapshot(); assert.deepEqual(state.slide.elements.subject.style,expected); assert.equal(state.undo,1);
      await key('z','KeyZ',2); assert.deepEqual((await snapshot()).slide.elements.subject.style,style);
      await key('y','KeyY',2); assert.deepEqual((await snapshot()).slide.elements.subject.style,expected);
    }
  });
  if (!only || only === 'C') await check('P1C tiny line/arrow body movement and endpoint hits at all zooms/coarse', async () => {
    for (const coarse of [false,true]) {
      await send('Emulation.setTouchEmulationEnabled',{enabled:coarse});
      assert.equal(await evaluate(`matchMedia('(pointer: coarse)').matches`),coarse);
      const pointerDrag=coarse ? touchDrag : drag;
      for (const zoom of [0.5,1,2]) for (const endHead of ['none','triangle']) {
        await setup({zoom,subject:{shapeType:'path',points:[0,0,4,0],width:4,height:1,endHead}});
        await pointerDrag(102*zoom,100*zoom,102*zoom+30,100*zoom+20);
        let s=await snapshot(); assert.deepEqual(s.slide.elements.subject.points,[0,0,4,0], 'body drag must not edit endpoints');
        assert.equal(s.slide.elements.subject.x,100+30/zoom); assert.equal(s.slide.elements.subject.y,100+20/zoom); assert.equal(s.undo,1);
        for (const end of ['start','end']) {
          await setup({zoom,subject:{shapeType:'path',points:[0,0,4,0],width:4,height:1,endHead}});
          // Outward side retains a full-sized endpoint target, even on touch.
          const x=(end === 'start' ? 100 : 104)*zoom, sign=end === 'start' ? -1 : 1;
          await pointerDrag(x+sign*4,100*zoom,x+sign*30,100*zoom-20);
          s=await snapshot(); assert.notDeepEqual(s.slide.elements.subject.points,[0,0,4,0]); assert.equal(s.undo,1);
        }
      }
    }
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  });
  if (!only || only === 'screenshot') await check('screenshot regression: original shaft joins actual head without an invented bend', async () => {
    // Approximate the supplied screenshot; source deck/precise vertices were
    // not provided. Validate the rendered shaft, not just the correctly placed tip.
    await setup({zoom:2,subject:{x:0,y:0,shapeType:'path',points:[325,370,233.5,146.5,230.5,145.5],width:325,height:370,strokeWidth:9,endHead:'triangle'}});
    const evidence=await evaluate(`(() => {
      const el=canvasTest.snapshot().slide.elements.subject;
      const geo=canvasTest.pathArrowGeometry(el);
      const p=document.querySelector('[data-element-id="subject"] polygon');
      const tip=p.points.getItem(0), matrix=p.getScreenCTM();
      const renderedTip=[matrix.a*tip.x+matrix.c*tip.y+matrix.e,matrix.b*tip.x+matrix.d*tip.y+matrix.f];
      const ext=document.querySelector('[aria-label="Extend end"] circle'), m=ext.getScreenCTM();
      const extension=[m.a*ext.cx.baseVal.value+m.c*ext.cy.baseVal.value+m.e,m.b*ext.cx.baseVal.value+m.d*ext.cy.baseVal.value+m.f];
      return {points:el.points,renderedTip,extension,head:geo.endGeo,shaftPoints:geo.shaftPoints,d:geo.d,originalD:geo.originalD,strokePlan:geo.strokePlan};
    })()`);
    assert.deepEqual(evidence.renderedTip,[461,291]);
    const dx=evidence.extension[0]-461,dy=evidence.extension[1]-291;
    assert(Math.abs(dx*(-1)-dy*(-3))<1e-3,'extension shares original terminal direction');
    assert.deepEqual(evidence.shaftPoints,evidence.points,'authored provenance remains intact');
    assert.equal(evidence.strokePlan.runs.length,1,'one retained original native leg');
    assert.match(evidence.d,/^M 325 370 L /,'no rounded crescent or invented rejoin');
    const [x0,y0,x1,y1]=evidence.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const original=evidence.originalD.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert(Math.abs((x1-x0)*(original[3]-y0)-(y1-y0)*(original[2]-x0))<1e-6,'cut stays on historically painted native L');
    const tri=evidence.head.fills[0].points;
    const sideCross=(tri[4]-tri[0])*(y1-tri[1])-(tri[5]-tri[1])*(x1-tri[0]);
    assert(Math.abs(sideCross)<1e-6,'shaft ends exactly on actual triangle side, not detached');
    assert.equal(await evaluate(`document.querySelector('[data-element-id="subject"] path[stroke]').getAttribute('d')`),evidence.d,'actual coverage consumes shared retained leg');
    const paint=await evaluate(`(${terminalStrokePaintOracle.toString()})()`);
    assertTerminalStrokeInflight(paint.inflight, assert);
    for(const result of paint.results) {
      assert.equal(result.crescent[3],0,'old production alpha211 crescent is absent');
      assert.equal(result.shaft[3],255,'original shaft remains visible');
      assert.equal(result.join[3],255,'side-entry join remains visible');
      assert.equal(result.missingInterior,0,'independent original route retained');
      assert.equal(result.unexpectedInterior,0,'no invented bend/spill');
    }
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-junction-after.json`,JSON.stringify(evidence,null,2));
    const shot=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-junction-after.png`,Buffer.from(shot.data,'base64'));
  });
  console.log('STABILIZATION CHECKS PASSED');
} finally { ws.close(); }
