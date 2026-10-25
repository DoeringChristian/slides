import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const evidence = process.env.RADIUS_GUIDE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-radius-guide-correction/native`;
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

const center = selector => evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),b=n.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
const radiusMetrics = () => evaluate(`(async()=>{const {cornerRadiusControl}=await import('/src/utils/cornerRadiusControl.ts');const c=cornerRadiusControl(canvasTest.snapshot().slide.elements.subject),g=document.querySelector('.corner-radius-handle'),n=g.querySelector('circle'),el=canvasTest.snapshot().slide.elements.subject,x=+n.getAttribute('cx')-el.x-c.x,y=+n.getAttribute('cy')-el.y-c.y;return {cross:x*c.dy-y*c.dx,along:x*c.dx+y*c.dy,length:c.segmentLength,hit:+n.getAttribute('r'),guide:g.querySelector('line')?.outerHTML,point:[+n.getAttribute('cx'),+n.getAttribute('cy')],axis:[c.dx,c.dy],obstacles:[...document.querySelectorAll('.path-handles circle')].filter(n=>getComputedStyle(n).pointerEvents!=='none').map(n=>({x:+n.getAttribute('cx'),y:+n.getAttribute('cy'),r:+n.getAttribute('r')}))}})()`);
try {
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base+'/tests/canvas-fixture.html'});await waitForCanvasFixture(evaluate);await wait(500);
 for(const coarse of (process.env.SKIP_RADIUS?[]:process.env.COARSE_ONLY?[true]:[false,true]))for(const collab of [false,true])for(const zoom of [.5,1,2])for(const [name,points,rotation] of [['horizontal',[0,0,40,0,40,200,240,200],0],['vertical',[0,0,0,40,200,40,200,240],0],['diagonal',[0,0,40,40,40,120,240,120],0],['rotated',[0,0,40,0,40,200,240,200],37]]) {
  await send('Emulation.setTouchEmulationEnabled',{enabled:coarse,maxTouchPoints:1});
  const config={mode:'production',collab,zoom,subject:{shapeType:'path',x:400,y:250,width:240/zoom,height:240/zoom,points:points.map(v=>v/zoom),cornerRadius:20,rotation}};
  await evaluate(`canvasTest.setup(${JSON.stringify(config)})`);await wait(100);await evaluate(`document.querySelector('.corner-radius-handle circle').scrollIntoView({block:'center',inline:'center'})`);await wait(40);
  const before=await authoritative(),metrics=await radiusMetrics(),p=await center('.corner-radius-handle circle');const visible=await evaluate(`document.querySelector('.corner-radius-handle').getAttribute('visibility')!=='hidden'`);
  if(visible){assert(Math.abs(metrics.cross)<1e-6,'collinear first ordered leg');assert(metrics.along-metrics.hit>=-1e-6);assert(metrics.along+metrics.hit<=metrics.length+1e-6,'finite entire hit envelope');
  if(!rotation)for(const o of metrics.obstacles)assert(Math.hypot(metrics.point[0]-o.x,metrics.point[1]-o.y)>metrics.hit+o.r,'separate native hit envelopes '+JSON.stringify({coarse,collab,zoom,name,metrics,o}));
  assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.corner-radius-handle')`),'radius independently acquired');
  assert(await evaluate(`(()=>{const r=document.querySelector('.corner-radius-handle circle'),b=r.getBoundingClientRect();return [...document.querySelectorAll('.path-handles circle')].filter(n=>getComputedStyle(n).pointerEvents!=='none').every(n=>{const q=n.getBoundingClientRect();return Math.hypot(b.x+b.width/2-q.x-q.width/2,b.y+b.height/2-q.y-q.height/2)>(+r.getAttribute('r')+ +n.getAttribute('r'))*${zoom}})})()`),'rotated native center separation');
  const a=rotation*Math.PI/180,axis=[metrics.axis[0]*Math.cos(a)-metrics.axis[1]*Math.sin(a),metrics.axis[0]*Math.sin(a)+metrics.axis[1]*Math.cos(a)],q=[p[0]+8*zoom*axis[0],p[1]+8*zoom*axis[1]];
  const pointer=async(type,point)=>{if(coarse){await send('Input.dispatchTouchEvent',{type:type==='mousePressed'?'touchStart':type==='mouseMoved'?'touchMove':'touchEnd',touchPoints:type==='mouseReleased'?[]:[{x:point[0],y:point[1],id:0}]});await wait(40);}else await mouse(type,point);};
  if(!collab&&zoom===1)await writeFile(`${evidence}/${name}-${coarse}-start.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  await pointer('mousePressed',p);close((await radiusMetrics()).point,metrics.point,'pointerdown no jump');await pointer('mouseMoved',q);assert.equal(await authoritative(),before);const live=await radiusMetrics();assert(Math.abs(live.cross)<1e-6);assert(live.guide,'live leader');
  if(!collab&&zoom===1)await writeFile(`${evidence}/${name}-${coarse}-drag.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  await pointer('mouseReleased',q);const after=await snap();assert(Math.abs(after.slide.elements.subject.cornerRadius-12)<.03);assert.equal(after.undo,1);close((await radiusMetrics()).point,live.point,'release no jump');if(!collab&&zoom===1)await writeFile(`${evidence}/${name}-${coarse}-end.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));await key('z','KeyZ',2);assert.equal(await authoritative(),before);
  }else{assert(metrics.length*zoom<=57,'only genuinely short fixtures can omit puck');assert.equal(await authoritative(),before);}
  const pointer=async(type,point)=>{if(coarse){await send('Input.dispatchTouchEvent',{type:type==='mousePressed'?'touchStart':type==='mouseMoved'?'touchMove':'touchEnd',touchPoints:type==='mouseReleased'?[]:[{x:point[0],y:point[1],id:0}]});await wait(40);}else await mouse(type,point);};
  // The same nonzero-radius fixture must keep midpoint insertion independently usable.
  const mid=await center('.path-handles > g:first-of-type circle:last-child');assert(await evaluate(`!!document.elementFromPoint(${mid[0]},${mid[1]})?.closest('.path-handles')`));await pointer('mousePressed',mid);await pointer('mouseMoved',[mid[0]+18,mid[1]+18]);await pointer('mouseReleased',[mid[0]+18,mid[1]+18]);assert.equal((await snap()).slide.elements.subject.points.length,10);assert.equal((await snap()).slide.elements.subject.cornerRadius,20);
  await key('z','KeyZ',2);
  if(name!=='diagonal') {
   const side=name==='vertical'?'middle-left':'top-center';
   const sidePoint=await evaluate(`(()=>{const n=document.querySelector('[data-resize-handle="${side}"]'),b=n.getBBox(),m=n.getScreenCTM(),p=new DOMPoint(b.x+b.width*.75,b.y+b.height*.75).matrixTransform(m);return [p.x,p.y]})()`);
   assert(await evaluate(`!!document.elementFromPoint(${sidePoint[0]},${sidePoint[1]})?.closest('[data-resize-handle]')`),'nearby side band retains acquisition');
   await pointer('mousePressed',sidePoint);await pointer('mouseMoved',[sidePoint[0]-12,sidePoint[1]-12]);await pointer('mouseReleased',[sidePoint[0]-12,sidePoint[1]-12]);assert.equal((await snap()).slide.elements.subject.cornerRadius,20);assert.equal((await snap()).undo,1);
  }
  matrix.push({coarse,collab,zoom,name,metrics});
 }
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 for(const collab of [false,true])for(const operation of ['create','start','end']) {
  await setup({collab,tool:operation==='create'?'line':'select',target:{x:100,y:100,width:200,height:120},subject:operation==='create'?undefined:{shapeType:'path',x:600,y:460,width:50,height:50,points:operation==='start'?[0,0,50,50]:[50,50,0,0],stroke:'#a02555',strokeWidth:5}});
  await pan([400,300]);await wait(40);
  if(operation==='create'){const p=await screen([600,460]);await mouse('mousePressed',p);await mouse('mouseReleased',p);}else{await evaluate(`canvasTest.editor.getState().beginPathExtension('subject','${operation}')`);await wait(80);}
  await modifier('Shift',true,8);const dock=await screen([305,165]);await mouse('mouseMoved',dock,8);
  const marker=()=>evaluate(`(()=>{const n=document.querySelector('.alignment-guides .snap-destination');return n?[+n.getAttribute('cx'),+n.getAttribute('cy')]:null})()`);
  // Destination circles are rendered in absolute slide coordinates.
  const guideEnd=()=>evaluate(`(()=>{const n=document.querySelector('.alignment-guides line');return [+n.getAttribute('x2'),+n.getAttribute('y2')]})()`);
  close(await guideEnd(),[300,160],'resolved dock guide');close(await marker(),[300,160],'resolved dock marker center');await modifier('Meta',true,12);close(await guideEnd(),[305,165],'raw Cmd guide');await modifier('Meta',false,8);close(await guideEnd(),[300,160],'restored dock guide');
  await mouse('mousePressed',dock,8);await mouse('mouseReleased',dock,8);const next=await screen([450,165]);await mouse('mouseMoved',next,8);const live=await shaft();assert(live,'live shaft after accepted dock');await key('Enter','Enter',8);await modifier('Shift',false,0);
  const ss=await snap(),path=ss.slide.elements[operation==='create'?ss.slide.elementOrder.at(-1):'subject'],pts=await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${path.id}'])`);const i=operation==='start'?2:pts.length-4;close(pts.slice(i,i+2),[300,160],'accepted dock remains interior');close(pts.slice(operation==='start'?0:-2,operation==='start'?2:undefined),[300+Math.hypot(150,5),160],'next ray anchored to resolved dock');assert.equal(ss.undo,1);matrix.push({collab,operation,chain:pts,marker:await marker()});
 }
 for(const collab of [false,true]) {
  await setup({collab,tool:'line',target:{x:100,y:100,width:200,height:120}});await pan([400,170]);await wait(40);const a=await screen([600,170]),b=await screen([250,170]);await mouse('mousePressed',a);await mouse('mouseMoved',b,8);
  const displayEnd=()=>evaluate(`(()=>{const n=document.querySelector('.alignment-guides line');return [+n.getAttribute('x2'),+n.getAttribute('y2')]})()`);
  close(await displayEnd(),(await shaft()).slice(-2),'ordinary aim final visible guide');close(await evaluate(`(()=>{const n=document.querySelector('.snap-destination');return [+n.getAttribute('cx'),+n.getAttribute('cy')]})()`),(await shaft()).slice(-2),'ordinary aim marker center');await modifier('Meta',true,12);close(await displayEnd(),[250,170],'ordinary aim raw Cmd replay');await modifier('Meta',false,8);close(await displayEnd(),(await shaft()).slice(-2),'ordinary aim restored guide');await mouse('mouseReleased',b,8);const ss=await snap();assert.equal(ss.slide.elements[ss.slide.elementOrder.at(-1)].endBinding.mode,'aim');await modifier('Shift',false,0);matrix.push({collab,ordinaryAimGuide:true});
 }
 // Guide intersection brings an ordinary edited endpoint into the dock budget.
 for(const collab of [false,true]) {
  await setup({collab,zoom:2,tool:'select',target:{x:100,y:100,width:200,height:120},subject:{shapeType:'path',x:600,y:160,width:100,height:0,points:[0,0,100,0],stroke:'#a02555',strokeWidth:5}});
  await evaluate(`canvasTest.store.getState().addElement(canvasTest.editor.getState().activeSlideId,{...canvasTest.snapshot().slide.elements.box,id:'guide',x:315,y:500,width:100,height:80});canvasTest.editor.setState({snapToGrid:true})`);await pan([500,160]);await wait(80);const p=await screen([700,160]),q=await screen([317,160]);await mouse('mousePressed',p);await mouse('mouseMoved',q,8);assert.equal((await cue())?.state,'active');await mouse('mouseReleased',q,8);assert.equal((await snap()).slide.elements.subject.endBinding?.mode,'pinned');matrix.push({collab,alignedEndpointDock:true});
 }
 for(const tool of ['polygon','bspline']) {await setup({tool,target:{x:400,y:250,width:180,height:120}});await evaluate(`canvasTest.editor.setState({snapToGrid:true})`);const p=await screen([402,280]);await mouse('mousePressed',p);await mouse('mouseReleased',p);await mouse('mouseMoved',await screen([200,100]));await key('Enter');const ss=await snap(),path=ss.slide.elements[ss.slide.elementOrder.at(-1)];const pts=await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${path.id}'])`);assert.equal(path.startBinding?.mode,'aim');assert(path.startBinding.fixedPoint[0]>0,'seed retains raw interior target intent');matrix.push({tool,seed:pts});}
 // Raw intent and accepted visible coordinates are one gesture-local terminal.
 // Do not deduplicate authored points elsewhere or append a zero-length segment.
 for(const collab of [false,true])for(const zoom of [.5,1,2])for(const operation of ['create','start','end'])for(const finish of ['Enter','rawEnter','repeated','double','Escape']) {
  await setup({collab,zoom,tool:operation==='create'?'line':'select',target:{x:100,y:100,width:200,height:120},subject:operation==='create'?undefined:{shapeType:'path',x:600,y:460,width:50,height:50,points:operation==='start'?[0,0,50,50]:[50,50,0,0],stroke:'#a02555',strokeWidth:5}});
  await pan([400,300]);await wait(40);const before=await authoritative();
  if(operation==='create'){const a=await screen([600,460]);await mouse('mousePressed',a);await mouse('mouseReleased',a);}else{await evaluate(`canvasTest.editor.getState().beginPathExtension('subject','${operation}')`);await wait(80);}
  await modifier('Shift',true,8);const raw=await screen([305,165]),visible=await screen([300,160]);await mouse('mouseMoved',raw,8);await mouse('mousePressed',raw,8);await mouse('mouseReleased',raw,8);
  const terminal=finish==='rawEnter'?raw:visible;await mouse('mouseMoved',terminal,8);const live=await shaft();assert.equal((await cue())?.state,'active','accepted terminal retains pin cue');assert.equal(await authoritative(),before);
  await modifier('Meta',true,12);assert.notEqual((await cue())?.state,'active','stationary Cmd suppresses binding');
  // Even a no-op click while binding is suppressed must retain BOTH identities.
  if(finish==='repeated'){await mouse('mousePressed',visible,12);await mouse('mouseReleased',visible,12);}
  await modifier('Meta',false,8);assert.equal((await cue())?.state,'active','stationary release restores acquired pin');close(await shaft(),live,'stationary no-op restores exact preview');
  if(finish==='repeated'||finish==='double'){await mouse('mousePressed',visible,8);await mouse('mouseReleased',visible,8);}
  if(!collab&&zoom===1&&finish==='Enter')await writeFile(`${evidence}/terminal-${operation}.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
  if(finish==='double') {
   for(const type of ['mousePressed','mouseReleased']){await send('Input.dispatchMouseEvent',{type,x:visible[0],y:visible[1],button:'left',buttons:type==='mousePressed'?1:0,clickCount:2,modifiers:8});await wait(30);}
  }else await key(finish==='Escape'?'Escape':'Enter',finish==='Escape'?'Escape':'Enter',8);
  await modifier('Shift',false,0);const ss=await snap();
  if(finish==='Escape'){assert.equal(await authoritative(),before);assert.equal(ss.undo,0);}
  else {
   const path=ss.slide.elements[operation==='create'?ss.slide.elementOrder.at(-1):'subject'];assert.equal(path.points.length,operation==='create'?4:6,'no duplicate accepted terminal');assert.equal(path[operation==='start'?'startBinding':'endBinding']?.mode,'pinned','no-op keeps acquired pin');
   const points=await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements['${path.id}'])`);close(operation==='start'?points.slice(0,2):points.slice(-2),[300,160],'accepted pin commit');close(await shaft(),live,'no-op preview equals commit');assert.equal(ss.undo,1);await key('z','KeyZ',2);assert.equal(await authoritative(),before,'exact single undo');await key('y','KeyY',2);assert.deepEqual((await snap()).slide.elements,ss.slide.elements,'exact redo');
  }
  matrix.push({collab,zoom,operation,finish,terminalIdentity:true});
 }
 // Dense explicit vertex envelopes block the bounded lane: property editing remains usable.
 const blocked={shapeType:'path',x:400,y:250,width:100,height:100,points:[0,0,40,0,60,0,80,0,100,0,100,100],cornerRadius:20};
 await evaluate(`canvasTest.setup({mode:'production',subject:${JSON.stringify(blocked)}})`);await wait(120);assert.equal(await evaluate(`document.querySelector('.corner-radius-handle').getAttribute('visibility')`),'hidden');assert(await evaluate(`document.querySelectorAll('.path-handles circle').length>0`));
 await evaluate(`canvasTest.setup({mode:'properties',subject:${JSON.stringify(blocked)}})`);await wait(150);
 const input=await evaluate(`(()=>{const label=[...document.querySelectorAll('*')].find(n=>n.textContent==='Corner Radius'&&n.children.length===0);const n=label?.parentElement?.parentElement?.querySelector('.cursor-ew-resize');if(!n)throw Error('radius property unavailable');const b=n.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);await mouse('mousePressed',input);await mouse('mouseReleased',input);await send('Input.insertText',{text:'13'});await key('Enter');assert.equal((await snap()).slide.elements.subject.cornerRadius,13);matrix.push({blockedPropertyFallback:true});
 assert.deepEqual(errors,[]);await writeFile(`${evidence}/matrix.json`,JSON.stringify(matrix,null,2));console.log(`PASS ${matrix.length} radius/guide corrections`);
} catch(error){await writeFile(`${evidence}/failure.json`,JSON.stringify({error:String(error),matrix,errors},null,2));throw error;}finally{await send('Emulation.setTouchEmulationEnabled',{enabled:false});ws.close();}
