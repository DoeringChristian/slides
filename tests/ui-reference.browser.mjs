import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/ui-reference.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
const runtimeErrors = [];
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text=msg.params.args.map(arg=>arg.value??arg.description??'').join(' ');
    if (/order of Hooks|Rendered (more|fewer) hooks|getSnapshot/.test(text)) runtimeErrors.push(text);
  }
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
async function pointerDrag(pointerType, p, q) {
  if(pointerType==='touch') {
    for(const [type,point] of [['touchStart',p],['touchMove',q],['touchEnd',null]]) {
      await send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:point[0],y:point[1],id:0}]:[]});await wait(40);
    }
  } else {
    for(const [type,point,buttons] of [['mousePressed',p,1],['mouseMoved',q,1],['mouseReleased',q,0]]) {
      await send('Input.dispatchMouseEvent',{type,x:point[0],y:point[1],pointerType,button:'left',buttons,clickCount:1});await wait(40);
    }
  }
}
async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await wait(50);
}
const snapshot = () => evaluate('canvasTest.snapshot()');
const lastShape = snap => snap.slide.elements[snap.slide.elementOrder.at(-1)];
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
const near = (actual, expected, message = '') => assert(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);
async function screen(x,y) { return evaluate(`(() => { const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM(); return [m.a*${x}+m.c*${y}+m.e,m.b*${x}+m.d*${y}+m.f]; })()`); }
async function world(id='subject') { return evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements[${JSON.stringify(id)}])`); }
async function select(ids) { await evaluate(`canvasTest.editor.getState().setSelectedElements(${JSON.stringify(ids)})`); await wait(60); }
async function modifier(type, keyName='Shift', modifiers=type==='keyDown'?8:0) {
  await send('Input.dispatchKeyEvent',{type,key:keyName,code:keyName==='Shift'?'ShiftLeft':'ControlLeft',windowsVirtualKeyCode:keyName==='Shift'?16:17,modifiers}); await wait(60);
}
async function guides() { return evaluate(`(() => { const g=document.querySelector('.alignment-guides'); return {hidden:g.getAttribute('visibility')==='hidden',markers:g.querySelectorAll('.snap-destination').length,html:g.outerHTML}; })()`); }
async function capture() { return evaluate(`Array.from(document.querySelectorAll('svg, svg *')).some(e=>e.hasPointerCapture?.(1))`); }
async function highlighted() { return evaluate(`!!document.querySelector('.ui-layer [stroke="#4285f4"][stroke-dasharray="6 3"]')`); }


try {
  await mkdir(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence`, { recursive: true });
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`${base}/tests/canvas-fixture.html`}); await waitForCanvasFixture(evaluate);await wait(1200);
  await check('final P1 pen/touch respect HTML overlays, including foreignObject controls, across zoom and rotation',async()=>{
    for(const pointerType of ['pen','touch'])for(const [zoom,rotation] of [[.5,0],[1,37],[2,0]])for(const nested of [false,true]){
      await setup({mode:'production',zoom,subject:{x:400,y:300,width:160,height:100,rotation}});
      const p=await center('[data-resize-handle="top-left"] [data-resize-visual]'),before=await snapshot();
      await evaluate(`(()=>{const button=document.createElement('button');button.id='occluding-control';button.textContent='UI';button.style.cssText='width:40px;height:40px;touch-action:none;background:#ffec99';window.overlayEvents=[];button.addEventListener('pointerdown',e=>{window.overlayEvents.push(e.pointerType);e.stopPropagation();});button.addEventListener('click',e=>{window.overlayEvents.push('click');e.stopPropagation();});
        if(${nested}){const svg=document.querySelector('.canvas-scroll-parent svg'),p=new DOMPoint(${p[0]},${p[1]}).matrixTransform(svg.getScreenCTM().inverse());const fo=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');fo.id='occluding-foreign-object';fo.setAttribute('x',p.x-20/${zoom});fo.setAttribute('y',p.y-20/${zoom});fo.setAttribute('width',40/${zoom});fo.setAttribute('height',40/${zoom});button.style.width='100%';button.style.height='100%';fo.append(button);svg.append(fo);}
        else{button.style.position='fixed';button.style.left='${p[0]-20}px';button.style.top='${p[1]-20}px';button.style.zIndex='10000';document.body.append(button);}})()`);
      assert.equal(await evaluate(`document.elementFromPoint(${p[0]},${p[1]}).id`),'occluding-control');
      await pointerDrag(pointerType,p,[p[0]+6,p[1]+4]);
      assert.deepEqual(await evaluate('window.overlayEvents'),[pointerType,'click'],`${pointerType}/${zoom}/${rotation}/${nested}: UI receives native input`);
      const after=await snapshot();assert.deepEqual(after.slide.elements,before.slide.elements);assert.equal(after.undo,0);
      if(pointerType==='touch'&&zoom===1&&!nested){const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/occluded-ui.png`,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.getElementById('occluding-foreign-object')?.remove();document.getElementById('occluding-control')?.remove()`);
    }
  });
  await check('final P1 enlarged zones cannot acquire occluded centers or scroll-clipped/offcanvas controls',async()=>{
    for(const pointerType of ['pen','touch'])for(const [zoom,rotation] of [[1,0],[.5,37]])for(const clipping of [false,true]){
      await setup({mode:'production',zoom,subject:{x:400,y:300,width:160,height:100,rotation}});
      let p=await center('[data-resize-handle="top-left"] [data-resize-visual]');const before=await snapshot();
      if(clipping){
        await evaluate(`(()=>{const viewport=document.querySelector('.canvas-scroll-parent');viewport.style.marginLeft='100px';viewport.scrollLeft+=${p[0]}+6;})()`);await wait(80);
        p=await center('[data-resize-handle="top-left"] [data-resize-visual]');
        const edge=await evaluate(`document.querySelector('.canvas-scroll-parent').getBoundingClientRect().left`);assert(Math.abs(p[0]-(edge-6))<=.51,'scrollLeft rounds to device CSS pixels');
        assert.equal(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]})?.closest('.canvas-scroll-parent')`),false,'control center is outside the scroll viewport');
        // Actual adjacent UI at the hidden projected control coordinate.
        await evaluate(`(()=>{const b=document.createElement('button');b.id='offcanvas-control';b.style.cssText='position:fixed;left:${p[0]-5}px;top:${p[1]-10}px;width:10px;height:20px;touch-action:none;z-index:10000';window.outsideDown=[];b.addEventListener('pointerdown',e=>{window.outsideDown.push(e.pointerType);e.stopPropagation();});document.body.append(b);})()`);
        await pointerDrag(pointerType,p,[p[0]+2,p[1]+2]);assert.deepEqual(await evaluate('window.outsideDown'),[pointerType]);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);assert.equal((await snapshot()).undo,0);
        await evaluate(`document.getElementById('offcanvas-control').remove()`);
      }else{
        await evaluate(`(()=>{const b=document.createElement('button');b.id='center-occluder';b.style.cssText='position:fixed;left:${p[0]-2}px;top:${p[1]-2}px;width:4px;height:4px;z-index:10000';document.body.append(b);})()`);
        assert.equal(await evaluate(`document.elementFromPoint(${p[0]},${p[1]}).id`),'center-occluder');
      }
      // Visible canvas point inside the enlarged zone, outside every native
      // side/corner target. Hidden centers must not enlarge into this region.
      const a=rotation*Math.PI/180,q=[p[0]+7*Math.cos(a)+7*Math.sin(a),p[1]+7*Math.sin(a)-7*Math.cos(a)];assert(await evaluate(`!!document.elementFromPoint(${q[0]},${q[1]})?.closest('.canvas-scroll-parent svg')`));
      assert.equal(await evaluate(`!!document.elementFromPoint(${q[0]},${q[1]})?.closest('[data-resize-handle]')`),false);
      await pointerDrag(pointerType,q,[q[0]+4,q[1]-4]);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);assert.equal((await snapshot()).undo,0);
      await evaluate(`document.getElementById('center-occluder')?.remove()`);
    }
  });
  await check('final P1 tiny12x12 native rotation and visible-corner ownership precede enlarged zones',async()=>{
    for(const pointerType of ['pen','touch'])for(const zoom of [.5,1,2])for(const rotation of [0,37]){
      await setup({mode:'production',zoom,subject:{x:400,y:300,width:12,height:12,rotation}});
      const r=await center('[data-rotation-visual]'),c=await screen(406,306),dist=Math.hypot(c[0]-r[0],c[1]-r[1]);
      // At1x/0deg this is precisely the reported (406,283) rotation hit.
      const p=[r[0]+3*(c[0]-r[0])/dist,r[1]+3*(c[1]-r[1])/dist],q=[c[0]-(p[1]-c[1]),c[1]+p[0]-c[0]];
      assert(await evaluate(`document.elementFromPoint(${p[0]},${p[1]}).hasAttribute('data-rotation-visual')`));
      await pointerDrag(pointerType,p,q);const state=await snapshot(),el=state.slide.elements.subject;
      assert(Math.abs(el.rotation-(rotation+90))<.1,`${pointerType}/${zoom}/${rotation}: actual rotation, not corner resize`);near(el.width,12);near(el.height,12);near(el.x,400);near(el.y,300);assert.equal(state.undo,1);
    }
    for(const rotation of [0,37])for(const nativeCorner of [false,true]){
      await setup({mode:'production',subject:{x:400,y:300,width:12,height:12,rotation}});
      const c=await screen(406,306),a=rotation*Math.PI/180,local=nativeCorner?[1,-3]:[0,8];
      const h=await center(nativeCorner?'[data-resize-handle="top-left"] [data-resize-visual]':'[data-rotation-visual]');
      const p=[h[0]+local[0]*Math.cos(a)-local[1]*Math.sin(a),h[1]+local[0]*Math.sin(a)+local[1]*Math.cos(a)];
      const q=nativeCorner?[p[0]+2*Math.cos(a)-2*Math.sin(a),p[1]+2*Math.sin(a)+2*Math.cos(a)]:[c[0]-(p[1]-c[1]),c[1]+p[0]-c[0]];
      if(nativeCorner)assert(await evaluate(`document.elementFromPoint(${p[0]},${p[1]}).hasAttribute('data-resize-visual')`));
      else assert.equal(await evaluate(`document.elementFromPoint(${p[0]},${p[1]}).hasAttribute('data-rotation-visual')`),false,'tests enlarged rotation, not native circle');
      await pointerDrag('touch',p,q);const state=await snapshot(),el=state.slide.elements.subject;
      if(nativeCorner){near(el.rotation,rotation);assert(Math.abs(el.width-10)<.01);assert(Math.abs(el.height-10)<.01);}
      else{assert(Math.abs(el.rotation-(rotation+90))<.1);near(el.width,12);near(el.height,12);}
      assert.equal(state.undo,1);
    }
    const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/tiny-controls.png`,Buffer.from(shot.data,'base64'));
  });
  await check('final P1 actual presenter fill-only Create at t.2 paints outline pixels, input retains actual paint only',async()=>{
    for(const shapeType of ['rect','ellipse','triangle','star']){
      const evidence=await evaluate(`(async()=>{const {createShapeElement}=await import('/src/utils/slideFactory.ts');const el=createShapeElement('${shapeType}',{x:60,y:60,width:160,height:100,fill:'#123456',stroke:'',strokeWidth:0});const markup=canvasTest.arrowMarkup(el,'create',.2),doc=new DOMParser().parseFromString(markup,'image/svg+xml'),path=doc.querySelector('path');const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);await img.decode();const c=document.createElement('canvas');c.width=400;c.height=400;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,400,400).data;let painted=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)painted++;return{markup,stroke:path.getAttribute('stroke'),strokeOpacity:+path.getAttribute('stroke-opacity'),fillOpacity:+path.getAttribute('fill-opacity'),length:+path.getAttribute('stroke-dasharray'),offset:+path.getAttribute('stroke-dashoffset'),painted,png:c.toDataURL()};})()`);
      assert.equal(evidence.stroke,'#123456');near(evidence.strokeOpacity,1);near(evidence.fillOpacity,0);assert(evidence.offset>0&&evidence.offset<evidence.length);assert(evidence.painted>20&&evidence.painted<4000,shapeType+' visible partial outline, not blank or steady fill');
      await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/create-`+shapeType+'-t02.png',Buffer.from(evidence.png.split(',')[1],'base64'));delete evidence.png;await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/create-`+shapeType+'-t02.json',JSON.stringify(evidence,null,2));
    }
    for(const strokeWidth of [0,4]){
      await setup({mode:'production',subject:{x:400,y:300,width:160,height:100,fill:'#123456',stroke:'',strokeWidth}});await select([]);
      await click(...await screen(398,350));assert.deepEqual((await snapshot()).editor.selected,[],'Create tracing paint must not become a body stroke');
      await click(...await screen(410,350));assert.deepEqual((await snapshot()).editor.selected,['subject']);
    }
  });
  await check('reference-sized normal selection controls at 100% and 90%, whole-side hit, rotation and hover geometry',async()=>{
    for(const zoom of [1,.9]) {
      await setup({mode:'production',zoom,subject:{x:400,y:300,width:200,height:150}});
      const metrics=await evaluate(`(()=>{const g=document.querySelector('.selection-transformer'),b=g.querySelector('rect'),corner=g.querySelector('g[data-resize-handle] rect[fill="white"]'),circles=[...g.querySelectorAll('circle')];return {border:[+b.getAttribute('x'),+b.getAttribute('y'),+b.getAttribute('width'),+b.getAttribute('height')],stroke:+b.getAttribute('stroke-width'),corner:+corner.getAttribute('width'),radius:+corner.getAttribute('rx'),rotationR:+circles.at(-1).getAttribute('r'),rotationY:+circles.at(-1).getAttribute('cy')};})()`);
      near(metrics.stroke*zoom,1);near(metrics.corner*zoom,8);near(metrics.radius*zoom,2);near(metrics.rotationR*zoom,4);near((300-metrics.rotationY)*zoom,20);
      near(metrics.border[0],400-4/zoom);near(metrics.border[2],200+8/zoom);
      const p=await screen(600+4/zoom,340);await drag(...p,p[0]+20,p[1]);near((await snapshot()).slide.elements.subject.width,200+20/zoom);
      await select([]);await mouse('mouseMoved',...await screen(360,370));await mouse('mouseMoved',...await screen(400,370));await wait(80);
      near(await evaluate(`+document.querySelector('.hover-outline rect').getAttribute('stroke-width')`)*zoom,1);
      const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/ours-hover-`+zoom+'.png',Buffer.from(shot.data,'base64'));
      await select(['subject']);const selected=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/ours-rectangle-`+zoom+'.png',Buffer.from(selected.data,'base64'));
    }
  });
  await check('no bbox blank-space body hits: paths, triangle corners, unfilled interiors, vector holes and whitespace',async()=>{
    const ring={kind:'vector',version:1,contours:[{id:'outer',start:[.1,.1],segments:[{kind:'line',to:[.9,.1]},{kind:'line',to:[.9,.9]},{kind:'line',to:[.1,.9]}],closed:true},{id:'inner',start:[.35,.35],segments:[{kind:'line',to:[.65,.35]},{kind:'line',to:[.65,.65]},{kind:'line',to:[.35,.65]}],closed:true}],fills:[{contourIds:['outer','inner'],rule:'evenodd'}],strokes:['outer','inner']};
    for(const zoom of [.5,1,2]) for(const rotation of [0,37]) for(const kind of ['rect','triangle','path','vector']) {
      const subject={x:300,y:200,width:200,height:160,rotation,shapeType:kind,fill:kind==='triangle'||kind==='vector'?'#ff0000':'',...(kind==='path'?{points:[0,0,200,160],endHead:'triangle'}:{}),...(kind==='vector'?{geometry:ring}:{})};
      await setup({mode:'production',zoom,subject});await select([]);
      const point=async(x,y)=>{const a=rotation*Math.PI/180,dx=x-100,dy=y-80;return screen(400+dx*Math.cos(a)-dy*Math.sin(a),280+dx*Math.sin(a)+dy*Math.cos(a));};
      const blank=kind==='triangle'?[5,5]:kind==='path'?[20,130]:[100,80];
      await click(...await point(...blank));assert.deepEqual((await snapshot()).editor.selected,[],kind+' empty body region');
      if(kind==='vector'){await click(...await point(2,80));assert.deepEqual((await snapshot()).editor.selected,[],'icon design whitespace');}
      const hit=kind==='triangle'?[100,90]:kind==='path'?[50,40]:kind==='vector'?[30,80]:[0,80];
      await click(...await point(...hit));assert.deepEqual((await snapshot()).editor.selected,['subject'],kind+' actual geometry');
    }
  });
  await check('final user gate: sole one-segment paths have no bbox; multisegment paths retain it outside point editing',async()=>{
    for(const endHead of ['none','triangle'])for(const multi of [false,true]) {
      await setup({mode:'production',subject:{x:400,y:300,width:250,height:110,shapeType:'path',points:multi?[0,0,120,110,250,70]:[0,0,250,70],endHead,curve:'linear'}});
      assert.equal(await evaluate(`!!document.querySelector('.selection-transformer')`),multi,JSON.stringify({endHead,multi,state:await snapshot()}));
      assert(await evaluate(`!!document.querySelector('.path-handles')`));
      const name='ours-final-'+(endHead==='none'?'line':'arrow')+'-'+(multi?'multi':'two');const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/`+name+'.png',Buffer.from(shot.data,'base64'));
      if(multi){const p=await screen(520,410);await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+20,p[1]+10);assert.equal(await evaluate(`!!document.querySelector('.selection-transformer')`),false);await mouse('mouseReleased',p[0]+20,p[1]+10);assert(await evaluate(`!!document.querySelector('.selection-transformer')`));}
    }
  });
  await check('P1 zero-width open paths remain painted, selectable and draggable; JSON/Yjs single undo',async()=>{
    for(const collab of [false,true])for(const zoom of [.5,1,2]){
      await setup({mode:'production',collab,zoom,subject:{x:400,y:300,width:200,height:1,shapeType:'path',points:[0,0,200,0],strokeWidth:0,endHead:'none'}});await select([]);
      near(await evaluate(`+document.querySelector('[data-element-id="subject"] path[stroke="#000000"]').getAttribute('stroke-width')`),3);
      const p=await screen(450,300);await click(...p);assert.deepEqual((await snapshot()).editor.selected,['subject']);const before=await snapshot();
      await drag(...p,p[0]+24,p[1]+12);let after=await snapshot();near(after.slide.elements.subject.x-before.slide.elements.subject.x,24/zoom);near(after.slide.elements.subject.y-before.slide.elements.subject.y,12/zoom);assert.equal(after.undo,1);
      await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
      await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
  });
  await check('P1 extreme elliptical rectangle radii: actual painted/empty pointer regions',async()=>{
    for(const zoom of [.5,1,2])for(const filled of [false,true]){
      await setup({mode:'production',zoom,subject:{x:400,y:300,width:200,height:40,cornerRadius:100,fill:filled?'#e03131':'',stroke:filled?'transparent':'#000000'}});await select([]);
      await click(...await screen(filled?425:400,filled?303:300));assert.deepEqual((await snapshot()).editor.selected,[]);
      const p=await screen(filled?500:400,320);await click(...p);assert.deepEqual((await snapshot()).editor.selected,['subject']);
      await select([]);await drag(...p,p[0]+20,p[1]+10);near((await snapshot()).slide.elements.subject.x,400+20/zoom);
    }
  });
  await check('multipoint corners outside border, independent side bands and rotation clearance at zoom/rotation',async()=>{
    for(const zoom of [.5,1,2])for(const rotation of [0,37]){
      await setup({mode:'production',zoom,subject:{x:400,y:300,width:200,height:120,rotation,shapeType:'path',points:[0,0,90,120,200,40],endHead:'triangle'}});
      const m=await evaluate(`(()=>{const g=document.querySelector('.selection-transformer'),b=g.querySelector('rect'),c=g.querySelector('[data-resize-handle="top-left"] [data-resize-visual]'),s=g.querySelector('[data-resize-handle="middle-left"]'),r=g.querySelector('[data-rotation-visual]');return {bx:+b.getAttribute('x'),by:+b.getAttribute('y'),cx:+c.getAttribute('x')+ +c.getAttribute('width')/2,cy:+c.getAttribute('y')+ +c.getAttribute('height')/2,sx:+s.getAttribute('x'),ry:+r.getAttribute('cy')};})()`);
      near((m.bx-m.cx)*zoom,8);near((m.by-m.cy)*zoom,8);near((m.by-m.ry)*zoom,24);near((m.bx-m.sx)*zoom,4);
      const p=await center('[data-resize-handle="bottom-right"] [data-resize-visual]');assert(await evaluate(`!!document.elementFromPoint(${p[0]},${p[1]}).closest('[data-resize-handle]')`));const before=await world();await drag(...p,p[0]+18,p[1]+14);assert.notDeepEqual(await world(),before);assert.equal((await snapshot()).undo,1);
      if(zoom===1){const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/multipoint-`+rotation+'.png',Buffer.from(shot.data,'base64'));}
    }
  });
  await check('actual mouse8/pen16/touch28 acquisition on fine-pointer desktop, no mouse body swallowing',async()=>{
    for(const pointerType of ['mouse','pen','touch']){
      await setup({mode:'production',subject:{x:400,y:300,width:200,height:120}});
      const p=await center('[data-resize-handle="top-left"] [data-resize-visual]'),offset=pointerType==='touch'?12:6;
      const x=p[0]+offset,y=p[1]+offset;
      if(pointerType==='touch'){
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});await wait(50);
        await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+24,y:y+16,id:0}]});await wait(50);
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(100);
      }else{for(const [type,dx,dy,buttons] of [['mousePressed',0,0,1],['mouseMoved',24,16,1],['mouseReleased',24,16,0]]){await send('Input.dispatchMouseEvent',{type,x:x+dx,y:y+dy,button:'left',buttons,pointerType,clickCount:1});await wait(50);}}
      const state=await snapshot();if(pointerType==='mouse'){near(state.slide.elements.subject.width,200);near(state.slide.elements.subject.x,424);near(state.slide.elements.subject.y,316);assert.equal(state.undo,1);}else{near(state.slide.elements.subject.width,176);assert.equal(state.undo,1);}
    }
  });
  await check('sole two-point Ctrl endpoint resize: fixed original center, Shift ray, rotated geometry and JSON/Yjs undo',async()=>{
    for(const collab of [false,true])for(const index of [0,1])for(const bits of [2,10])for(const rotation of [0,37]){
      await setup({mode:'production',collab,subject:{x:400,y:300,width:200,height:100,rotation,shapeType:'path',points:[0,0,200,100],endHead:'triangle'}});
      const before=await snapshot(),v=await world(),p=await screen(v[2*index],v[2*index+1]);
      await mouse('mousePressed',...p,1,bits);await mouse('mouseMoved',p[0]+35,p[1]+19,1,bits);await mouse('mouseReleased',p[0]+35,p[1]+19,1,bits);
      const out=await world();near(out[0]+out[2],v[0]+v[2]);near(out[1]+out[3],v[1]+v[3]);assert.notDeepEqual(out,v);assert.equal((await snapshot()).undo,1);
      if(bits&8){const angle=Math.atan2(out[3]-out[1],out[2]-out[0])*180/Math.PI;near(angle/45,Math.round(angle/45));}
      const after=await snapshot();await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);await key('y','KeyY',2);assert.deepEqual((await snapshot()).slide.elements,after.slide.elements);
    }
    await setup({mode:'production',subject:{x:400,y:300,width:200,height:100,shapeType:'path',points:[0,0,200,100]}});
    const before=await snapshot(),p=await screen(600,400);await mouse('mousePressed',...p);await mouse('mouseMoved',p[0]+30,p[1]+10);await modifier('keyDown','Control',2);await modifier('keyUp','Control',0);await mouse('mouseReleased',p[0]+30,p[1]+10);const out=await world();near(out[0],400);near(out[1],300);
    await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
  });
  await check('actual image body/zero-margin controls, rotation drag and action button isolation',async()=>{
    for(const image of [false,true]){
      await setup({mode:'production',subject:{x:400,y:300,width:200,height:100,...(image?{type:'image',resourceId:'test-image'}:{fill:'#ff0000'})}});
      if(image){await evaluate(`(()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#1971c2';ctx.fillRect(0,0,200,100);canvasTest.store.getState().addResource({id:'test-image',name:'Pointer image fixture',type:'image',src:c.toDataURL(),originalWidth:200,originalHeight:100});canvasTest.store.temporal.getState().clear();})()`);await wait(150);assert(await evaluate(`!!document.querySelector('[data-element-id="subject"] img')`));}
      const border=await evaluate(`+document.querySelector('.selection-transformer > rect').getAttribute('x')`);near(border,image?400:396);
      if(image){const p=await screen(470,340);await drag(...p,p[0]+20,p[1]+10);near((await snapshot()).slide.elements.subject.x,420);await key('z','KeyZ',2);}
      const p=await center('[data-rotation-visual]'),c=await screen(500,350),dx=p[0]-c[0],dy=p[1]-c[1];await mouse('mousePressed',...p);await mouse('mouseMoved',c[0]-dy,c[1]+dx,1,8);await mouse('mouseReleased',c[0]-dy,c[1]+dx,1,8);near((await snapshot()).slide.elements.subject.rotation,90);
      const before=await snapshot();await click(...await center('button[title="Lock"]'));const after=await snapshot();assert.equal(after.slide.elements.subject.locked,true);for(const field of ['x','y','width','height','rotation'])assert.equal(after.slide.elements.subject[field],before.slide.elements.subject[field]);assert.equal(after.undo,before.undo+1);
      const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/ui-final-evidence/rotation-action-`+image+'.png',Buffer.from(shot.data,'base64'));
    }
  });
  await check('actual pointer picks arrowhead interiors, bends and Bezier overshoot; ignores bbox blanks',async()=>{
    for(const kind of ['head','bend','bezier']){
      await setup({mode:'production',subject:{x:400,y:300,width:200,height:100,shapeType:'path',points:kind==='bend'?[0,0,100,100,200,0]:[0,0,200,0],endHead:kind==='head'?'triangle':'none',strokeWidth:kind==='head'?8:2,curve:kind==='bezier'?'bezier':'linear',...(kind==='bezier'?{tangents:[0,0,0,-180,0,-180,0,0]}:{})}});await select([]);
      const hit=kind==='head'?[590,303]:kind==='bend'?[500,400]:[500,165];await click(...await screen(...hit));assert.deepEqual((await snapshot()).editor.selected,['subject'],kind+' actual paint');
      await select([]);await click(...await screen(430,380));assert.deepEqual((await snapshot()).editor.selected,[],kind+' bbox blank');
    }
  });
  await check('overlapping objects and bound label keep pointer priority over path geometry',async()=>{
    await setup({mode:'production',subject:{x:400,y:300,width:200,height:1,shapeType:'path',points:[0,0,200,0]},targets:[{id:'front',x:440,y:280,width:100,height:40,fill:'#ff0000'}]});await select([]);await click(...await screen(460,300));assert.deepEqual((await snapshot()).editor.selected,['front']);
    await evaluate(`(async()=>{const {createTextElement}=await import('/src/utils/slideFactory.ts');const sid=canvasTest.editor.getState().activeSlideId;canvasTest.store.getState().addElement(sid,createTextElement({id:'label',text:'Bound label',containerId:'subject',x:450,y:280,width:100,height:40}));})()`);await wait(150);await select([]);
    const p=await center('[data-element-id="label"]');await click(...p);assert.deepEqual((await snapshot()).editor.selected,['subject'],'bound label forwards to its container, not the overlapping front object');assert.equal((await snapshot()).editor.editing,null);
  });
  await check('centered endpoints retain compatible edge/pin bindings, detach moved opposite end, obey Cmd, preview=commit',async()=>{
    for(const collab of [false,true])for(const bits of [2,6,10,14])for(const dest of [695,740]){
      await setup({mode:'production',collab,subject:{x:400,y:300,width:200,height:1,shapeType:'path',points:[0,0,200,0],endHead:'triangle',startBinding:{elementId:'left',mode:'pinned',fixedPoint:[.5,.5]}},targets:[{id:'left',x:350,y:250,width:100,height:100},{id:'target',x:700,y:250,width:100,height:100}]});
      const before=await snapshot(),p=await screen(600,300),q=await screen(dest,300);await mouse('mousePressed',...p,1,bits);await mouse('mouseMoved',...q,1,bits);
      const preview=await evaluate(`[...document.querySelectorAll('.path-handles circle[fill="#fff"]')].map(c=>[+c.getAttribute('cx'),+c.getAttribute('cy')]).flat()`);near(preview[0]+preview[2],1000);near(preview[1]+preview[3],600);
      await mouse('mouseReleased',...q,1,bits);const after=await snapshot(),v=await world();v.forEach((x,i)=>near(x,preview[i],'bound center preview/commit'));assert.equal(after.slide.elements.subject.startBinding,null);assert.equal(!!after.slide.elements.subject.endBinding,!(bits&4));
      if(!(bits&4))assert.equal(after.slide.elements.subject.endBinding.mode,dest===695?'pinned':'aim');
      assert.equal(after.undo,1);await key('z','KeyZ',2);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
    }
  });
  assert.deepEqual(runtimeErrors,[]);console.log('UI REFERENCE FOCUSED CHECKS PASSED');
}finally{ws.close();}
