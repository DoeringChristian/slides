import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Crop mode: a crop is a crop group (one image + crop shapes, which reveal
// their union). Crop mode greys the image, and every shape drawn in it
// becomes a crop shape — one undo step each; Esc ends it.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && (!process.env.CDP_TARGET_ID || p.id === process.env.CDP_TARGET_ID));
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
    if (/order of Hooks|Rendered (more|fewer) hooks|getSnapshot|same key/.test(text)) runtimeErrors.push(text);
  }
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
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

async function screen(x,y){return evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:m.a*${x}+m.e,y:m.d*${y}+m.f}})()`);}
async function mouse(type,p,count=1){await send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:count});await wait(30);}
async function click(p,count=1){await mouse('mousePressed',p,count);await mouse('mouseReleased',p,count);}
async function drag(a,b){await mouse('mousePressed',a);await mouse('mouseMoved',b);await mouse('mouseReleased',b);await wait(100);}
async function button(label){const point=await evaluate(`(()=>{const b=[...document.querySelectorAll('#creation-properties button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await click(point);await wait(100);}
const RED = `canvasTest.store.getState().addResource({id:'red',name:'red',type:'image',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>'),originalWidth:300,originalHeight:200})`;
const state = () => evaluate(`(() => { const st = canvasTest.editor.getState(); const s = canvasTest.snapshot().slide; return { cropping: st.croppingElementId, tool: st.tool, scope: st.activeObjectGroupId, selected: st.selectedElementIds.slice().sort(), elements: s.elements, order: s.elementOrder }; })()`);
const undo = () => evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().undo();else canvasTest.store.temporal.getState().undo()");
const redo = () => evaluate("if(canvasTest.getActiveUndoManager())canvasTest.getActiveUndoManager().redo();else canvasTest.store.temporal.getState().redo()");
const key = async (k, code = k) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : k === 'Enter' ? 13 : 0 }); await wait(120); };
const pixel = (x, y) => evaluate(`(async()=>{const {renderSlideToSVG}=await import('/src/utils/io/svgRenderer.ts');const s=canvasTest.snapshot().slide;const svg=renderSlideToSVG(s,canvasTest.store.getState().presentation.resources);const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,960,540);return Array.from(ctx.getImageData(${x},${y},1,1).data)})()`);
const barButton = async (selector) => { const p = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('missing '+${JSON.stringify(selector)});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await click(p); await wait(150); };
const RED_PX = [255, 0, 0, 255], WHITE_PX = [255, 255, 255, 255];
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const collab of [false, true]) {
    await setup({ mode: 'production', collab, objectList: true, subject: { type: 'image', x: 250, y: 150, width: 300, height: 200, resourceId: 'red' },
      targets: [{ id: 'other', x: 650, y: 150, width: 100, height: 80, fill: '#3366cc' }] });
    await evaluate(`${RED};canvasTest.editor.getState().setSelectedElements(['subject']);canvasTest.getActiveUndoManager()?.clear();canvasTest.store.temporal.getState().clear()`);
    await wait(150);

    // 1. Crop from the selection bar: crop mode, the image greys, the rest dims.
    await barButton('[data-crop-action="start"]');
    let s = await state();
    assert.equal(s.cropping, 'subject');
    assert(await evaluate("!!document.querySelector('[data-crop-ghost]')"), 'grey ghost of the whole image');
    assert(await evaluate("!!document.querySelector('[data-crop-dimmed] [data-element-id=other]')"), 'other objects dimmed');
    assert(await evaluate("!!document.querySelector('[data-crop-mode]')"), 'crop mode banner');

    // 2. Draw a rectangle: it becomes a crop shape, and the tool drops back to select.
    await evaluate("canvasTest.editor.getState().setTool('rect')");
    await drag(await screen(270, 170), await screen(370, 250));
    s = await state();
    const rect = Object.values(s.elements).find(el => el.type === 'shape' && el.cropGroupId && el.shapeType === 'rect');
    assert(rect, 'drawn rectangle is a crop shape');
    const group = rect.cropGroupId;
    assert.equal(s.tool, 'select', 'tool resets to select');
    assert.deepEqual(s.elements.subject.objectGroupIds, [group], 'image joins the crop group');
    assert.equal(s.scope, group, 'crop group is the entered group');
    assert.deepEqual(s.selected, [rect.id], 'the new crop shape is selected');
    assert.equal(rect.stroke, '', 'crop shapes are drawn unstroked');
    // Drawing in crop mode snaps to other objects (they stay visible under
    // the spotlight): from here a crop edge can line up with a neighbour.
    await evaluate("canvasTest.editor.setState({snapToGrid:true});canvasTest.editor.getState().setTool('rect')");
    await mouse('mousePressed', await screen(560, 300)); await mouse('mouseMoved', await screen(600, 320)); await mouse('mouseMoved', await screen(648, 340)); await mouse('mouseReleased', await screen(648, 340)); await wait(150);
    const snappedCrop = Object.values((await state()).elements).filter(el => el.type === 'shape' && el.cropGroupId === group).find(el => el.id !== rect.id);
    assert.equal(snappedCrop.x + snappedCrop.width, 650, `a crop edge snaps to another object's edge: ${snappedCrop.x + snappedCrop.width}`);
    await undo(); await wait(100);
    // ...and to the image being cropped, and to the group's other crop shapes.
    const drawCrop = async (from, to) => {
      const before = new Set(Object.keys((await state()).elements));
      await evaluate("canvasTest.editor.getState().setTool('rect')");
      await mouse('mousePressed', await screen(...from)); await mouse('mouseMoved', await screen((from[0] + to[0]) / 2, (from[1] + to[1]) / 2)); await mouse('mouseMoved', await screen(...to)); await mouse('mouseReleased', await screen(...to)); await wait(150);
      const els = (await state()).elements;
      return Object.values(els).find(el => !before.has(el.id));
    };
    const toImage = await drawCrop([480, 300], [548, 347]);
    assert.equal(toImage.x + toImage.width, 550, `crop edge snaps to the image's right edge: ${toImage.x + toImage.width}`);
    assert.equal(toImage.y + toImage.height, 350, `and bottom edge: ${toImage.y + toImage.height}`);
    await undo(); await wait(100);
    // Started 5 below the first crop shape's top (170 — not an image edge).
    const toSibling = await drawCrop([380, 175], [402, 210]);
    assert.equal(toSibling.y, rect.y, `crop edge snaps to a fellow crop shape's edge: ${toSibling.y} vs ${rect.y}`);
    await undo(); await wait(100);
    // Polygon points snap to every edge of the image (left/right included);
    // the last point's y (297) has no target nearby and stays.
    {
      const before = new Set(Object.keys((await state()).elements));
      await evaluate("canvasTest.editor.getState().setTool('polygon')");
      for (const p of [[253, 153], [403, 152], [547, 347], [252, 297]]) { await click(await screen(...p)); await wait(80); }
      await key('Enter'); await wait(200);
      const poly = Object.values((await state()).elements).find(el => !before.has(el.id));
      const pts = await evaluate(`canvasTest.pathPointsInSlide(canvasTest.snapshot().slide.elements[${JSON.stringify(poly?.id)}])`);
      assert.deepEqual(pts.map(Math.round), [250, 150, 400, 150, 550, 350, 250, 297], `polygon points snap to the image's edges and centre: ${pts}`);
      await undo(); await wait(100);
    }
    await evaluate("canvasTest.editor.setState({snapToGrid:false})");
    assert.deepEqual(await pixel(320, 210), RED_PX, 'inside the crop shows');
    assert.deepEqual(await pixel(480, 300), WHITE_PX, 'outside the crop is cut');

    // 3. A second shape reveals more: the union.
    await evaluate("canvasTest.editor.getState().setTool('ellipse')");
    await drag(await screen(430, 260), await screen(530, 340));
    s = await state();
    const ellipse = Object.values(s.elements).find(el => el.type === 'shape' && el.shapeType === 'ellipse' && el.cropGroupId === group);
    assert(ellipse, 'second crop shape in the same crop group');
    assert.deepEqual(await pixel(480, 300), RED_PX, 'the second shape reveals its area too');
    assert.deepEqual(await pixel(320, 210), RED_PX, 'and the first still shows');
    assert.deepEqual(await pixel(400, 320), WHITE_PX, 'between them stays cut');
    assert(await evaluate(`document.querySelectorAll('[data-crop-outlines] path').length`) >= 2, 'crop shapes are outlined');
    if (!collab) await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/crop-mode.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    // PDF export (canvas) shows the same union.
    const pdf = await evaluate(`(async()=>{const {preloadResources,renderSlide}=await import('/src/utils/io/exportPdf.ts');const s=canvasTest.snapshot().slide;const res=canvasTest.store.getState().presentation.resources;const c=renderSlide(s,res,await preloadResources([s],res),1);const ctx=c.getContext('2d');return [[320,210],[480,300],[400,320]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data))})()`);
    assert.deepEqual(pdf, [RED_PX, RED_PX, WHITE_PX], 'PDF export: union of the crop shapes');
    // An outline on one crop shape shows all the way round, not only where
    // it overlaps the other crop shape.
    await evaluate(`canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId, ${JSON.stringify(rect.id)}, { stroke: '#0000ff', strokeWidth: 6 })`);
    await wait(100);
    const edge = await pixel(Math.round(rect.x), Math.round(rect.y + rect.height / 2));
    assert(edge[2] > 200 && edge[0] < 60, `outline drawn outside the other crop shape: ${edge}`);
    await undo(); await wait(100);

    // 4. Moving a crop shape moves the crop.
    await evaluate(`canvasTest.editor.getState().setSelectedElements([${JSON.stringify(rect.id)}])`); await wait(80);
    await drag(await screen(320, 210), await screen(340, 210));
    s = await state();
    assert(Math.abs(s.elements[rect.id].x - (rect.x + 20)) < 1, 'crop shape moved');
    assert.equal(s.elements.subject.x, 250, 'image stayed');

    // 5. Each step is one undo.
    await undo(); await wait(100);
    assert(Math.abs((await state()).elements[rect.id].x - rect.x) < 1, 'undo move');
    await undo(); await wait(100);
    assert.equal((await state()).elements[ellipse.id], undefined, 'undo second shape');
    await undo(); await wait(100);
    s = await state();
    assert.equal(s.elements[rect.id], undefined, 'undo first shape');
    assert.equal(s.elements.subject.objectGroupIds?.length ?? 0, 0, 'image left the crop group with it');
    await redo(); await redo(); await wait(100);
    s = await state();
    assert(s.elements[rect.id] && s.elements[ellipse.id], 'redo both shapes');

    // 6. Esc ends crop mode and selects the crop group.
    await evaluate("canvasTest.editor.getState().setSelectedElements([])");
    await key('Escape');
    s = await state();
    assert.equal(s.cropping, null);
    assert.deepEqual(s.selected, ['subject', rect.id, ellipse.id].sort(), 'the crop group is selected');
    assert.equal(await evaluate("document.querySelectorAll('[data-crop-ghost]').length"), 0);

    // Outside crop mode, the cropped image aligns by its visible corners: a
    // shape drawn 2 units from the crop's left edge (rect.x) snaps onto it,
    // one drawn 2 units from the image's hidden left edge (250) does not.
    {
      await evaluate("canvasTest.editor.setState({snapToGrid:true});canvasTest.editor.getState().setSelectedElements([])");
      const drawAt = async (x) => {
        const before = new Set(Object.keys((await state()).elements));
        await evaluate("canvasTest.editor.getState().setTool('rect')");
        await mouse('mousePressed', await screen(x, 400)); await mouse('mouseMoved', await screen(x + 20, 420)); await mouse('mouseMoved', await screen(x + 40, 440)); await mouse('mouseReleased', await screen(x + 40, 440)); await wait(150);
        const el = Object.values((await state()).elements).find(e => !before.has(e.id));
        await undo(); await wait(100);
        return el.x;
      };
      assert.equal(await drawAt(rect.x + 2), rect.x, 'snaps to the visible crop edge');
      assert.equal(await drawAt(252), 252, "does not snap to the image's hidden edge");
      await evaluate("canvasTest.editor.setState({snapToGrid:false})");
      await evaluate("canvasTest.editor.getState().setSelectedElements(['subject'])"); await wait(150);
    }

    // 7. The whole crop group selected offers Edit crop / Remove crop.
    await wait(150);
    assert(await evaluate(`!!document.querySelector('[data-crop-action="edit"]')`), 'Edit crop in the bar');
    await barButton('[data-crop-action="edit"]');
    assert.equal((await state()).cropping, 'subject', 'edit re-enters crop mode');
    assert.equal((await state()).scope, group);
    await key('Enter');
    assert.equal((await state()).cropping, null, 'Enter ends crop mode');

    // 8. Image + a shape: Crop makes that shape the crop.
    await evaluate(`canvasTest.store.getState().setCrop(canvasTest.editor.getState().activeSlideId,'subject',null)`);
    // The removed crop leaves a plain group; ungroup it, then select the image with another shape.
    await evaluate(`(()=>{const st=canvasTest.store.getState(), sl=canvasTest.editor.getState().activeSlideId; st.ungroupObjects(sl,['subject']); canvasTest.editor.getState().clearSelection(); canvasTest.editor.getState().setSelectedElements(['subject','other'])})()`); await wait(150);
    assert(await evaluate(`!!document.querySelector('[data-crop-action="make"]')`), 'Crop to shapes offered for image + shape');
    await barButton('[data-crop-action="make"]');
    s = await state();
    assert.equal(s.cropping, 'subject');
    assert.equal(s.elements.other.cropGroupId, s.elements.subject.objectGroupIds?.at(-1), 'the shape crops the image');
    await key('Escape');

    // 9. Crop mode left without drawing changes nothing.
    await setup({ mode: 'production', collab, subject: { type: 'image', x: 250, y: 150, width: 300, height: 200, resourceId: 'red' } });
    await evaluate(`${RED};canvasTest.editor.getState().setSelectedElements(['subject'])`); await wait(120);
    const before = JSON.stringify((await state()).elements);
    await barButton('[data-crop-action="start"]');
    await key('Escape');
    s = await state();
    assert.equal(s.cropping, null);
    assert.equal(JSON.stringify(s.elements), before, 'nothing drawn, nothing changed');
    // 11. Extending a crop line keeps crop mode: the clicks that place the
    // new points and Enter that finishes belong to the drawing.
    await barButton('[data-crop-action]');
    await evaluate("canvasTest.editor.getState().setTool('line')");
    await drag(await screen(270, 200), await screen(350, 200));
    s = await state();
    const line = Object.values(s.elements).find(el => el.type === 'shape' && el.shapeType === 'path' && el.cropGroupId);
    assert(line, 'a line drawn in crop mode is a crop shape');
    const pointsBefore = line.points.length;
    await evaluate(`canvasTest.editor.getState().beginPathExtension(${JSON.stringify(line.id)}, 'end')`); await wait(100);
    await click(await screen(420, 280)); await wait(120);
    await click(await screen(300, 320)); await wait(120);
    assert.equal((await state()).cropping, 'subject', 'placing extension points stays in crop mode');
    await key('Enter'); await wait(150);
    s = await state();
    assert.equal(s.cropping, 'subject', 'finishing the extension stays in crop mode');
    assert(s.elements[line.id].points.length > pointsBefore, `the line was extended (${pointsBefore} → ${s.elements[line.id].points.length})`);
    await key('Escape');
    assert.equal((await state()).cropping, null);

    // 10. Text crops by its glyphs: the text tool in crop mode makes crop text.
    await evaluate("canvasTest.editor.getState().setSelectedElements(['subject'])"); await wait(150);
    await barButton('[data-crop-action]');
    await evaluate("canvasTest.editor.getState().setTool('text')");
    await drag(await screen(260, 170), await screen(540, 330));
    s = await state();
    const text = Object.values(s.elements).find(el => el.type === 'text' && el.cropGroupId);
    assert(text?.cropGroupId, 'text drawn in crop mode is crop text');
    assert.equal(await evaluate('canvasTest.editor.getState().editingTextId'), text.id, 'and is being edited');
    await evaluate(`canvasTest.editor.getState().setEditingTextId(null);canvasTest.store.getState().updateElement(canvasTest.editor.getState().activeSlideId, ${JSON.stringify(text.id)}, { text: 'CROP', style: { ...canvasTest.snapshot().slide.elements[${JSON.stringify(text.id)}].style, fontSize: 110, fontWeight: 'bold', color: '#00aa00' } })`);
    await wait(800);
    if (!collab) await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/crop-text.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...(await screen(240, 150)), width: 340, height: 220, scale: 1 } })).data, 'base64'));
    // On the editor canvas too (the crop redraws once the layout settles).
    const canvasRed = await evaluate(`(async()=>{const t=canvasTest.snapshot().slide.elements[${JSON.stringify(text.id)}];const r=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return {x:r.a*t.x+r.e,y:r.d*t.y+r.f,w:t.width*r.a,h:140*r.d}})()`);
    const shot = (await send('Page.captureScreenshot', { format: 'png', clip: { x: canvasRed.x, y: canvasRed.y, width: canvasRed.w, height: canvasRed.h, scale: 1 } })).data;
    const redOnCanvas = await evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${'${'}shot}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let red=0;for(let i=0;i<d.length;i+=4)if(d[i]>200&&d[i+1]<80)red++;return red/(d.length/4)})()`.replace('${shot}', shot));
    assert(redOnCanvas > 0.05, `canvas: the image shows through the glyphs (${redOnCanvas})`);
    // Red (the image) only through the glyphs: neither all nor nothing of the
    // text box, and no green (the text paints nothing itself).
    const fractions = await evaluate(`(async()=>{
      const s=canvasTest.snapshot().slide, res=canvasTest.store.getState().presentation.resources, t=s.elements[${JSON.stringify(text.id)}];
      const count=(ctx)=>{const d=ctx.getImageData(t.x,t.y,t.width,140).data;let red=0,green=0,n=d.length/4;for(let i=0;i<d.length;i+=4){if(d[i]>200&&d[i+1]<80)red++;if(d[i+1]>120&&d[i]<80)green++;}return {red:red/n,green:green/n};};
      const {renderSlideToSVG}=await import('/src/utils/io/svgRenderer.ts');
      const img=new Image();img.src='data:image/svg+xml,'+encodeURIComponent(renderSlideToSVG(s,res));await img.decode();
      const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,960,540);
      const {preloadResources,renderSlide}=await import('/src/utils/io/exportPdf.ts');
      const pdf=renderSlide(s,res,await preloadResources([s],res),1).getContext('2d');
      return {svg:count(ctx),pdf:count(pdf)};
    })()`);
    for (const [where, f] of Object.entries(fractions)) {
      assert(f.red > 0.05 && f.red < 0.8, `${where}: the image shows through the glyphs only (${JSON.stringify(f)})`);
      assert(f.green < 0.01, `${where}: crop text draws nothing itself (${JSON.stringify(f)})`);
    }
    await key('Escape');

    console.log('PASS crop mode: draw crop shapes (union), move, undo, Esc/Enter, edit, make from shapes, empty exit collab=' + collab);
  }
  assert.deepEqual(runtimeErrors, []);
} finally { ws.close(); }
