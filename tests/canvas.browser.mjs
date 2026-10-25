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
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate);
  await wait(1500);
  assert(await evaluate('!!window.canvasTest'), 'fixture loaded');

  await check('radius top edge: no jump, rotated zoom delta, one undo, Escape and pointercancel', async () => {
    await setup({ subject: { cornerRadius: 0 } });
    assert.equal(await evaluate("document.querySelector('.corner-radius-handle circle').getAttribute('cy')"), '100');
    const p = await center('.corner-radius-handle circle');
    await click(...p); assert.equal((await snapshot()).undo, 0);
    await drag(...p, p[0] + 25, p[1] + 40);
    let s = await snapshot(); assert.equal(s.slide.elements.subject.cornerRadius, 25); assert.equal(s.undo, 1);
    await setup({ zoom: 2, subject: { rotation: 90, cornerRadius: 0 } });
    const r = await center('.corner-radius-handle circle');
    await drag(...r, r[0], r[1] + 40);
    assert.equal((await snapshot()).slide.elements.subject.cornerRadius, 20);
    const q = await center('.corner-radius-handle circle');
    await mouse('mousePressed', ...q); await mouse('mouseMoved', q[0], q[1] + 20); await key('Escape'); await mouse('mouseReleased', q[0], q[1] + 20);
    assert.equal((await snapshot()).undo, 1);
    await mouse('mousePressed', ...q); await mouse('mouseMoved', q[0], q[1] + 10);
    await evaluate("window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))"); await mouse('mouseReleased', ...q);
    assert.equal((await snapshot()).undo, 1);
  });
  await check('path rounding follows first ordered horizontal segment', async () => {
    await setup({ subject: { shapeType: 'path', points: [0, 0, 100, 0, 100, 80], cornerRadius: 0 } });
    const p = await center('.corner-radius-handle circle');
    const geometry=await evaluate(`(()=>{const el=canvasTest.snapshot().slide.elements.subject,n=document.querySelector('.corner-radius-handle circle'),m=n.getScreenCTM(),svg=n.parentElement.parentElement.getScreenCTM(),world=canvasTest.pathPointsInSlide(el),a=new DOMPoint(world[0],world[1]).matrixTransform(svg),b=new DOMPoint(world[2],world[3]).matrixTransform(svg),q=new DOMPoint(+n.getAttribute('cx'),+n.getAttribute('cy')).matrixTransform(m),length=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length;return {cross:(q.x-a.x)*dy-(q.y-a.y)*dx,along:(q.x-a.x)*dx+(q.y-a.y)*dy,length,hit:+n.getAttribute('r')*Math.hypot(m.a,m.b)}})()`);
    assert(Math.abs(geometry.cross)<1e-6,'knob follows actual first-segment world direction');
    assert(geometry.along-geometry.hit>=0&&geometry.along+geometry.hit<=geometry.length,'entire hit stays within finite first leg');
    assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.corner-radius-handle')`), 'first-segment knob owns a clear hit lane');
    await drag(...p, p[0] - 20, p[1] + 30);
    assert.equal((await snapshot()).slide.elements.subject.cornerRadius, 20);
    assert.equal((await snapshot()).undo,1);
    const q=await center('.corner-radius-handle circle');await mouse('mousePressed',...q);await mouse('mouseMoved',q[0]+10,q[1]);await key('Escape');await mouse('mouseReleased',q[0]+10,q[1]);assert.equal((await snapshot()).slide.elements.subject.cornerRadius,20);assert.equal((await snapshot()).undo,1);
    await key('z','KeyZ',2);assert.equal((await snapshot()).slide.elements.subject.cornerRadius,0);
  });
  await check('small-object body drag vs outside resize at zoom .5, 1, 2', async () => {
    for (const zoom of [0.5, 1, 2]) {
      await setup({ zoom, subject: { width: 12, height: 12 } });
      await drag(100 * zoom + .25, 106 * zoom, 100 * zoom + 30.25, 106 * zoom + 10);
      let s = await snapshot(); assert.equal(s.slide.elements.subject.width, 12); assert.equal(s.slide.elements.subject.x, 100 + 30 / zoom);
      const p = await center('.selection-transformer > g:last-of-type rect:last-child');
      await drag(...p, p[0] + 12, p[1] + 12);
      s = await snapshot(); assert(s.slide.elements.subject.width > 12); assert.equal(s.undo, 2);
    }
  });
  await check('click starts arrow draft, successive points, Enter commits once without text editing', async () => {
    await setup({ empty: true, tool: 'arrow' });
    await click(80, 90); assert.equal((await snapshot()).slide.elementOrder.length, 0);
    await mouse('mouseMoved', 180, 140); await click(180, 140);
    await mouse('mouseMoved', 260, 200); await key('Enter');
    const s = await snapshot(), el = lastShape(s);
    assert.equal(el.points.length, 6); assert.equal(el.endHead, 'triangle'); assert.equal(s.undo, 1);
    assert.equal(s.editor.tool, 'select'); assert.equal(s.editor.editing, null);
    assert.deepEqual(absPoints(el), [80, 90, 180, 140, 260, 200]);
    await key('Backspace'); assert.notEqual(lastShape(await snapshot())?.visible, true);
  });
  await check('drag creates exactly two points; double-click finishes without duplicate; Escape cancels', async () => {
    await setup({ empty: true, tool: 'line', zoom: 2 });
    await drag(80, 80, 280, 220);
    assert.equal(lastShape(await snapshot()).points.length, 4);
    await setup({ empty: true, tool: 'arrow' });
    await click(60, 60); await click(160, 110); await click(260, 160); await click(260, 160, 2);
    const s = await snapshot(); assert.equal(s.slide.elementOrder.length, 1); assert.equal(lastShape(s).points.length, 6); assert.equal(s.undo, 1);
    await setup({ empty: true, tool: 'arrow' }); await click(80, 80); await mouse('mouseMoved', 200, 100); await key('Escape');
    assert.equal((await snapshot()).slide.elementOrder.length, 0); assert.equal((await snapshot()).undo, 0);
  });
  await check('drawing and endpoint editing use same raw interior aim/border intent and previews', async () => {
    for (const x of [295, 250]) {
      await setup({ empty: true, tool: 'arrow', targets: [{ id: 'target', x: 200, y: 100, width: 100, height: 100 }] });
      await mouse('mousePressed', 60, 150); await mouse('mouseMoved', x, 150);
      const preview = await evaluate('canvasTest.drawing.drawState.snappedCurrentX');
      await mouse('mouseReleased', x, 150);
      const s = await snapshot(), el = lastShape(s);
      assert.equal(el.endBinding.mode, 'aim'); assert(Math.abs(absPoints(el).at(-2) - preview) < 1e-6);
    }
    await setup({ subject: { shapeType: 'path', points: [0, 0, 100, 0], width: 100, height: 1, endHead: 'triangle' },
      targets: [{ id: 'target', x: 260, y: 50, width: 100, height: 100 }] });
    await drag(200, 100, 300, 100);
    const el = (await snapshot()).slide.elements.subject;
    assert.equal(el.endBinding.mode, 'aim'); assert.equal(absPoints(el).at(-2), 260);
    assert.deepEqual(el.endBinding.fixedPoint,[.4,.5]);
  });
  await check('midpoint uses pointer cursor; vertex deletion owns Backspace; typing does not delete', async () => {
    await setup({ subject: { shapeType: 'path', curve: 'smooth', points: [0, 0, 100, 60, 200, 0], width: 200, height: 60 } });
    assert(await evaluate("Array.from(document.querySelectorAll('.path-handles circle')).some(e=>getComputedStyle(e).cursor==='pointer')"));
    await mouse('mouseMoved', 200, 160); await key('Backspace');
    let s = await snapshot(); assert.equal(s.slide.elements.subject.visible, true); assert.equal(s.slide.elements.subject.points.length, 4);
    await evaluate("const input=document.createElement('input');document.body.append(input);input.focus();input.value='abc'");
    await key('Backspace'); s = await snapshot(); assert.equal(s.slide.elements.subject.visible, true);
    await evaluate("document.querySelector('body > input').remove()");
  });
  await check('palette compact paired triggers, below-label wrapping actions, smooth and B-spline mode selection', async () => {
    await setup({ mode: 'properties', subject: { shapeType: 'path', curve: 'bspline3', points: [0, 0, 80, 80, 160, 0], width: 160, height: 80 } });
    const heads = await evaluate("['Start head','End head','Stroke Style','Curve'].map(label=>{const e=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.startsWith(label+':'));const r=e.getBoundingClientRect();return {label,text:e.textContent,x:r.x,y:r.y,w:r.width};})");
    assert.equal(heads[0].y, heads[1].y); assert.equal(heads[2].y, heads[3].y); assert(heads.every(h=>!h.text.trim()));
    const p = await center('button[aria-label^="Curve:"]'); await click(...p);
    assert(await evaluate("!!document.querySelector('[role=radio][aria-label*=B-spline][aria-checked=true]')"));
    await evaluate("document.querySelector('[role=radio][aria-label=\"Curved through points\"]').click()"); await wait(70);
    assert.equal((await snapshot()).slide.elements.subject.curve, 'smooth');
    await click(...await center('button[aria-label^="End head:"]')); assert(await evaluate("!!document.querySelector('[role=dialog]')")); await key('Escape');
    assert.equal(await evaluate("document.querySelectorAll('[role=dialog]').length"), 0);
    const shot = await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-canvas-layout.png`, Buffer.from(shot.data, 'base64'));
  });
  await check('on-canvas extension preserves identity/style, follows terminal direction, repeat extension and cancellation', async () => {
    for (const curve of ['linear', 'smooth', 'bezier']) for (const end of ['start', 'end']) {
      await setup({ subject: { shapeType: 'path', curve, points: [0, 0, 70, 40, 150, 0], width: 150, height: 60, rotation: 25,
        endHead: 'triangle', stroke: '#f00', tangents: curve === 'bezier' ? [0,0,30,0,-20,0,20,0,-30,0,0,0] : undefined } });
      const p = await center(`[aria-label="Extend ${end}"]`); await click(...p);
      await mouse('mouseMoved', end === 'end' ? 380 : 50, 220); await click(end === 'end' ? 380 : 50, 220); await key('Enter');
      let s = await snapshot(), el = s.slide.elements.subject;
      assert.equal(s.slide.elementOrder.length, 1); assert.equal(el.points.length, 8); assert.equal(el.rotation, 25);
      assert.equal(el.endHead, 'triangle'); assert.equal(el.stroke, '#f00'); assert.equal(s.undo, 1);
      const control = await center(`[aria-label="Extend ${end}"]`); assert(Number.isFinite(control[0]));
      await click(...control); await mouse('mouseMoved', 450, 270); await key('Escape');
      s = await snapshot(); assert.equal(s.undo, 1); assert.equal(s.slide.elements.subject.points.length, 8);
    }
  });
  await check('Shift-only eight-ray constraint; free pointer is not angularly magnetized', async () => {
    for(const modifiers of [0,8,12]) {
      await setup({ empty: true, tool: 'arrow', snap: false });
      await mouse('mousePressed',100,100);await mouse('mouseMoved',200,104,1,modifiers);
      assert.equal(await evaluate("canvasTest.drawing.guides.some(g=>g.type==='direction')"),!!(modifiers&8));
      await mouse('mouseReleased',200,104,1,modifiers);
      const pts=absPoints(lastShape(await snapshot()));
      assert(Math.abs(pts[3] - ((modifiers&8)?100:104))<1e-6);
      assert(Math.abs(pts[2] - ((modifiers&8)?100+Math.hypot(100,4):200))<1e-6);
    }
  });
  await check('actual SlidePanel Add Slide keeps selected arrow after JSON and queued Yjs keyframe creation', async () => {
    for (const collab of [false, true]) {
      await setup({ mode: 'slides', collab, subject: { shapeType: 'path', points: [0,0,100,50], endHead: 'triangle' } });
      const old = (await snapshot()).slide.id;
      await click(...await center('button[title="Add Slide"]'));
      const s = await snapshot(); assert.notEqual(s.slide.id, old); assert.deepEqual(s.editor.selected, ['subject']);
      assert(await evaluate("!!document.querySelector('[aria-label=\"Extend end\"]')"));
    }
  });
  await check('actual MergeIntoButton: visible source beats hidden target, no false notice, selected visible winner (JSON/Yjs)', async () => {
    for (const collab of [false, true]) for (const visible of [false, true]) {
      await setup({ mode: 'merge', collab, subject: { shapeType: 'path', points: [0,0,100,50], endHead: 'triangle' },
        targets: [{ id: 'target', visible, x: 300, y: 100 }] });
      await click(...await center('button[title="Merge “subject” into…"]'));
      await click(...await center('button[title="Merge “subject” into “target”"]'));
      const s = await snapshot(); assert.deepEqual(s.editor.selected, ['target']); assert(!s.slide.elements.subject);
      assert.equal(s.slide.elements.target.visible, true); assert.equal(s.slide.elements.target.shapeType, visible ? 'rect' : 'path');
      assert.equal(await evaluate("document.body.textContent.includes('conflicting slide')"), visible);
    }
  });
  await check('static multipoint creation: Enter/double-click, repeated terminal and short final leg head stays on tip', async () => {
    for (const finish of ['Enter', 'double-click']) {
      await setup({ empty: true, tool: 'arrow' });
      await click(100,100); await click(180,180); await click(250,130); await mouse('mouseMoved',251,132);
      const readTip = `(() => { const p=document.querySelector('svg polygon'); const v=p.points.getItem(0); const m=p.getScreenCTM(); return [m.a*v.x+m.c*v.y+m.e,m.b*v.x+m.d*v.y+m.f]; })()`;
      const previewTip = await evaluate(readTip);
      if (finish === 'Enter') { await click(251,132); await click(251,132); await key('Enter'); }
      else { await click(251,132); await click(251,132,2); }
      const s = await snapshot(), el = lastShape(s); assert.equal(el.points.length,8);
      const tip = await evaluate(readTip); tip.forEach((v,i)=>assert(Math.abs(v-previewTip[i])<1e-5));
      assert(Math.abs(tip[0]-251)<1e-5 && Math.abs(tip[1]-132)<1e-5);
      assert.equal(s.undo,1); assert.equal(s.editor.editing,null);
      const shot=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-multipoint-${finish}.png`,Buffer.from(shot.data,'base64'));
    }
  });
  console.log('ALL BROWSER CHECKS PASSED; screenshot /tmp/slides-canvas-layout.png');
} finally { ws.close(); }
