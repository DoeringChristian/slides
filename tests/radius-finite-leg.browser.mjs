import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.RADIUS_FINITE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-radius-finite-leg/native`;
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
const close = (actual, expected, label) => { assert(actual, label); actual.forEach((v, i) => assert(Math.abs(v - expected[i]) < .002, `${label}: ${actual} != ${expected}`)); };
const center = selector => evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),b=n.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
const radiusMetrics = () => evaluate(`(async()=>{const {cornerRadiusControl,cornerRadiusClearance,readRadiusControlObstacles}=await import('/src/utils/cornerRadiusControl.ts');const c=cornerRadiusControl(canvasTest.snapshot().slide.elements.subject),g=document.querySelector('.corner-radius-handle'),n=g.querySelector('circle'),el=canvasTest.snapshot().slide.elements.subject,x=+n.getAttribute('cx')-el.x-c.x,y=+n.getAttribute('cy')-el.y-c.y;const zoom=canvasTest.editor.getState().zoom;return {maxRadius:c.maxRadius,interval:cornerRadiusClearance({...c,x:el.x+c.x,y:el.y+c.y},zoom,+n.getAttribute('r'),readRadiusControlObstacles(g,zoom)),cross:x*c.dy-y*c.dx,along:x*c.dx+y*c.dy,length:c.segmentLength,hit:+n.getAttribute('r'),guide:g.querySelector('line')?.outerHTML,point:[+n.getAttribute('cx'),+n.getAttribute('cy')],axis:[c.dx,c.dy],obstacles:[...document.querySelectorAll('.path-handles circle')].filter(n=>getComputedStyle(n).pointerEvents!=='none').map(n=>({x:+n.getAttribute('cx'),y:+n.getAttribute('cy'),r:+n.getAttribute('r')}))}})()`);
try {
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base+'/tests/canvas-fixture.html'});await waitForCanvasFixture(evaluate);
 for(const collab of [false,true])for(const coarse of [false,true])for(const zoom of [.5,1,2])for(const length of [40,240])for(const [name,points,rotation] of [['horizontal',[0,0,length,0,length,200,length+200,200],0],['vertical',[0,0,0,length,200,length,200,length+200],0],['diagonal',[0,0,length*Math.SQRT1_2,length*Math.SQRT1_2,length*Math.SQRT1_2,240,440,240],0],['rotated',[0,0,length,0,length,200,length+200,200],37]])for(const radius of [0,'default',20,'max']) {
  await send('Emulation.setTouchEmulationEnabled',{enabled:coarse,maxTouchPoints:1});
  const subject={shapeType:'path',x:400,y:250,width:440,height:440,points,rotation,endHead:'triangle',stroke:'#a02555',strokeWidth:5,strokeStyle:'dashed',fill:'#d8efec'};
  if(radius!=='default')subject.cornerRadius=radius==='max'?1000:radius;
  await evaluate(`canvasTest.setup(${JSON.stringify({mode:'production',collab,zoom,subject})})`);await wait(45);
  if(radius==='max'){await evaluate(`(async()=>{const {cornerRadiusControl}=await import('/src/utils/cornerRadiusControl.ts');const s=canvasTest.snapshot();canvasTest.store.getState().updateElement(s.slide.id,'subject',{cornerRadius:cornerRadiusControl(s.slide.elements.subject).maxRadius})})()`);await wait(30);}
  await evaluate(`document.querySelector('.corner-radius-handle').scrollIntoView({block:'center',inline:'center'})`);await wait(20);
  const metrics=await radiusMetrics(),visible=await evaluate(`getComputedStyle(document.querySelector('.corner-radius-handle')).visibility!=='hidden'`);
  const row={collab,coarse,zoom,length,name,radius,visible,...metrics};matrix.push(row);
  assert(length!==240||visible,'comfortably long first leg MUST retain puck '+JSON.stringify(row));
  if(!visible){assert.equal(length,40,'only short fixtures may need property fallback');continue;}
  const finite=m=>{assert(Math.abs(m.cross)<1e-6);assert(m.along-m.hit>=-1e-6&&m.along+m.hit<=m.length+1e-6,'entire hit within finite first leg '+JSON.stringify(m));};finite(metrics);
  const p=await center('.corner-radius-handle circle');assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.corner-radius-handle')`),'native radius acquisition');
  assert(await evaluate(`(()=>{const r=document.querySelector('.corner-radius-handle circle'),b=r.getBoundingClientRect();return [...document.querySelectorAll('.path-handles circle')].filter(n=>getComputedStyle(n).pointerEvents!=='none').every(n=>{const q=n.getBoundingClientRect();return Math.hypot(b.x+b.width/2-q.x-q.width/2,b.y+b.height/2-q.y-q.height/2)>(+r.getAttribute('r')+ +n.getAttribute('r'))*${zoom}-1e-5})})()`),'native endpoint/midpoint/focus envelopes separate');
  const storedRadius=(await snap()).slide.elements.subject.cornerRadius??0;
  const expectedAlong=metrics.interval.end-Math.max(0,Math.min(1,storedRadius/metrics.maxRadius))*(metrics.interval.end-metrics.interval.start);
  assert(Math.abs(metrics.along-expectedAlong)<1e-6,'zero nearest vertex 2, increasing radius back toward midpoint');
  if(!collab&&zoom===1&&length===240)await writeFile(`${evidence}/${name}-${coarse}-${radius}.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  const pointer=async(type,point)=>{if(coarse){await send('Input.dispatchTouchEvent',{type:type==='mousePressed'?'touchStart':type==='mouseMoved'?'touchMove':'touchEnd',touchPoints:type==='mouseReleased'?[]:[{x:point[0],y:point[1],id:0}]});await wait(35);}else await mouse(type,point);};
  const a=rotation*Math.PI/180,axis=[metrics.axis[0]*Math.cos(a)-metrics.axis[1]*Math.sin(a),metrics.axis[0]*Math.sin(a)+metrics.axis[1]*Math.cos(a)],q=[p[0]+8*zoom*axis[0],p[1]+8*zoom*axis[1]];
  if(radius===0){
   const original=await authoritative(),back=[p[0]-8*zoom*axis[0],p[1]-8*zoom*axis[1]];
   await pointer('mousePressed',p);close((await radiusMetrics()).point,metrics.point,'zero pointerdown no jump');await pointer('mouseMoved',back);
   assert.equal(await authoritative(),original,'zero preview cannot write JSON or Yjs');const increased=await radiusMetrics();assert(increased.along<metrics.along,'positive radius moves toward first vertex');finite(increased);
   await pointer('mouseReleased',back);assert(Math.abs((await snap()).slide.elements.subject.cornerRadius-8)<.03,'toward first vertex increases zero radius 1:1');assert.equal((await snap()).undo,1);
   // Keep distinct gestures outside the existing Yjs 500ms capture window.
   if(collab)await wait(550);
   const current=await center('.corner-radius-handle circle'),forward=[current[0]+8.1*zoom*axis[0],current[1]+8.1*zoom*axis[1]];
   await pointer('mousePressed',current);await pointer('mouseMoved',forward);await pointer('mouseReleased',forward);
   assert.equal((await snap()).slide.elements.subject.cornerRadius,0,'toward second vertex returns exactly to zero');assert.equal((await snap()).undo,2);close((await radiusMetrics()).point,metrics.point,'zero visual endpoint stable');
   await key('z','KeyZ',2);assert(Math.abs((await snap()).slide.elements.subject.cornerRadius-8)<.03);await key('z','KeyZ',2);assert.equal(await authoritative(),original,'both-direction exact undo');row.bothDirections=true;
  }
  if(radius!==20)continue;
  const before=await authoritative(),beforeShape=(await snap()).slide.elements.subject,oldPaint=await evaluate(`document.querySelector('[data-element-id="subject"]').outerHTML`);
  await pointer('mousePressed',p);close((await radiusMetrics()).point,metrics.point,'pointerdown no jump');await pointer('mouseMoved',q);assert.equal(await authoritative(),before,'preview cannot write JSON or Yjs');const live=await radiusMetrics();finite(live);assert(live.guide);assert(live.along>metrics.along,'decreasing radius moves toward vertex 2');assert(await evaluate(`(()=>{const g=document.querySelector('.corner-radius-handle'),l=g.querySelector('line'),c=g.querySelector('circle');return l.getAttribute('x2')===c.getAttribute('cx')&&l.getAttribute('y2')===c.getAttribute('cy')})()`),'guide ends at puck');
  assert.notEqual(await evaluate(`document.querySelector('[data-element-id="subject"]').outerHTML`),oldPaint,'actual styled transient geometry changes');
  assert(await evaluate(`!!document.querySelector('[data-element-id="subject"] path[stroke="#a02555"][stroke-dasharray]')`),'live preview retains styled shared stroke');
  if(!collab&&zoom===1)await writeFile(`${evidence}/${name}-${length}-${coarse}-live.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  await pointer('mouseReleased',q);const after=await snap();assert(Math.abs(after.slide.elements.subject.cornerRadius-12)<.03);assert.equal(after.undo,1);close((await radiusMetrics()).point,live.point,'release no jump');await key('z','KeyZ',2);assert.equal(await authoritative(),before,'exact single undo');await key('y','KeyY',2);assert.deepEqual((await snap()).slide.elements,after.slide.elements,'exact redo');await key('z','KeyZ',2);
  const c=await center('.corner-radius-handle circle'),end=[c[0]-200*zoom*axis[0],c[1]-200*zoom*axis[1]];
  await pointer('mousePressed',c);await pointer('mouseMoved',end);finite(await radiusMetrics());assert.equal(await authoritative(),before,'full-range preview remains transient');await key('Escape');await pointer('mouseReleased',end);assert.equal(await authoritative(),before,'exact cancel including out-of-leg pointer');assert.deepEqual((await snap()).slide.elements.subject,beforeShape);
  await pointer('mousePressed',c);await pointer('mouseMoved',end);await pointer('mouseReleased',end);const maximum=await evaluate(`(async()=>{const {cornerRadiusControl}=await import('/src/utils/cornerRadiusControl.ts');return cornerRadiusControl(canvasTest.snapshot().slide.elements.subject).maxRadius})()`);assert.equal((await snap()).slide.elements.subject.cornerRadius,Math.round(maximum*100)/100,'1:1 out-of-leg drag reaches persisted two-decimal global maximum');assert.equal((await snap()).undo,1);finite(await radiusMetrics());await key('z','KeyZ',2);assert.equal(await authoritative(),before,'max-radius exact undo');
 }
 // Genuine short-leg fallback still exposes the existing property editor in both stores.
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 for(const collab of [false,true]){
  await evaluate(`canvasTest.setup(${JSON.stringify({mode:'properties',collab,subject:{shapeType:'path',points:[0,0,40,0,40,200,240,200],cornerRadius:20}})})`);await wait(120);
  const p=await evaluate(`(()=>{const label=[...document.querySelectorAll('*')].find(n=>n.textContent==='Corner Radius'&&n.children.length===0);const n=label?.parentElement?.parentElement?.querySelector('.cursor-ew-resize');if(!n)throw Error('radius property unavailable');const b=n.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
  await mouse('mousePressed',p);await mouse('mouseReleased',p);await send('Input.insertText',{text:'100'});await key('Enter');assert.equal((await snap()).slide.elements.subject.cornerRadius,100);
 }
 assert.deepEqual(errors,[]);await writeFile(`${evidence}/matrix.json`,JSON.stringify(matrix,null,2));console.log(`PASS ${matrix.length} finite-first-leg cases; ${matrix.filter(r=>!r.visible).length} genuine short-leg fallbacks`);
} catch(error){await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));throw error;}finally{await send('Emulation.setTouchEmulationEnabled',{enabled:false});ws.close();}
