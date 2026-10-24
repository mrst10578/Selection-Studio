import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {parseBatchInput,batchDigest,normalizeBatchResult,queueRetryDelay} from '../cloudflare/ocr-batch-core.js';
import {handleBatchApi} from '../cloudflare/ocr-batch-api.js';
import {consumeOcrBatch} from '../cloudflare/ocr-queue-consumer.js';
import worker from '../cloudflare/_worker.js';

const schema=await readFile(new URL('../cloudflare/schema-security.sql',import.meta.url),'utf8');
const url='https://selection-studio-e1c.pages.dev';
const actor='qa-actor-a';
const img='data:image/png;base64,'+'A'.repeat(36);
const example=(key='qa-idempotency-001',text='Precisely transcribe math and Persian, do not answer.')=>({
 requestKey:key,items:[
  {clientRef:'qa-question-item-001',kind:'question',image:img,prompt:text},
  {clientRef:'qa-answer-item-001',kind:'answer',image:img,prompt:text+' answer'}
 ]
});
function fixture(){
 const local=new DatabaseSync(':memory:');local.exec('PRAGMA foreign_keys=ON;');local.exec(schema);
 const calls=[];
 const db={
  prepare(sql){
   return {bind(...args){
    const stmt=local.prepare(sql);
    const row={
     async first(){return stmt.get(...args)??null},
     async all(){return {results:stmt.all(...args)}},
     async run(){return stmt.run(...args)}
    };
    row.raw=()=>stmt.run(...args);
    return row;
   }};
  },
  async batch(stmts){
   local.exec('BEGIN');
   try{const all=stmts.map(x=>x.raw());local.exec('COMMIT');return all}
   catch(e){local.exec('ROLLBACK');throw e}
  }
 };
 const images=new Map();
 const r2={
  async put(key,data){images.set(key,data)},
  async get(key){return images.has(key)?{text:async()=>images.get(key)}:null},
  async delete(key){images.delete(key)}
 };
 const queue={
  async send(body){calls.push(structuredClone(body))}
 };
 return {local,db,r2,queue,calls,images,env:{SECURITY_DB:db,OCR_JOB_ASSETS:r2,OCR_QUEUE:queue,OCR_SERVICE_TOKEN:'fake-internal-only',OCR_GLOBAL_DAILY_LIMIT:'30',OCR_BATCH_ENABLED:'true'}};
}
const call=(env,actor,path='',method='GET',payload)=>handleBatchApi(new Request(url+'/api/ocr/jobs'+path,{
 method,
 headers:payload?{'Content-Type':'application/json'}:{},
 ...(payload?{body:JSON.stringify(payload)}:{})
}),env,actor,new URL(url+'/api/ocr/jobs'+path));
const signedMessage=body=>{
 const result={body,ackCount:0,retries:[]};
 result.ack=()=>result.ackCount++;
 result.retry=opts=>result.retries.push(opts);
 return result;
};
test('batch parser rejects duplicate refs, invalid images and oversize item counts',()=>{
 assert.equal(parseBatchInput(example()).items.length,2);
 assert.throws(()=>parseBatchInput({...example(),items:[...example().items,...example().items]}),/INVALID_BATCH_ITEM/);
 assert.throws(()=>parseBatchInput({...example(),items:[]}),/INVALID_BATCH_COUNT/);
 assert.throws(()=>parseBatchInput({...example(),items:[{...example().items[0],image:'https://evil.example/payload'}]}),/INVALID_BATCH_IMAGE/);
 assert.equal(queueRetryDelay(1),15);assert.equal(queueRetryDelay(2),30);
 assert.equal(normalizeBatchResult({text:'فارسی x²',latex:['x^2']}).text,'فارسی x²');
});
test('job idempotency prevents duplicate Queue messages and rejects changed payload',async()=>{
 const f=fixture(),body=example();
 const a=await call(f.env,actor,'','POST',body);
 assert.equal(a.status,202);
 const job=await a.json();
 assert.equal(job.total,2);assert.equal(job.counts.queued,2);
 assert.equal(f.calls.length,2);
 assert.deepEqual(Object.keys(f.calls[0]).sort(),['itemId','jobId']);
 assert.equal(f.images.size,2);
 const again=await call(f.env,actor,'','POST',body);
 assert.equal(again.status,200);assert.equal((await again.json()).id,job.id);
 assert.equal(f.calls.length,2);
 const collision=await call(f.env,actor,'','POST',example(body.requestKey,'Different OCR transcription prompt; force digest conflict.'));
 assert.equal(collision.status,409);
 const outsider=await call(f.env,'qa-other-actor','/'+job.id);
 assert.equal(outsider.status,404);
 const list=await call(f.env,actor);
 assert.equal((await list.json()).jobs.length,1);
 f.local.close();
});
test('pause, resume, failed-only retry and cancel persist across new HTTP requests',async()=>{
 const f=fixture(),start=await call(f.env,actor,'','POST',example());
 const job=await start.json();
 assert.equal((await call(f.env,actor,'/'+job.id+'/pause','POST')).status,200);
 let paused=await (await call(f.env,actor,'/'+job.id)).json();
 assert.equal(paused.status,'paused');
 // Paused messages are not billed; their staged record is redispatched on Resume.
 const p=signedMessage(f.calls[0]);
 await consumeOcrBatch({messages:[p]},f.env);
 assert.equal(p.ackCount,1);assert.equal(p.retries.length,0);
 paused=await (await call(f.env,actor,'/'+job.id)).json();
 assert.equal(paused.counts.staged,1);
 const before=f.calls.length;
 await call(f.env,actor,'/'+job.id+'/resume','POST');
 assert.equal(f.calls.length,before+1);
 f.local.prepare("UPDATE ocr_batch_items SET status='failed',error_code='OCR_UPSTREAM_FAILED' WHERE id=?").run(job.items[0].id);
 await call(f.env,actor,'/'+job.id+'/retry','POST');
 assert.equal((await (await call(f.env,actor,'/'+job.id)).json()).counts.failed,0);
 const cancelled=await (await call(f.env,actor,'/'+job.id+'/cancel','POST')).json();
 assert.equal(cancelled.status,'cancelled');
 assert.equal(cancelled.counts.cancelled,2);
 assert.equal((await call(f.env,actor,'/'+job.id+'/resume','POST')).status,409);
 assert.equal((await call(f.env,actor,'/'+job.id+'/retry','POST')).status,409);
 f.local.close();
});
test('consumer acknowledges success, enforces at-least-once idempotency and deletes completed input',async()=>{
 const f=fixture();
 const job=await (await call(f.env,actor,'','POST',example())).json();
 const first=signedMessage(f.calls[0]);
 const fetchBefore=globalThis.fetch;let calls=0;
 globalThis.fetch=async(request,options)=>{
  calls++;
  assert.ok(String(request).includes('selection-studio-ocr-secure'));
  assert.equal(options.headers.Authorization,'Bearer fake-internal-only');
  assert.equal(JSON.parse(options.body).image,img);
  return Response.json({result:{response:JSON.stringify({text:'۲ + ۲ = ؟',latex:['2+2'],notes:'بدون ابهام'})}});
 };
 try{
  await consumeOcrBatch({messages:[first]},f.env);
  assert.equal(first.ackCount,1);assert.equal(first.retries.length,0);
  assert.equal(f.images.size,1);
  const status=await (await call(f.env,actor,'/'+job.id)).json();
  assert.equal(status.counts.done,1);
  assert.equal(status.items[0].result.text,'۲ + ۲ = ؟');
  await consumeOcrBatch({messages:[signedMessage(f.calls[0])]},f.env);
  assert.equal(calls,1);
  await consumeOcrBatch({messages:[signedMessage(f.calls[1])]},f.env);
  assert.equal((await (await call(f.env,actor,'/'+job.id)).json()).status,'completed');
  assert.equal(f.images.size,0);
 }finally{globalThis.fetch=fetchBefore;f.local.close()}
});
test('transient upstream 503 retries one message with backoff without changing other records',async()=>{
 const f=fixture();const job=await (await call(f.env,actor,'','POST',example())).json();
 const previous=globalThis.fetch;
 let n=0;
 globalThis.fetch=async()=>{
  n++;
  return n===1?new Response('{}',{status:503}):Response.json({result:{response:'{"text":"پاسخ صحیح OCR","latex":[]}'}})
 };
 try{
  const msg=signedMessage(f.calls[0]);
  await consumeOcrBatch({messages:[msg]},f.env);
  assert.equal(msg.ackCount,0);assert.equal(msg.retries.length,1);
  let status=await (await call(f.env,actor,'/'+job.id)).json();
  assert.equal(status.items[0].status,'queued');
  await consumeOcrBatch({messages:[signedMessage(f.calls[0])]},f.env);
  status=await (await call(f.env,actor,'/'+job.id)).json();
  assert.equal(status.items[0].status,'done');assert.equal(status.items[0].attempts,2);
  assert.equal(status.items[1].status,'queued');
 }finally{globalThis.fetch=previous;f.local.close()}
});
test('unauthenticated batch route fails closed before D1, R2 or queue access',async()=>{
 const req=new Request(url+'/api/ocr/jobs',{method:'GET'});
 const response=await worker.fetch(req,{ASSETS:{fetch:async()=>new Response('asset')}});
 assert.equal(response.status,503);
 const noJwt=await worker.fetch(req,{ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'aud',OPERATOR_EMAILS:'user@example.com'});
 assert.equal(noJwt.status,401);
});

test('operator resume recovers stranded deliveries without duplicating fresh queue sends',async()=>{
 const f=fixture(),job=await (await call(f.env,actor,'','POST',example('qa-idempotency-recovery-001'))).json();
 assert.equal(f.calls.length,2);
 // A healthy queued message must never be re-dispatched just for clicking Resume.
 await call(f.env,actor,'/'+job.id+'/resume','POST');
 assert.equal(f.calls.length,2);
 f.local.prepare("UPDATE ocr_batch_items SET updated_at=datetime('now','-10 minutes') WHERE id=?").run(job.items[0].id);
 // Expired processing lease with a remaining attempt is also safely recoverable.
 f.local.prepare("UPDATE ocr_batch_items SET status='processing',attempts=1,lease_until=1 WHERE id=?").run(job.items[1].id);
 const recovered=await (await call(f.env,actor,'/'+job.id+'/resume','POST')).json();
 assert.equal(recovered.counts.queued,2);
 assert.equal(f.calls.length,4);
 assert.deepEqual(f.calls.slice(2).map(x=>x.itemId).sort(),job.items.map(x=>x.id).sort());
 const stale=signedMessage(f.calls[0]),fresh=signedMessage(f.calls[2]);
 // The old and new delivery both reference one D1 item, never new storage/cost.
 assert.equal(stale.body.itemId,fresh.body.itemId);
 f.local.close();
});
test('exhausted stale processing lease needs manual retry rather than hidden extra inference',async()=>{
 const f=fixture(),job=await (await call(f.env,actor,'','POST',example('qa-idempotency-recovery-002'))).json();
 f.local.prepare("UPDATE ocr_batch_items SET status='processing',attempts=3,lease_until=1 WHERE id=?").run(job.items[0].id);
 const before=f.calls.length;
 const snapshot=await (await call(f.env,actor,'/'+job.id+'/resume','POST')).json();
 assert.equal(snapshot.counts.failed,1);
 assert.equal(snapshot.items[0].error,'OCR_LEASE_EXPIRED');
 assert.equal(f.calls.length,before);
 f.local.close();
});

test('batch OCR is disabled by default even when R2 and Queue are bound',async()=>{
 const f=fixture();delete f.env.OCR_BATCH_ENABLED;
 const response=await call(f.env,actor,'','POST',example('disabled-batch-001'));
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'BATCH_DISABLED');
 assert.equal(f.images.size,0);
 assert.equal(f.calls.length,0);
 assert.equal(f.local.prepare('SELECT COUNT(*) AS n FROM ocr_batch_jobs').get().n,0);
 assert.equal((await call(f.env,actor)).status,200);
 f.local.close();
});
test('batch shutdown blocks resume and retry but retains read, pause and cancel',async()=>{
 const f=fixture(),started=await call(f.env,actor,'','POST',example('disabled-batch-002'));
 assert.equal(started.status,202);
 const job=(await started.json()).id;
 f.env.OCR_BATCH_ENABLED='false';
 assert.equal((await call(f.env,actor,'/'+job+'/resume','POST')).status,503);
 assert.equal((await call(f.env,actor,'/'+job+'/retry','POST')).status,503);
 assert.equal((await call(f.env,actor,'/'+job)).status,200);
 assert.equal((await call(f.env,actor,'/'+job+'/pause','POST')).status,200);
 assert.equal((await call(f.env,actor,'/'+job+'/cancel','POST')).status,200);
 assert.equal(f.calls.length,2,'no additional Queue sends on shutdown');
 f.local.close();
});


test('consumer refuses billable inference while batch release switch is off',async()=>{
 const f=fixture();
 const job=await(await call(f.env,actor,'','POST',example('disabled-consumer-003'))).json();
 const msg=signedMessage(f.calls[0]);
 f.env.OCR_BATCH_ENABLED='false';
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('inference must remain disabled')};
 try{
  await consumeOcrBatch({messages:[msg]},f.env);
  assert.equal(msg.ackCount,0);
  assert.deepEqual(msg.retries,[{delaySeconds:3600}]);
  const state=await(await call(f.env,actor,'/'+job.id)).json();
  assert.equal(state.counts.queued,2);
  assert.equal(f.images.size,2);
  assert.equal(f.local.prepare("SELECT COUNT(*) AS n FROM ocr_usage").get().n,0);
 }finally{globalThis.fetch=previous;f.local.close()}
});
