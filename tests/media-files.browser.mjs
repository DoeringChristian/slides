import './browser-gate-required.mjs';
// Media as files, end to end against a real backend: an added image and
// video are uploaded as raw bytes (the deck only references them), stream
// with HTTP Range, come back from the server after the local copy is gone,
// stay on this machine across a reload, and presenting waits until every
// file is here — and says which one is missing when one is.
import assert from 'node:assert/strict';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const server = process.env.IMPORT_TEST_SERVER;
assert(server, 'needs the owned backend (persistence suite)');
const page = (await (await fetch(`${cdp}/json/list`)).json()).find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
assert(page, 'serial browser fixture owner required');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (pending.has(m.id)) { const [resolve, reject] = pending.get(m.id); pending.delete(m.id); m.error ? reject(m.error) : resolve(m.result); }
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, [resolve, reject]); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(expression, what = expression) { for (let i = 0; i < 400; i++) { try { if (await ev(expression)) return; } catch {} await wait(50); } throw Error(`Timed out: ${what}`); }
async function navigate(url) { await send('Page.navigate', { url }); await wait(500); await until(`document.readyState==='complete' && !!document.querySelector('#root')?.children.length`); }
const store = `(await import('/src/store/presentationStore.ts')).usePresentationStore`;
const editor = `(await import('/src/store/editorStore.ts')).useEditorStore`;
const vault = `(await import('/src/store/vaultStore.ts')).useVaultStore`;
const media = `(await import('/src/media/mediaStore.ts'))`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await navigate(base);
  await ev(`(async()=>{indexedDB.deleteDatabase('slides-media');await ${vault}.getState().setStorageMode('server', ${JSON.stringify(server)})})()`);
  await ev(`(async()=>{await ${vault}.getState().createProject('Media files')})()`);
  await until(`(async()=>!!${vault}.getState().activeProjectId)()`, 'project open');
  const projectId = await ev(`(async()=>${vault}.getState().activeProjectId)()`);

  // Add an image and a video the way a drop does: the file loaders, then the store.
  const added = await ev(`(async()=>{
    const f=await import('/src/utils/model/slideFactory.ts');
    const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle='#e00';x.fillRect(0,0,64,48);
    const png=await new Promise(r=>c.toBlob(r,'image/png'));
    const v=document.createElement('canvas');v.width=160;v.height=90;const vx=v.getContext('2d');
    const rec=new MediaRecorder(v.captureStream(30),{mimeType:'video/webm'});const ch=[];rec.ondataavailable=e=>ch.push(e.data);rec.start();
    for(let i=0;i<30;i++){vx.fillStyle='hsl('+i*12+',80%,50%)';vx.fillRect(0,0,160,90);await new Promise(r=>setTimeout(r,33));}
    await new Promise(r=>{rec.onstop=r;rec.stop();});
    const webm=new File(ch,'clip.webm',{type:'video/webm'});
    const s=${store}.getState(), slide=(${editor}).getState().activeSlideId;
    const img=await f.loadImageFile(new File([png],'red.png',{type:'image/png'}),{x:100,y:100,width:200,height:150},s.presentation.resources);
    s.addResource(img.resource);s.addElement(slide,img.element);
    const vid=await f.loadVideoFile(webm,{x:400,y:100,width:320,height:180},s.presentation.resources);
    s.addResource(vid.resource);s.addElement(slide,vid.element);
    return {image:img.resource,video:vid.resource,pngSize:png.size,webmSize:webm.size};
  })()`);
  assert.equal(added.image.size, added.pngSize);
  assert.equal(added.video.mime, 'video/webm');
  assert.match(added.image.hash, /^[0-9a-f]{64}$/);
  // Rendered at once from this machine's copy, while it uploads.
  await until(`!!document.querySelector('img[src^="blob:"]')`, 'image shown from its local copy');

  await ev(`(async()=>{await ${media}.flushUploads()})()`);
  const user = await ev(`JSON.parse(localStorage.getItem('slides.identity')).userId`);
  const url = (hash) => `${server}/api/projects/${projectId}/media/${hash}?u=${user}`;
  for (const r of [added.image, added.video]) {
    const head = await fetch(url(r.hash), { method: 'HEAD' });
    assert.equal(head.status, 200, `the server keeps ${r.name}`);
    assert.equal(head.headers.get('content-type'), r.mime);
  }
  // Streams: a range request answers with just those bytes.
  const range = await fetch(url(added.video.hash), { headers: { Range: 'bytes=0-9' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  // Nobody else's media, and nothing that is not the bytes it claims.
  assert.equal((await fetch(`${server}/api/projects/${projectId}/media/${added.image.hash}?u=someoneElse1`)).status, 403);
  const forged = await fetch(url('0'.repeat(64)), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: 'not those bytes' });
  assert.equal(forged.status, 400);

  // The deck itself holds references only.
  await wait(5600); // the server's backup snapshot
  // (The project list's thumbnail is a small picture of slide 1, not the deck.)
  const deckJson = JSON.stringify((await (await fetch(`${server}/api/projects/${projectId}`, { headers: { 'X-Slides-User': user } })).json()).presentation);
  assert(!deckJson.includes('base64'), 'no media inside the deck');
  assert(deckJson.length < 20000, `the deck stays small (${deckJson.length} bytes)`);

  // A fresh browser state: the local copy is gone, the server has the files.
  await ev(`(async()=>{${media}.resetMediaStoreForTests();})()`);
  await send('Page.reload'); await wait(800);
  await until(`document.readyState==='complete' && !!document.querySelector('#root')?.children.length`);
  // Still on this machine after the reload (IndexedDB), before any deck is open.
  assert.equal(await ev(`(async()=>!!(await ${media}.getMediaBlob(${JSON.stringify(added.video.hash)})))()`), true, 'kept across a reload');
  await ev(`(async()=>{indexedDB.deleteDatabase('slides-media');})()`);
  await send('Page.reload'); await wait(800);
  await until(`document.readyState==='complete' && !!document.querySelector('#root')?.children.length`);
  await ev(`(async()=>{await ${vault}.getState().openProject(${JSON.stringify(projectId)})})()`);
  await until(`(async()=>{const r=${media}.getDeckReadiness();return r.total===2&&r.ready===2&&!r.checking})()`, 'both files copied back from the server');
  await until(`!!document.querySelector('img[src^="blob:"]')`, 'image shown again');

  // Presenting plays only from this machine's copies, and starts at once.
  await ev(`(async()=>{${editor}.getState().setPresentingSlideIndex(0);${editor}.getState().setPresenting(true)})()`);
  await wait(400);
  assert.equal(await ev(`!!document.querySelector('[data-media-gate]')`), false, 'no wait when everything is here');
  await until(`(()=>{const v=document.querySelector('.fixed.inset-0 video');return !!v && v.src.startsWith('blob:')})()`, 'presenter video from the local copy');
  await ev(`(async()=>{${editor}.getState().setPresenting(false)})()`);

  // A file found nowhere: the deck says so, and presenting asks before it starts.
  await ev(`(async()=>{const s=${store}.getState();s.addResource({id:'ghost-media',name:'lost.mp4',type:'video',hash:'${'e'.repeat(64)}',mime:'video/mp4',size:1,originalWidth:10,originalHeight:10});
    const f=await import('/src/utils/model/slideFactory.ts');s.addElement(${editor}.getState().activeSlideId,f.createImageElement('ghost-media',10,10,{x:900,y:400}))})()`);
  await until(`(async()=>{const r=${media}.getDeckReadiness();return !r.checking&&r.missing.length===1})()`, 'missing file reported');
  assert.match(await ev(`document.querySelector('[data-media-readiness]')?.textContent ?? ''`), /1 media file missing/);
  await ev(`(async()=>{${editor}.getState().setPresenting(true)})()`);
  await until(`!!document.querySelector('[data-media-gate]')`, 'presenting waits and explains');
  assert.match(await ev(`document.querySelector('[data-media-gate]').textContent`), /lost\.mp4/);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(`!document.querySelector('[data-media-gate]')`, 'Enter presents anyway');
  await ev(`(async()=>{${editor}.getState().setPresenting(false)})()`);

  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS media files: raw uploads verified by hash, Range streaming, small decks, local copies across reloads, presenting waits for every file');
} finally { ws.close(); }
