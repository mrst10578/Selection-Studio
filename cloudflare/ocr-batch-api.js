/* ZH-78 | Authenticated OCR batch API. No images or credentials in Queue messages. */
import {parseBatchInput,batchDigest,batchSnapshot,MAX_BATCH_REQUEST_BYTES,internalIdPattern} from './ocr-batch-core.js';
const reply=(payload,status=200)=>Response.json(payload,{status,headers:{'Cache-Control':'no-store'}});
const error=(code,status=400)=>reply({error:code},status);
const q=(db,text,...params)=>db.prepare(text).bind(...params);
const storageKey=(job,item)=>'ocr-batches/'+job+'/'+item+'.json';
const configured=env=>env.SECURITY_DB?.prepare&&env.OCR_JOB_ASSETS?.put&&env.OCR_QUEUE?.send;
async function jobFor(db,actor,id){return q(db,'SELECT * FROM ocr_batch_jobs WHERE actor=?1 AND id=?2',actor,id).first()}
async function itemsFor(db,id){const result=await q(db,'SELECT * FROM ocr_batch_items WHERE job_id=?1 ORDER BY ordinal',id).all();return result.results||[]}
async function visible(db,job){return batchSnapshot(job,await itemsFor(db,job.id))}
async function enqueue(env,id,items){
 let sent=0;
 for(const item of items){
  if(item.status!=='staged')continue;
  try{
   await env.OCR_QUEUE.send({jobId:id,itemId:item.id},{contentType:'json'});
   await q(env.SECURITY_DB,"UPDATE ocr_batch_items SET status='queued',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND status='staged'",item.id,id).run();
   sent++;
  }catch{ /* Staged items remain redispatchable via resume. */ }
 }
 return sent;
}
async function create(request,env,actor){
 if(!configured(env))return error('BATCH_NOT_CONFIGURED',503);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return error('JSON_REQUIRED',415);
 const bytes=Number(request.headers.get('content-length')||0);
 if(!Number.isFinite(bytes)||bytes>MAX_BATCH_REQUEST_BYTES+16384)return error('BATCH_TOO_LARGE',413);
 let data;
 try{
  const body=await request.text();
  if(new TextEncoder().encode(body).length>MAX_BATCH_REQUEST_BYTES+16384)return error('BATCH_TOO_LARGE',413);
  data=parseBatchInput(JSON.parse(body));
 }catch(e){return error(e.message==='BATCH_TOO_LARGE'?'BATCH_TOO_LARGE':'INVALID_BATCH_REQUEST',e.message==='BATCH_TOO_LARGE'?413:400)}
 const db=env.SECURITY_DB,digest=await batchDigest(data);
 const existing=await q(db,'SELECT * FROM ocr_batch_jobs WHERE actor=?1 AND request_key=?2',actor,data.requestKey).first();
 if(existing)return existing.digest===digest?reply(await visible(db,existing)):error('IDEMPOTENCY_KEY_CONFLICT',409);
 const active=await q(db,"SELECT COUNT(*) AS n FROM ocr_batch_jobs WHERE actor=?1 AND status IN ('running','paused')",actor).first();
 if((active?.n||0)>=3)return error('TOO_MANY_ACTIVE_BATCHES',429);
 const jobId=crypto.randomUUID(),items=data.items.map((part,ordinal)=>({...part,ordinal,id:crypto.randomUUID()}));
 const written=[];
 try{
  for(const item of items){
   const key=storageKey(jobId,item.id);
   await env.OCR_JOB_ASSETS.put(key,JSON.stringify({image:item.image,prompt:item.prompt}),{httpMetadata:{contentType:'application/json'}});
   written.push(key);
  }
  await db.batch([
   q(db,"INSERT INTO ocr_batch_jobs(id,actor,request_key,digest,status) VALUES (?1,?2,?3,?4,'running')",jobId,actor,data.requestKey,digest),
   ...items.map(item=>q(db,"INSERT INTO ocr_batch_items(id,job_id,ordinal,client_ref,kind,asset_key,status,attempts) VALUES (?1,?2,?3,?4,?5,?6,'staged',0)",
    item.id,jobId,item.ordinal,item.clientRef,item.kind,storageKey(jobId,item.id)))
  ]);
 }catch{
  await Promise.allSettled(written.map(k=>env.OCR_JOB_ASSETS.delete(k)));
  const other=await q(db,'SELECT * FROM ocr_batch_jobs WHERE actor=?1 AND request_key=?2',actor,data.requestKey).first().catch(()=>null);
  return other&&other.digest===digest?reply(await visible(db,other)):error(other?'IDEMPOTENCY_KEY_CONFLICT':'BATCH_STORAGE_UNAVAILABLE',other?409:503);
 }
 const queued=await enqueue(env,jobId,items.map(x=>({id:x.id,status:'staged'})));
 return reply({...await visible(db,await jobFor(db,actor,jobId)),queued},202);
}
async function act(env,actor,id,action){
 const db=env.SECURITY_DB,job=await jobFor(db,actor,id);
 if(!job)return error('BATCH_NOT_FOUND',404);
 if(action==='pause'){
  if(!['running','paused'].includes(job.status))return error('BATCH_CANNOT_PAUSE',409);
  await q(db,"UPDATE ocr_batch_jobs SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND actor=?2 AND status='running'",id,actor).run();
 }else if(action==='cancel'){
  await q(db,"UPDATE ocr_batch_jobs SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND actor=?2 AND status IN ('running','paused')",id,actor).run();
  await q(db,"UPDATE ocr_batch_items SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE job_id=?1 AND status IN ('staged','queued','processing')",id).run();
 }else if(action==='resume'){
  if(!['running','paused'].includes(job.status))return error('BATCH_CANNOT_RESUME',409);
  await q(db,"UPDATE ocr_batch_jobs SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND actor=?2 AND status='paused'",id,actor).run();
  // Queue delivery is at-least-once, but exhausted/dropped messages can leave D1
  // records stranded. Explicit operator Resume safely redispatches only stale work.
  // Live leases remain untouched. A duplicate old message is protected by the
  // consumer's conditional claim and cannot cause concurrent inference.
  const now=Date.now();
  await q(db,"UPDATE ocr_batch_items SET status='failed',error_code='OCR_LEASE_EXPIRED',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?1 AND status='processing' AND attempts>=3 AND lease_until<?2",id,now).run();
  await q(db,"UPDATE ocr_batch_items SET status='staged',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?1 AND status='processing' AND attempts<3 AND lease_until<?2",id,now).run();
  await q(db,"UPDATE ocr_batch_items SET status='staged',updated_at=CURRENT_TIMESTAMP WHERE job_id=?1 AND status='queued' AND updated_at<datetime('now','-5 minutes')",id).run();
  await enqueue(env,id,await itemsFor(db,id));
 }else if(action==='retry'){
  if(job.status==='cancelled')return error('BATCH_CANCELLED',409);
  const count=await q(db,"SELECT COUNT(*) AS n FROM ocr_batch_items WHERE job_id=?1 AND status='failed'",id).first();
  if(!Number(count?.n))return error('BATCH_NOTHING_TO_RETRY',409);
  await q(db,"UPDATE ocr_batch_jobs SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND actor=?2 AND status IN ('paused','completed')",id,actor).run();
  await q(db,"UPDATE ocr_batch_items SET status='staged',attempts=0,error_code=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=?1 AND status='failed'",id).run();
  await enqueue(env,id,await itemsFor(db,id));
 }
 return reply(await visible(db,await jobFor(db,actor,id)));
}
export async function handleBatchApi(request,env,actor,url){
 if(!env.SECURITY_DB?.prepare)return error('BATCH_STORAGE_NOT_CONFIGURED',503);
 const rest=url.pathname.slice('/api/ocr/jobs'.length);
 const match=/^\/([a-f0-9-]{36})(?:\/(pause|resume|retry|cancel))?$/i.exec(rest);
 try{
  if(!rest){
   if(request.method==='POST')return await create(request,env,actor);
   if(request.method!=='GET')return error('METHOD_NOT_ALLOWED',405);
   const all=await q(env.SECURITY_DB,'SELECT * FROM ocr_batch_jobs WHERE actor=?1 ORDER BY created_at DESC LIMIT 8',actor).all();
   return reply({jobs:await Promise.all((all.results||[]).map(j=>visible(env.SECURITY_DB,j)))});
  }
  if(!match||!internalIdPattern.test(match[1]))return error('BATCH_NOT_FOUND',404);
  if(match[2]){
   if(request.method!=='POST')return error('METHOD_NOT_ALLOWED',405);
   if(!configured(env))return error('BATCH_NOT_CONFIGURED',503);
   return act(env,actor,match[1],match[2]);
  }
  if(request.method!=='GET')return error('METHOD_NOT_ALLOWED',405);
  const job=await jobFor(env.SECURITY_DB,actor,match[1]);
  return job?reply(await visible(env.SECURITY_DB,job)):error('BATCH_NOT_FOUND',404);
 }catch{return error('BATCH_DATABASE_UNAVAILABLE',503)}
}
