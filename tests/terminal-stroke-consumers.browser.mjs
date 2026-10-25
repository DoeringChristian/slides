import './browser-gate-required.mjs';
import { terminalStrokePaintOracle, assertTerminalStrokeInflight } from './terminalStrokePaintOracle.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
const evidence = process.env.TERMINAL_STROKE_EVIDENCE ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-terminal-stroke-consumers/browser`;
await mkdir(evidence, { recursive: true });
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` }); await waitForCanvasFixture(evaluate); await wait(500);
  await setup({ zoom: 2, subject: { shapeType: 'path', x: 0, y: 0, points: [325,370,233.5,146.5,230.5,145.5], strokeWidth: 9, cornerRadius: 8, endHead: 'triangle' } });
  const oracle = await evaluate(`(${terminalStrokePaintOracle.toString()})()`);
  for (const result of oracle.results) {
    await writeFile(`${evidence}/${result.mode}-crescent.png`, Buffer.from(result.png.split(',')[1], 'base64')); delete result.png;
  }
  for (const result of oracle.inflight) {
    for (const key of ['png', 'referencePng']) {
      await writeFile(`${evidence}/${result.name}-${key}.png`, Buffer.from(result[key].split(',')[1], 'base64')); delete result[key];
    }
  }
  await writeFile(`${evidence}/independent-paint-oracle.json`, JSON.stringify(oracle, null, 2));
  for (const result of oracle.results) {
    assert.equal(result.crescent[3], 0, `${result.mode}: production crescent absent`);
    assert.equal(result.shaft[3], 255, `${result.mode}: original shaft visible`);
    assert.equal(result.join[3], 255, `${result.mode}: side-entry join visible`);
    assert.equal(result.missingInterior, 0, `${result.mode}: entire independent original route retained`);
    assert.equal(result.unexpectedInterior, 0, `${result.mode}: no invented bend or spill`);
  }
  assertTerminalStrokeInflight(oracle.inflight, assert);
  console.log('PASS 7 explicit in-flight Create/TipDraw/multi-run independent raster and branch checks');
  console.log('PASS original production crescent + independent visible native-L/side-join oracle', oracle.results);
  const matrix = await evaluate(`(async () => {
    const source = canvasTest.snapshot().slide.elements.subject;
    async function raster(el, mode) {
      const c = document.createElement('canvas'); c.width = c.height = 400; const ctx = c.getContext('2d');
      if (mode === 'pdf') canvasTest.drawShapeElement(ctx, el);
      else { const image = new Image(), url = URL.createObjectURL(new Blob([canvasTest.arrowMarkup(el, mode)], { type: 'image/svg+xml' })); image.src = url; await image.decode(); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url); }
      return ctx.getImageData(0, 0, 400, 400).data;
    }
    const records = [];
    for (const head of ['none','arrow','triangle','triangle-outline','bar','dot','circle','circle-outline','diamond','diamond-outline','crowfoot-one','crowfoot-many','crowfoot-one-many'])
    for (const placement of ['start','end','both']) for (const strokeStyle of ['solid','dashed','dotted']) {
      const el = { ...source, x: 0, y: 0, opacity: .5, stroke: 'rgba(40,80,160,.5)', strokeWidth: 8, cornerRadius: 0,
        points: [20,100,180,100,180,20,100,20,100,180], closed: true, fill: 'none', strokeStyle,
        startHead: placement !== 'end' ? head : 'none', endHead: placement !== 'start' ? head : 'none' };
      const actual = await raster(el, 'static'), pdf = await raster(el, 'pdf');
      const original = await raster({ ...el, startHead: 'none', endHead: 'none' }, 'static');
      let phaseDelta = 0, pdfDelta = 0, pdfPixels = 0, maxAlpha = 0;
      // Earlier crossing is outside either terminal silhouette. Its phase must
      // equal the untouched native path, even after a consumed start interval.
      for (let y = 65; y < 135; y++) for (let x = 65; x < 135; x++) {
        const i = (y * 400 + x) * 4 + 3;
        phaseDelta += Math.abs(actual[i] - original[i]);
        pdfDelta += Math.abs(actual[i] - pdf[i]);
        if (actual[i] !== pdf[i]) pdfPixels++;
        maxAlpha = Math.max(maxAlpha, actual[i], pdf[i]);
      }
      records.push({head,placement,strokeStyle,phaseDelta,pdfDelta,pdfPixels,maxAlpha,runs:canvasTest.pathArrowGeometry(el).strokePlan?.runs.length ?? null});
    }
    return records;
  })()`);
  await writeFile(`${evidence}/phase-alpha-pdf-matrix.json`, JSON.stringify(matrix, null, 2));
  for (const record of matrix) {
    assert(record.maxAlpha <= 64, 'RGBA and element opacity each applied once: ' + JSON.stringify(record));
    assert(record.phaseDelta < 400, 'unrelated crossing/phase unchanged except AA: ' + JSON.stringify(record));
    assert(record.pdfDelta < 400, 'SVG/Canvas shared coverage: ' + JSON.stringify(record));
  }
  assert(matrix.some(r => r.runs > 1), 'matrix exercises multiple retained runs');
  console.log('PASS 117 head/placement/dash/alpha/earlier-crossing SVG-PDF comparisons');
  const nativeCases = await evaluate(`(async () => {
    const source = canvasTest.snapshot().slide.elements.subject;
    const cases = [
      { name:'short', points:[100,100,101,100] },
      { name:'zero', points:[100,100,100,100] },
      { name:'coincident-return', points:[100,100,180,100,100,100] },
      { name:'reverse-crescent', points:[230.5,145.5,233.5,146.5,325,370] },
      { name:'manual-loop', points:[100,100,200,100], curve:'bezier', tangents:[0,0,240,200,-240,-200,0,0] },
    ];
    const result=[];
    for(const fixture of cases) for(const head of ['none','arrow','triangle','triangle-outline','bar','dot','circle','circle-outline','diamond','diamond-outline','crowfoot-one','crowfoot-many','crowfoot-one-many'])
    for(const placement of ['start','end','both']) {
      const el={...source,...fixture,x:0,y:0,opacity:.6,stroke:'rgba(40,80,160,.5)',strokeWidth:9,cornerRadius:8,fill:'none',closed:false,startHead:placement==='end'?'none':head,endHead:placement==='start'?'none':head};
      const svg=document.createElement('canvas'),pdf=document.createElement('canvas');svg.width=svg.height=pdf.width=pdf.height=400;
      const image=new Image(),url=URL.createObjectURL(new Blob([canvasTest.arrowMarkup(el,'static')],{type:'image/svg+xml'}));image.src=url;await image.decode();svg.getContext('2d').drawImage(image,0,0);URL.revokeObjectURL(url);
      canvasTest.drawShapeElement(pdf.getContext('2d'),el);
      const a=svg.getContext('2d').getImageData(0,0,400,400).data,b=pdf.getContext('2d').getImageData(0,0,400,400).data;
      let alphaDelta=0,solidDisagreement=0;
      for(let i=3;i<a.length;i+=4){alphaDelta+=Math.abs(a[i]-b[i]);if(Math.abs(a[i]-b[i])>50)solidDisagreement++;}
      result.push({name:fixture.name,head,placement,alphaDelta,solidDisagreement,runs:canvasTest.pathArrowGeometry(el).strokePlan?.runs.length??null});
    }
    return result;
  })()`);
  await writeFile(`${evidence}/degenerate-manual-svg-pdf.json`,JSON.stringify(nativeCases,null,2));
  for(const record of nativeCases) {
    // Unchanged native zero-length open strokes have a pre-existing SVG/Canvas
    // round-cap difference (Canvas paints a dot). No consumption plan is used.
    if(record.name==='zero' && record.runs===null) {
      assert(record.alphaDelta<5000 && record.solidDisagreement<=58,'bounded unchanged zero-leg native fast path');
    } else {
      assert(record.alphaDelta<1000,'bounded SVG/Canvas AA difference: '+JSON.stringify(record));
      assert.equal(record.solidDisagreement,0,'no missing retained run: '+JSON.stringify(record));
    }
  }
  console.log('PASS 195 short/zero/coincident/reversed/manual-loop native SVG-PDF comparisons');

} finally { ws.close(); }
