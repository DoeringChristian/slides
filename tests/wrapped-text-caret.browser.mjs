import './browser-gate-required.mjs';
import { waitForCanvasFixture } from './browserFixtureReady.mjs';
// Real Chrome/CDP integration checks, no additional dependency. Run Vite first:
// VITEST=1 npm run dev -- --host 127.0.0.1 --port 5178
// Launch Chrome with --headless=new --remote-debugging-port=9223 and a temporary
// --user-data-dir, then: node tests/wrapped-text-caret.browser.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.VITE_TEST_URL;
const cdp = process.env.CDP_URL;
const pages = await (await fetch(`${cdp}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && p.url.includes('canvas-fixture'));
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
    if (/order of Hooks|Rendered (more|fewer) hooks|getSnapshot/.test(text)) runtimeErrors.push(text);
  }
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
let pressed = false;
async function mouse(type, x, y, clickCount = 1, modifiers = 0) {
  if(type === 'mousePressed') pressed = true;
  if(type === 'mouseReleased') pressed = false;
  await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount, modifiers });
  await wait(30);
}
async function click(x, y, count = 1) { await mouse('mousePressed', x, y, count); await mouse('mouseReleased', x, y, count); }

async function key(key, code = key, modifiers = 0) {
  const keyCodes = { Enter: 13, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, a: 65 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, commands: modifiers === 4 && key === 'a' ? ['selectAll'] : undefined, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: keyCodes[key], modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCodes[key], modifiers });

}
const snapshot = () => evaluate('canvasTest.snapshot()');

async function check(name, run) { await run(); console.log(`PASS ${name}`); }


const evidence=process.env.CARET_EVIDENCE??`${process.env.BROWSER_GATE_EVIDENCE}/artifacts/slides-caret-mixed-final/native`;
const style={fontFamily:'Arial',fontSize:24,fontWeight:'normal',fontStyle:'normal',textDecoration:'none',color:'#333333',align:'center',verticalAlign:'middle',lineHeight:1.2};
async function type(text){for(const char of text){await send('Input.dispatchKeyEvent',{type:'keyDown',key:char,text:char});await send('Input.dispatchKeyEvent',{type:'keyUp',key:char});}}
const source=()=>evaluate(`Array.from(document.querySelectorAll('[contenteditable] [data-line]'),n=>n.textContent).join('\\n')`);
async function measure(){return evaluate(`(async()=>{
 const e=document.querySelector('[contenteditable]'),s=getSelection();
 const {textEditorSourceOffset}=await import('/src/utils/textEditorSelection.ts');
 const {loadFont}=await import('/src/utils/glyphPaths.ts');const font=await loadFont('normal','normal');
 const clone=e.cloneNode(true);clone.removeAttribute('contenteditable');Object.assign(clone.style,{left:'0',top:'0',visibility:'hidden'});document.body.append(clone);
 const cb=clone.getBoundingClientRect();const chars=[];let offset=0;
 for(let j=0;j<clone.children.length;j++){
  const line=clone.children[j],actual=e.children[j],node=line.firstChild;if(node?.nodeType!==3){offset++;continue;}
  const probe=line.cloneNode(false);probe.style.height='auto';probe.style.width='1000px';probe.style.whiteSpace='pre';probe.textContent='x';clone.append(probe);
  const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0';probe.append(marker);
  const pr=document.createRange();pr.setStart(probe.firstChild,0);pr.setEnd(probe.firstChild,1);
  const ascent=marker.getBoundingClientRect().top-pr.getBoundingClientRect().top;probe.remove();
  for(let i=0;i<node.length;i++){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);const b=r.getBoundingClientRect();const ar=document.createRange();ar.setStart(actual.firstChild,i);ar.setEnd(actual.firstChild,i+1);const ab=ar.getBoundingClientRect();chars.push({char:node.textContent[i],offset:offset+i,advance:(font.glyphs.get(font.charToGlyphIndex(node.textContent[i])).advanceWidth/font.unitsPerEm)*parseFloat(getComputedStyle(actual).fontSize),x:b.x-cb.x,y:b.y-cb.y,baseline:b.y-cb.y+ascent,w:b.width,h:b.height,screen:{x:ab.x,y:ab.y,w:ab.width,h:ab.height}});}
  offset+=node.length+1;
 }
 clone.remove();
 const svg=e.parentElement.querySelector('svg');const root=svg.getScreenCTM();const inv=root.inverse();const zoom=root.a===0?Math.abs(root.b):Math.hypot(root.a,root.b);
 const glyphsAll=[...svg.querySelectorAll('path')].map(p=>{const m=p.getScreenCTM();const pt=new DOMPoint(m.e,m.f).matrixTransform(inv);return {visible:!!p.getAttribute('d'),x:pt.x*zoom-parseFloat(e.style.left),baseline:pt.y*zoom-parseFloat(e.style.top),screen:{x:m.e,y:m.f}};});
 const r=s.getRangeAt(0).getBoundingClientRect();return {text:[...e.children].map(n=>n.textContent).join('\\n'),offset:textEditorSourceOffset(e,s.focusNode,s.focusOffset),chars,glyphsAll,glyphs:glyphsAll.filter(g=>g.visible),caret:{x:r.x,y:r.y,w:r.width,h:r.height},caretRectCount:s.getRangeAt(0).getClientRects().length,caretLocalX:new DOMPoint(r.x+r.width/2,r.y+r.height/2).matrixTransform(inv).x*zoom-parseFloat(e.style.left),width:e.style.width,height:e.parentElement.style.height,lineHeight:getComputedStyle(e.firstChild).lineHeight,transform:e.parentElement.style.transform};})()`);}
async function aligned(name,includeSpaces=false){await wait(100);const m=await measure();await writeFile(`${evidence}/${name}.json`,JSON.stringify(m,null,2));
 const chars=m.chars.filter(c=>!/^\s$/u.test(c.char));assert.equal(m.glyphs.length,chars.length,name+' visible glyph count');
 for(let i=0;i<chars.length;i++){assert(Math.abs(chars[i].x-m.glyphs[i].x)<0.15,`${name} char${i} X ${chars[i].x}/${m.glyphs[i].x}`);assert(Math.abs(chars[i].baseline-m.glyphs[i].baseline)<0.15,`${name} char${i} baseline ${chars[i].baseline}/${m.glyphs[i].baseline}`);}
 if(includeSpaces){assert.equal(m.glyphsAll.length,m.chars.length,name+' all source characters');for(let i=0;i<m.chars.length;i++){assert(Math.abs(m.chars[i].x-m.glyphsAll[i].x)<0.15,name+' whitespace/source X at '+i);assert(Math.abs(m.chars[i].baseline-m.glyphsAll[i].baseline)<0.15,name+' whitespace/source row at '+i);}}
 const rows=values=>[...new Set(values.map(v=>Math.round(v.baseline*10)/10))];assert.equal(rows(chars).length,rows(m.glyphs).length,name+' row count');
 const last=m.chars.find(c=>c.offset===m.offset-1);if(last){const glyph=m.glyphs[chars.findIndex(c=>c.offset===last.offset)];if(glyph&&m.caretRectCount===1)assert(Math.abs(m.caretLocalX-(glyph.x+last.advance))<0.15,`${name} caret end X ${m.caretLocalX}/${glyph.x+last.advance}`);assert(m.caret.y>=last.screen.y-1&&m.caret.y<=last.screen.y+last.screen.h+1,name+' active caret row');}
 return m;
}
// Expected destination is chosen BEFORE the key event from the known rows
// and rendered glyph advance boundaries; never from the returned selection.
function arrowTarget(m, direction) {
 const visible=m.chars.filter(c=>!/\s/u.test(c.char));
 const rows=[...new Set(visible.map(c=>c.baseline))].sort((a,b)=>a-b);
 const current=visible.find(c=>c.offset===m.offset-1);
 assert(current,'predictable fixture starts after a visible character');
 const rowIndex=rows.indexOf(current.baseline)+direction;
 assert(rowIndex>=0&&rowIndex<rows.length,'fixture has adjacent visual row');
 const row=visible.filter(c=>c.baseline===rows[rowIndex]);
 const boundaries=row.flatMap(c=>[{offset:c.offset,x:c.x},{offset:c.offset+1,x:c.x+c.advance}]);
 const target=boundaries.reduce((best,b)=>Math.abs(b.x-m.caretLocalX)<Math.abs(best.x-m.caretLocalX)?b:best);
 return {...target,baseline:rows[rowIndex],preferredX:m.caretLocalX};
}
async function verticalArrow(name,keyName,direction) {
 const before=await measure(),target=arrowTarget(before,direction);
 await key(keyName);const after=await measure();
 assert.equal(after.offset,target.offset,name+' exact destination source offset');
 assert(Math.abs(after.caretLocalX-target.x)<0.15,name+' preferred-X nearest rendered boundary');
 const preceding=after.chars.find(c=>c.offset===after.offset-1);
 assert(Math.abs(preceding.baseline-target.baseline)<0.15,name+' exact destination visual row');
 await writeFile(`${evidence}/${name}-oracle.json`,JSON.stringify({beforeOffset:before.offset,target,actualOffset:after.offset,actualX:after.caretLocalX},null,2));
 return target.offset;
}
async function picture(name){await writeFile(`${evidence}/${name}.png`,Buffer.from((await send('Page.captureScreenshot')).data,'base64'));}
try{
 await mkdir(evidence,{recursive:true});await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');await send('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base+'/tests/canvas-fixture.html'});await waitForCanvasFixture(evaluate);await wait(1000);
 for(const collab of [false,true])for(const kind of ['rect','ellipse','free','auto'])for(const rotated of [false,true]){
 const name=`${collab?'yjs':'json'}-${kind}-${rotated?'rotate-zoom':'normal'}`;const zoom=rotated?1.25:1,rotation=rotated?30:0;const bound=!['free','auto'].includes(kind);let id=bound?'label':'subject';
 await check(name,async()=>{
 if(bound){await setup({mode:'production',collab,zoom,subject:{shapeType:kind==='ellipse'?'ellipse':'rect',x:200,y:180,width:kind==='ellipse'?156:110,height:40,rotation}});await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;const label={...createBoundLabel(s.elements.subject),id:'label',text:'',style:${JSON.stringify(style)}};canvasTest.store.getState().addElement(s.id,label);})()`);await wait(150);}
 else await setup({mode:'production',collab,zoom,subject:{type:'text',x:205,y:185,width:100,height:30.72,rotation,text:'',textSizing:kind==='auto'?'auto-content':'user-width',style}});
 await evaluate(`canvasTest.editor.getState().setEditingTextId('${id}')`);await wait(250);await evaluate('document.fonts.ready');const before=await snapshot();
 let expected='';for(const chunk of ['one',' two',' three',' four',' five']){await type(chunk);expected+=chunk;assert.equal(await source(),expected);const m=await aligned(name+'-'+chunk.trim());assert.equal(m.offset,expected.length);}
 await picture(name+'-words');assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);
 // Native vertical arrows choose actual wrapped visual rows, then native insertion.
 if(kind!=='auto'){
  // Four equal-width W glyphs per soft row; use an interior boundary so
  // upstream/downstream affinity at a wrap space cannot hide a wrong row.
  await key('a','KeyA',4);await type('WWWWWWWWWWWW');expected='WWWWWWWWWWWW';await aligned(name+'-arrow-fixture');await key('ArrowLeft');await key('ArrowLeft');
  const up=await verticalArrow(name+'-up','ArrowUp',-1);assert.equal(up,6);await type('X');expected=expected.slice(0,up)+'X'+expected.slice(up);assert.equal(await source(),expected);await aligned(name+'-up-insert');
  await key('Backspace');expected='WWWWWWWWWWWW';assert.equal(await source(),expected);await aligned(name+'-restore-arrow-fixture');
  const down=await verticalArrow(name+'-down','ArrowDown',1);assert.equal(down,10);await type('Y');expected=expected.slice(0,down)+'Y'+expected.slice(down);assert.equal(await source(),expected);await aligned(name+'-down-insert');
 }
 // Click a visible glyph after growth (not the invisible DOM approximation).
 let m=await aligned(name+'-pre-click');const index=kind==='auto'?2:8;const glyph=m.glyphs[index];const visible=m.chars.filter(c=>!/^\s$/u.test(c.char))[index];
 await click(glyph.screen.x+1,glyph.screen.y-5*zoom);const at=await measure();assert.equal(at.offset,visible.offset,name+' click source offset');await type('Z');expected=expected.slice(0,at.offset)+'Z'+expected.slice(at.offset);assert.equal(await source(),expected);await aligned(name+'-click-insert');
 await key('a','KeyA',4);await type('WWWWWWWWWWWW');assert.equal(await source(),'WWWWWWWWWWWW');await aligned(name+'-long');await picture(name+'-long');
 await key('Enter');await type('tail');assert.equal(await source(),'WWWWWWWWWWWW\ntail');await aligned(name+'-tail');
 for(let i=0;i<5;i++)await key('Backspace');assert.equal(await source(),'WWWWWWWWWWWW');await aligned(name+'-backspace-enter');
 for(let i=0;i<5;i++)await key('Backspace');assert.equal(await source(),'WWWWWWW');await aligned(name+'-backspace-wrap');
 await key('a','KeyA',4);await type('  one two  three');assert.equal(await source(),'  one two  three');await aligned(name+'-whitespace');
 await key('Escape');await wait(250);const done=await snapshot();assert.equal(done.slide.elements[id].text,'  one two  three');assert.equal(done.undo,before.undo+1);
 // The entry hit-test mirror must resolve every committed visible glyph to
 // its UTF-16 source offset, not just have the right aggregate height.
 const hits=await evaluate(`(async()=>{const e=canvasTest.snapshot().slide.elements['${id}'];const {layoutUserText}=await import('/src/utils/userTextSizing.ts');const {calculateCursorFromClick}=await import('/src/utils/textHitTest.ts');const {textInsets}=await import('/src/utils/boundTextLayout.ts');const {textVerticalOffset}=await import('/src/utils/textLayout.ts');const d=await layoutUserText(e);const pad=textInsets(e),dy=textVerticalOffset(e.style.verticalAlign,e.height,pad,d.height);const hits=[];for(const p of d.paths.filter(p=>p.d)){const [x,y]=p.transform.match(/[-\\d.]+/g).map(Number);hits.push(await calculateCursorFromClick(e,{x:pad+x+1,y:pad+dy+y-5}));}return hits;})()`);
 assert.deepEqual(hits,[2,3,4,6,7,8,11,12,13,14,15],name+' entry hit mirror');
 await evaluate(`canvasTest.editor.getState().setEditingTextId('${id}')`);await wait(250);await key('Escape');await wait(150);assert.equal((await snapshot()).undo,done.undo,name+' no-op cancellation');

 await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo();})()`);await wait(100);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
 });}

 for(const collab of [false,true])for(const kind of ['rect','free','auto'])for(const align of ['left','center','right'])await check(`trailing-${collab}-${kind}-${align}`,async()=>{
  const name=`trailing-${collab}-${kind}-${align}`,font={...style,align},id=kind==='rect'?'label':'subject';
  if(kind==='rect'){
   await setup({mode:'production',collab,subject:{x:200,y:180,width:110,height:40}});
   await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;canvasTest.store.getState().addElement(s.id,{...createBoundLabel(s.elements.subject),id:'label',text:'',style:${JSON.stringify(font)}});})()`);await wait(150);
  }else await setup({mode:'production',collab,subject:{type:'text',x:205,y:185,width:100,height:30.72,text:'',textSizing:kind==='auto'?'auto-content':'user-width',style:font}});
  await evaluate(`canvasTest.editor.getState().setEditingTextId('${id}')`);await wait(250);
  await type('one');await aligned(name+'-control');await type(' ');await aligned(name+'-one-space');await type(' ');await aligned(name+'-two-spaces');
  await key('Enter');await type('tail  ');assert.equal(await source(),'one  \ntail  ');await aligned(name+'-explicit-newline');
  await key('a','KeyA',4);await type('one two three  ');await aligned(name+'-softwrap');await picture(name);
  await key('Escape');await wait(200);assert.equal((await snapshot()).slide.elements[id].text,'one two three  ');
 });
 // Unicode boundaries use real native characters, including whitespace pen
 // positions. NBSP controls must retain emergency token splits.
 for(const collab of [false,true])for(const kind of ['rect','free'])for(const rotated of [false,true]){
  const zoom=rotated?1.25:1,rotation=rotated?30:0,id=kind==='rect'?'label':'subject';
  const font={...style,align:'center'};
  if(kind==='rect'){
   await setup({mode:'production',collab,zoom,subject:{x:200,y:180,width:110,height:40,rotation}});
   await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;canvasTest.store.getState().addElement(s.id,{...createBoundLabel(s.elements.subject),id:'label',text:'',style:${JSON.stringify(font)}});})()`);await wait(150);
  }else await setup({mode:'production',collab,zoom,subject:{type:'text',x:205,y:185,width:100,height:30.72,rotation,text:'',textSizing:'user-width',style:font}});
  await evaluate(`canvasTest.editor.getState().setEditingTextId('${id}')`);await wait(250);const before=await snapshot();
  for(const [cp,firstRow] of [[0x2002,2],[0x2003,2],[0x2009,2],[0xa0,3],[0x202f,4],[0x2007,3]])await check(`unicode-${collab}-${kind}-${rotated}-${cp.toString(16)}`,async()=>{
   const name=`unicode-${collab}-${kind}-${rotated}-${cp.toString(16)}`,text='WW'+String.fromCodePoint(cp)+'WWW';
   await key('a','KeyA',4);await type(text);assert.equal(await source(),text);const m=await aligned(name,true);assert.equal(m.offset,6);
   assert.equal(m.glyphs.filter(g=>Math.abs(g.baseline-m.glyphs[0].baseline)<0.1).length,firstRow,name+' exact character distribution,not just row count');
   const index=firstRow+1<m.glyphs.length?firstRow+1:firstRow;
   const target=m.chars.filter(c=>c.char==='W')[index],g=m.glyphs[index];
   await click(g.screen.x+Math.sin(rotation*Math.PI/180)*5*zoom+Math.cos(rotation*Math.PI/180),g.screen.y-Math.cos(rotation*Math.PI/180)*5*zoom+Math.sin(rotation*Math.PI/180));
   assert.equal((await measure()).offset,target.offset,name+' native glyph-click source offset');await type('X');assert.equal(await source(),text.slice(0,target.offset)+'X'+text.slice(target.offset));await aligned(name+'-insert',true);
   await key('a','KeyA',4);await type(text);await aligned(name+'-restored',true);
   assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);await picture(name);
  });
  // Native edit ENTRY: finish first, then click the steady SVG glyph. This
  // is not a direct invocation of the entry-hit mirror helper.
  await key('a','KeyA',4);await type('WW\u2003WWW');await key('Escape');await wait(250);
  const hits=await evaluate(`(async()=>{const e=canvasTest.snapshot().slide.elements['${id}'];const {layoutUserText}=await import('/src/utils/userTextSizing.ts');const {calculateCursorFromClick}=await import('/src/utils/textHitTest.ts');const d=await layoutUserText(e);const hits=[];for(const p of d.paths.filter(p=>p.d)){const [x,y]=p.transform.match(/[-\\d.]+/g).map(Number);hits.push(await calculateCursorFromClick(e,{x:x+1,y:y-5}));}return hits;})()`);
  assert.deepEqual(hits,[0,1,3,4,5],'committed Unicode entry mirror source offsets');
  // Bound-label taps intentionally forward to container selection. Preserve
  // that policy; native single-click entry is exercised by free user-width.
  if(kind==='rect')continue;
  const point=await evaluate(`(()=>{const p=[...document.querySelector('[data-element-id="${id}"]').querySelectorAll('path')].filter(p=>p.getAttribute('d'))[3];const m=p.getScreenCTM();return new DOMPoint(1,-5).matrixTransform(m).toJSON();})()`);
  await click(point.x,point.y);await wait(250);
  assert.equal((await snapshot()).editor.editing,id,'native pointer entered editor');
  const entry=await aligned(`entry-${collab}-${kind}-${rotated}`,true);assert.equal(entry.offset,4,'native entry clicked second W of wrapped row');
  await type('Z');assert.equal(await source(),'WW\u2003WZWW');await aligned(`entry-${collab}-${kind}-${rotated}-insert`,true);await key('Escape');await wait(150);
 }
 // Interacting whitespace classes: the terminal ASCII run hangs only at a
 // soft wrap. A preceding/following typographic run keeps its own width.
 const mixedCases=[
  ['suffix','WW\u2003 WWW','WW\u2003 '],
  ['reverse','WW \u2003WWW','WW \u2003'],
  ['alternating','WW\u2003 \u2009 WWW','WW\u2003 \u2009 '],
  ['final','WW\u2003 ','WW\u2003 '],
  ['final-alternating','WW\u2003 \u2009 ','WW\u2003 \u2009 '],
  ['newline','WW\u2003 \ntail','WW\u2003 '],
  ['nbsp-after','WW\u2003 \u00a0WWW','WW\u2003 '],
  ['nbsp-before','WW\u00a0 \u2003WWW','WW\u00a0 \u2003'],
 ];
 for(const collab of [false,true])for(const kind of ['rect','free'])for(const rotated of [false,true])for(const align of ['left','center','right']){
  const zoom=rotated?1.25:1,rotation=rotated?30:0,id=kind==='rect'?'label':'subject',font={...style,align};
  if(kind==='rect'){
   await setup({mode:'production',collab,zoom,subject:{x:200,y:180,width:110,height:40,rotation}});
   await evaluate(`(async()=>{const {createBoundLabel}=await import('/src/utils/syncDependents.ts');const s=canvasTest.snapshot().slide;canvasTest.store.getState().addElement(s.id,{...createBoundLabel(s.elements.subject),id:'label',text:'',style:${JSON.stringify(font)}});})()`);await wait(150);
  }else await setup({mode:'production',collab,zoom,subject:{type:'text',x:205,y:185,width:100,height:30.72,rotation,text:'',textSizing:'user-width',style:font}});
  await evaluate(`canvasTest.editor.getState().setEditingTextId('${id}')`);await wait(250);const before=await snapshot();
  for(const [caseName,text,firstRow] of mixedCases)await check(`mixed-${collab}-${kind}-${rotated}-${align}-${caseName}`,async()=>{
   const name=`mixed-${collab}-${kind}-${rotated}-${align}-${caseName}`;
   await key('a','KeyA',4);
   for(const [i,line] of text.split('\n').entries()){if(i)await key('Enter');await type(line);}
   assert.equal(await source(),text);const m=await aligned(name,true);assert.equal(m.offset,text.length);
   const first=m.chars[0].baseline;
   assert.deepEqual(m.chars.filter(c=>Math.abs(c.baseline-first)<0.1).map(c=>c.offset),Array.from({length:firstRow.length},(_,i)=>i),name+' exact first-row source boundaries');
   const glyph=m.glyphs[1],angle=rotation*Math.PI/180;
   await click(glyph.screen.x+Math.cos(angle)*zoom+Math.sin(angle)*5*zoom,glyph.screen.y+Math.sin(angle)*zoom-Math.cos(angle)*5*zoom);
   assert.equal((await measure()).offset,1,name+' click at second rendered W');
   await type('i');assert.equal(await source(),text.slice(0,1)+'i'+text.slice(1));await aligned(name+'-insert',true);
   assert.deepEqual((await snapshot()).slide,before.slide);assert.equal((await snapshot()).undo,before.undo);
   if(caseName==='suffix'||caseName==='alternating')await picture(name);
  });
  await key('Escape');await wait(200);const done=await snapshot();assert.equal(done.slide.elements[id].text,'WiW\u00a0 \u2003WWW');assert.equal(done.undo,before.undo+1);
  await evaluate(`(()=>{const u=canvasTest.getActiveUndoManager();if(u)u.undo();else canvasTest.store.temporal.getState().undo();})()`);await wait(100);assert.deepEqual((await snapshot()).slide.elements,before.slide.elements);
 }
 assert.deepEqual(runtimeErrors,[]);
}finally{await writeFile(`${evidence}/runtime-errors.json`,JSON.stringify(runtimeErrors,null,2));ws.close();}
