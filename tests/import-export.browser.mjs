import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const server = process.env.IMPORT_TEST_SERVER;
const dir = `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-import-export-repair`;
await mkdir(dir, { recursive: true });
const page = (await (await fetch(`${cdp}/json/list`)).json()).find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(page, 'serial browser fixture owner required');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(), matrix = [], owned = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { const [resolve, reject] = pending.get(m.id); pending.delete(m.id); m.error ? reject(m.error) : resolve(m.result); } });
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, [resolve, reject]); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(expression) { for (let i = 0; i < 240; i++) { try { if (await ev(expression)) return; } catch {} await wait(50); } throw Error(`Timed out: ${expression}`); }
async function click(selector) { const p = await ev(`(()=>{const e=${selector};if(!e)throw Error('missing control');const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'left', clickCount: 1 }); await wait(100); }
const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const store = `(await import('/src/store/presentationStore.ts')).usePresentationStore`;
const vault = `(await import('/src/store/vaultStore.ts')).useVaultStore`;
const current = () => ev(`(async()=>${store}.getState().presentation)()`);
const close = async () => { await click(`document.querySelector('[title="Back to Projects"]')`); await until(`!!document.querySelector('input[type=file][accept*=pptx]')`); };
async function navigate(url) { await send('Page.navigate', { url }); await wait(500); await until(`document.readyState==='complete' && !!document.querySelector('#root')?.children.length`); }
async function importFile(file, mobile = false) {
  if (mobile) await click(`document.querySelector('[aria-label="Menu"]')`);
  await click(button('Import'));
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept*=pptx]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await until(`(async()=>!!${vault}.getState().activeProjectId && !document.querySelector('input[type=file][accept*=pptx]'))()`);
}
async function captureExport(mode) {
  await ev(`(()=>{window.__html=null;const original=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='text/html')blob.text().then(t=>window.__html=t);return original.call(this,blob)};})()`);
  await click(`document.querySelector('[title="Export"]')`);
  if (mode === 'editor') await click(`document.querySelector('input[type=checkbox]')`);
  await click(button('Export'));
  await until(`typeof window.__html==='string'`);
  return ev('window.__html');
}
// NotesEditor commits unchanged notes on dev StrictMode mount/unmount; it advances updatedAt.
function exactContent(actual, expected) { assert.deepEqual({ ...actual, updatedAt: expected.updatedAt }, expected); }
function same(actual, expected) { assert.notEqual(actual.id, expected.id); exactContent({ ...actual, id: expected.id }, expected); }
let previousConfig, fixtureTitle;
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false });
  await navigate(base);
  previousConfig = await ev(`localStorage.getItem('slides-storage-config')`);
  await ev(`(async()=>{await ${vault}.getState().setStorageMode('local')})()`);
  await until(`!!document.querySelector('input[type=file][accept*=pptx]')`);
  const source = await ev(`(async()=>{const f=await import('/src/utils/slideFactory.ts');const p=f.createPresentation();p.id='native-import-'+crypto.randomUUID();p.title='Import roundtrip '+p.id;const special="$$x$$ $& $\x60 $' </script > </script/> <!-- <script> ü";const s=p.slides[p.slideOrder[0]];s.notes=special;const box=f.createShapeElement('rect',{id:'container',fill:'#12345678',fillStyle:'hachure',cornerRadius:12});const text=f.createTextElement({id:'label',text:'$$x^2$$ '+special,containerId:'container',boundTextLayout:'measured',transitions:{content:'write',contentOptions:{write:{undoFirst:true}}}});const path=f.createShapeElement('path',{id:'connector',points:[0,0,100,100],endBinding:{elementId:'container',mode:'aim',fixedPoint:[.5,.5]},strokeStyle:'dashed',transitions:{controlPoints:'ease'}});const resource={id:'resource-stable',name:special,type:'image',src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxL8AAAAASUVORK5CYII=',originalWidth:1,originalHeight:1};p.resources[resource.id]=resource;const image={id:'image',type:'image',x:700,y:100,width:50,height:50,rotation:0,opacity:1,visible:true,locked:false,resourceId:resource.id,cropX:0,cropY:0,cropWidth:1,cropHeight:1};for(const el of [box,text,path,image]){s.elements[el.id]=el;s.elementOrder.push(el.id);p.objects[el.id]={id:el.id,name:el.id,type:el.type};}const next=structuredClone(s);next.id='second-slide';next.hidden=true;next.groupId=s.groupId='group-stable';next.elements.label.text='Second $$y$$';next.elements.label.visible=false;next.elements.container.x+=100;p.slides[next.id]=next;p.slideOrder.push(next.id);const {layoutSvgText}=await import('/src/utils/textLayout.ts');const {fitLabelToDoc,labelWrapWidthFor,syncDependentsAfterMutation}=await import('/src/utils/syncDependents.ts');for(const slide of Object.values(p.slides)){for(let pass=0;pass<3;pass++){const c=slide.elements.container,t=slide.elements.label;const doc=await layoutSvgText(t.text,t.style,labelWrapWidthFor(c,t));const fit=fitLabelToDoc(c,t,doc);Object.assign(t,fit.label);Object.assign(c,fit.container);for(const u of syncDependentsAfterMutation(slide.elements,slide.elementOrder,new Set(['container','label']),undefined,true))Object.assign(slide.elements[u.elementId],u.changes);}}return p})()`);
  // Slide and template IDs are separate namespaces; a template has no transition.
  const templateSlide = source.slides[source.slideOrder[0]];
  source.templates[templateSlide.id] = { id: templateSlide.id, name: 'Same-key native template',
    elements: structuredClone(templateSlide.elements), elementOrder: [...templateSlide.elementOrder],
    background: structuredClone(templateSlide.background) };
  fixtureTitle = source.title;
  await writeFile(`${dir}/native.json`, JSON.stringify(source));
  await importFile(`${dir}/native.json`);
  const imported = await current(); owned.push({ mode: 'local', id: imported.id }); same(imported, source);
  matrix.push('local native Import button/file-input preserves rich two-keyframe payload; fresh project identity');
  const exported = {}, payloads = {};
  for (const mode of ['editor', 'viewer']) {
    const beforeExport = await current(); const html = await captureExport(mode); exported[mode] = html;
    await writeFile(`${dir}/${mode}.html`, html);
    const parsed = await ev(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(html)},'text/html');return JSON.parse(d.getElementById('slides-payload').textContent)})()`);
    assert.deepEqual(parsed, beforeExport); payloads[mode] = parsed;
    await close(); await importFile(`${dir}/${mode}.html`); const p = await current(); same(p, imported); owned.push({ mode: 'local', id: p.id });
    matrix.push(`${mode} generated real template / DOMParser / native HTML Import exact referenced payload`);
  }
  await close();
  matrix.push('same-key slide/template namespaces survive native JSON, both HTML exports and re-import');
  // Mobile and desktop share the same native input handler.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(200); await importFile(`${dir}/native.json`, true); const mobile = await current(); same(mobile, source); owned.push({ mode: 'local', id: mobile.id });
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 950, deviceScaleFactor: 1, mobile: false }); await wait(200); await close();
  matrix.push('mobile Import menu uses same native file-input path');
  // Explicit malformed rejection leaves picker/current deck unchanged.
  await writeFile(`${dir}/invalid.json`, JSON.stringify({ ...source, slideOrder: ['missing-slide'] }));
  await ev(`window.__alert=null;window.alert=m=>window.__alert=m`);
  await click(button('Import')); const { root } = await send('DOM.getDocument'); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file][accept*=pptx]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [`${dir}/invalid.json`] });
  await until(`!!window.__alert`); assert.match(await ev('window.__alert'), /missing ID "missing-slide"/); exactContent(await current(), mobile);
  matrix.push('malformed native explicit actionable rejection; current store unchanged');
  // Standalone bundles boot, then editor bundle re-exports via its actual UI.
  for (const mode of ['viewer', 'editor']) {
    await navigate(`${base}/__import-export-fixture/${mode}.html`);
    await until(`!!document.querySelector('svg') || document.body.textContent.includes('start')`);
    assert.deepEqual(await ev(`JSON.parse(document.getElementById('slides-payload').textContent)`), payloads[mode]);
    assert(await ev(`document.querySelector('#root').children.length>0`));
    if (mode === 'editor') {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
      await until(`!!document.querySelector('[title="Export"]')`);
      const html = await captureExport('editor'); await writeFile(`${dir}/reexport.html`, html);
      exactContent(await ev(`JSON.parse(new DOMParser().parseFromString(${JSON.stringify(html)},'text/html').getElementById('slides-payload').textContent)`), payloads[mode]);
    }
    matrix.push(`${mode} actual standalone boot${mode === 'editor' ? ' and UI re-export' : ''}`);
  }
  await navigate(`${base}/__import-export-fixture/reexport.html`);
  await until(`!!document.querySelector('svg') || document.body.textContent.includes('start')`);
  await navigate(base);
  await until(`!!document.querySelector('input[type=file][accept*=pptx]')`);
  await importFile(`${dir}/reexport.html`); const roundtrip = await current(); owned.push({mode:'local',id:roundtrip.id}); same(roundtrip, imported); await close();
  matrix.push('standalone re-export boots and imports again through native input');
  await ev(`(async()=>{await ${vault}.getState().setStorageMode('server',${JSON.stringify(server)})})()`);
  const userId = await ev(`(async()=>(await import('/src/hooks/useIdentity.ts')).getIdentity().userId)()`);
  const old = { ...source, slides: {}, slideOrder: [], objects: {}, resources: {}, templates: {} };
  const headers = { 'Content-Type': 'application/json', 'X-Slides-User': userId };
  let response = await fetch(`${server}/api/projects/${old.id}`, { method: 'PUT', headers, body: JSON.stringify({ presentation: old }) }); assert(response.ok); owned.push({ mode: 'server', id: old.id });
  await ev(`(async()=>{await ${vault}.getState().loadProjects();await ${vault}.getState().openProject(${JSON.stringify(old.id)})})()`);
  await until(`(async()=>!!(await import('/src/collab/yDocAdapter.ts')).getActiveDoc())()`);
  assert.deepEqual((await current()).slideOrder, []);
  await close(); await importFile(`${dir}/native.json`);
  const serverImported = await current(); same(serverImported, source); owned.push({ mode: 'server', id: serverImported.id });
  await until(`(async()=>{const d=(await import('/src/collab/yDocAdapter.ts')).getActiveDoc();return !!d&&(await import('/src/collab/ySchema.ts')).yDocToJson(d).id===${JSON.stringify(serverImported.id)}})()`);
  same(await current(), source); await wait(5500); same(await current(), source);
  response = await fetch(`${server}/api/projects/${old.id}`, { headers }); exactContent((await response.json()).presentation, old);
  await close(); await ev(`(async()=>{await ${vault}.getState().openProject(${JSON.stringify(serverImported.id)})})()`);
  await until(`(async()=>!!(await import('/src/collab/yDocAdapter.ts')).getActiveDoc())()`); same(await current(), source);
  await navigate(base); await ev(`(async()=>{await ${vault}.getState().openProject(${JSON.stringify(serverImported.id)})})()`);
  await until(`(async()=>!!(await import('/src/collab/yDocAdapter.ts')).getActiveDoc())()`); same(await current(), source);
  matrix.push('ephemeral real server: existing empty original-ID room untouched; import gets fresh populated room; sync, snapshot delay, reopen and reload preserve native payload');
  await close();
  await writeFile(`${dir}/browser-evidence.json`, JSON.stringify({ matrix, owned }, null, 2));
  console.log(JSON.stringify({ passed: true, matrix }, null, 2));
} finally {
  // Only IDs created by this test; never delete other projects or purge rooms.
  try {
    await navigate(base);
    for (const mode of ['server', 'local']) {
      await ev(`(async()=>{await ${vault}.getState().setStorageMode('${mode}'${mode === 'server' ? ',' + JSON.stringify(server) : ''})})()`);
      // Recover only this run's explicitly owned title if an assertion failed before ID registration.
      if(fixtureTitle){const fixtures=await ev(`(async()=>${vault}.getState().projects.filter(p=>p.title===${JSON.stringify(fixtureTitle)}).map(p=>p.id))()`);for(const id of fixtures)if(!owned.some(p=>p.mode===mode&&p.id===id))owned.push({mode,id});}
      for (const fixture of owned.filter(p => p.mode === mode)) await ev(`(async()=>{await ${vault}.getState().deleteProject(${JSON.stringify(fixture.id)})})()`);
    }
    if (previousConfig === null) await ev(`localStorage.removeItem('slides-storage-config')`);
    else if (previousConfig !== undefined) await ev(`localStorage.setItem('slides-storage-config',${JSON.stringify(previousConfig)})`);
    await send('Page.navigate', { url: `${base}/tests/canvas-fixture.html` });
  } catch (e) { console.error('owned fixture cleanup failed', e); }
  await send('Page.setInterceptFileChooserDialog', { enabled: false });
  ws.close();
}
