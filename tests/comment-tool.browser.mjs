import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
import assert from 'node:assert/strict';
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
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function screen(x,y){return evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:m.a*${x}+m.e,y:m.d*${y}+m.f}})()`);}
async function mouse(type,p,count=1){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:count});await wait(30);}
async function click(p,count=1){await mouse('mousePressed',p,count);await mouse('mouseReleased',p,count);}
async function drag(a,b){await mouse('mousePressed',a);for(let i=1;i<=5;i++)await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/5,y:a.y+(b.y-a.y)*i/5});await mouse('mouseReleased',b);await wait(150);}
async function button(label){const point=await evaluate(`(()=>{const b=[...document.querySelectorAll('#creation-properties button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(point);await wait(100);}
const handle = name => evaluate(`(()=>{const h=document.querySelector('.selection-transformer [data-resize-handle=${name}]');if(!h)return null;const r=(h.querySelector('[data-resize-visual]')??h).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const key = async (text, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: text, code: text === 'Enter' ? 'Enter' : undefined, windowsVirtualKeyCode: text === 'Enter' ? 13 : text === 'Escape' ? 27 : undefined, text: text === 'Enter' ? '\r' : text.length === 1 ? text : undefined, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: text, modifiers }); await wait(20); };
const typeText = async text => { await send('Input.insertText', { text }); await wait(50); };
const focused = () => evaluate(`(()=>{const a=document.activeElement;return a?a.tagName+':'+(a.getAttribute('placeholder')??''):null})()`);
try {
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for (const collab of [false, true]) {
    await waitForCanvasFixture(evaluate);
    await evaluate(`canvasTest.setup(${JSON.stringify({mode:'production',collab,subject:{x:100,y:100,width:120,height:80}})})`);
    await wait(100);
    const comments = () => evaluate('Object.values(canvasTest.snapshot().slide.comments ?? {})');

    // Drag an area of empty space: the comment box opens, focused.
    await evaluate(`canvasTest.editor.getState().setTool('comment')`); await wait(50);
    await drag(await screen(500, 200), await screen(700, 330));
    assert.equal(await evaluate('canvasTest.editor.getState().tool'), 'select', 'tool resets to select');
    assert.equal(await focused(), 'TEXTAREA:Comment on this area…', 'typing goes straight into the comment box');
    assert.equal((await comments()).length, 0, 'nothing is written before posting');
    await typeText('Put a bar chart');
    // Shift+Enter is a new line, not a send.
    await key('Enter', 8);
    assert.equal((await comments()).length, 0, 'Shift+Enter does not post');
    await typeText('of the results here');
    await key('Enter');
    await wait(150);
    let all = await comments();
    assert.equal(all.length, 1);
    assert.equal(all[0].text, 'Put a bar chart\nof the results here');
    assert.deepEqual(all[0].region, { x: 500, y: 200, width: 200, height: 130 });
    assert.equal(all[0].elementIds, undefined, 'empty area: no elements inside');
    await key('Escape'); await wait(80);

    // A click on empty space pins the comment to that spot.
    await evaluate(`canvasTest.editor.getState().setTool('comment')`); await wait(50);
    await click(await screen(800, 420)); await wait(150);
    assert.equal(await focused(), 'TEXTAREA:What should go here?');
    await typeText('Logo here'); await key('Enter'); await wait(150);
    all = await comments();
    const spot = all.find(c => c.text === 'Logo here');
    assert.deepEqual(spot.region, { x: 800, y: 420, width: 0, height: 0 });
    await key('Escape'); await wait(80);

    // A click on an object comments on that object.
    await evaluate(`canvasTest.editor.getState().setTool('comment')`); await wait(50);
    await click(await screen(160, 140)); await wait(150);
    assert.equal(await focused(), 'TEXTAREA:Comment on this element…');
    await typeText('Make this red'); await key('Enter'); await wait(150);
    all = await comments();
    assert.deepEqual(all.find(c => c.text === 'Make this red').elementIds, ['subject']);
    assert.equal(all.find(c => c.text === 'Make this red').region, undefined);
    console.log(`PASS comment tool: area, spot and object comments open a focused box and post with their target collab=${collab}`);
  }
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
