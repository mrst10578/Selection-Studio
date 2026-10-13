import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {handleAssetApi} from '../cloudflare/private-asset-api.js';
const bank=await readFile(new URL('../cloudflare/schema-question-bank-v1.sql',import.meta.url),'utf8');
const assets=await readFile(new URL('../cloudflare/schema-private-assets-v1.sql',import.meta.url),'utf8');
const actorA='a'.repeat(32),actorB='b'.repeat(32),pid='12345678-1234-1234-1234-123456789012';
const pdf=new TextEncoder().encode('%PDF-1.7\n'+('exam booklet '.repeat(8)));
function fixture(){
 const local=new DatabaseSync(':memory:');local.exec('PRAGMA foreign_keys=ON;'+bank+assets);
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
