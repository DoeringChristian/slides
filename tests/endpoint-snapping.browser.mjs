import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';

const evidence = process.env.BROWSER_GATE_EVIDENCE;
await mkdir(evidence, { recursive: true });
const pages = await (await fetch(`${process.env.CDP_URL}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && (!process.env.CDP_TARGET_ID || p.id === process.env.CDP_TARGET_ID));
assert(page, 'isolated Chrome page exists');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0, pressed = false;
const pending = new Map(), errors = [], matrix = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const screen = ([x,y]) => evaluate(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('.canvas-scroll-parent svg').getScreenCTM());return [p.x,p.y]})()`);
async function mouse(type, point, modifiers = 0) {
  if (type === 'mousePressed') pressed = true;
  if (type === 'mouseReleased') pressed = false;
  await send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: 1, modifiers });
  await wait(20);
}
async function meta(down) {
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key: 'Meta', code: 'MetaLeft', modifiers: down ? 4 : 0 });
  await wait(20);
}
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < .002, `${label}: ${actual} != ${expected}`);
async function setup(collab, zoom, operation, target) {
  const drawing = operation.startsWith('draw');
  await evaluate(`canvasTest.resetPreferences()`);
  await evaluate(`canvasTest.setup(${JSON.stringify({ mode: 'production', collab, zoom, snap: true,
    empty: drawing, tool: drawing ? 'arrow' : 'select',
    subject: { shapeType: 'path', x: 220, y: 200, width: 80, height: 0, points: [0,0,80,0], stroke: '#a02555', strokeWidth: 2, endHead: 'triangle' },
    targets: [target],
  })})`);
  await wait(100);
  // Keep the complete interaction and the target inside the real scrollport at all zooms.
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),svg=p.querySelector('svg');const c=new DOMPoint(400,300).matrixTransform(svg.getScreenCTM());p.scrollLeft+=c.x-500;p.scrollTop+=c.y-450})()`);
  await wait(30);
}
async function gesture(operation, destination, suppress) {
  const drawing = operation.startsWith('draw'), start = operation.endsWith('start');
  if (suppress) await meta(true);
  const modifiers = suppress ? 4 : 0;
  let from, to;
  if (drawing) {
    const remote = [220, destination[1]];
    from = await screen(start ? destination : remote);
    to = await screen(start ? remote : destination);
  } else {
    from = await evaluate(`(()=>{const n=[...document.querySelectorAll('.path-handles circle[fill="#fff"]')][${start ? 0 : 1}];if(!n)throw Error('missing endpoint handle');const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    to = await screen(destination);
  }
  await mouse('mouseMoved', from, modifiers);
  await mouse('mousePressed', from, modifiers);
  await mouse('mouseMoved', to, modifiers);
  await mouse('mouseReleased', to, modifiers);
  if (suppress) await meta(false);
  await wait(60);
  return evaluate(`(()=>{const s=canvasTest.snapshot();const e=s.slide.elements[${drawing ? 's.slide.elementOrder.at(-1)' : "'subject'"}];const points=canvasTest.pathPointsInSlide(e);return {point:points.slice(${start ? '0,2' : '-2'}),binding:e.${start ? 'startBinding' : 'endBinding'}??null,undo:s.undo}})()`);
}
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await waitForCanvasFixture(evaluate);
  for (const collab of [false,true]) for (const zoom of [.5,1,2]) {
    for (const operation of ['draw-start','draw-end','edit-start','edit-end']) {
      // Ordinary alignment uses the very same rectangle edge/centre candidates,
      // even when no attachment is possible because the other axis is far away.
      for (const x of [400,450,500]) {
        await setup(collab, zoom, operation, { id:'target', x:400, y:400, width:100, height:60 });
        const result = await gesture(operation, [x-4/zoom,200], false);
        near(result.point[0],x,`${operation} rectangle edge/centre alignment`);
        near(result.point[1],200,`${operation} distant alignment retains other axis`);
        assert.equal(result.binding,null,'alignment at a distance must not attach');
        assert.equal(result.undo,1,'one gesture is one undo');
        matrix.push({collab,zoom,operation,case:'alignment',x});
      }
      for (const [offset,suppress,disabled] of [[4,false,false],[6,false,false],[4,true,false],[4,false,true]]) {
        await setup(collab, zoom, operation, { id:'target', x:400, y:270, width:100, height:60 });
        if (disabled) await evaluate("canvasTest.editor.getState().setSnapToGrid(false)");
        const destination=[400-offset/zoom,300];
        const result=await gesture(operation,destination,suppress);
        const attached=offset===4&&!suppress&&!disabled;
        near(result.point[0],attached?400:destination[0],`${operation} ${offset}px connection capture, Meta=${suppress}`);
        near(result.point[1],300,`${operation} connection y`);
        assert.equal(result.binding?.elementId??null,attached?'target':null,'connection uses the same five-screen-pixel budget');
        assert.equal(result.undo,1,'one endpoint gesture is one undo');
        matrix.push({collab,zoom,operation,case:'connection',offset,suppress,disabled});
      }
    }
    console.log(`PASS endpoint snapping drawing/editing start/end collab=${collab} zoom=${zoom}`);
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${evidence}/matrix.json`,JSON.stringify({matrix,errors},null,2));
} catch(error) {
  await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));
  await writeFile(`${evidence}/failure.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  throw error;
} finally { ws.close(); }
