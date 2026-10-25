import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.DOCKING_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-docking/native`;
await mkdir(evidence, { recursive: true });
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(page);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0, pressed = false;
const pending = new Map(), errors = [], matrix = [];
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? reject(msg.error) : resolve(msg.result);
  }
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function mouse(type, point, modifiers = 0) {
  if (type === 'mousePressed') pressed = true;
  if (type === 'mouseReleased') pressed = false;
  await send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: 1, modifiers }); await wait(25);
}
async function modifier(key, down, modifiers) {
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key, code: `${key}Left`, modifiers }); await wait(40);
}
async function key(key, code = key, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers }); await wait(60);
}
const snap = () => evaluate('canvasTest.snapshot()');
const authoritative = () => evaluate(`(async()=>{const {yDocToJson}=await import('/src/collab/ySchema.ts');const {getActiveDoc}=await import('/src/collab/yDocAdapter.ts');return JSON.stringify(getActiveDoc()?yDocToJson(getActiveDoc()):canvasTest.store.getState().presentation)})()`);
const screen = point => evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(),p=new DOMPoint(${point[0]},${point[1]}).matrixTransform(m);return [p.x,p.y]})()`);
const cue = () => evaluate(`(()=>{const n=document.querySelector('[data-connector-dock]');return n?{state:n.dataset.connectorDock,point:[+n.getAttribute('cx'),+n.getAttribute('cy')],r:+n.getAttribute('r'),fill:n.getAttribute('fill')}:null})()`);
const shaft = () => evaluate(`(()=>{const n=document.querySelector('svg path[stroke="#a02555"][fill="none"]');if(!n)return null;const svg=document.querySelector('.canvas-scroll-parent svg'),m=svg.getScreenCTM().inverse().multiply(n.getScreenCTM());return [0,n.getTotalLength()].flatMap(t=>{const p=n.getPointAtLength(t).matrixTransform(m);return [p.x,p.y]})})()`);
const close = (actual, expected, label) => { assert(actual, label); actual.forEach((v, i) => assert(Math.abs(v - expected[i]) < .002, `${label}: ${actual} != ${expected}`)); };
async function setup({ collab = false, zoom = 1, shapeType = 'rect', rotation = 0, tool = 'arrow', subject, secondSlide = false } = {}) {
  await evaluate(`canvasTest.resetPreferences()`);
  await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('${tool}',{stroke:'#a02555',strokeWidth:5});})()`);
  await evaluate(`canvasTest.setup(${JSON.stringify({ mode: 'production', collab, zoom, tool, empty: !subject, subject, secondSlide, targets: [{ id: 'box', shapeType, x: 400, y: 250, width: 180, height: 120, rotation, fill: '#d8efec' }] })})`);
  await wait(180);
  const dock = await evaluate(`(async()=>{const {bindingAimPoint}=await import('/src/utils/connectorUtils.ts');const box=canvasTest.snapshot().slide.elements.box;const p=bindingAimPoint({elementId:box.id,mode:'pinned',fixedPoint:[1,.5]},box);return [p.x,p.y]})()`);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),svg=p.querySelector('svg'),m=svg.getScreenCTM(),r=new DOMPoint(${dock[0]},${dock[1]}).matrixTransform(m);p.scrollLeft+=r.x-460;p.scrollTop+=r.y-380;})()`); await wait(40);
  return dock;
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(1000);
  for (const collab of [false, true]) for (const zoom of [.5, 1, 2]) for (const shapeType of ['rect', 'ellipse']) {
    const rotation = shapeType === 'ellipse' ? 37 : 0, tool = shapeType === 'rect' ? 'arrow' : 'line';
    const dock = await setup({ collab, zoom, shapeType, rotation, tool });
    const r = rotation * Math.PI / 180;
    const physical = [dock[0] + 5 * Math.cos(r), dock[1] + 5 * Math.sin(r)];
    const start = await screen(physical), endWorld = [dock[0] + 155, dock[1] + 103], end = await screen(endWorld);
    const before = await snap(), raw = await authoritative();
    await mouse('mouseMoved', start);
    const hovered = await cue(); assert.equal(hovered?.state, 'active'); close(hovered.point, dock, 'highlighted start'); assert.equal(hovered.r * zoom, 4);
    await modifier('Shift', true, 8); close((await cue()).point, dock, 'Shift at initial start has no outgoing constraint');
    await modifier('Shift', false, 0); close((await cue()).point, dock, 'stationary Shift release restores idle cue');
    await modifier('Meta', true, 4); assert.equal(await cue(), null);
    await modifier('Meta', false, 0); close((await cue()).point, dock, 'stationary idle reacquisition');
    await mouse('mousePressed', start); await mouse('mouseMoved', end);
    close((await shaft()).slice(0, 2), dock, 'live start is dock, not pointer'); assert.equal(await authoritative(), raw); assert.equal((await snap()).undo, 0);
    await modifier('Shift', true, 8);
    let points = await shaft(); close(points.slice(0, 2), dock, 'Shift retains latched start'); assert(Math.abs((points[2]-points[0])-(points[3]-points[1]))<.002);
    await modifier('Meta', true, 12); points = await shaft(); close(points.slice(0, 2), physical, 'Cmd physical start'); assert(Math.abs((points[2]-points[0])-(points[3]-points[1]))<.002);
    await modifier('Meta', false, 8); points = await shaft(); close(points.slice(0, 2), dock, 'Cmd release restores dock under Shift');
    await modifier('Shift', false, 0); points = await shaft(); close(points.slice(0, 2), dock, 'Shift release preserves pin');
    if (zoom === 1) await writeFile(`${evidence}/start-${collab}-${shapeType}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await mouse('mouseReleased', end); const after = await snap(), id = after.slide.elementOrder.at(-1), arrow = after.slide.elements[id];
    assert.equal(arrow.startBinding.mode, 'pinned'); assert.equal(arrow.startBinding.elementId, 'box'); assert.equal(arrow.endBinding, null); assert.equal(after.undo, 1); assert.equal(after.editor.tool, 'select');
    close(await shaft(), points, 'shared rendered preview equals commit');
    close(await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${id}']).slice(0,2)`), dock, 'durable start equals cue');
    const center = await screen([490,310]), movedCenter = [center[0]+20,center[1]+15], preMove = await authoritative();
    await mouse('mousePressed',center);await mouse('mouseMoved',movedCenter);assert.equal(await authoritative(),preMove,'native target drag remains transient');
    const targetLive=await evaluate(`document.querySelector('.content-layer').innerHTML`);await mouse('mouseReleased',movedCenter);
    assert.equal(await evaluate(`document.querySelector('.content-layer').innerHTML`),targetLive,'native target drag projection equals commit');
    assert.deepEqual((await snap()).slide.elements[id].startBinding,arrow.startBinding);
    await evaluate(`canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'box',{x:420,y:280,width:230,height:85,rotation:63})`); await wait(60);
    const transformed = await evaluate(`(async()=>{const {bindingAimPoint}=await import('/src/utils/connectorUtils.ts');const s=canvasTest.snapshot().slide,a=s.elements['${id}'],p=bindingAimPoint(a.startBinding,s.elements.box);return {actual:canvasTest.pathPointsInSlide(a).slice(0,2),expected:[p.x,p.y]}})()`); close(transformed.actual, transformed.expected, 'target transform keeps pin');
    await key('z', 'KeyZ', 2); await key('z', 'KeyZ', 2); await key('z', 'KeyZ', 2); assert.deepEqual((await snap()).slide.elements, before.slide.elements);
    matrix.push({ collab, zoom, shapeType, rotation, tool, start: 'cue=live=commit', cmdShift: 'stationary clear/reacquire with physical bypass', undo: true, transform: true }); console.log('PASS dock creation', collab, zoom, shapeType);
  }
  for (const collab of [false, true]) {
    let dock = await setup({ collab }), start = await screen([dock[0]+5,dock[1]]), end = await screen([dock[0]+160,dock[1]+90]);
    await mouse('mouseMoved', start); await mouse('mousePressed', start); await mouse('mouseReleased', start); await mouse('mouseMoved', end);
    close((await shaft()).slice(0,2),dock,'click-draft retains dock'); await key('Enter');
    let s=await snap(); assert.equal(s.slide.elements[s.slide.elementOrder.at(-1)].startBinding.mode,'pinned'); assert.equal(s.undo,1);
    dock=await setup({collab}); start=await screen([dock[0]+5,dock[1]]);end=await screen([dock[0]+160,dock[1]+90]); const before=await authoritative();
    await mouse('mouseMoved',start);await mouse('mousePressed',start);await mouse('mouseMoved',end);await key('Escape');await mouse('mouseReleased',end);assert.equal(await authoritative(),before);assert.equal(await cue(),null);
    dock=await setup({collab}); const physical=[dock[0]+5,dock[1]]; start=await screen(physical);end=await screen([dock[0]+160,dock[1]+90]);
    await mouse('mouseMoved',start);await mouse('mousePressed',start);await mouse('mouseMoved',end);await modifier('Meta',true,4);await mouse('mouseReleased',end,4);await modifier('Meta',false,0);
    s=await snap();const arrow=s.slide.elements[s.slide.elementOrder.at(-1)];assert.equal(arrow.startBinding,null);assert.equal(arrow.endBinding,null);close(await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${arrow.id}']).slice(0,2)`),physical,'Cmd release commits physical unbound start');
    dock=await setup({collab,secondSlide:true});start=await screen([dock[0]+5,dock[1]]);end=await screen([dock[0]+160,dock[1]+90]);
    await mouse('mouseMoved',start);await mouse('mousePressed',start);await mouse('mouseMoved',end);
    await evaluate(`canvasTest.editor.getState().setActiveSlide('other')`);await mouse('mouseReleased',end);await modifier('Meta',true,4);await modifier('Meta',false,0);
    assert.equal((await snap()).slide.elementOrder.length,1,'slide switch cannot resurrect pending pin');assert.equal(await shaft(),null);assert.equal(await cue(),null);
    matrix.push({collab,clickDraft:true,cancel:true,cmdCommit:true,slideSwitch:true});console.log('PASS click/cancel/Cmd commit',collab);
    for(const endKey of ['startBinding','endBinding']) {
      const subject={shapeType:'path',x:250,y:200,width:120,height:70,points:[0,0,120,70],stroke:'#a02555',strokeWidth:5,endHead:'triangle'};
      dock=await setup({collab,tool:'select',subject});
      const from=await evaluate(`(()=>{const n=[...document.querySelectorAll('.path-handles circle[fill="#fff"]')][${endKey==='startBinding'?0:1}],r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`),to=await screen([dock[0]+5,dock[1]]),raw=await authoritative();
      await mouse('mousePressed',from);await mouse('mouseMoved',to);close((await cue()).point,dock,'edit cue');assert.equal(await authoritative(),raw);
      const live=await evaluate(`document.querySelector('.content-layer').innerHTML`);await mouse('mouseReleased',to);s=await snap();assert.equal(s.slide.elements.subject[endKey].mode,'pinned');assert.equal(await evaluate(`document.querySelector('.content-layer').innerHTML`),live);assert.equal(s.undo,1);
      matrix.push({collab,endKey,edit:'cue=projected=commit'});console.log('PASS endpoint docking',collab,endKey);
    }
  }
  // Unsupported triangle gets ordinary aim highlighting but never a guessed dot.
  await setup({shapeType:'triangle'}); await mouse('mouseMoved',await screen([580,310]));assert.equal(await cue(),null);
  assert.deepEqual(errors,[]);await writeFile(`${evidence}/matrix.json`,JSON.stringify({matrix,errors},null,2));console.log(`PASS ${matrix.length} docking native scenarios; triangle omitted`);
} catch(error) {
  await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));
  await writeFile(`${evidence}/failure.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));throw error;
} finally { ws.close(); }
