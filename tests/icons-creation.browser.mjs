import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas.browser.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
  await evaluate('canvasTest.resetPreferences()');
  await check('keyboard search chooses native icon; creation properties do not mutate deck; click placement is one undo in JSON and Yjs', async () => {
    for (const collab of [false,true]) {
      await setup({mode:'icons',empty:true,collab});
      await click(...await center('button[aria-label^="Icons:"]'));
      assert(await evaluate(`document.activeElement.getAttribute('aria-label')==='Search icons'`));
      await send('Input.insertText',{text:'sun'}); await wait(80);
      assert.equal(await evaluate(`document.querySelectorAll('[role="radio"]').length`),1);
      assert.equal((await snapshot()).editor.tool,'select');
      await key('ArrowDown'); await key('Enter');
      assert.equal((await snapshot()).editor.tool,'icon');
      assert(await evaluate(`document.querySelector('#creation-properties').textContent.includes('Create icon')`));
      assert(!await evaluate(`document.querySelector('#creation-properties button[title*="keyframe"]')`));
      assert.equal((await snapshot()).undo,0);
      await mouse('mousePressed',100,150); await mouse('mouseMoved',250,230);
      const preview = await evaluate(`Array.from(document.querySelectorAll('svg path')).filter(p=>p.getAttribute('d')?.includes('A ')).map(p=>p.getAttribute('d'))`);
      assert(preview.length>0);
      await mouse('mouseReleased',250,230);
      const snap=await snapshot(),el=lastShape(snap);
      assert.equal(el.shapeType,'vector'); assert.equal(el.geometry.provenance.icon,'sun');
      assert.equal(el.geometry.contours.length,9); assert.equal(el.width,64); assert.equal(el.height,64); assert.equal(el.x,218); assert.equal(el.y,198);
      assert.equal(snap.slide.elementOrder.length,1); assert.equal(snap.undo,1); assert.equal(snap.editor.tool,'select');
      await key('z','KeyZ',4); // macOS meta undo
      assert.equal((await snapshot()).slide.elementOrder.length,0);
    }
  });
  await check('icon fixed native box ignores drag distance and stationary Shift in JSON/Yjs',async()=>{
    for (const collab of [false,true]) for (const releaseShift of [false,true]) {
      await setup({mode:'icons',empty:true,tool:'icon',collab});
      await mouse('mousePressed',300,300); await mouse('mouseMoved',180,230);
      const previewD=()=>evaluate(`(() => {const paths=Array.from(document.querySelectorAll('svg path[stroke-linecap="round"]'));return paths.at(-1)?.getAttribute('d');})()`);
      const free=await previewD();assert(free);
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:8});await wait(80);
      const constrained=await previewD();assert(constrained);assert.equal(constrained,free);
      if(releaseShift){await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:0});await wait(80);assert.equal(await previewD(),free);}
      await mouse('mouseReleased',180,230,1,releaseShift?0:8);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,modifiers:0});await wait(50);
      const snap=await snapshot(),el=lastShape(snap);assert.equal(el.width,64);assert.equal(el.height,64);
      assert.equal(el.x,148);assert.equal(el.y,198);assert.equal(snap.undo,1);assert.equal(snap.editor.tool,'select');
      assert.equal(await previewD(),releaseShift?free:constrained);
    }
  });
  await check('draft scrub previews/cancel never persist; acceptance alone teaches in JSON/Yjs',async()=>{
    for(const collab of [false,true]) for(const populated of [false,true]) {
      await evaluate('canvasTest.resetPreferences()');
      if(populated) await evaluate(`(async()=>{const {useCreationPreferences:p}=await import('/src/store/creationPreferences.ts');p.getState().remember('icon',{strokeWidth:4,fill:'#ff000080'});})()`);
      await setup({mode:'icons',empty:true,tool:'icon',collab});
      const stored=()=>evaluate(`JSON.stringify({styles:canvasTest.preferences(),storage:localStorage.getItem('slides.creation-preferences.v1')})`);
      const before=await stored();
      const control=()=>evaluate(`(()=>{const row=Array.from(document.querySelectorAll('#creation-properties .min-w-0')).find(r=>r.textContent.startsWith('Stroke Width')&&r.querySelector('.cursor-ew-resize'));const el=row.querySelector('.cursor-ew-resize'),b=el.getBoundingClientRect();return {p:[b.x+b.width/2,b.y+b.height/2],text:el.textContent};})()`);
      const start=await control();
      await mouse('mousePressed',...start.p);await mouse('mouseMoved',start.p[0]+20,start.p[1]);
      assert.notEqual((await control()).text,start.text);assert.equal(await stored(),before);
      await key('Escape');await mouse('mouseReleased',start.p[0]+20,start.p[1]);
      assert.equal((await control()).text,start.text);assert.equal(await stored(),before);assert.equal((await snapshot()).undo,0);
      await mouse('mousePressed',...start.p);await mouse('mouseMoved',start.p[0]+20,start.p[1]);assert.equal(await stored(),before);
      await mouse('mouseReleased',start.p[0]+20,start.p[1]);
      assert.equal(await evaluate('canvasTest.preferences().icon.strokeWidth'),Number((await control()).text.trim()));
      assert.notEqual(await stored(),before);assert.equal((await snapshot()).undo,0);
      const accepted=await stored();
      await mouse('mousePressed',...start.p);await mouse('mouseMoved',start.p[0]+40,start.p[1]);assert.equal(await stored(),accepted);
      await evaluate(`canvasTest.editor.getState().setTool('select')`);await wait(80);await mouse('mouseReleased',start.p[0]+40,start.p[1]);
      assert.equal(await stored(),accepted);
    }
    await evaluate('canvasTest.resetPreferences()');
  });
  await check('pre-draw stroke setup persists without keyframe/history; reload and project switch retain style',async()=>{
    await setup({mode:'icons',empty:true,tool:'icon'});
    // Existing NumberProperty/ScrubInput accepts typed changes through the draft sink.
    const strokeCenter=await evaluate(`(() => { const row=Array.from(document.querySelectorAll('#creation-properties .min-w-0')).find(r=>r.textContent.startsWith('Stroke Width')&&r.querySelector('.cursor-ew-resize')); const b=row.querySelector('.cursor-ew-resize').getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`);
    await click(...strokeCenter); await send('Input.insertText',{text:'7'}); await key('Enter');
    assert.equal((await snapshot()).undo,0);
    assert.equal((await snapshot()).slide.elementOrder.length,0);
    assert.equal(await evaluate('canvasTest.preferences().icon.strokeWidth'),7);
    await send('Page.reload'); await wait(1200);
    await setup({mode:'icons',empty:true,tool:'icon'});
    assert.equal(await evaluate('canvasTest.preferences().icon.strokeWidth'),7);
    await click(240,260);
    assert.equal(lastShape(await snapshot()).strokeWidth,7);
  });
  await check('accepted existing edits teach defaults, undo and nonlocal/store edits do not',async()=>{
    await setup({mode:'icons',subject:{strokeWidth:2},collab:false});
    await click(...await evaluate(`(() => { const row=Array.from(document.querySelectorAll('#creation-properties .min-w-0')).find(r=>r.textContent.startsWith('Stroke Width')&&r.querySelector('.cursor-ew-resize')); const b=row.querySelector('.cursor-ew-resize').getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]; })()`));
    await send('Input.insertText',{text:'6'}); await key('Enter');
    assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),6);
    await evaluate('document.activeElement.blur()'); await key('z','KeyZ',4);
    assert.equal((await snapshot()).slide.elements.subject.strokeWidth,2);
    assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),6);
    await evaluate(`(async()=>{ const {usePresentationStore:s}=await import('/src/store/presentationStore.ts');const {useEditorStore:e}=await import('/src/store/editorStore.ts'); s.getState().updateElement(e.getState().activeSlideId,'subject',{strokeWidth:11}); })()`);
    assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),6);
    await setup({mode:'icons',subject:{strokeWidth:15}});
    assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),6);
  });
  await check('JSON/Yjs accepted scrub teaches once; cancelled scrub, keyframe reset and remote styles never teach',async()=>{
    for(const collab of [false,true]){
      await setup({mode:'icons',subject:{strokeWidth:2},collab,secondSlide:true});
      const strokeCenter=()=>evaluate(`(() => {const row=Array.from(document.querySelectorAll('#creation-properties .min-w-0')).find(r=>r.textContent.startsWith('Stroke Width')&&r.querySelector('.cursor-ew-resize'));const b=row.querySelector('.cursor-ew-resize').getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2];})()`);
      const p=await strokeCenter();await drag(p[0],p[1],p[0]+20,p[1]);
      const learned=await evaluate('canvasTest.preferences().rect.strokeWidth');
      assert.equal(learned,(await snapshot()).slide.elements.subject.strokeWidth);assert(learned>2);
      const q=await strokeCenter();await mouse('mousePressed',...q);await mouse('mouseMoved',q[0]+40,q[1]);await key('Escape');await mouse('mouseReleased',q[0]+40,q[1]);
      assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),learned);
      await evaluate(`(() => {const row=Array.from(document.querySelectorAll('#creation-properties .min-w-0')).find(r=>r.textContent.startsWith('Stroke Width')&&r.querySelector('button[title="Reset to next keyframe"]')); row.querySelector('button[title="Reset to next keyframe"]').click();})()`);await wait(80);
      assert.equal((await snapshot()).slide.elements.subject.strokeWidth,2);
      assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),learned);
      if(collab){await evaluate(`canvasTest.doc.transact(()=>canvasTest.doc.getMap('presentation').get('slides').get(canvasTest.editor.getState().activeSlideId).get('elements').get('subject').set('strokeWidth',13),'remote')`);await wait(80);assert.equal((await snapshot()).slide.elements.subject.strokeWidth,13);assert.equal(await evaluate('canvasTest.preferences().rect.strokeWidth'),learned);}
    }
  });
  await check('mobile uses same searchable native preview palette',async()=>{
    await setup({mode:'icons',empty:true,mobile:true});
    await click(...await center('button[aria-label^="Icons:"]'));
    await send('Input.insertText',{text:'map'});await wait(50);
    await click(...await center('[role="radio"][aria-label="Map Pin"]'));
    await click(180,240);
    assert.equal(lastShape(await snapshot()).geometry.provenance.icon,'map-pin');
  });
  await check('curated normalization matches all24 installed Lucide definitions at square and non-square sizes',async()=>{
    const names=['house','search','user','users','settings','bell','mail','phone','calendar','clock','check','x','plus','minus','arrow-right','heart','star','cloud','sun','moon','camera','image','map-pin','lightbulb'];
    const originals=Object.fromEntries(names.map(name=>{
      const source=readFileSync(`node_modules/lucide-react/dist/esm/icons/${name}.js`,'utf8');
      const nodes=Function(`return ${source.match(/const __iconNode = ([\s\S]*?);/)[1]}`)();
      return [name,nodes.map(([tag,attributes])=>`<${tag} ${Object.entries(attributes).filter(([key])=>key!=='key').map(([key,value])=>`${key}="${value}"`).join(' ')}/>`).join('')];
    }));
    const evidence=await evaluate(`(async()=>{
      const original=${JSON.stringify(originals)};
      const {CURATED_ICONS}=await import('/src/utils/curatedIcons.ts');const {createShapeElement}=await import('/src/utils/slideFactory.ts');
      async function raster(markup){const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;const ctx=canvas.getContext('2d');const image=new Image();const url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));image.src=url;await image.decode();ctx.drawImage(image,0,0);URL.revokeObjectURL(url);return ctx.getImageData(0,0,300,300).data;}
      const results=[];
      for(const icon of CURATED_ICONS) for(const [w,h] of [[240,240],[240,120]]){
        const expected='<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><g transform="translate(20 20) scale('+w/24+' '+h/24+')" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+original[icon.id].replaceAll('/>',' vector-effect="non-scaling-stroke"/>')+'</g></svg>';
        const actual=canvasTest.arrowMarkup(createShapeElement('vector',{id:'compare',geometry:icon.geometry,x:20,y:20,width:w,height:h,stroke:'#000',strokeWidth:2,fill:''}));
        const a=await raster(expected),b=await raster(actual);let err=0;for(let i=3;i<a.length;i+=4)err+=Math.abs(a[i]-b[i]);results.push({icon:icon.id,w,h,error:err/(a.length/4)});
      }
      return results;
    })()`);
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/icons-lucide-parity.json`,JSON.stringify(evidence,null,2));
    for(const row of evidence)assert(row.error<.2,JSON.stringify(row));
  });
  await check('all24 static/presenter/Create/SVG/PNG/PDF/Office geometry and alpha parity, holes stay empty',async()=>{
    const evidence=await evaluate(`(async()=>{
      const {CURATED_ICONS}=await import('/src/utils/curatedIcons.ts');
      const {createShapeElement}=await import('/src/utils/slideFactory.ts');
      const {officeShapeSvg}=await import('/src/utils/officeShape.ts');
      async function raster(el,mode) {
        const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');
        if(mode==='pdf') canvasTest.drawShapeElement(ctx,el);
        else { const markup=mode==='office'?officeShapeSvg(el):canvasTest.arrowMarkup(el,mode); const img=new Image();
          const url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));img.src=url;await img.decode();ctx.drawImage(img,0,0);URL.revokeObjectURL(url); }
        return {ctx, data:()=>ctx.getImageData(0,0,200,160).data};
      }
      const matrix=[];
      for(const icon of CURATED_ICONS) for(const fillStyle of ['solid','hachure','crosshatch']) {
        const el=createShapeElement('vector',{id:'raster-'+icon.id,x:20,y:20,width:144,height:108,geometry:icon.geometry,
          fill:'rgba(255, 0, 0, 0.5)',stroke:'rgba(0, 0, 255, 0.25)',strokeWidth:4,opacity:.4,fillStyle});
        for(const mode of ['presenter','create','office','pdf','export']) {
          const ref=await raster(el,'static'),out=await raster(el,mode);
          if(mode==='export'){ref.ctx.globalCompositeOperation='destination-over';ref.ctx.fillStyle='#fff';ref.ctx.fillRect(0,0,960,540);}
          const a=ref.data(),b=out.data();let err=0,maxAlpha=0;
          for(let i=mode==='export'?0:3;i<a.length;i+=4){err+=Math.abs(a[i]-b[i]);maxAlpha=Math.max(maxAlpha,b[i]);}
          matrix.push({icon:icon.id,fillStyle,mode,error:err/(a.length/4),maxAlpha});
        }
      }
      const settings=createShapeElement('vector',{id:'holes',x:0,y:0,width:240,height:240,geometry:CURATED_ICONS.find(i=>i.id==='settings').geometry,fill:'#f00',stroke:'#000',opacity:.4});
      const hole=(await raster(settings,'pdf')).ctx.getImageData(120,120,1,1).data[3];
      return {matrix,hole};
    })()`);
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/icons-raster-evidence.json`,JSON.stringify(evidence,null,2));
    for(const row of evidence.matrix){assert(row.error<2,JSON.stringify(row));if(row.mode!=='export')assert(row.maxAlpha<=66,JSON.stringify(row));}
    assert.equal(evidence.hole,0);
  });
  await check('vector Create intermediate Chrome frames trace before fill with no alpha-zero delay',async()=>{
    const evidence=await evaluate(`(async()=>{
      const {CURATED_ICONS}=await import('/src/utils/curatedIcons.ts');const {createShapeElement}=await import('/src/utils/slideFactory.ts');
      const rows=[];
      for(const name of ['settings','sun','heart'])for(const fill of ['#ff0000','#ff000000'])for(const t of [.05,.2,.4,.69,.85]){
        const el=createShapeElement('vector',{id:'intermediate',x:10,y:10,width:240,height:240,geometry:CURATED_ICONS.find(i=>i.id===name).geometry,fill,stroke:'#0000ff',strokeWidth:4});
        const svg=canvasTest.arrowMarkup(el,'create',t);const dom=new DOMParser().parseFromString(svg,'image/svg+xml');
        const paint=Array.from(dom.querySelectorAll('path')).filter(p=>p.getAttribute('stroke')==='none');
        const canvas=document.createElement('canvas');canvas.width=300;canvas.height=300;const ctx=canvas.getContext('2d'),img=new Image();const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));img.src=url;await img.decode();ctx.drawImage(img,0,0);URL.revokeObjectURL(url);
        const data=ctx.getImageData(0,0,300,300).data;let blue=0,red=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>0){if(data[i+2]>data[i])blue++;if(data[i]>data[i+2])red++;}
        rows.push({name,fill,t,blue,red,fillOpacity:paint.map(p=>Number(p.getAttribute('fill-opacity')))});
      }return rows;
    })()`);
    for(const row of evidence){assert(row.blue>0,JSON.stringify(row));if(row.t<.7){assert.equal(row.red,0);assert(row.fillOpacity.every(v=>v===0));}else if(row.fill==='#ff0000')assert(row.red>0);}
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/icons-review-create-frames.json`,JSON.stringify(evidence,null,2));
  });
  await check('actual PPTX and ODP files embed shared native vector SVG fallback',async()=>{
    await setup({empty:true,tool:'icon'});await click(220,230);
    const evidence=await evaluate(`(async()=>{
      const {default:JSZip}=await import('/node_modules/.vite/deps/jszip.js');
      const {exportPptx}=await import('/src/utils/exportPptx.ts');const {exportOdp}=await import('/src/utils/exportOdp.ts');
      const originalURL=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;const results={};
      try {for(const [name,fn] of [['pptx',exportPptx],['odp',exportOdp]]){
        const blobs=[];URL.createObjectURL=function(blob){blobs.push(blob);return originalURL.call(this,blob)};HTMLAnchorElement.prototype.click=function(){};
        await fn(canvasTest.store.getState().presentation);const zip=await JSZip.loadAsync(await blobs.at(-1).arrayBuffer());const assets=[];
        for(const path of Object.keys(zip.files).filter(p=>p.endsWith('.svg')))assets.push(await zip.file(path).async('string'));results[name]=assets;
      }}finally{URL.createObjectURL=originalURL;HTMLAnchorElement.prototype.click=originalClick;}return results;
    })()`);
    for(const format of ['pptx','odp']){assert.equal(evidence[format].length,1);assert.match(evidence[format][0],/fill-rule="evenodd"/);assert.match(evidence[format][0],/stroke-linecap="round"/);assert(!evidence[format][0].includes('foreignObject'));}
    await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/icons-office-evidence.json`,JSON.stringify(evidence,null,2));
  });
  await evaluate('canvasTest.resetPreferences()');
  await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/icons-creation-browser.png`,Buffer.from(r.data,'base64')));
  console.log('PASS icons creation browser suite');
} finally { ws.close(); }
