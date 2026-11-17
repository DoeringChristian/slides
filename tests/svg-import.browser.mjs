import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// SVG import as editable objects: structure (groups, <use>, hidden parts,
// paint) and fidelity — the imported shapes, drawn by the editor's shared
// renderer, must match the browser's own rendering of the original SVG.
import assert from 'node:assert/strict';
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && (!process.env.CDP_TARGET_ID || p.id === process.env.CDP_TARGET_ID));
assert(page, 'Chrome page target is available');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}


// A drawing in its own coordinate system (viewBox), with nested transformed
// groups, rounded rects, circles, arcs, a gradient, a reused symbol, a
// hidden element, dashes, fill opacity and even-odd holes.
const SHAPES = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="200" viewBox="0 0 200 100">
  <defs>
    <linearGradient id="grad"><stop offset="0" stop-color="#22aa44"/><stop offset="1" stop-color="#22aa44"/></linearGradient>
    <symbol id="dot"><circle cx="5" cy="5" r="5" fill="#aa00aa"/></symbol>
  </defs>
  <rect x="0" y="0" width="200" height="100" fill="#f0f0f0"/>
  <g id="left" transform="translate(10 10)">
    <rect x="0" y="0" width="60" height="40" rx="8" fill="#ff0000" stroke="#000" stroke-width="2"/>
    <g transform="rotate(20 30 60) scale(1 1.2)"><circle cx="30" cy="55" r="12" fill="url(#grad)"/></g>
  </g>
  <g id="right" style="opacity:0.5">
    <path d="M110 20 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 Z M120 20 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 Z" fill="#0066ff" fill-rule="evenodd"/>
    <polyline points="110,70 140,90 170,70" fill="none" stroke="#333" stroke-width="3" stroke-dasharray="4 2"/>
  </g>
  <use xlink:href="#dot" x="180" y="5"/>
  <use href="#dot" x="180" y="80"/>
  <rect x="80" y="40" width="10" height="10" fill="#ffaa00" fill-opacity="0.5"/>
  <circle cx="100" cy="90" r="5" fill="#000" style="display:none"/>
</svg>`;

try {
  await waitForCanvasFixture(evaluate);
  const result = await evaluate(`(async () => {
    const { importSvg } = await import('/src/utils/io/importSvg.ts');
    const { renderSlideToSVG } = await import('/src/utils/io/svgRenderer.ts');
    const svgText = ${JSON.stringify(SHAPES)};
    // Fit the 200×100 drawing into a 600×300 box centred at (480, 270): an
    // exact ×3 scale placed at (180, 120), so the original can be drawn the
    // same way for comparison.
    const { elements, warnings } = await importSvg(svgText, { center: [480, 270], fit: { width: 600, height: 300 } });
    const slide = { id: 's', elements: Object.fromEntries(elements.map(e => [e.id, e])), elementOrder: elements.map(e => e.id), background: { type: 'solid', color: '#ffffff' }, transition: { duration: 300 }, notes: '' };
    const raster = async (svg, draw) => {
      const img = new Image(); img.src = 'data:image/svg+xml,' + encodeURIComponent(svg); await img.decode();
      const c = document.createElement('canvas'); c.width = 960; c.height = 540;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 960, 540); draw(ctx, img);
      return ctx.getImageData(0, 0, 960, 540).data;
    };
    const imported = await raster(renderSlideToSVG(slide, {}), (ctx, img) => ctx.drawImage(img, 0, 0, 960, 540));
    const original = await raster(svgText, (ctx, img) => ctx.drawImage(img, 180, 120, 600, 300));
    // Compare inside the drawing's box: fraction of pixels that differ
    // clearly (beyond anti-aliasing at edges).
    let differ = 0, total = 0;
    for (let y = 120; y < 420; y++) for (let x = 180; x < 780; x++) {
      const i = (y * 960 + x) * 4;
      const d = Math.abs(imported[i] - original[i]) + Math.abs(imported[i + 1] - original[i + 1]) + Math.abs(imported[i + 2] - original[i + 2]);
      total++; if (d > 60) differ++;
    }
    const ellipse = elements.find(e => e.type === 'shape' && /22aa44/i.test(e.fill));
    return {
      count: elements.length,
      types: [...new Set(elements.map(e => e.type + ':' + (e.shapeType ?? '')))],
      groups: elements.map(e => (e.objectGroupIds ?? []).length),
      sharedRoot: new Set(elements.map(e => (e.objectGroupIds ?? [])[0])).size,
      purples: elements.filter(e => /aa00aa/i.test(e.fill)).length,
      halfOrange: elements.find(e => /255, 170, 0/.test(e.fill))?.fill,
      dashed: elements.filter(e => e.strokeStyle === 'dashed').length,
      evenodd: elements.filter(e => e.geometry?.fills?.[0]?.rule === 'evenodd').length,
      ellipseRotated: !!ellipse,
      warnings,
      differ: differ / total,
    };
  })()`);
  console.log('SVG_IMPORT', JSON.stringify(result));
  // background, rounded rect, gradient circle, ring, polyline, 2 uses, orange; hidden circle skipped.
  assert.equal(result.count, 8);
  assert.deepEqual(result.types, ['shape:vector']);
  assert.equal(result.sharedRoot, 1, 'one group holds the whole import');
  assert(result.groups.some(n => n === 2), 'SVG groups with two objects become nested object groups');
  assert.equal(result.purples, 2, '<use> references expand into copies');
  assert.equal(result.halfOrange, 'rgba(255, 170, 0, 0.5)', 'fill-opacity goes into the colour');
  assert.equal(result.dashed, 1);
  assert.equal(result.evenodd, 1, 'holes are kept with the even-odd rule');
  assert(result.ellipseRotated, 'the gradient is flattened to its first colour');
  assert(result.warnings.some(w => /Gradients/.test(w)));
  assert(result.differ < 0.01, `imported shapes draw like the original (${(result.differ * 100).toFixed(2)}% of pixels differ)`);
  console.log('PASS SVG import: editable shapes, groups, <use>, paint, and pixel fidelity');

  // Text becomes a text object.
  const text = await evaluate(`(async () => {
    const { importSvg } = await import('/src/utils/io/importSvg.ts');
    const { elements } = await importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#eee"/><text x="10" y="50" font-size="20" font-family="serif" font-weight="bold" fill="#123456">Hello SVG</text></svg>');
    return elements.filter(e => e.type === 'text').map(e => ({ text: e.text, color: e.style.color, font: e.style.fontFamily, weight: e.style.fontWeight }));
  })()`);
  assert.deepEqual(text, [{ text: 'Hello SVG', color: '#123456', font: 'Libertinus Serif', weight: 'bold' }]);
  console.log('PASS SVG import: text becomes a text object');

  // Inkscape-style figures (regressions found on a real paper figure):
  // embedded images with line-wrapped base64, scratch objects off the page,
  // clip paths and masks as crops (content clipped off the page is
  // invisible), and arrow markers — also on straight lines that carry SVG's
  // default fill.
  const inkscape = await evaluate(`(async () => {
    const { importSvg } = await import('/src/utils/io/importSvg.ts');
    const c = document.createElement('canvas'); c.width = 2; c.height = 2;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2, 2);
    const b64 = c.toDataURL('image/png').split(',')[1];
    const wrapped = b64.match(/.{1,20}/g).join('\\n   ');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" viewBox="0 0 200 100">'
      + '<defs><marker id="tri" orient="auto"><path d="M5,0 L-3,5 V-5 Z"/></marker>'
      + '<clipPath id="crop"><rect x="10" y="10" width="40" height="40"/></clipPath>'
      + '<clipPath id="offpage"><rect x="-300" y="10" width="40" height="40"/></clipPath>'
      + '<mask id="m"><rect x="60" y="10" width="30" height="30" fill="#fff"/></mask></defs>'
      + '<image x="0" y="0" width="80" height="80" preserveAspectRatio="none" clip-path="url(#crop)" xlink:href="data:image/png;base64,\\n   ' + wrapped + '"/>'
      + '<image x="0" y="0" width="190" height="90" preserveAspectRatio="none" clip-path="url(#offpage)" xlink:href="data:image/png;base64,' + b64 + '"/>'
      + '<image x="50" y="0" width="80" height="80" preserveAspectRatio="none" mask="url(#m)" xlink:href="data:image/png;base64,' + b64 + '"/>'
      + '<path d="M110,50 L180,50" stroke="#000" stroke-width="1" fill="#000" style="marker-end:url(#tri)"/>'
      + '<path d="M110,80 C130,60 160,60 180,80" stroke="#000" fill="none" marker-start="url(#tri)"/>'
      + '<rect x="400" y="300" width="50" height="50" fill="#00f"/>'
      + '</svg>';
    const r = await importSvg(svg, { center: [480, 270], fit: { width: 600, height: 300 } });
    const crops = r.elements.filter(e => e.cropGroupId);
    return {
      images: r.elements.filter(e => e.type === 'image').length,
      resources: r.resources.length,
      croppedImages: r.elements.filter(e => e.type === 'image' && crops.some(b => e.objectGroupIds?.includes(b.cropGroupId))).length,
      arrows: r.elements.filter(e => e.shapeType === 'path').map(e => [e.startHead, e.endHead, e.curve]),
      blue: r.elements.some(e => /0000ff/i.test(e.fill ?? '')),
      warnings: r.warnings,
    };
  })()`);
  console.log('INKSCAPE', JSON.stringify(inkscape));
  assert.equal(inkscape.images, 2, 'line-wrapped base64 images load; the image clipped off the page is left out');
  assert.equal(inkscape.croppedImages, 2, 'clip path and mask become crop groups');
  assert.deepEqual(inkscape.arrows, [['none', 'triangle', 'linear'], ['triangle', 'none', 'bezier']], 'markers become arrowheads, also on a filled straight line');
  assert.equal(inkscape.blue, false, 'objects off the page are left out');
  assert(inkscape.warnings.some(w => /outside the page/.test(w)));
  console.log('PASS SVG import: Inkscape figures — wrapped images, off-page content, clips and masks as crops, arrows');

  // The real flow: inserting an SVG asks how; "Editable shapes" adds them to
  // the slide, grouped and selected.
  await evaluate(`canvasTest.setup({ mode: 'layout', empty: true })`); await wait(300);
  await evaluate(`(async () => {
    const { useSvgImport } = await import('/src/components/dialogs/svgImport.ts');
    const file = new File([${JSON.stringify(SHAPES)}], 'figure.svg', { type: 'image/svg+xml' });
    useSvgImport.getState().ask({ file, slideId: canvasTest.editor.getState().activeSlideId });
  })()`);
  await wait(200);
  assert(await evaluate(`!!document.querySelector('[data-svg-import]')`), 'the choice is offered');
  await evaluate(`[...document.querySelectorAll('[data-svg-import] button')].find(b => b.textContent.includes('Editable shapes')).click()`);
  await wait(800);
  const added = await evaluate(`(() => { const s = canvasTest.snapshot().slide; return { count: s.elementOrder.length, selected: canvasTest.editor.getState().selectedElementIds.length, dialog: !!document.querySelector('[data-svg-import]') }; })()`);
  // The gradient warning keeps the dialog open to report it.
  assert.equal(added.count, 8);
  assert.equal(added.selected, 8, 'the import is selected as one group');
  assert.equal(added.dialog, true, 'simplifications are reported');
  console.log('PASS SVG import dialog inserts editable shapes');
} finally { ws.close(); }
