import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {handleAssetApi} from '../cloudflare/private-asset-api.js';
const bank=await readFile(new URL('../cloudflare/schema-question-bank-v1.sql',import.meta.url),'utf8');
const assets=await readFile(new URL('../cloudflare/schema-private-assets-v1.sql',import.meta.url),'utf8');
const security=await readFile(new URL('../cloudflare/schema-security.sql',import.meta.url),'utf8');
const actorA='a'.repeat(32),actorB='b'.repeat(32),pid='12345678-1234-1234-1234-123456789012';
const pdf=new TextEncoder().encode('%PDF-1.7\n'+('exam booklet '.repeat(8)));
function fixture(){
 const local=new DatabaseSync(':memory:');local.exec('PRAGMA foreign_keys=ON;'+security+bank+assets);
 local.prepare('INSERT INTO bank_projects (id,actor,name) VALUES(?,?,?)').run(pid,actorA,'fixture');
 const stored=new Map(),env={SECURITY_DB:{
  prepare(sql){return{bind(...args){const q=local.prepare(sql);return{
   async first(){return q.get(...args)||null},async all(){return{results:q.all(...args)}},async run(){return q.run(...args)}
  }}}}
 },QUESTION_ASSETS:{
  async head(key){return stored.has(key)?{key}:null},
  async put(key,data){stored.set(key,new Uint8Array(data))},
  async get(key){if(!stored.has(key))return null;const value=stored.get(key);return{body:new ReadableStream({start(c){c.enqueue(value);c.close()}})}}
 }};
 const call=(actor,path='',method='GET',bytes=null,headers={})=>{
  const u=new URL('https://preview.example/api/v1/projects/'+pid+'/assets'+path);
  const req=new Request(u,{method,headers,body:bytes});
  return handleAssetApi(req,env,actor,u);
 };
 return {local,stored,env,call};
}
test('private upload deduplicates bytes and registered project attachment, never returns public URL',async()=>{
 const f=fixture(),headers={'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'};
 const a=await f.call(actorA,'','POST',pdf,headers);assert.equal(a.status,201);
 const result=await a.json();assert.equal(result.size,pdf.byteLength);
 assert.equal(Object.hasOwn(result,'url'),false);
 const b=await f.call(actorA,'','POST',pdf,headers);assert.equal((await b.json()).existing,true);
 assert.equal(f.stored.size,1);
 const listing=await(await f.call(actorA)).json();assert.equal(listing.assets.length,1);
 const download=await f.call(actorA,'/'+result.digest+'?role=question_pdf');
 assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(new Uint8Array(await download.arrayBuffer()),pdf);
 f.local.close();
});
test('actor isolation prevents listing, reads or uploads to foreign projects',async()=>{
 const f=fixture();
 assert.equal((await f.call(actorB)).status,404);
 assert.equal((await f.call(actorB,'','POST',pdf,{'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'})).status,404);
 assert.equal((await f.call(actorB,'/'+'0'.repeat(64)+'?role=figure')).status,404);
 f.local.close();
});
test('wrong magic bytes, invalid role, and unsafe media are rejected before storage',async()=>{
 const f=fixture();
 assert.equal((await f.call(actorA,'','POST',pdf,{'Content-Type':'image/png','X-Asset-Role':'figure'})).status,415);
 assert.equal(f.stored.size,0);
 assert.equal((await f.call(actorA,'','POST',pdf,{'Content-Type':'application/pdf','X-Asset-Role':'figure'})).status,400);
 assert.equal((await f.call(actorA,'','POST',pdf,{'Content-Type':'text/html','X-Asset-Role':'export'})).status,400);
 f.local.close();
});
test('missing R2 binding fails closed without exposing metadata',async()=>{
 const f=fixture();delete f.env.QUESTION_ASSETS;
 const response=await f.call(actorA);
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'ASSET_STORAGE_NOT_CONFIGURED');
 f.local.close();
});


test('quota blocks a 25th private project asset before R2 write',async()=>{
 const f=fixture();
 const insert=f.local.prepare('INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)');
 for(let i=1;i<=24;i++){
  const d=i.toString(16).padStart(64,'0');
  insert.run(pid,actorA,d,'application/pdf','question_pdf','private-assets/'+actorA+'/'+d+'.pdf',60);
 }
 const response=await f.call(actorA,'','POST',pdf,{'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'});
 assert.equal(response.status,429);
 assert.equal((await response.json()).error,'ASSET_QUOTA_EXCEEDED');
 assert.equal(f.stored.size,0);
 f.local.close();
});
test('unreferenced private asset can be tombstoned without accidentally deleting deduplicated R2 data',async()=>{
 const f=fixture(),headers={'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'};
 const created=await(await f.call(actorA,'','POST',pdf,headers)).json();
 const path='/'+created.digest+'?role=question_pdf';
 assert.equal((await f.call(actorB,path,'DELETE')).status,404);
 const removed=await f.call(actorA,path,'DELETE');assert.equal(removed.status,200);
 const result=await removed.json();
 assert.equal(result.deleted,true);assert.equal(result.physicalCleanupPending,true);
 assert.equal((await(await f.call(actorA)).json()).assets.length,0);
 assert.equal((await f.call(actorA,path)).status,404);
 assert.equal(f.stored.size,1,'R2 is not physically deleted during a metadata tombstone');
 const repeated=await(await f.call(actorA,'','POST',pdf,headers)).json();
 assert.equal(repeated.existing,true);
 assert.equal((await(await f.call(actorA)).json()).assets.length,1);
 f.local.close();
});
test('a question PDF referenced by any saved revision cannot be deleted',async()=>{
 const f=fixture(),headers={'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'};
 const result=await(await f.call(actorA,'','POST',pdf,headers)).json();
 const question='77777777-2222-3333-4444-555555555555';
 f.local.prepare('INSERT INTO bank_questions(id,project_id,actor,content_json) VALUES(?,?,?,?)')
  .run(question,pid,actorA,JSON.stringify({questionText:'متن',sourceDigest:result.digest}));
 const path='/'+result.digest+'?role=question_pdf';
 assert.equal((await f.call(actorA,path,'DELETE')).status,409);
 // Rewriting or deleting the current question does not erase historical source proof.
 f.local.prepare('UPDATE bank_questions SET revision=revision+1,content_json=?,deleted_at=CURRENT_TIMESTAMP WHERE id=?')
  .run(JSON.stringify({questionText:'نسخه جدید',sourceDigest:''}),question);
 const response=await f.call(actorA,path,'DELETE');
 assert.equal(response.status,409);
 assert.equal((await response.json()).error,'SOURCE_PDF_REFERENCED_BY_QUESTION');
 f.local.close();
});

test('private file operations produce pseudonymous audit records without source content',async()=>{
 const f=fixture(),headers={'Content-Type':'application/pdf','X-Asset-Role':'answer_pdf'};
 const uploaded=await(await f.call(actorA,'','POST',pdf,headers)).json();
 assert.equal((await f.call(actorA,'/'+uploaded.digest+'?role=answer_pdf')).status,200);
 assert.equal((await f.call(actorA,'/'+uploaded.digest+'?role=answer_pdf','DELETE')).status,200);
 const events=f.local.prepare("SELECT actor,action,detail FROM security_audit WHERE action LIKE 'bank_asset_%' ORDER BY id").all();
 assert.deepEqual(events.map(e=>e.action),['bank_asset_upload','bank_asset_download','bank_asset_tombstone']);
 assert.ok(events.every(e=>e.actor===actorA&&e.detail===pid+':answer_pdf'));
 assert.ok(events.every(e=>!JSON.stringify(e).includes('%PDF-')));
 f.local.close();
});
test('a security audit outage denies file uploads before storing any bytes',async()=>{
 const f=fixture();f.local.exec('DROP TABLE security_audit');
 const response=await f.call(actorA,'','POST',pdf,{'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'});
 assert.equal(response.status,503);
 assert.equal(f.stored.size,0);
 f.local.close();
});


test('atomic tombstone guard closes the revision-insertion race',async()=>{
 const f=fixture(),headers={'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'};
 const asset=await(await f.call(actorA,'','POST',pdf,headers)).json();
 const originalPrepare=f.env.SECURITY_DB.prepare;
 let injected=false;
 f.env.SECURITY_DB.prepare=function(sql){
  const statement=originalPrepare(sql);
  if(!sql.includes('UPDATE bank_assets SET deleted_at'))return statement;
  return {bind(...args){const bound=statement.bind(...args);return {
   ...bound,async first(){
    if(!injected){
     injected=true;
     f.local.prepare('INSERT INTO bank_questions(id,project_id,actor,content_json) VALUES(?,?,?,?)')
      .run('77777777-1111-2222-3333-555555555555',pid,actorA,JSON.stringify({questionText:'ثبت در حین حذف',sourceDigest:asset.digest}));
    }
    return bound.first();
   }
  }}};
 };
 const response=await f.call(actorA,'/'+asset.digest+'?role=question_pdf','DELETE');
 assert.equal(injected,true);
 assert.equal(response.status,409);
 assert.equal((await response.json()).error,'SOURCE_PDF_REFERENCED_BY_QUESTION');
 assert.equal((await(await f.call(actorA)).json()).assets.length,1);
 f.local.close();
});

test('verified duplicate upload stays idempotent when project hits its file cap',async()=>{
 const f=fixture(),headers={'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'};
 const original=await(await f.call(actorA,'','POST',pdf,headers)).json();
 const insert=f.local.prepare('INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)');
 for(let i=1;i<24;i++){
  const d=i.toString(16).padStart(64,'0');
  insert.run(pid,actorA,d,'application/pdf','figure','private-assets/'+actorA+'/'+d+'.pdf',60);
 }
 const repeat=await f.call(actorA,'','POST',pdf,headers);
 assert.equal(repeat.status,200);
 assert.equal((await repeat.json()).digest,original.digest);
 assert.equal(f.local.prepare('SELECT COUNT(*) AS n FROM bank_assets WHERE project_id=? AND deleted_at IS NULL').get(pid).n,24);
 assert.equal(f.stored.size,1);
 f.stored.clear();
 const missing=await f.call(actorA,'','POST',pdf,headers);
 assert.equal(missing.status,503);
 assert.equal((await missing.json()).error,'ASSET_MISSING_IN_STORAGE');
 f.local.close();
});

test('tombstoned R2 blobs still occupy the actor physical-object quota',async()=>{
 const f=fixture(),insert=f.local.prepare('INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size,deleted_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)');
 for(let i=1;i<=96;i++){
  const d=i.toString(16).padStart(64,'0');
  insert.run(pid,actorA,d,'application/pdf','question_pdf','private-assets/'+actorA+'/'+d+'.pdf',100);
 }
 assert.equal(f.local.prepare('SELECT COUNT(*) AS n FROM bank_assets WHERE deleted_at IS NULL').get().n,0);
 const result=await f.call(actorA,'','POST',pdf,{'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'});
 assert.equal(result.status,429);
 assert.equal((await result.json()).error,'ASSET_QUOTA_EXCEEDED');
 assert.equal(f.stored.size,0);
 f.local.close();
});
test('tombstoned R2 blobs still occupy the actor physical-byte quota',async()=>{
 const f=fixture(),insert=f.local.prepare('INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size,deleted_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)');
 for(let i=1;i<=32;i++){
  const d=(i+100).toString(16).padStart(64,'0');
  insert.run(pid,actorA,d,'application/pdf','question_pdf','private-assets/'+actorA+'/'+d+'.pdf',8*1024*1024);
 }
 const response=await f.call(actorA,'','POST',pdf,{'Content-Type':'application/pdf','X-Asset-Role':'question_pdf'});
 assert.equal(response.status,429);
 assert.equal(f.stored.size,0);
 f.local.close();
});
