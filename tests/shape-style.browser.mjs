import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas.browser.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page');
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.exceptionThrown') console.error('BROWSER ERROR', JSON.stringify(msg.params.exceptionDetails));
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
async function touchDrag(x,y,ex,ey) {
  for (const [type,points] of [['touchStart',[{x,y}]],['touchMove',[{x:ex,y:ey}]],['touchEnd',[]]]) {
    await send('Input.dispatchTouchEvent',{type,touchPoints:points}); await wait(40);
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
const absPoints = el => el.points.map((v, i) => v + (i % 2 ? el.y : el.x));
async function center(selector) { return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); const b=el.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`); }
async function check(name, run) { await run(); console.log(`PASS ${name}`); }
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(1600);
  await check('new drawing defaults and live preview agree; tools reset to select',async()=>{
    // This assertion concerns factory defaults, not settings remembered by other suites.
    await evaluate('canvasTest.resetPreferences()');
    await setup({empty:true,tool:'rect'});
    await mouse('mousePressed',60,70);await mouse('mouseMoved',220,180);
    assert(await evaluate(`Array.from(document.querySelectorAll('svg rect')).some(r=>r.getAttribute('rx')==='8'&&r.getAttribute('stroke')==='#000000'&&r.getAttribute('fill')==='transparent')`));
    await mouse('mouseReleased',220,180);
    const s=await snapshot(),el=lastShape(s);assert.equal(el.cornerRadius,8);assert.equal(el.stroke,'#000000');assert.equal(el.strokeWidth,2);assert.equal(el.fill,'');assert.equal(s.editor.tool,'select');
  });
  await check('shape alpha UI is independent, scrub undo/cancel works in JSON and Yjs', async () => {
    for (const collab of [false,true]) {
      await setup({ mode:'properties', collab, subject:{ fill:'#ff0000', stroke:'#0000ff', opacity:.4 } });
      assert(!await evaluate(`Array.from(document.querySelectorAll('#properties div')).some(e=>e.textContent==='Opacity')`));
      await click(...await center('button[title="Fill"]'));
      const fill=await center('[aria-label="Fill alpha"] .cursor-ew-resize');
      await drag(...fill,fill[0]-80,fill[1]);
      let s=await snapshot(); assert.equal(s.slide.elements.subject.fill,'rgba(255, 0, 0, 0.6)');
      assert.equal(s.slide.elements.subject.stroke,'#0000ff'); assert.equal(s.slide.elements.subject.opacity,.4); assert.equal(s.undo,1);
      await click(350,10); await click(...await center('button[title="Stroke"]'));
      const stroke=await center('[aria-label="Stroke alpha"] .cursor-ew-resize');
      await drag(...stroke,stroke[0]-120,stroke[1]);
      s=await snapshot(); assert.equal(s.slide.elements.subject.stroke,'rgba(0, 0, 255, 0.4)'); assert.equal(s.slide.elements.subject.fill,'rgba(255, 0, 0, 0.6)'); assert.equal(s.undo,2);
      await mouse('mousePressed',...stroke); await mouse('mouseMoved',stroke[0]+50,stroke[1]); await key('Escape'); await mouse('mouseReleased',stroke[0]+50,stroke[1]);
      assert.equal((await snapshot()).slide.elements.subject.stroke,'rgba(0, 0, 255, 0.4)'); assert.equal((await snapshot()).undo,2);
      // An unrelated current-state mutation cancels, and late alpha pointer events are inert.
      await mouse('mousePressed',...stroke); await mouse('mouseMoved',stroke[0]+50,stroke[1]);
      await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId,'subject',{fillStyle:'crosshatch'})`);
      await mouse('mouseReleased',stroke[0]+50,stroke[1]);
      s=await snapshot(); assert.equal(s.slide.elements.subject.stroke,'rgba(0, 0, 255, 0.4)'); assert.equal(s.slide.elements.subject.fillStyle,'crosshatch');
      await evaluate(`canvasTest.getActiveUndoManager() ? canvasTest.getActiveUndoManager().undo() : canvasTest.store.temporal.getState().undo()`); await wait(100);
      assert.equal((await snapshot()).slide.elements.subject.fillStyle,undefined);
      await click(350,10);await click(...await center('button[aria-label="Fill Style: Solid"]'));
      assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"][aria-label="Fill Style"] pattern').length`),2);
      await click(...await center('[role="radio"][aria-label="Hachure"]'));
      assert.equal((await snapshot()).slide.elements.subject.fillStyle,'hachure');
      await click(...await center('button[title="Fill"]'));
      await click(...await center('[aria-label="Fill alpha"] .cursor-ew-resize'));
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
      await send('Input.insertText',{text:'35'});await key('Enter');
      assert.equal((await snapshot()).slide.elements.subject.fill,'rgba(255, 0, 0, 0.35)');
      assert.equal((await snapshot()).slide.elements.subject.stroke,'rgba(0, 0, 255, 0.4)');

    }
  });
  await check('real SVG/Canvas raster: alpha, global opacity, hatch crossings, clipping, presenter/Create/export',async()=>{
    await setup({subject:{x:20,y:20,width:120,height:100,cornerRadius:0,strokeWidth:8,fill:'rgba(255, 0, 0, 0.5)',stroke:'rgba(0, 0, 255, 0.25)',opacity:.4}});
    const evidence=await evaluate(`(async()=>{
      const original=canvasTest.snapshot().slide.elements.subject;
      async function raster(el,mode){
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
        if(mode==='pdf') canvasTest.drawShapeElement(ctx,el);
        else {const img=new Image(); const markup=mode==='office' ? (await import('/src/utils/officeShape.ts')).officeShapeSvg(el) : canvasTest.arrowMarkup(el,mode);
          const url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'})); img.src=url;await img.decode();ctx.drawImage(img,0,0);URL.revokeObjectURL(url);}
        return {canvas,ctx,pixel:(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data)};
      }
      const matrix=[];
      for(const fillStyle of ['solid','hachure','crosshatch']) for(const shapeType of ['rect','ellipse','triangle','star','path']) {
        const el={...original,fillStyle,shapeType,closed:true,points:[0,0,120,0,80,100,0,70]};
        const reference=await raster(el,'static');
        for(const mode of ['presenter','create','office','pdf','export']) {
          const r=await raster(el,mode);if(mode==='export'){reference.ctx.globalCompositeOperation='destination-over';reference.ctx.fillStyle='#fff';reference.ctx.fillRect(0,0,960,540);}const a=reference.ctx.getImageData(0,0,160,140).data,b=r.ctx.getImageData(0,0,160,140).data;
          let err=0;for(let i=mode==='export'?0:3;i<a.length;i+=4) err+=Math.abs(a[i]-b[i]);
          const maxAlpha=Math.max(...Array.from(b).filter((_,i)=>i%4===3));
          matrix.push({fillStyle,shapeType,mode,error:err/(a.length/4),maxAlpha,center:r.pixel(64,64),outside:r.pixel(145,125)});
        }
      }
      const solid=await raster(original,'static'),pdf=await raster(original,'pdf');
      // A screenshot-ready matrix uses the same production leaf renderers.
      document.getElementById('fixture').style.display='none'; const gallery=document.createElement('div');gallery.id='gallery';document.body.appendChild(gallery);gallery.innerHTML='<div style="display:flex;flex-wrap:wrap">'+['solid','hachure','crosshatch'].map(fillStyle=>canvasTest.arrowMarkup({...original,id:'gallery-'+fillStyle,fillStyle,shapeType:'star',x:30,y:30,width:180,height:180,opacity:1},'static')).join('')+'</div>';
      return {matrix,solid:{fill:solid.pixel(60,60),stroke:solid.pixel(18,60),overlap:solid.pixel(22,60)},pdf:{fill:pdf.pixel(60,60),stroke:pdf.pixel(18,60),overlap:pdf.pixel(22,60)}};
    })()`);
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/shape-style-raster.json`,JSON.stringify(evidence,null,2));
    for(const row of evidence.matrix){assert(row.error<2,JSON.stringify(row));if(row.mode==='export')continue;assert(row.maxAlpha<=65,`composition/crossing alpha ${JSON.stringify(row)}`);assert.equal(row.outside[3],0);}
    assert(Math.abs(evidence.solid.fill[3]-51)<=1);assert(Math.abs(evidence.solid.stroke[3]-26)<=1);
    assert.deepEqual(evidence.pdf,evidence.solid);
    const shot=await send('Page.captureScreenshot');await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/shape-style-patterns.png`,Buffer.from(shot.data,'base64'));
  });
  await check('actual PPTX/ODP ZIP XML and embedded hatch assets preserve native alpha and composition',async()=>{
    await evaluate(`document.getElementById('gallery')?.remove();document.getElementById('fixture').style.display=''`);
    await setup({ subject:{ fill:'rgba(255, 0, 0, 0.5)',stroke:'rgba(0, 0, 255, 0.25)',opacity:1,cornerRadius:0 },targets:[
      {id:'hatch',shapeType:'star',x:300,y:80,width:180,height:150,rotation:25,opacity:.4,fill:'rgba(255, 0, 0, 0.5)',fillStyle:'crosshatch',stroke:'#000000'},
      {id:'alphaPath',shapeType:'path',x:500,y:300,width:120,height:100,closed:true,points:[0,0,120,0,80,100],fill:'rgba(255, 0, 0, 0.5)',stroke:'#000000'},
      {id:'legacy',x:520,y:80,width:120,height:100,opacity:.4,fill:'#ff0000',stroke:'#0000ff'},
    ]});
    const evidence=await evaluate(`(async()=>{
      const {default:JSZip}=await import('/node_modules/.vite/deps/jszip.js');
      const {exportPptx}=await import('/src/utils/exportPptx.ts');const {exportOdp}=await import('/src/utils/exportOdp.ts');
      const p=canvasTest.store.getState().presentation;
      const originalURL=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;
      const results={};
      try {
        for(const [name,fn] of [['pptx',exportPptx],['odp',exportOdp]]){
          const blobs=[];URL.createObjectURL=function(blob){blobs.push(blob);return originalURL.call(this,blob)};
          HTMLAnchorElement.prototype.click=function(){};
          await fn(p);const blob=blobs.at(-1);if(!blob)throw new Error(name+' produced no file');
          const zip=await JSZip.loadAsync(await blob.arrayBuffer());
          const xml=await zip.file(name==='pptx'?'ppt/slides/slide1.xml':'content.xml').async('string');
          const assets=[];for(const path of Object.keys(zip.files).filter(p=>p.endsWith('.svg'))){assets.push({path,svg:await zip.file(path).async('string')})}
          const pngs=Object.keys(zip.files).filter(p=>p.endsWith('.png'));
          const imported= name==='pptx' ? await (await import('/src/utils/importPptx.ts')).importPptx(new File([blob],'styles.pptx')) : await (await import('/src/utils/importOdp.ts')).importOdp(new File([blob],'styles.odp'));
          results[name]={xml,assets,pngs,imported};
        }
      }finally{URL.createObjectURL=originalURL;HTMLAnchorElement.prototype.click=originalClick}
      return results;
    })()`);
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/shape-style-office.json`,JSON.stringify(evidence,null,2));
    assert.match(evidence.pptx.xml,/<a:alpha val="50000"/);assert.match(evidence.pptx.xml,/<a:alpha val="25000"/);
    assert.match(evidence.odp.xml,/draw:opacity="50%"/);assert.match(evidence.odp.xml,/svg:stroke-opacity="25%"/);
    for(const format of ['pptx','odp']){
      const assets=evidence[format].assets;assert.equal(assets.length,3,'hatch, composition and alpha complex path use images, simple solid alpha remains native');
      const hatch=assets.find(a=>a.svg.includes('<pattern'));assert(hatch);assert.match(hatch.svg,/rotate\(25/);assert.match(hatch.svg,/opacity="0.4"/);assert.match(hatch.svg,/stroke="rgba\(255, 0, 0, 0.5\)"/);
      assert(!hatch.svg.includes('foreignObject'));
      const imported=evidence[format].imported;
      const shapes=Object.values(imported.slides[imported.slideOrder[0]].elements).filter(e=>e.type==='shape');
      assert(shapes.some(e=>e.fill==='rgba(255, 0, 0, 0.5)'&&e.stroke==='rgba(0, 0, 255, 0.25)'),format+' native alpha import roundtrip');
    }
    assert(evidence.pptx.pngs.length>=3,'PowerPoint SVGs have raster compatibility assets');
  });
  console.log('SHAPE STYLE BROWSER CHECKS PASSED');
} finally { ws.close(); }
