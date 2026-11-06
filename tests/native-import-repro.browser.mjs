import './browser-gate-required.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const server = process.env.IMPORT_TEST_SERVER;
const dir = `${process.env.BROWSER_GATE_EVIDENCE}/artifacts/native-import-repro`;
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
async function until(expression) { for (let i = 0; i < 240; i++) { try { if (await ev(expression)) return; } catch {} await wait(50); } throw Error(`Timed out: ${expression}; dialogs: ${JSON.stringify(errors)}; body: ${await ev('document.body.innerText')}`); }
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
const files = JSON.parse(process.env.SLIDES_IMPORT_FILES || '[]');

const errors=[];
ws.addEventListener('message', e => {
  const m=JSON.parse(e.data);
  if(m.method==='Page.javascriptDialogOpening') {
    errors.push(m.params.message);
    send('Page.handleJavaScriptDialog',{accept:true});
  }
  if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
});
try {
  await send('Page.enable');await send('Runtime.enable');await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog',{enabled:true});
  await send('Emulation.setDeviceMetricsOverride', {width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await navigate(base);
  if (!files.length) {
    const legacy=await ev(`(async()=>{
      const f=await import('/src/utils/slideFactory.ts');
      const p=f.createPresentation();const s=p.slides[p.slideOrder[0]];
      const shape=f.createShapeElement('rect',{id:'old-shape',x:100,y:100});
      delete shape.creationPreset;
      s.elements[shape.id]=shape;s.elementOrder=[shape.id];
      p.objects[shape.id]={id:shape.id,name:'Rectangle',type:'shape'};
      p.slides.recovered={...structuredClone(s),id:'recovered'};
      delete p.updatedAt;
      return p;
    })()`);
    const file=dir+'/legacy.json';await writeFile(file,JSON.stringify(legacy));files.push(file);
  }
  for (const mode of ['local','server']) {
    await ev(`(async()=>{await ${vault}.getState().setStorageMode(${JSON.stringify(mode)},${JSON.stringify(server)})})()`);
    await until(`!!document.querySelector('input[type=file][accept*=pptx]')`);
    for(const file of files) {
      const content=await readFile(file,'utf8');
      const expected=await ev(`(async()=>{const {importPresentationFile}=await import('/src/utils/importPresentation.ts');return importPresentationFile(new File([${JSON.stringify(content)}],${JSON.stringify(file.split('/').at(-1))}));})()`);
      await importFile(file);
      await wait(mode==='server'?6500:400);
      const imported=await current();
      // Compare persisted content after real app mount and collaboration sync.
      assert.equal(imported.slideOrder.length,expected.slideOrder.length);
      assert.deepEqual(Object.keys(imported.objects).sort(),Object.keys(expected.objects).sort());
      assert.deepEqual(imported.resources,expected.resources);
      for(const sid of expected.slideOrder) {
        assert.deepEqual(imported.slides[sid].elementOrder,expected.slides[sid].elementOrder);
        for(const eid of expected.slides[sid].elementOrder) {
          const a=imported.slides[sid].elements[eid],b=expected.slides[sid].elements[eid];
          assert.equal(a.type,b.type);
          if(b.type==='image')assert.equal(a.resourceId,b.resourceId);
          if(b.type==='text')assert.equal(a.text,b.text);
        }
      }
      const id=imported.id;
      await close();
      await ev(`(async()=>{await ${vault}.getState().openProject(${JSON.stringify(id)})})()`);
      await until(`!!document.querySelector('[title="Back to Projects"]')`);
      await wait(mode==='server'?1000:200);
      assert.equal((await current()).slideOrder.length,expected.slideOrder.length);
      assert.deepEqual(errors,[]);
      console.log('PASS '+mode+' actual file import, sync, save, reopen: '+file+' ('+expected.slideOrder.length+' slides)');
      await close();
    }
  }
} finally {
  await writeFile(dir+'/errors.json',JSON.stringify(errors,null,2));
  ws.close();
}
