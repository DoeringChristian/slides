import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.CURRENT_SCHEMA_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-compatibility-removal/run/native-current`;
await mkdir(evidence, { recursive: true });
const target = (await (await fetch(`${cdp}/json/list`)).json()).find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(target);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0; const pending = new Map(), results = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { const [resolve, reject] = pending.get(m.id); pending.delete(m.id); m.error ? reject(m.error) : resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, [resolve, reject]); ws.send(JSON.stringify({ id, method, params })); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; }
const snap = () => evaluate('canvasTest.snapshot()');
const world = () => evaluate('canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements.subject)');
async function toggle() {
  const [x,y] = await evaluate(`(()=>{const label=[...document.querySelectorAll('label')].find(n=>n.textContent.trim()==='Pinned');label.scrollIntoView({block:'center'});const r=label.querySelector('input').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  await wait(80);
}
async function undo() { await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo()})()`); await wait(60); }
try {
  await send('Page.enable'); await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  for (const collab of [false,true]) for (const rotation of [0,37]) {
    await evaluate(`(async()=>{const {createShapeElement}=await import('/src/utils/slideFactory.ts');const {bindingAimPoint}=await import('/src/utils/connectorUtils.ts');const {pathBoundsFor}=await import('/src/utils/pathShapes.ts');const box=createShapeElement('rect',{id:'box',x:100,y:100,width:200,height:120,rotation:${rotation}});const binding={elementId:'box',mode:'pinned',fixedPoint:[1,.5]};const p=bindingAimPoint(binding,box);canvasTest.setup({mode:'properties',collab:${collab},subject:{shapeType:'path',...pathBoundsFor([p.x,p.y,p.x+200,p.y+100],'linear',false),startBinding:binding},targets:[box]})})()`);
    await wait(180); const before = await snap(), points = await world();
    await toggle(); const aim = await snap(); assert.equal(aim.slide.elements.subject.startBinding.mode,'aim');
    (await world()).forEach((v,i)=>assert(Math.abs(v-points[i])<1e-8,'unpin preserves current endpoint'));
    await wait(520); await toggle(); const pin = await snap(); assert.equal(pin.slide.elements.subject.startBinding.mode,'pinned');
    await undo(); assert.deepEqual((await snap()).slide.elements,aim.slide.elements);
    await undo(); assert.deepEqual((await snap()).slide.elements,before.slide.elements);
    await evaluate(`(()=>{canvasTest.store.getState().updateElement(canvasTest.snapshot().slide.id,'box',{x:180,width:260,height:90});})()`); await wait(80);
    const moved = await evaluate(`(async()=>{const {bindingAimPoint}=await import('/src/utils/connectorUtils.ts');const s=canvasTest.snapshot().slide;return {actual:canvasTest.pathPointsInSlide(s.elements.subject).slice(0,2),expected:bindingAimPoint(s.elements.subject.startBinding,s.elements.box)}})()`);
    assert(Math.hypot(moved.actual[0]-moved.expected.x,moved.actual[1]-moved.expected.y)<1e-8);
    await undo(); assert.deepEqual((await snap()).slide.elements,before.slide.elements);
    results.push({collab,rotation,unpinDisplacement:0,repin:true,undo:'exact',targetTransform:'follows pin'});
  }
  const roundtrip = await evaluate(`(async()=>{const {assertPresentation}=await import('/src/utils/currentPresentation.ts');const {importPresentationFile}=await import('/src/utils/importPresentation.ts');const {jsonToYDoc,yDocToJson}=await import('/src/collab/ySchema.ts');const p=canvasTest.store.getState().presentation;const json=await importPresentationFile(new File([JSON.stringify(p)],'current.json'));const html=await importPresentationFile(new File(['<script id="slides-payload" type="application/json">'+JSON.stringify(p).replace(/</g,'\\u003c')+'</script>'],'current.html'));const d=jsonToYDoc(p);const y=yDocToJson(d);d.destroy();assertPresentation(p);return {json,html,y,p}})()`);
  assert.deepEqual(roundtrip.json,roundtrip.p); assert.deepEqual(roundtrip.html,roundtrip.p); assert.deepEqual(roundtrip.y,roundtrip.p);
  await writeFile(`${evidence}/matrix.json`,JSON.stringify(results,null,2));
  await writeFile(`${evidence}/properties.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  console.log('PASS current native pin/unpin/repin, transform, undo, JSON/HTML/Yjs',results.length);
} finally { ws.close(); }
