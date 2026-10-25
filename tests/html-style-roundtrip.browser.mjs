import './browser-gate-required.mjs';
// Actual Ctrl+S download -> main-page Import -> cold-start collaboration.
// Run serially with the dedicated canvas-fixture CDP target and an isolated server.
// A source-only Yjs roundtrip cannot detect a stale running backend schema.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const server = process.env.IMPORT_TEST_SERVER;
const dir = process.env.HTML_STYLE_EVIDENCE_DIR ?? `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-html-style-regression`;
await mkdir(`${dir}/downloads`, { recursive: true });
const target = (await (await fetch(`${cdp}/json/list`)).json())
  .find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(target, 'dedicated serial canvas-fixture target required');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let seq = 0;
const pending = new Map(), downloads = [], owned = [], results = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Browser.downloadWillBegin') downloads.push(message.params);
  if (!pending.has(message.id)) return;
  const [resolve, reject] = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(message.error); else resolve(message.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, [resolve, reject]);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  for (let i = 0; i < 240; i++) {
    try { if (await evaluate(expression)) return; } catch { /* navigation may replace the execution context */ }
    await wait(50);
  }
  throw Error(`Timed out: ${expression}`);
}
async function click(expression) {
  const [x, y] = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await wait(100);
}
const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const store = `(await import('/src/store/presentationStore.ts')).usePresentationStore`;
const vault = `(await import('/src/store/vaultStore.ts')).useVaultStore`;
const current = () => evaluate(`(async()=>${store}.getState().presentation)()`);
async function navigate(url) {
  await send('Page.navigate', { url });
  await wait(500);
  await until(`document.readyState==='complete' && !!document.querySelector('#root')?.children.length`);
}
async function closeProject() {
  await click(`document.querySelector('[title="Back to Projects"]')`);
  await until(`!!document.querySelector('input[type=file][accept*=pptx]')`);
}
async function storage(mode) {
  await evaluate(`(async()=>{await ${vault}.getState().setStorageMode(${JSON.stringify(mode)}${mode === 'server' ? ',' + JSON.stringify(server) : ''})})()`);
}
async function importFile(path, mode) {
  // Do not replace this with importProject/loadPresentation: the main-page handler is under test.
  await click(button('Import'));
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept*=pptx]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
  await until(`(async()=>!!${vault}.getState().activeProjectId && !${vault}.getState().isLoading)()`);
  const imported = await current();
  owned.push({ mode, id: imported.id }); // only successful, explicitly created IDs may be cleaned up
  await writeFile(`${dir}/owned.json`, JSON.stringify(owned, null, 2));
  return imported;
}
async function exportDownload(mode, name) {
  const count = downloads.length;
  if (mode === 'viewer') {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key: 's', code: 'KeyS', modifiers: 2, windowsVirtualKeyCode: 83 });
    }
  } else {
    await click(`document.querySelector('[title="Export"]')`);
    await click(`document.querySelector('input[type=checkbox]')`);
    await click(button('Export'));
  }
  for (let i = 0; i < 240 && downloads.length === count; i++) await wait(50);
  assert.equal(downloads.length, count + 1, 'native browser download event');
  const event = downloads.at(-1);
  let html;
  for (let i = 0; i < 240; i++) {
    try { html = await readFile(`${dir}/downloads/${event.guid}`, 'utf8'); if (html.includes('</html>')) break; } catch { /* download not finished */ }
    await wait(50);
  }
  assert(html?.includes('</html>'), 'completed HTML download');
  const path = `${dir}/${name}.html`;
  await writeFile(path, html);
  const payload = await evaluate(`JSON.parse(new DOMParser().parseFromString(${JSON.stringify(html)},'text/html').getElementById('slides-payload').textContent)`);
  return { path, payload, event };
}
function samePresentation(actual, expected) {
  assert.notEqual(actual.id, expected.id, 'import allocates a new project, not a preexisting Y room');
  // NotesEditor mount commits unchanged notes; only updatedAt can differ.
  assert.deepEqual({ ...actual, id: expected.id, updatedAt: expected.updatedAt }, expected);
}
let previousConfig;
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: `${dir}/downloads`, eventsEnabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(base);
  previousConfig = await evaluate(`localStorage.getItem('slides-storage-config')`);
  for (const style of ['hachure', 'crosshatch', 'solid']) {
    await storage('local');
    const source = await evaluate(`(async()=>{
      const f=await import('/src/utils/slideFactory.ts');const p=f.createPresentation();
      p.id=crypto.randomUUID();p.title='HTML style regression '+p.id;
      const s=p.slides[p.slideOrder[0]];
      const e=f.createShapeElement('rect',{id:'rectangle',x:260,y:180,width:600,height:380,
        fill:'#0088cc',fillStyle:${JSON.stringify(style)},stroke:'#112233',strokeWidth:4,cornerRadius:18});
      s.elements={rectangle:e};s.elementOrder=['rectangle'];p.objects.rectangle={id:'rectangle',name:'Rectangle',type:'shape'};
      return p;
    })()`);
    await writeFile(`${dir}/${style}.json`, JSON.stringify(source));
    await importFile(`${dir}/${style}.json`, 'local');
    const committed = await current();
    const viewer = await exportDownload('viewer', `${style}-viewer`);
    const editor = await exportDownload('editor', `${style}-editor`);
    assert.deepEqual(viewer.payload, committed);
    assert.deepEqual(editor.payload, committed, 'editor and Ctrl+S viewer embed identical authored data');
    await closeProject();
    for (const mode of ['local', 'server']) {
      await storage(mode);
      const imported = await importFile(viewer.path, mode);
      if (mode === 'server') {
        await until(`(async()=>{const d=(await import('/src/collab/yDocAdapter.ts')).getActiveDoc();return !!d&&(await import('/src/collab/ySchema.ts')).yDocToJson(d).id===${JSON.stringify(imported.id)}})()`);
        const yjson = await evaluate(`(async()=>(await import('/src/collab/ySchema.ts')).yDocToJson((await import('/src/collab/yDocAdapter.ts')).getActiveDoc()))()`);
        samePresentation(yjson, committed);
      }
      await wait(250);
      samePresentation(await current(), committed);
      await evaluate(`(async()=>{(await import('/src/store/editorStore.ts')).useEditorStore.getState().setSelectedElements(['rectangle'])})()`);
      const label = `Fill Style: ${style[0].toUpperCase()}${style.slice(1)}`;
      await until(`!!document.querySelector('button[aria-label="${label}"]')`);
      const canvasPaint = await evaluate(`(() => {
        const element = document.querySelector('.content-layer [data-element-id="rectangle"]');
        const rect = element?.querySelector('rect[stroke="#112233"]');
        if (!rect) throw new Error('Actual canvas rectangle missing');
        const fill = rect.getAttribute('fill');
        const patternId = /^url\\(#([^)]*)\\)$/.exec(fill ?? '')?.[1];
        const pattern = patternId ? document.getElementById(patternId) : null;
        return { fill, patternId, patternTag: pattern?.localName,
          ownsPattern: !!pattern && element.contains(pattern),
          patternStroke: pattern?.querySelector('path')?.getAttribute('stroke'),
          patternPath: pattern?.querySelector('path')?.getAttribute('d') };
      })()`);
      if (style === 'solid') {
        assert.equal(canvasPaint.fill, '#0088cc', 'actual canvas rectangle retains solid fill');
        assert.equal(canvasPaint.patternId, undefined);
      } else {
        assert(canvasPaint.patternId, 'actual canvas rectangle references a fill pattern');
        assert.equal(canvasPaint.patternTag, 'pattern');
        assert.equal(canvasPaint.ownsPattern, true, 'paint server belongs to canvas element, not a property preview or thumbnail');
        assert.equal(canvasPaint.patternStroke, '#0088cc');
        assert(canvasPaint.patternPath?.length > 0, 'referenced canvas pattern contains hatch geometry');
      }
      await writeFile(`${dir}/${style}-${mode}-canvas-paint.json`, JSON.stringify(canvasPaint, null, 2));
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${dir}/${style}-${mode}.png`, Buffer.from(data, 'base64'));
      if (mode === 'server') await wait(5500); // include the server snapshot debounce, not just initial paint
      await closeProject();
      await evaluate(`(async()=>{await ${vault}.getState().openProject(${JSON.stringify(imported.id)})})()`);
      if (mode === 'server') await until(`(async()=>!!(await import('/src/collab/yDocAdapter.ts')).getActiveDoc())()`);
      samePresentation(await current(), committed);
      await closeProject();
      results.push({ style, mode, id: imported.id, download: viewer.event, passed: true });
      console.log(`PASS ${style}: Ctrl+S -> main Import -> ${mode} -> sync/render/reopen`);
    }
  }
} finally {
  // No prefix scans or existing-room resets. Do not touch any project not created above.
  try {
    await navigate(base);
    // Unmounting NotesEditor may enqueue a final Y update. Let its server
    // snapshot settle before deleting fixtures so it cannot recreate them.
    await wait(5500);
    for (const mode of ['server', 'local']) {
      await storage(mode);
      for (const { id } of owned.filter(item => item.mode === mode)) {
        await evaluate(`(async()=>{await ${vault}.getState().deleteProject(${JSON.stringify(id)})})()`);
        assert.equal(await evaluate(`(async()=>${vault}.getState().error)()`), null, `cleanup ${id}`);
      }
    }
  } finally {
    if (previousConfig === null) await evaluate(`localStorage.removeItem('slides-storage-config')`);
    else if (previousConfig !== undefined) await evaluate(`localStorage.setItem('slides-storage-config',${JSON.stringify(previousConfig)})`);
    await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` });
    await send('Page.setInterceptFileChooserDialog', { enabled: false });
    await send('Browser.setDownloadBehavior', { behavior: 'default' });
    await writeFile(`${dir}/results.json`, JSON.stringify({ results, owned }, null, 2));
    ws.close();
  }
}
