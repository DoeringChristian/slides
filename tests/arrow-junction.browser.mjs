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
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(2000);
  await setup({ subject: { shapeType: 'path', points: [30,180,199,100,200,100], strokeWidth: 9, endHead: 'triangle', x: 0, y: 0 } });
  const evidence = await evaluate(`(async () => {
    const original = canvasTest.snapshot().slide.elements.subject;
    const pixel = (ctx, x, y) => Array.from(ctx.getImageData(x,y,1,1).data);
    async function raster(el, mode, t = 1) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (mode === 'pdf') canvasTest.drawShapeElement(ctx, el);
      else {
        const image = new Image();
        const url = URL.createObjectURL(new Blob([canvasTest.arrowMarkup(el,mode,t)], {type:'image/svg+xml'}));
        image.src = url; await image.decode(); ctx.drawImage(image,0,0); URL.revokeObjectURL(url);
      }
      return {canvas,ctx};
    }
    const result = [];
    for (const endHead of ['triangle','triangle-outline','diamond','diamond-outline','circle','circle-outline','dot']) {
      const el = {...original, points:[20,100,199,100,200,100], endHead, opacity:0.5, stroke:'#3355ff'};
      for (const mode of ['static','presenter','create','tipDraw','pdf']) {
        const {ctx} = await raster(el,mode);
        const shaft = pixel(ctx,80,100);
        const head = pixel(ctx, endHead === 'dot' ? 190 : 185,100);
        const maxAlpha = Math.max(...Array.from(ctx.getImageData(160,80,45,40).data).filter((_,i)=>i%4===3));
        const beyond = pixel(ctx,endHead.endsWith('outline') ? 206 : 202,100);
        result.push({endHead,mode,shaft,head,maxAlpha,beyond});
      }
    }
    // Near-tip perpendicular entry: outline hole must stay transparent, and
    // cap spill just beyond the actual endpoint must be removed in both leaves.
    const extreme = {...original, points:[199,20,199,100,200,100], opacity:1, endHead:'triangle-outline'};
    const extremes=[];
    for (const mode of ['static','presenter','create','tipDraw','pdf']) {
      const {ctx}=await raster(extreme,mode);
      const filled = await raster({...extreme,endHead:'triangle'},mode);
      extremes.push({mode,hole:pixel(ctx,185,100),outside:pixel(ctx,206,100),filledCap:pixel(filled.ctx,202,99)});
    }
    // TipDraw midpoint is on the actual L-shaped prefix, never an inset-length
    // extension of the tangent. Final raster is identical to steady state.
    const bend={...original,points:[20,20,200,20,200,200],endHead:'triangle',opacity:0.5};
    const midpoint=canvasTest.arrowMarkup(bend,'tipDraw',0.175);
    const final=await raster(bend,'tipDraw',1), steady=await raster(bend,'static',1);
    const a=final.ctx.getImageData(0,0,400,400).data,b=steady.ctx.getImageData(0,0,400,400).data;
    const finalMatches=Array.from(a).every((v,i)=>v===b[i]);
    const exported=await raster(bend,'export');
    const exportHead=pixel(exported.ctx,200,180);
    steady.ctx.globalCompositeOperation='destination-over'; steady.ctx.fillStyle='white'; steady.ctx.fillRect(0,0,400,400);
    const white=steady.ctx.getImageData(0,0,400,400).data,exp=exported.ctx.getImageData(0,0,400,400).data;
    const exportMaxDelta=Array.from(white).reduce((max,v,i)=>Math.max(max,Math.abs(v-exp[i])),0);
    const exportMatches=exportMaxDelta<=1;
    const createFinal=await raster(bend,'create',1);
    const createData=createFinal.ctx.getImageData(0,0,400,400).data;
    const createFinalMatches=Array.from(a).every((v,i)=>v===createData[i]);
    const createFrames=[0,0.25,0.5,1].map(t=>({t,markup:canvasTest.arrowMarkup(extreme,'create',t)}));
    // Paint regressions: remembered zero-alpha RGB behaves exactly like no
    // fill throughout Create, including hatch URLs; zero-alpha stroke stays off.
    const transparentCreate=[];
    for(const fillStyle of ['solid','hachure','crosshatch']) for(const t of [.25,.5,.75,.99,1]) {
      const rect={...original,shapeType:'rect',x:20,y:20,width:100,height:80,cornerRadius:0,
        fillStyle,fill:'rgba(255, 0, 0, 0)',stroke:'#000000',strokeWidth:2};
      const actual=await raster(rect,'create',t),none=await raster({...rect,fill:'none'},'create',t);
      const hidden=await raster({...rect,stroke:'rgba(0, 0, 255, 0)'},'create',t);
      const a=actual.ctx.getImageData(0,0,160,130).data,b=none.ctx.getImageData(0,0,160,130).data;
      transparentCreate.push({fillStyle,t,maxDelta:Array.from(a).reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0),
        outline:pixel(actual.ctx,70,20),hiddenMaxAlpha:Math.max(...Array.from(hidden.ctx.getImageData(0,0,160,130).data).filter((_,i)=>i%4===3))});
    }
    // PDF's Canvas fill helper + shared path geometry provide a frame reference
    // for the two-path Create trace. PDF itself exports steady slides, not frames.
    const {shapeToSvgPaths}=await import('/src/utils/shapeToPath.ts');
    const {drawShapeFill}=await import('/src/utils/shapeFill.ts');
    async function canvasCreate(el,t) {
      if(t===1) return raster(el,'pdf');
      const layer=document.createElement('canvas');layer.width=layer.height=400;
      const ctx=layer.getContext('2d');ctx.translate(el.x,el.y);
      const paths=shapeToSvgPaths(el);
      paths.forEach((p,i)=>{
        const local=Math.max(0,Math.min(1,(t-i*.5)/.5));
        const fillPhase=Math.max(0,(local-.7)/(1-.7));
        const strokeAlpha=local===0?0:i===0?1-fillPhase:1;
        if(i===0){ctx.save();ctx.globalAlpha=fillPhase;drawShapeFill(ctx,new Path2D(p.fillD ?? p.d),el,true);ctx.restore();}
        ctx.save();ctx.globalAlpha=strokeAlpha;ctx.strokeStyle=el.stroke;ctx.lineWidth=el.strokeWidth;
        ctx.lineCap=ctx.lineJoin='round';ctx.setLineDash([p.length]);ctx.lineDashOffset=p.length*(1-Math.min(1,local/.7));
        for(const cut of p.shaftClipPaths??[])ctx.clip(new Path2D(cut),'evenodd');
        ctx.stroke(new Path2D(p.d));ctx.restore();
      });
      const canvas=document.createElement('canvas');canvas.width=canvas.height=400;
      const output=canvas.getContext('2d');output.globalAlpha=el.opacity;output.drawImage(layer,0,0);
      return {canvas,ctx:output};
    }
    const closedFill=[];
    for(const fillStyle of ['solid','hachure','crosshatch']) for(const alpha of [1,.5]) {
      const el={...original,points:[95,0,95,50,80,50,80,0,100,0],closed:true,x:20,y:20,width:100,height:50,
        cornerRadius:0,strokeWidth:3,endHead:'triangle-outline',fillStyle,fill:'rgba(255, 0, 0, '+alpha+')',stroke:'#000000',opacity:alpha===1?1:.6};
      for(const [mode,t] of [['static',1],['presenter',1],['create',.25],['create',.425],['create',.5],['create',.75],['create',.99],['create',1]]) {
        const actual=await raster(el,mode,t),expected=mode==='create'?await canvasCreate(el,t):await raster(el,'pdf');
        const a=actual.ctx.getImageData(90,5,50,80).data,b=expected.ctx.getImageData(90,5,50,80).data;
        let error=0;
        for(let i=0;i<a.length;i++)error+=Math.abs(i%4===3?a[i]-b[i]:a[i]*a[i-i%4+3]/255-b[i]*b[i-i%4+3]/255);
        closedFill.push({fillStyle,alpha,mode,t,error:error/a.length,
          probes:[[112,22],[111,21],[112,24]].map(([x,y])=>({actual:pixel(actual.ctx,x,y),expected:pixel(expected.ctx,x,y)}))});
      }
    }
    // Actual Chrome contact sheet, not a hand-drawn expected image.
    const sheet=document.createElement('div'); sheet.style='position:fixed;inset:0;background:white;display:grid;grid-template-columns:repeat(4,300px);z-index:99999;overflow:auto';
    for(const [label,points,endHead,mode,t] of [
      ['screenshot',[325,370,233.5,146.5,230.5,145.5],'triangle','static',1],
      ['sharp side entry',[80,230,199,100,200,100],'triangle','static',1],
      ['outline side entry',[199,20,199,100,200,100],'triangle-outline','static',1],
      ['circle outline',[100,230,199,100,200,100],'circle-outline','static',1],
      ['Create 0.25',[80,230,199,100,200,100],'triangle-outline','create',0.25],
      ['Create 0.5',[80,230,199,100,200,100],'triangle-outline','create',0.5],
      ['tipDraw mid',[20,20,200,20,200,200],'triangle','tipDraw',0.175],
      ['alpha 0.5',[80,230,199,100,200,100],'triangle','static',1]
    ]) {
      const div=document.createElement('div'); const title=document.createElement('div'); title.textContent=label; div.append(title);
      const {canvas}=await raster({...original,points,endHead,stroke:'#3355ff',opacity:label==='alpha 0.5'?0.5:1},mode,t);
      canvas.style='width:300px;height:300px'; div.append(canvas); sheet.append(div);
    }
    for(const [label,mode,t,fillStyle,alpha] of [
      ['closed fill SVG','static',1,'solid',1],['closed fill PDF Canvas','pdf',1,'solid',1],
      ['closed Create .425','create',.425,'solid',1],['closed hatch alpha Create','create',.425,'crosshatch',.5]
    ]) {
      const div=document.createElement('div');const title=document.createElement('div');title.textContent=label;div.append(title);
      const el={...original,points:[95,0,95,50,80,50,80,0,100,0],closed:true,x:20,y:20,width:100,height:50,
        cornerRadius:0,strokeWidth:3,endHead:'triangle-outline',fillStyle,fill:'rgba(255, 0, 0, '+alpha+')',stroke:'#000000'};
      const {canvas}=await raster(el,mode,t);canvas.style='width:300px;height:300px';div.append(canvas);sheet.append(div);
    }
    document.body.append(sheet);
    return {result,extremes,midpoint,finalMatches,exportMatches,exportMaxDelta,createFinalMatches,exportHead,createFrames,transparentCreate,closedFill};
  })()`);
  await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-junction-browser.json`,JSON.stringify(evidence,null,2));
  for(const row of evidence.transparentCreate) {
    assert.equal(row.maxDelta,0,JSON.stringify(row));
    assert.equal(row.outline[3],255,'visible rectangle outline: '+JSON.stringify(row));
    assert.equal(row.hiddenMaxAlpha,0,'intentional transparent stroke: '+JSON.stringify(row));
  }
  for(const row of evidence.closedFill) {
    // SVG pattern-tile edges and direct Canvas hatch clipping antialias
    // differently; tight probes below guard the actual head-cut regression.
    assert(row.error<2,JSON.stringify(row));
    for(const probe of row.probes) for(let i=0;i<4;i++) {
      const a=i===3?probe.actual[i]:probe.actual[i]*probe.actual[3]/255;
      const b=i===3?probe.expected[i]:probe.expected[i]*probe.expected[3]/255;
      assert(Math.abs(a-b)<=5,'closed fill probe: '+JSON.stringify(row));
    }
    if(row.fillStyle==='solid'&&row.alpha===1&&row.t>=.425) assert(row.probes[0].actual[3]>=127,'fill at local (92,2) survives shaft cut');
  }
  for (const entry of evidence.result) {
    assert.equal(entry.shaft[3],128,`${entry.mode}/${entry.endHead} shaft opacity once`);
    assert(entry.maxAlpha <= 128,`${entry.mode}/${entry.endHead} no dark overlap: ${entry.maxAlpha}`);
    assert.equal(entry.beyond[3],0,`${entry.mode}/${entry.endHead} no protruding cap`);
    if(entry.endHead.endsWith('outline')) assert.equal(entry.head[3],0,`${entry.mode}/${entry.endHead} transparent hole`);
    else assert.equal(entry.head[3],128,`${entry.mode}/${entry.endHead} filled head`);
  }
  for(const e of evidence.extremes) { assert.equal(e.hole[3],0,e.mode+' hole'); assert.equal(e.outside[3],0,e.mode+' beyond tip'); assert.equal(e.filledCap[3],0,e.mode+' near-tip filled cap'); }
  assert(evidence.midpoint.includes('200,20'),'riding tip lies on original path');
  assert(evidence.finalMatches,'completed tipDraw raster equals static exactly');
  assert(evidence.createFinalMatches,'completed ordinary Create raster equals static exactly');
  assert(evidence.exportMatches,'SVG export raster equals static over white within one channel rounding unit: '+evidence.exportMaxDelta);
  assert.equal(evidence.exportHead[3],255,'SVG export rasterizes shared head over background');
  assert(evidence.createFrames.every(frame=>frame.markup.includes('clipPath')),'ordinary Create keeps shaft cuts throughout');
  await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-junction-browser.json`,JSON.stringify(evidence,null,2));
  const shot=await send('Page.captureScreenshot'); await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/arrow-junction-matrix.png`,Buffer.from(shot.data,'base64'));
  console.log('PASS arrow junction Chrome raster matrix: static/presenter/Create/tipDraw/PDF, alpha, outline holes, cap spill, SVG export; 15 zero-alpha Create frames and 48 closed-headed solid/hatch alpha comparisons');
} finally { ws.close(); }
