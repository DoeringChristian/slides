import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// PDF export: a video cannot play in a PDF, so its page shows the video's
// first frame — not a dark placeholder box. Uses a real in-page recorded video.
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


try {
  await waitForCanvasFixture(evaluate);
  const result = await evaluate(`(async () => {
    // A short WebM whose frames are solid red.
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const ctx = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    // Red for the first half second, then blue.
    for (let i = 0; i < 30; i++) { ctx.fillStyle = i < 15 ? 'rgb(255,0,0)' : 'rgb(0,0,255)'; ctx.fillRect(0, 0, 320, 200); await new Promise(r => setTimeout(r, 33)); }
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    const src = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    const { preloadResources, renderSlide } = await import('/src/utils/io/exportPdf.ts');
    const resources = { v: { id: 'v', name: 'clip', type: 'video', src, originalWidth: 320, originalHeight: 200 } };
    const slide = { id: 's', elementOrder: ['vid'], background: { type: 'solid', color: '#ffffff' }, transition: { duration: 300 }, notes: '',
      elements: { vid: { id: 'vid', type: 'image', x: 100, y: 100, width: 320, height: 200, rotation: 0, opacity: 1, locked: false, visible: true, resourceId: 'v'} } };
    const images = await preloadResources([slide], resources);
    const page = renderSlide(slide, resources, images, 1);
    const px = (x, y) => Array.from(page.getContext('2d').getImageData(x, y, 1, 1).data);
    // A keyframe showing a still from late in the clip exports that frame.
    const still = { ...slide, id: 's2', elements: { vid: { ...slide.elements.vid, playback: 'still', playFrom: 0.8 } } };
    const later = renderSlide(still, resources, await preloadResources([still], resources), 1);
    return { framed: images.has('video:s:vid'), inside: px(260, 200), outside: px(50, 50),
      still: Array.from(later.getContext('2d').getImageData(260, 200, 1, 1).data) };
  })()`);
  console.log('PDF_VIDEO', JSON.stringify(result));
  assert.equal(result.framed, true, 'the first frame was extracted');
  const [r, g, b] = result.inside;
  assert(r > 200 && g < 60 && b < 60, `the page shows the video's red first frame, not the dark placeholder: ${result.inside}`);
  assert.deepEqual(result.outside.slice(0, 3), [255, 255, 255]);
  assert(result.still[2] > 200 && result.still[0] < 60, `a Still keyframe exports its own frame (blue, at 0.8 s): ${result.still}`);
  console.log('PASS PDF export shows a video at the frame its keyframe starts from');
} finally { ws.close(); }
