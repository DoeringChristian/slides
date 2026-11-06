import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/canvas-modifiers.browser.mjs
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
let pressed=false;
async function mouse(type,x,y,modifiers=0){if(type==='mousePressed')pressed=true;if(type==='mouseReleased')pressed=false;await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!pressed?'none':'left',buttons:pressed?1:0,clickCount:1,modifiers});await wait(40);}
async function clickPoint(p,mods=0){await mouse('mousePressed',...p,mods);await mouse('mouseReleased',...p,mods);}
async function center(selector){return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});const b=el.getBoundingClientRect();return[b.x+b.width/2,b.y+b.height/2]})()`);}
async function card(id,mods=0){
  const point=await evaluate(`(()=>{const el=document.querySelector('[data-object-id="'+${JSON.stringify(id)}+'"]')??[...document.querySelectorAll('[data-object-group-id]')].find(el=>JSON.parse(el.dataset.memberIds).includes(${JSON.stringify(id)}));if(!el)throw Error('Missing object '+${JSON.stringify(id)});const tile=el.querySelector('.aspect-square');tile.scrollIntoView({block:'nearest'});const b=tile.getBoundingClientRect();return[b.x+b.width/2,b.y+b.height/2]})()`);
  await clickPoint(point,mods);
}
async function key(key,modifiers=0){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:'Key'+key.toUpperCase(),modifiers});await wait(80);}
async function selection(){return evaluate('canvasTest.editor.getState().selectedElementIds.slice().sort()');}
async function snap(){return evaluate('canvasTest.snapshot().slide');}
async function screen(x,y){return evaluate(`(()=>{const m=document.querySelector('.canvas-scroll-parent svg').getScreenCTM();return [m.a*${x}+m.e,m.d*${y}+m.f]})()`);}
async function drag(p,q){await mouse('mousePressed',...p);await mouse('mouseMoved',...q);await mouse('mouseReleased',...q);await wait(100);}
try {
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
for(const collab of [false,true]) {
  await setup({mode:'production',objectList:true,collab,subject:{x:250,y:150,width:100,height:80,fill:'#cc5533'},targets:[{id:'b',x:450,y:150,width:100,height:80,fill:'#44aa77'},{id:'c',x:650,y:150,width:100,height:80,fill:'#5577aa'},{id:'hidden',visible:false}],secondSlide:true});
  await card('subject');await card('b',4);assert.deepEqual(await selection(),['b','subject']);
  await card('subject',4);assert.deepEqual(await selection(),['b']);
  await card('subject');await card('c',8);assert.deepEqual(await selection(),['b','c','subject']);
  await card('subject');await card('b',8);assert.deepEqual(await selection(),['b','subject']);
  await card('hidden');assert.deepEqual(await selection(),['b','subject']);
  console.log('PASS list plain/control/meta/shift selection collab='+collab);
  assert.equal(await evaluate("document.querySelectorAll('[data-selection-action-bar]').length"),1,'one action bar for the shared selection box');
  await clickPoint(await center('[data-selection-action-bar] button[title="Lock"]'));
  assert((await snap()).elements.subject.locked);assert((await snap()).elements.b.locked);
  assert.equal(await evaluate("document.querySelectorAll('[data-selection-action-bar]').length"),1);
  await clickPoint(await center('[data-selection-action-bar] button[title="Unlock"]'));
  assert(!(await snap()).elements.subject.locked);assert(!(await snap()).elements.b.locked);
  await clickPoint(await center('[data-selection-action-bar] button[title="Hide from slide (Del)"]'));
  assert(!(await snap()).elements.subject.visible);assert(!(await snap()).elements.b.visible);
  await key('z',2);
  assert((await snap()).elements.subject.visible);assert((await snap()).elements.b.visible);
  await card('subject');await card('b',4);
  const before=await snap();
  await key('g',2);
  assert.equal(await evaluate("document.querySelectorAll('[data-object-group-id]').length"),1,'group is a single tile');
  assert.equal(await evaluate("document.querySelectorAll('[data-object-id=subject],[data-object-id=b]').length"),0,'members collapsed by default');
  await clickPoint(await center('button[aria-label="Expand group"]'));
  assert(await evaluate("!!document.querySelector('[data-group-members] [data-object-id=subject]')"),'membership is visibly contained');
  await clickPoint(await center('button[aria-label="Collapse group"]'));
  // Selecting on canvas must transfer keyboard focus away from property inputs.
  await evaluate(`(()=>{const input=document.createElement('input');input.id='focus-regression';input.value='123';document.body.append(input);input.focus();})()`);
  await clickPoint(await screen(270,180));
  await key('Backspace');
  assert(!(await snap()).elements.subject.visible,'Backspace hides selected objects after leaving an input');
  await key('z',2);
  await evaluate("document.querySelector('#focus-regression').remove()");
  await card('subject');
  assert.equal(await evaluate("document.querySelectorAll('[data-selection-action-bar]').length"),1,'one group action bar');
  const grouped=await snap();assert(grouped.elements.subject.objectGroupIds?.length===1);assert.deepEqual(grouped.elements.subject.objectGroupIds,grouped.elements.b.objectGroupIds);
  assert.deepEqual(grouped.elementOrder,before.elementOrder);
  await key('z',2);assert(!(await snap()).elements.subject.objectGroupIds);
  await key('z',10);assert((await snap()).elements.subject.objectGroupIds);
  await card('c');await card('b');assert.deepEqual(await selection(),['b','subject']);
  await card('b',4);assert.deepEqual(await selection(),[]);
  await clickPoint(await screen(270,180));assert.deepEqual(await selection(),['b','subject']);
  assert.equal(await evaluate("document.querySelectorAll('.selection-transformer').length"),1);
  assert.equal(await evaluate("document.querySelectorAll('#selection-overview [data-selection-highlight]').length"),1,'group has one overview outline');
  await card('c');
  await mouse('mouseMoved',...(await screen(270,180)));
  const hover=await evaluate("(()=>{const r=document.querySelector('.hover-outline rect');return r&&{x:+r.getAttribute('x'),width:+r.getAttribute('width')}})()");
  assert(hover && hover.x<250 && hover.width>300,'hover surrounds both group members');
  await clickPoint(await screen(270,180));
  const entry=await screen(270,180);
  for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x:entry[0],y:entry[1],button:'left',clickCount:2});
  await wait(100);
  assert.deepEqual(await selection(),['subject']);
  assert(await evaluate('!!canvasTest.editor.getState().activeObjectGroupId'));
  assert.equal(await evaluate('canvasTest.editor.getState().editingTextId'),null);
  await card('b');assert.deepEqual(await selection(),['b']);
  await mouse('mouseMoved',...(await screen(270,180)));
  const memberHover=await evaluate("+document.querySelector('.hover-outline rect').getAttribute('width')");
  assert(memberHover<120,'inside group hover surrounds only the member');
  assert.equal(await evaluate("document.querySelectorAll('[data-selection-action-bar]').length"),1);

  const insideBefore=await snap();
  const insidePoint=await screen(470,180);
  await drag(insidePoint,[insidePoint[0]+30,insidePoint[1]+20]);
  assert.equal((await snap()).elements.subject.x,insideBefore.elements.subject.x);
  assert((await snap()).elements.b.x>insideBefore.elements.b.x);
  await key('z',2);
  await key('Escape');assert.deepEqual(await selection(),['b','subject']);
  assert.equal(await evaluate('canvasTest.editor.getState().activeObjectGroupId'),null);
  for(const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x:entry[0],y:entry[1],button:'left',clickCount:2});
  await wait(60);
  assert(await evaluate('!!canvasTest.editor.getState().activeObjectGroupId'));
  await clickPoint(await screen(100,450));
  assert.deepEqual(await selection(),[]);
  assert.equal(await evaluate('canvasTest.editor.getState().activeObjectGroupId'),null,'whitespace exits group');
  assert.equal(await evaluate("document.querySelectorAll('[data-group-members]').length"),0,'whitespace collapses group list');
  await clickPoint(await screen(270,180));assert.deepEqual(await selection(),['b','subject']);
  const p=await screen(270,180);await drag(p,[p[0]+45,p[1]+30]);
  let moved=await snap();assert(Math.abs((moved.elements.subject.x-before.elements.subject.x)-(moved.elements.b.x-before.elements.b.x))<.01);assert(moved.elements.subject.x>before.elements.subject.x);
  assert.equal(moved.elements.c.x,before.elements.c.x);
  const sizeBefore=moved;
  const handle=await center('[data-resize-handle="bottom-right"] [data-resize-visual]');await drag(handle,[handle[0]+60,handle[1]+30]);
  const resized=await snap();assert(resized.elements.subject.width>sizeBefore.elements.subject.width);assert(resized.elements.b.width>sizeBefore.elements.b.width);
  const rot=await center('[data-rotation-visual]');await drag(rot,[rot[0]+45,rot[1]+25]);
  const rotated=await snap();assert(Math.abs(rotated.elements.subject.rotation)>1);assert(Math.abs(rotated.elements.subject.rotation-rotated.elements.b.rotation)<.01);
  await key('Backspace');assert(!(await snap()).elements.subject.visible);assert(!(await snap()).elements.b.visible);await key('z',2);assert((await snap()).elements.subject.visible);assert((await snap()).elements.b.visible);
  await card('b');await card('c',4);await key('g',4);assert.equal((await snap()).elements.b.objectGroupIds.length,2);
  await key('G',12);assert.equal((await snap()).elements.b.objectGroupIds.length,1);assert(!(await snap()).elements.c.objectGroupIds);
  await clickPoint(await center('button[aria-label="Ungroup objects"]'));assert(!(await snap()).elements.b.objectGroupIds);
  assert(await evaluate('!canvasTest.store.getState().presentation.slides.other.elements.subject.objectGroupIds'),'other keyframe unchanged');
  const pasteResult = await evaluate(`(async()=>{
    let reads=0;
    Object.defineProperty(navigator.clipboard,'read',{configurable:true,value:()=>{reads++;throw Error('Unexpected clipboard read')}});
    const state=canvasTest.editor.getState();
    state.setClipboard([canvasTest.snapshot().slide.elements.subject]);
    const before=canvasTest.snapshot().slide.elementOrder.length;
    const data=new DataTransfer();data.setData('text/plain','slides-internal-copy');
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    document.body.dispatchEvent(event);
    const ordinary=new DataTransfer();ordinary.setData('text/plain','unrelated external text');
    const textEvent=new ClipboardEvent('paste',{clipboardData:ordinary,bubbles:true,cancelable:true});
    document.body.dispatchEvent(textEvent);
    await new Promise(resolve=>setTimeout(resolve,30));
    return {reads,added:canvasTest.snapshot().slide.elementOrder.length-before,handled:event.defaultPrevented,textHandled:textEvent.defaultPrevented};
  })()`);
  assert.deepEqual(pasteResult,{reads:0,added:1,handled:true,textHandled:false});
  await setup({mode:'production',objectList:true,creationProperties:true,collab,subject:{x:250,y:150,width:100,height:80,fill:'#cc5533'},targets:[{id:'b',x:450,y:150,width:100,height:80,fill:'#44aa77'},{id:'c',x:650,y:150,width:100,height:80}],secondSlide:true});
  await card('subject');await card('b',4);
  assert(await evaluate("!!document.querySelector('[data-multi-properties]')"));
  assert(await evaluate("document.querySelector('[data-property=fill]').textContent.includes('Mixed')"),'different fills display Mixed');
  const batchBefore=await snap();
  async function enterField(label,value){
    const [property,index] = {X:['position',0],Opacity:['opacity',0],Rotation:['rotation',0],Width:['size',0]}[label];
    const selector=`[data-multi-properties] [data-property="${property}"] .cursor-ew-resize`;
    await evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].scrollIntoView({block:'center'})`);
    const point=await evaluate(`(()=>{const r=document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
    await clickPoint(point);await wait(50);await send('Input.insertText',{text:String(value)});await key('Enter');await wait(100);
  }
  await enterField('X',300);
  assert.equal((await snap()).elements.subject.x,300);assert.equal((await snap()).elements.b.x,500);
  await key('z',2);assert.deepEqual(await snap(),batchBefore);
  await enterField('Opacity',40);
  assert.equal((await snap()).elements.subject.opacity,.4);assert.equal((await snap()).elements.b.opacity,.4);
  await key('z',2);assert.deepEqual(await snap(),batchBefore);
  await enterField('Rotation',90);
  assert.equal((await snap()).elements.subject.rotation,90);assert.equal((await snap()).elements.b.rotation,90);
  await key('z',2);assert.deepEqual(await snap(),batchBefore);
  await evaluate(`document.querySelector('[data-property=rotation] .cursor-ew-resize').scrollIntoView({block:'center'})`);
  const scrubPoint=await center('[data-property=rotation] .cursor-ew-resize');
  await mouse('mousePressed',...scrubPoint);await mouse('mouseMoved',scrubPoint[0]+20,scrubPoint[1]);await mouse('mouseMoved',scrubPoint[0]+50,scrubPoint[1]);
  assert((await snap()).elements.subject.rotation>0,'shared scrub previews group rotation');
  await key('Escape');await mouse('mouseReleased',scrubPoint[0]+50,scrubPoint[1]);
  assert.deepEqual(await snap(),batchBefore,'Escape restores every group member');
  await drag(scrubPoint,[scrubPoint[0]+30,scrubPoint[1]]);
  assert((await snap()).elements.subject.rotation>0);assert.equal((await snap()).elements.subject.rotation,(await snap()).elements.b.rotation);
  await key('z',2);assert.deepEqual(await snap(),batchBefore,'one undo restores a full group scrub');
  await enterField('Width',600);
  assert.equal((await snap()).elements.subject.width,200);assert.equal((await snap()).elements.b.width,200);
  await key('z',2);assert.deepEqual(await snap(),batchBefore);
  await evaluate("document.activeElement.blur()");await key('g',2);
  assert((await snap()).elements.subject.objectGroupIds?.length===1);
  await enterField('X',300);assert.equal((await snap()).elements.b.x,500);
  const transitionBefore=await evaluate('structuredClone(canvasTest.store.getState().presentation.slides.other.elements)');
  await evaluate(`document.querySelector('[data-property=position] button[aria-label^="Outgoing transition"]').click()`);await wait(80);
  assert(await evaluate(`!!document.querySelector('[role=dialog][aria-label="Outgoing transition"] svg')`),'uses existing animated preview picker');
  assert.equal(await evaluate(`document.querySelector('[role=dialog][aria-label="Outgoing transition"] svg[data-preview-elements]').dataset.previewElements`),'2','animation preview renders the entire group');
  await evaluate(`document.querySelector('[role=radio][aria-label="Ease"]').click()`);await wait(100);
  const transitions=await evaluate('canvasTest.store.getState().presentation.slides.other.elements');
  assert.equal(transitions.subject.transitions.position,'ease');assert.equal(transitions.b.transitions.position,'ease');
  await key('Escape');await evaluate('document.activeElement.blur()');await key('z',2);
  assert.deepEqual(await evaluate('canvasTest.store.getState().presentation.slides.other.elements'),transitionBefore,'one undo restores all group transitions');

  await evaluate("document.querySelector('[data-property=position] [title=\"Reset to next keyframe\"]').click()");await wait(100);
  assert.equal((await snap()).elements.subject.x,250);assert.equal((await snap()).elements.b.x,450);
  assert((await snap()).elements.subject.objectGroupIds?.length===1,'reset preserves group membership');
  // Exercise actual DOM drag payloads and drop handlers, not store shortcuts.
  await evaluate(`(()=>{const source=document.querySelector('[data-object-id="c"]');const target=document.querySelector('[data-object-group-id]');const data=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{dataTransfer:data,bubbles:true,cancelable:true}));target.dispatchEvent(new DragEvent('dragover',{dataTransfer:data,bubbles:true,cancelable:true}));target.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));})()`);await wait(100);
  assert.deepEqual((await snap()).elements.c.objectGroupIds,(await snap()).elements.subject.objectGroupIds,'drop moves loose object into group');
  await key('z',2);assert(!(await snap()).elements.c.objectGroupIds);
  await setup({mode:'production',objectList:true,collab,subject:{x:250,y:150,width:100,height:80},targets:[{id:'b',x:450,y:150,width:100,height:80},{id:'c',x:650,y:150,width:100,height:80},{id:'d',x:850,y:150,width:100,height:80}],secondSlide:true});
  await card('subject');await card('b',4);await key('g',2);
  await card('c');await card('d',4);await key('g',2);
  const beforeMerge=await snap();
  const mergedPayload=await evaluate(`(()=>{const groups=[...document.querySelectorAll('[data-object-group-id]')];const data=new DataTransfer();groups[0].dispatchEvent(new DragEvent('dragstart',{dataTransfer:data,bubbles:true,cancelable:true}));groups[1].dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));return data.getData('application/x-object-group-id');})()`);await wait(100);
  assert(mergedPayload);
  assert.equal(await evaluate("document.querySelectorAll('[data-object-group-id]').length"),1,'group drop merges group entries');
  for(const id of ['subject','b','c','d']) {
    const current=(await snap()).elements[id];assert.deepEqual(current.objectGroupIds,(await snap()).elements.d.objectGroupIds);
    assert.equal(current.x,beforeMerge.elements[id].x);assert.equal(current.y,beforeMerge.elements[id].y);
  }
  assert.deepEqual((await snap()).elementOrder,beforeMerge.elementOrder);
  await key('z',2);assert.deepEqual(await snap(),beforeMerge,'single undo restores both groups');
  await setup({mode:'production',objectList:true,creationProperties:true,collab,subject:{x:250,y:150},targets:[{id:'b',x:450,y:150},{id:'c',x:650,y:150}],secondSlide:true});
  await evaluate(`(()=>{const store=canvasTest.store.getState();store.updateElement('other','subject',{visible:false,x:777});store.deleteElements('other',['b']);
    if(canvasTest.doc){canvasTest.doc.transact(()=>{const slide=canvasTest.doc.getMap('presentation').get('slides').get('other');slide.get('elements').delete('b');const order=slide.get('elementOrder');order.delete(order.toArray().indexOf('b'),1);});}
    else{const presentation=structuredClone(canvasTest.store.getState().presentation);delete presentation.slides.other.elements.b;presentation.slides.other.elementOrder=presentation.slides.other.elementOrder.filter(id=>id!=='b');canvasTest.store.setState({presentation});}
    store.duplicateSlide('other');canvasTest.editor.setState({selectedSlideIds:[]});})()`);await wait(100);
  await card('subject');await card('b',4);
  await evaluate(`canvasTest.editor.setState({selectedSlideIds:[canvasTest.editor.getState().activeSlideId,'other']})`);await wait(80);
  const visibilityBefore=await evaluate('structuredClone(canvasTest.store.getState().presentation.slides)');
  await evaluate(`document.querySelector('[data-property=visibility] button[title="Sync to all selected slides"]').click()`);await wait(100);
  const visibilityAfter=await evaluate('canvasTest.store.getState().presentation.slides');
  assert.equal(visibilityAfter.other.elements.subject.visible,true);assert.equal(visibilityAfter.other.elements.subject.x,777,'visibility sync preserves destination geometry');
  assert.equal(visibilityAfter.other.elements.b.visible,true,'missing selected object is added to destination');
  for(const id of Object.keys(visibilityBefore).filter(id=>id!=='other'))assert.deepEqual(visibilityAfter[id],visibilityBefore[id],'unselected slides and source remain unchanged');
  await key('z',2);assert.deepEqual(await evaluate('canvasTest.store.getState().presentation.slides'),visibilityBefore,'one undo restores multi-object visibility sync');
  console.log('PASS visibility copy to selected slides, missing objects, preserved geometry and atomic undo collab='+collab);
  console.log('PASS multi-object panel: mixed styles, shared transforms, per-object reset, atomic undo collab='+collab);
  await setup({mode:'production',creationProperties:true,collab,subject:{shapeType:'path',creationPreset:'arrow',points:[0,0,160,0],width:160,height:0,endHead:'arrow'},secondSlide:true});
  await evaluate(`canvasTest.store.getState().updateElement('other','subject',{visible:false})`);await wait(80);
  await evaluate(`document.querySelector('button[aria-label^="Outgoing transition"]').click()`);await wait(60);
  for(const [label,easing] of [['Linear','linear'],['Create','create'],['Extend','extend'],['Grow','grow']]) {
    await evaluate(`document.querySelector('[role=radio][aria-label="${label}"]').click()`);await wait(60);
    assert.equal((await snap()).elements.subject.transitions.visibility,easing,'disappearing arrow setting belongs to visible source');
    assert.notEqual(await evaluate('canvasTest.store.getState().presentation.slides.other.elements.subject.transitions?.visibility'),easing,'hidden destination does not consume visibility effect');
  }
  await key('Escape');
  console.log('PASS disappearing arrow picker writes each selected effect to playback source collab='+collab);
  console.log('PASS object group shortcuts, undo/redo, canvas selection/move/resize/rotate, nested ungroup collab='+collab);
}
const exportedOrigins = await evaluate(`(async()=>{
  const {exportStandaloneHtml}=await import('/src/utils/exportStandaloneHtml.ts');
  const originalUrl=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;
  let blob;const origins=[];
  URL.createObjectURL=function(value){blob=value;return originalUrl.call(this,value)};
  HTMLAnchorElement.prototype.click=function(){};
  try { for(const mode of ['viewer','editor']) {
    await exportStandaloneHtml(canvasTest.store.getState().presentation,{mode});
    const parsed=new DOMParser().parseFromString(await blob.text(),'text/html');
    origins.push(JSON.parse(parsed.querySelector('#slides-config').textContent).editorOrigin);
  }} finally { URL.createObjectURL=originalUrl;HTMLAnchorElement.prototype.click=originalClick; }
  return origins;
})()`);
// The isolated browser deliberately overrides the build origin to avoid external navigation.
assert.deepEqual(exportedOrigins,['http://invalid.test','http://invalid.test']);
console.log('PASS actual viewer/editor exports preserve the configured editor origin');
assert.deepEqual(runtimeErrors,[]);
}finally{ws.close();}
