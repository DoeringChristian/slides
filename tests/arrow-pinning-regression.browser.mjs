import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.PINNING_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-pinning-regression/native`;
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
  for (const collab of [false, true]) for (const rememberedClosed of [false, true]) {
    const dock = await setup({ collab });
    if (rememberedClosed) await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('arrow',{closed:true,curve:'smooth',startHead:'circle',endHead:'arrow'});})()`);
    const prefs = await evaluate('canvasTest.preferences()');
    const start = await screen([dock[0]+5,dock[1]]), end = await screen([dock[0]+180,dock[1]+100]);
    const before = await snap(), raw = await authoritative();
    await mouse('mouseMoved', start);
    const hover = await cue();
    await writeFile(`${evidence}/hover-${collab}-${rememberedClosed}.png`, Buffer.from((await send('Page.captureScreenshot', {format:'png'})).data,'base64'));
    await mouse('mousePressed',start); await mouse('mouseMoved',end);
    assert.equal(await authoritative(),raw); assert.equal((await snap()).undo,0);
    const preview = await shaft();
    await mouse('mouseReleased',end);
    const after = await snap(), arrow = after.slide.elements[after.slide.elementOrder.at(-1)];
    const result = {collab,rememberedClosed,prefs,hover,preview,arrow,undo:after.undo}; matrix.push(result);
    if (!process.env.REPRO_ONLY) {
      assert.equal(hover?.state,'active'); assert.equal(arrow.closed,false); assert.equal(arrow.startBinding?.mode,'pinned');
      assert.equal(arrow.startBinding.elementId,'box'); assert.equal(after.undo,1);
      close(await shaft(),preview,'remembered-style preview equals committed shaft');
      if (rememberedClosed) assert.deepEqual([arrow.curve,arrow.startHead,arrow.endHead],['smooth','circle','arrow']);
      assert.deepEqual(await evaluate('canvasTest.preferences()'),prefs,'creation does not erase remembered closure');
      const center=await screen([490,310]),to=[center[0]+30,center[1]+20];
      await mouse('mousePressed',center);await mouse('mouseMoved',to);await mouse('mouseReleased',to);
      const moved=await snap();assert.deepEqual(moved.slide.elements[arrow.id].startBinding,arrow.startBinding);
      close(await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${arrow.id}']).slice(0,2)`),[dock[0]+30,dock[1]+20],'pin follows native target move');
      await key('z','KeyZ',2);await key('z','KeyZ',2);assert.deepEqual((await snap()).slide.elements,before.slide.elements);
    }
    console.log('OBSERVED',collab,rememberedClosed,JSON.stringify({hover:!!hover,closed:arrow.closed,startBinding:arrow.startBinding}));
  }
  if (!process.env.REPRO_ONLY) for (const collab of [false, true]) {
    for (const kind of ['rect','ellipse','text','image','label']) {
      await setup({collab});
      await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('arrow',{closed:true,curve:'smooth',endHead:'arrow'});})()`);
      const target={id:'destination',x:700,y:370,width:180,height:120,fill:'#ddeeff',creationPreset:kind==='ellipse'?'ellipse':'rect',textSizing:'user-width',boundTextLayout:'padded',...(kind==='ellipse'?{shapeType:'ellipse'}:{})};
      if(kind==='text') Object.assign(target,{type:'text',text:'Free target',style:{fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#000000',align:'left',verticalAlign:'top',lineHeight:1.2}});
      if(kind==='image') Object.assign(target,{type:'image',resourceId:null,cropX:0,cropY:0,cropWidth:1,cropHeight:1});
      await evaluate(`canvasTest.store.getState().addElement(canvasTest.snapshot().slide.id,${JSON.stringify({...target,rotation:0,opacity:1,locked:false,visible:true,type:target.type??'shape',shapeType:target.shapeType??'rect',stroke:'#000000',strokeWidth:2,cornerRadius:0})})`);
      if(kind==='label') await evaluate(`(async()=>{const {createTextElement}=await import('/src/utils/slideFactory.ts');canvasTest.store.getState().addElement(canvasTest.snapshot().slide.id,createTextElement({id:'label',text:'Bound target',containerId:'destination'}));})()`);
      await evaluate(`canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);await wait(100);
      const from=await screen([585,310]),to=await screen([748,403]); const before=await authoritative();
      await mouse('mouseMoved',from);assert.equal((await cue())?.state,'active');
      await modifier('Meta',true,4);assert.equal(await cue(),null);await modifier('Meta',false,0);assert.equal((await cue())?.state,'active');
      await mouse('mousePressed',from);await mouse('mouseMoved',to);
      assert.equal(await evaluate(`document.querySelector('[data-connector-highlight]')?.getAttribute('data-connector-highlight')`),'destination');
      assert.equal(await authoritative(),before);
      await modifier('Meta',true,4);assert.equal(await evaluate(`!!document.querySelector('[data-connector-highlight]')`),false);
      await modifier('Meta',false,0);await mouse('mouseReleased',to);
      const state=await snap(),arrow=state.slide.elements[state.slide.elementOrder.at(-1)];
      assert.equal(arrow.closed,false);assert.equal(arrow.startBinding.mode,'pinned');assert.equal(arrow.endBinding.elementId,'destination');assert.equal(arrow.endBinding.mode,'aim');assert.equal(state.undo,1);
      matrix.push({collab,kind,closedPreference:true,ordinaryDrop:'pinned-to-aim',meta:'stationary bypass/reacquire',previewWrites:0});
      if(kind==='label') {
        for(const changes of [{locked:true},{locked:false,visible:false}]) {
          await evaluate(`canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'destination',${JSON.stringify(changes)});canvasTest.editor.getState().setTool('arrow')`);
          await mouse('mouseMoved',await screen([200,100]));await mouse('mouseMoved',to);
          assert.equal(await evaluate(`!!document.querySelector('[data-connector-highlight]')`),false,'bound text cannot bypass parent eligibility');
        }
      }

    }
    for(const endKey of ['startBinding','endBinding']) {
      await setup({collab,tool:'select',subject:{shapeType:'path',x:250,y:200,width:120,height:70,points:[0,0,120,70],closed:false,stroke:'#a02555',strokeWidth:5,endHead:'triangle'}});
      await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('arrow',{closed:true});})()`);
      const handle=()=>evaluate(`(()=>{const n=[...document.querySelectorAll('.path-handles circle[fill="#fff"]')][${endKey==='startBinding'?0:1}],r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
      const to=await screen([585,310]),before=await authoritative();
      await mouse('mousePressed',await handle());await mouse('mouseMoved',to);assert.equal((await cue())?.state,'active');assert.equal(await authoritative(),before);await mouse('mouseReleased',to);
      assert.equal((await snap()).slide.elements.subject[endKey].mode,'pinned');
      await mouse('mousePressed',await handle());await mouse('mouseMoved',to);await modifier('Meta',true,4);await mouse('mouseReleased',to,4);await modifier('Meta',false,0);
      assert.equal((await snap()).slide.elements.subject[endKey],null,'Meta endpoint drop unbinds');
      await key('z','KeyZ',2);assert.equal((await snap()).slide.elements.subject[endKey].mode,'pinned');await key('z','KeyZ',2);assert.equal(await authoritative(),before);
      matrix.push({collab,endKey,closedPreference:true,endpoint:'rebind/unbind/exact undo'});
    }
    // Click-to-create shares two-point topology; three-point intent stays closed.
    for(const count of [2,3]) {
      await setup({collab});
      await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('arrow',{closed:true,curve:'smooth',endHead:'arrow'});})()`);
      const before=await authoritative();
      for(const point of [[585,310],[740,400],...(count===3?[[660,470]]:[])]) {const at=await screen(point);await mouse('mouseMoved',at);await mouse('mousePressed',at);await mouse('mouseReleased',at);}
      assert.equal(await authoritative(),before);await key('Enter');
      const state=await snap(),arrow=state.slide.elements[state.slide.elementOrder.at(-1)];
      assert.equal(arrow.points.length,count*2);assert.equal(arrow.closed,count===3);
      assert.equal(arrow.startBinding?.mode??null,count===2?'pinned':null);assert.equal(state.undo,1);
      assert.equal((await evaluate('canvasTest.preferences()')).arrow.closed,true);
      matrix.push({collab,clickVertices:count,closed:arrow.closed,startBinding:arrow.startBinding});
    }
    // Shift + remembered closure still yields a constrained open connector; Escape is exact.
    await setup({collab});await evaluate(`(async()=>{const {useCreationPreferences}=await import('/src/store/creationPreferences.ts');useCreationPreferences.getState().remember('arrow',{closed:true});})()`);
    const before=await authoritative(),start=await screen([585,310]),end=await screen([760,410]);
    await mouse('mouseMoved',start);await mouse('mousePressed',start);await mouse('mouseMoved',end);await modifier('Shift',true,8);
    const line=await shaft();assert(Math.abs((line[2]-line[0])-(line[3]-line[1]))<.002);
    await modifier('Shift',false,0);await key('Escape');await mouse('mouseReleased',end);assert.equal(await authoritative(),before);assert.equal((await snap()).undo,0);
    matrix.push({collab,closedPreference:true,shift:true,cancel:'exact'});
    // Real page reload hydrates remembered preferences, then reopens serialized fixture data.
    await mouse('mouseMoved',start);await evaluate(`canvasTest.editor.getState().setTool('arrow')`);await wait(50);
    await mouse('mousePressed',start);await mouse('mouseMoved',end);await mouse('mouseReleased',end);
    const saved=await snap(),id=saved.slide.elementOrder.at(-1),persisted=saved.slide.elements[id];assert.equal(persisted.startBinding.mode,'pinned');
    await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`});await waitForCanvasFixture(evaluate);await wait(100);
    assert.equal((await evaluate('canvasTest.preferences()')).arrow.closed,true,'reload retains closure preference');
    await evaluate(`canvasTest.setup(${JSON.stringify({mode:'production',collab,empty:true,targets:Object.values(saved.slide.elements)})})`);await wait(150);
    assert.deepEqual((await snap()).slide.elements[id],persisted,'reopened arrow retains open topology and durable binding');
    matrix.push({collab,reload:'preferences + persisted arrow unchanged'});

  }
  assert.deepEqual(errors,[]);
  await writeFile(`${evidence}/matrix.json`,JSON.stringify({matrix,errors},null,2));
} catch(error) {
  await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));
  await writeFile(`${evidence}/failure.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));throw error;
} finally { ws.close(); }
