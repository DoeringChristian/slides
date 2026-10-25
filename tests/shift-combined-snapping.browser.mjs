import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.COMBINED_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-combined-snapping/native`;
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
const pan = point => evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),m=p.querySelector('svg').getScreenCTM(),r=new DOMPoint(${point[0]},${point[1]}).matrixTransform(m);p.scrollLeft+=r.x-460;p.scrollTop+=r.y-380;})()`);
const snap = () => evaluate('canvasTest.snapshot()');
const authoritative = () => evaluate(`(async()=>{const {yDocToJson}=await import('/src/collab/ySchema.ts');const {getActiveDoc}=await import('/src/collab/yDocAdapter.ts');return JSON.stringify(getActiveDoc()?yDocToJson(getActiveDoc()):canvasTest.store.getState().presentation)})()`);
const screen = point => evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(),p=new DOMPoint(${point[0]},${point[1]}).matrixTransform(m);return [p.x,p.y]})()`);
const cue = () => evaluate(`(()=>{const n=document.querySelector('[data-connector-dock]');return n?{state:n.dataset.connectorDock,point:[+n.getAttribute('cx'),+n.getAttribute('cy')],r:+n.getAttribute('r'),fill:n.getAttribute('fill')}:null})()`);
const shaft = () => evaluate(`(()=>{const n=document.querySelector('svg path[stroke="#a02555"][fill="none"]');if(!n)return null;const svg=document.querySelector('.canvas-scroll-parent svg'),m=svg.getScreenCTM().inverse().multiply(n.getScreenCTM());return [0,n.getTotalLength()].flatMap(t=>{const p=n.getPointAtLength(t).matrixTransform(m);return [p.x,p.y]})})()`);
const close = (actual, expected, label) => { assert(actual, label); actual.forEach((v, i) => assert(Math.abs(v - expected[i]) < .002, `${label}: ${actual} != ${expected}`)); };
async function setup({ collab = false, zoom = 1, shapeType = 'rect', rotation = 0, tool = 'arrow', subject, secondSlide = false, target = {} } = {}) {
  await evaluate(`canvasTest.resetPreferences()`);
  await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('${tool}',{stroke:'#a02555',strokeWidth:5});})()`);
  await evaluate(`canvasTest.setup(${JSON.stringify({ mode: 'production', collab, zoom, tool, empty: !subject, subject, secondSlide, targets: [{ id: 'box', shapeType, x: 400, y: 250, width: 180, height: 120, rotation, fill: '#d8efec', ...target }] })})`);
  await wait(180);
  const dock = await evaluate(`(async()=>{const {bindingAimPoint}=await import('/src/utils/connectorUtils.ts');const box=canvasTest.snapshot().slide.elements.box;const p=bindingAimPoint({elementId:box.id,mode:'pinned',fixedPoint:[1,.5]},box);return [p.x,p.y]})()`);
  await evaluate(`(()=>{const p=document.querySelector('.canvas-scroll-parent'),svg=p.querySelector('svg'),m=svg.getScreenCTM(),r=new DOMPoint(${dock[0]},${dock[1]}).matrixTransform(m);p.scrollLeft+=r.x-460;p.scrollTop+=r.y-380;})()`); await wait(40);
  return dock;
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(1000);
  for (const collab of [false,true]) for (const zoom of [.5,1,2]) for (const tool of ['line','arrow']) {
    await setup({collab,zoom,tool});await evaluate(`canvasTest.editor.setState({snapToGrid:true})`);await pan([300,150]);await wait(40);
    const before=await authoritative(),a=await screen([200,100]),b=await screen([400-2/zoom,104]);
    await mouse('mousePressed',a);await mouse('mouseReleased',a);await modifier('Shift',true,8);await mouse('mouseMoved',b,8);
    let live=await shaft();assert(Math.abs(live[3]-live[1])<.002,'visible horizontal');
    const draft=await evaluate(`({previewX:+document.querySelector('.alignment-guides line').getAttribute('x2')})`);
    assert(Math.abs(draft.previewX-400)<.002,'new point intersects object x guide');assert.equal(await authoritative(),before);
    await modifier('Meta',true,12);assert(Math.abs((await evaluate(`+document.querySelector('.alignment-guides line').getAttribute('x2')`))-400)>.1,'Cmd bypasses guide');
    await modifier('Meta',false,8);assert(Math.abs((await evaluate(`+document.querySelector('.alignment-guides line').getAttribute('x2')`))-400)<.002,'stationary restoration');
    live=await shaft();await key('Enter','Enter',8);await modifier('Shift',false,0);
    const after=await snap(),path=after.slide.elements[after.slide.elementOrder.at(-1)];assert.equal(after.undo,1);
    close(await shaft(),live,'preview commit');close(await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${path.id}'])`),[200,100,400,100],'logical commit');
    await key('z','KeyZ',2);assert.equal(await authoritative(),before);
    matrix.push({collab,zoom,tool,guide:true,stationaryCmd:true,undo:true});
  }
  for(const collab of [false,true]) {
    await setup({collab,tool:'line'});await evaluate(`canvasTest.editor.setState({snapToGrid:true})`);await pan([300,180]);await wait(40);
    {const a=await screen([200,100]),b=await screen([204,248]),before=await authoritative();await mouse('mousePressed',a);await mouse('mouseReleased',a);await modifier('Shift',true,8);await mouse('mouseMoved',b,8);close(await shaft(),[200,100,200,250],'vertical new-point horizontal guide');const live=await shaft();await key('Enter','Enter',8);await modifier('Shift',false,0);close(await shaft(),live,'vertical commit');await key('z','KeyZ',2);assert.equal(await authoritative(),before);matrix.push({collab,verticalGuide:true});}
    for(const [origin,end,compatible] of [[[750,310],[585,310],true],[[750,315],[585,315],false],[[750,480],[585,315],true]]) {
      const dock=await setup({collab,tool:'line'}),a=await screen(origin),b=await screen(end),before=await authoritative();
      await mouse('mousePressed',a);await modifier('Shift',true,8);await mouse('mouseMoved',b,8);
      const c=await cue();assert.equal(c?.state==='active',compatible,'only compatible dock acquisition');
      if(compatible)close(c.point,dock,'compatible cue');
      const live=await shaft(),dx=live[2]-live[0],dy=live[3]-live[1];assert(Math.min(Math.abs(dx),Math.abs(dy),Math.abs(Math.abs(dx)-Math.abs(dy)))<.002,'visible eight ray');assert.equal(await authoritative(),before);
      await mouse('mouseReleased',b,8);await modifier('Shift',false,0);close(await shaft(),live,'dock preview commit');
      const ss=await snap(),path=ss.slide.elements[ss.slide.elementOrder.at(-1)];assert.equal(path.endBinding?.mode==='pinned',compatible);assert.equal(ss.undo,1);
      await key('z','KeyZ',2);assert.equal(await authoritative(),before);matrix.push({collab,origin,end,compatible});
    }
    for(const kind of ['text','image']) {
      const target=kind==='text'?await evaluate(`(async()=>{const {createTextElement}=await import('/src/utils/slideFactory.ts');return createTextElement({id:'box',x:400,y:250,width:180,height:120,text:'Free text'})})()`):{type:'image',cropX:0,cropY:0,cropWidth:1,cropHeight:1,resourceId:null};
      const dock=await setup({collab,tool:'line',target}),a=await screen([dock[0]+5,dock[1]]),b=await screen([dock[0]+140,dock[1]+70]);
      await mouse('mouseMoved',a);assert.equal((await cue())?.state,'active');await mouse('mousePressed',a);await mouse('mouseMoved',b);const live=await shaft();await mouse('mouseReleased',b);close(await shaft(),live,'text/image commit');
      const ss=await snap();assert.equal(ss.slide.elements[ss.slide.elementOrder.at(-1)].startBinding.mode,'pinned');matrix.push({collab,kind});
    }
    for(const click of [false,true]) for(const invalidation of ['slide','doc','target','removed','sameDoc']) {
      if(!collab&&invalidation==='doc')continue;
      const dock=await setup({collab,secondSlide:true,tool:'line'}),a=await screen([dock[0]+5,dock[1]]),b=await screen([dock[0]+150,dock[1]+70]);
      await mouse('mouseMoved',a);await mouse('mousePressed',a);if(click)await mouse('mouseReleased',a);await mouse('mouseMoved',b);
      await evaluate(`(async()=>{const editor=canvasTest.editor,sid=editor.getState().activeSlideId;const {getActiveDoc,setActiveDoc}=await import('/src/collab/yDocAdapter.ts');const doc=getActiveDoc();
        ${invalidation==='slide'?"editor.getState().setActiveSlide('other');editor.getState().setActiveSlide(sid);":invalidation==='doc'?'setActiveDoc(null);setActiveDoc(doc);':invalidation==='sameDoc'?'setActiveDoc(doc);':invalidation==='removed'?"const target=canvasTest.snapshot().slide.elements.box;canvasTest.store.getState().deleteElements(sid,['box']);canvasTest.store.getState().addElement(sid,target);":"canvasTest.store.getState().updateElement(sid,'box',{visible:false});canvasTest.store.getState().updateElement(sid,'box',{visible:true});"}})()`);
      const before=await authoritative();if(click)await key('Enter');else await mouse('mouseReleased',b);
      if(invalidation==='sameDoc'){assert.notEqual(await authoritative(),before);assert.equal((await snap()).slide.elementOrder.length,2);}else{assert.equal(await authoritative(),before);assert.equal(await shaft(),null);assert.equal(await cue(),null);}
      matrix.push({collab,click,invalidation});
    }
    for(const end of ['start','end']) {
      await setup({collab,tool:'select',subject:{shapeType:'path',x:200,y:100,width:100,height:100,points:[0,0,100,100],stroke:'#a02555',strokeWidth:5}});
      await evaluate(`canvasTest.editor.setState({snapToGrid:true,pathExtension:{elementId:'subject',end:'${end}'},tool:'line',selectedElementIds:[]})`);await wait(100);
      await pan([300,150]);await wait(40);const before=await authoritative(),b=await screen([398,end==='start'?104:204]);await modifier('Shift',true,8);await mouse('mouseMoved',b,8);
      const draft=await evaluate(`({previewX:+document.querySelector('.alignment-guides line').getAttribute('x2')})`);assert(Math.abs(draft.previewX-400)<.002,'extension guide');const live=await shaft();await key('Enter','Enter',8);await modifier('Shift',false,0);close(await shaft(),live,'extension preview commit');assert.equal((await snap()).undo,1);await key('z','KeyZ',2);assert.equal(await authoritative(),before);matrix.push({collab,end,extension:true});
    }
  }
  const label=await evaluate(`(async()=>{const {createTextElement}=await import('/src/utils/slideFactory.ts');return createTextElement({id:'box',x:400,y:250,width:180,height:120,text:'Label',containerId:'subject'})})()`);
  await setup({target:label,subject:{x:400,y:250,width:180,height:120,visible:false}});await mouse('mouseMoved',await screen([585,310]));assert.equal(await cue(),null,'bound labels excluded');
  assert.deepEqual(errors,[]);await writeFile(`${evidence}/matrix.json`,JSON.stringify(matrix,null,2));console.log(`PASS ${matrix.length} combined scenarios and bound-label exclusion`);
} catch(error) {await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));throw error;} finally { ws.close(); }
