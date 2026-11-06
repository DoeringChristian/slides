// Isolated real-backend regression: no user projects, profiles or ports.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { isolatedBackend } from './isolated-backend.mjs';
import { createPresentation } from '../src/utils/model/slideFactory.ts';
import { ROOT_KEY } from '../src/collab/ySchema.ts';
const evidence=await mkdtemp(join(tmpdir(),'slides-reconnect-evidence-'));
console.log('Evidence:',evidence);
const backend=await isolatedBackend(evidence);
const clients=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(id) {
  const doc=new Y.Doc();
  const provider=new WebsocketProvider(backend.origin.replace('http:','ws:')+'/yjs',id,doc,{WebSocketPolyfill:WebSocket,disableBc:true,params:{userId:'reconnect-test'}});
  const client={doc,provider};clients.push(client);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('sync timeout')),5000);provider.on('sync',ok=>{if(ok){clearTimeout(timer);resolve();}});});
  return client;
}
function title(client,value) {const text=client.doc.getMap(ROOT_KEY).get('title');client.doc.transact(()=>{text.delete(0,text.length);text.insert(0,value);});}
function close(client){client.provider.destroy();client.doc.destroy();}
try {
  const p=createPresentation();p.title='original';
  const response=await fetch(backend.origin+'/api/projects',{method:'POST',headers:{'content-type':'application/json','x-slides-user':'reconnect-test'},body:JSON.stringify({presentation:p})});assert.equal(response.status,201);
  const a=await connect(p.id);title(a,'first edit');await wait(250);close(a);await wait(250);
  const b=await connect(p.id);
  assert.equal(b.doc.getMap(ROOT_KEY).get('title').toString(),'first edit','fresh client must load latest persisted updates after last client disconnects');
  title(b,'second edit');await wait(5500);
  const saved=await (await fetch(backend.origin+'/api/projects/'+p.id,{headers:{'x-slides-user':'reconnect-test'}})).json();
  assert.equal(saved.presentation.title,'second edit','JSON snapshots must keep working after a room reopens');
  close(b);await wait(250);
  const c=await connect(p.id);assert.equal(c.doc.getMap(ROOT_KEY).get('title').toString(),'second edit');
  console.log('PASS reconnect retains edits and snapshot subscription is renewed');
} finally {for(const client of clients)close(client);await backend.close();}
