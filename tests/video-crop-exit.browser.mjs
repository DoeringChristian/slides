import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// A cropped video and its crop shape leave together: through the exit half of
// a transition the video must fade exactly like its outline, never drop out
// early. Measured from real screenshots with a real (in-page recorded) video.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
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

/** Decode an 8-bit RGB(A) PNG (what CDP screenshots produce). */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { width, height, at: (x, y) => [...out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await waitForCanvasFixture(evaluate);
  // Record a short solid-red WebM in the page and register it as a video resource.
  await evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    for (let i = 0; i < 20; i++) { ctx.fillStyle = 'rgb(255,0,0)'; ctx.fillRect(0, 0, 320, 200); await new Promise(r => setTimeout(r, 33)); }
    await new Promise(r => { rec.onstop = r; rec.stop(); });
    window.__videoUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  })()`);
  const result = [];
  const frames = [0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.48];
  for (const t of frames) {
    await evaluate(`(() => {
      const img = { id: 'vid', type: 'image', x: 100, y: 100, width: 320, height: 200, rotation: 0, opacity: 1, locked: false, visible: true, resourceId: 'v', objectGroupIds: ['g'], playing: false, muted: true };
      const mask = { id: 'mask', type: 'shape', shapeType: 'rect', creationPreset: 'rect', x: 120, y: 120, width: 200, height: 140, rotation: 0, opacity: 1, locked: false, visible: true, fill: 'transparent', stroke: '#000000', strokeWidth: 6, cornerRadius: 0, objectGroupIds: ['g'], cropGroupId: 'g' };
      const slide = els => ({ id: 's' + els.length, elements: Object.fromEntries(els.map(e => [e.id, e])), elementOrder: els.map(e => e.id), background: { type: 'solid', color: '#ffffff' }, transition: { duration: 300 }, notes: '' });
      const resources = { v: { id: 'v', name: 'v', type: 'video', src: window.__videoUrl, originalWidth: 320, originalHeight: 200, duration: 0.6 } };
      return canvasTest.renderPresenterFrame(slide([img, mask]), slide([]), resources, ${t});
    })()`);
    // Let the video decode and paint its first frame.
    await evaluate(`new Promise(r => { const v = document.querySelector('#presenter-frame-host video'); if (!v) return r(); if (v.readyState >= 2) return r(); v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 1500); })`);
    await wait(150);
    const shot = Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 960, height: 540, scale: 1 } })).data, 'base64');
    if (t === 0.3) await writeFile(`${process.env.BROWSER_GATE_EVIDENCE}/video-crop-exit-t0.3.png`, shot);
    const png = decodePng(shot);
    // Inside the crop (video), and on the crop's outline.
    result.push({ t, video: png.at(220, 190), outline: png.at(120, 190) });
  }
  console.log('VIDEO_EXIT', JSON.stringify(result));
  for (const { t, video, outline } of result) {
    const expected = Math.max(0, 1 - t / 0.5);
    // Video red fades like the outline: green/blue channels of the video
    // sample (255·(1-opacity) over white) track the outline's darkness.
    const videoAlpha = 1 - video[1] / 255;
    const outlineAlpha = 1 - outline[0] / 255;
    assert(Math.abs(videoAlpha - expected) < 0.08, `t=${t}: video opacity ${videoAlpha.toFixed(2)} vs expected ${expected.toFixed(2)} (${video})`);
    assert(Math.abs(outlineAlpha - expected) < 0.08, `t=${t}: outline opacity ${outlineAlpha.toFixed(2)} vs expected ${expected.toFixed(2)} (${outline})`);
  }
  console.log('PASS cropped video fades out with its crop shape');
} finally { ws.close(); }
