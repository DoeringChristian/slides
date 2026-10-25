import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.CORRECTIONS_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-arrow-pinning-corrections/native`;
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
const checkboxExpr = `(()=>{const label=[...document.querySelectorAll('#creation-properties div')].find(n=>n.textContent==='Closed path' && n.children.length===0);return label?.parentElement.parentElement.querySelector('input[type="checkbox"]')})()`;
const closure = () => evaluate(`({checked:${checkboxExpr}?.checked,persisted:JSON.parse(localStorage.getItem('slides.creation-preferences.v1')).styles[canvasTest.editor.getState().tool]?.closed})`);
async function toggle() {
  const at=await evaluate(`(()=>{const n=${checkboxExpr};n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  await mouse('mousePressed',at);await mouse('mouseReleased',at);return closure();
}
async function setup(collab,tool='arrow') {
  await evaluate('canvasTest.resetPreferences()');
  await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('${tool}',{stroke:'#a02555',strokeWidth:5});})()`);
  await evaluate(`canvasTest.setup(${JSON.stringify({mode:'production',creationProperties:true,collab,tool,empty:true,snap:true,targets:[{id:'source',x:400,y:250,width:180,height:120},{id:'target',x:700,y:250,width:180,height:120},{id:'authored-closed',shapeType:'path',x:100,y:100,width:100,height:60,points:[0,0,100,60],closed:true,endHead:'arrow'}]})})`);await wait(200);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),m=p.querySelector('svg').getScreenCTM(),r=new DOMPoint(580,310).matrixTransform(m);p.scrollLeft+=r.x-400;p.scrollTop+=r.y-380})()`);await wait(40);
}
async function clickPoint(point) { const at=await screen(point);await mouse('mouseMoved',at);await mouse('mousePressed',at);await mouse('mouseReleased',at); }
const latest = state => state.slide.elements[state.slide.elementOrder.at(-1)];
const highlight = () => evaluate(`document.querySelector('[data-connector-highlight]')?.getAttribute('data-connector-highlight')??null`);
async function capture(name) {await writeFile(`${evidence}/${name}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
try {
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1450,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(700);
  for(const collab of [false,true]) for(const tool of ['arrow','line']) {
    await setup(collab,tool);
    const states=[];for(let i=0;i<3;i++)states.push(await toggle());
    matrix.push({collab,tool,scenario:'checkbox true-false-true',states});await capture(`checkbox-${collab}-${tool}`);
    assert.deepEqual(states,[{checked:true,persisted:true},{checked:false,persisted:false},{checked:true,persisted:true}]);
    const before=await authoritative(),preferences=await evaluate('canvasTest.preferences()'),authored=(await snap()).slide.elements['authored-closed'];
    const restoreTool=async()=>{await evaluate(`canvasTest.editor.getState().setTool('${tool}')`);await wait(80);};
    // No reset: the same UI preference controls drag and multipoint topology.
    for(const [count,closed] of [[2,true],[3,true],[3,false]]) {
      await restoreTool();
      if(!closed)assert.deepEqual(await toggle(),{checked:false,persisted:false});
      const start=await screen([585,310]),end=await screen([790,310]);
      await mouse('mouseMoved',start);assert.equal((await cue())?.state,'active');
      if(count===2){await mouse('mousePressed',start);await mouse('mouseMoved',end);assert.equal(await authoritative(),before);await mouse('mouseReleased',end);}
      else {for(const point of [[585,310],[650,430],[790,310]])await clickPoint(point);assert.equal(await authoritative(),before);await key('Enter');}
      const shape=latest(await snap());assert.deepEqual((await snap()).slide.elements['authored-closed'],authored);assert.equal(shape.points.length,count*2);assert.equal(shape.closed,count===3&&closed);
      if(shape.closed){assert.equal(shape.startBinding,null);assert.equal(shape.endBinding,null);}
      else {assert.equal(shape.startBinding.elementId,'source');assert.equal(shape.endBinding.elementId,'target');}
      assert.equal((await snap()).undo,1);await key('z','KeyZ',2);assert.equal(await authoritative(),before);
      await restoreTool();assert.deepEqual(await closure(),{checked:closed,persisted:closed});
      matrix.push({collab,tool,scenario:'UI-driven creation',count,rememberedClosed:closed,shape});
    }
    assert.deepEqual(await toggle(),{checked:true,persisted:true});
    assert.deepEqual(await evaluate('canvasTest.preferences()'),preferences);
    for(const nearPoint of [[792,312],[702,312]]) for(const finish of ['enter','click','cancel']) {
      await restoreTool();await clickPoint([585,310]);await clickPoint([790,310]);
      const accepted=await shaft();await mouse('mouseMoved',await screen(nearPoint));
      const near={shaft:await shaft(),highlight:await highlight(),vertices:await evaluate(`document.querySelectorAll('.ui-layer circle[stroke="#4285f4"][fill="#fff"]').length`)};
      await capture(`coalesced-${collab}-${tool}-${nearPoint[0]}-${finish}`);assert.equal(await authoritative(),before);assert.equal((await snap()).undo,0);
      assert.equal(near.vertices,2);assert.equal(near.highlight,'target');close(near.shaft,accepted,'near-terminal preview retains endpoint binding');
      await modifier('Shift',true,8);assert.equal(await highlight(),'target');close(await shaft(),accepted,'Shift compatible with coalesced binding');
      await modifier('Meta',true,12);assert.equal(await highlight(),null);assert.equal(await authoritative(),before);
      await modifier('Meta',false,8);assert.equal(await highlight(),'target');close(await shaft(),accepted,'stationary Meta release restores coalesced binding');await modifier('Shift',false,0);
      if(finish==='cancel'){await key('Escape');assert.equal(await authoritative(),before);assert.equal((await snap()).undo,0);}
      else {
        if(finish==='click')await clickPoint(nearPoint);
        assert.equal(await highlight(),'target');close(await shaft(),accepted,'click acceptance shares coalesced preview');
        await key('Enter');const committed=latest(await snap()),committedShaft=await shaft();
        close(committedShaft,near.shaft,'coalesced preview equals commit');assert.equal(committed.points.length,4);assert.equal(committed.closed,false);assert.equal(committed.startBinding.elementId,'source');assert.equal(committed.endBinding.elementId,'target');assert.equal((await snap()).undo,1);
        await key('z','KeyZ',2);assert.equal(await authoritative(),before);
      }
      assert.deepEqual(await evaluate('canvasTest.preferences()'),preferences);
      matrix.push({collab,tool,scenario:'coalesced terminal',nearPoint,finish,accepted,near,previewWrites:0});
    }
  }
  assert.deepEqual(errors,[]);await writeFile(`${evidence}/matrix.json`,JSON.stringify({matrix,errors},null,2));console.log('PASS corrections',matrix.length);
} catch(error) {await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));await capture('failure');throw error;}
finally {ws.close();}
