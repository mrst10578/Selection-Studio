/* ZH-78 | Dedicated Cloudflare Queue consumer (never runs in Pages).
 * Every message is acked or retried individually. D1 CAS prevents duplicate billing
 * for concurrent deliveries while a lease is live; upstream may still charge for
 * a crashed request before D1 commits, so attempts and daily quota are capped. */
import {normalizeBatchResult,internalIdPattern,queueRetryDelay,isRetryableOcrStatus,MAX_BATCH_REQUEST_BYTES} from './ocr-batch-core.js';
const sql=(db,text,...p)=>db.prepare(text).bind(...p);
function extract(value,depth=0){
 if(value==null||depth>7)return null;
 if(typeof value==='string'){
  const s=value.trim();
  try{return extract(JSON.parse(s),depth+1)}
  catch{return normalizeBatchResult({text:s,format:'plain'})}
 }
 if(Array.isArray(value)){for(const item of value){const v=extract(item,depth+1);if(v)return v}return null}
 if(typeof value!=='object')return null;
 if(typeof value.text==='string'||typeof value.transcription==='string'||Array.isArray(value.latex))
  return normalizeBatchResult({text:value.text??value.transcription??'',latex:value.latex??value.formulas??[],notes:value.notes??''});
 for(const k of ['result','response','output','message','content','choices','parts']){
  if(value[k]!=null){const result=extract(value[k],depth+1);if(result)return result}
 }
 return null;
}
async function audit(db,actor,status,detail){
 await sql(db,'INSERT INTO security_audit(actor,action,result,detail) VALUES(?1,?2,?3,?4)',actor,'ocr_batch',status,detail).run();
}
async function quota(db,actor,env){
 const now=Date.now(),day=Math.floor(now/86400000),globalLimit=Math.min(100,Math.max(1,Number(env.OCR_GLOBAL_DAILY_LIMIT)||30));
 for(const [subject,window,bucket,max] of [
  [actor,'minute',Math.floor(now/60000),10],
  [actor,'day',day,100],
  ['__global__','day',day,globalLimit]
 ]){
  const row=await sql(db,'INSERT INTO ocr_usage(actor,window,bucket,used) VALUES(?1,?2,?3,1) ON CONFLICT(actor,window,bucket) DO UPDATE SET used=used+1 WHERE used<?4 RETURNING used',
   subject,window,bucket,max).first();
  if(!row)return false;
 }
 return true;
}
async function settleJob(db,jobId){
 await sql(db,"UPDATE ocr_batch_jobs SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='running' AND NOT EXISTS (SELECT 1 FROM ocr_batch_items WHERE job_id=?1 AND status IN ('staged','queued','processing'))",jobId).run();
}
async function consumeOne(msg,env){
 const {jobId,itemId}=msg.body||{};
 if(!internalIdPattern.test(jobId||'')||!internalIdPattern.test(itemId||'')){msg.ack();return}
 const db=env.SECURITY_DB;
 if(!db?.prepare||!env.OCR_JOB_ASSETS?.get||!env.OCR_SERVICE_TOKEN){msg.retry({delaySeconds:120});return}
 const job=await sql(db,'SELECT id,actor,status FROM ocr_batch_jobs WHERE id=?1',jobId).first();
 const item=await sql(db,'SELECT id,status,attempts,asset_key FROM ocr_batch_items WHERE job_id=?1 AND id=?2',jobId,itemId).first();
 if(!job||!item||['done','cancelled','failed'].includes(item.status)||['completed','cancelled'].includes(job.status)){msg.ack();return}
 if(job.status==='paused'){
  const staged=await sql(db,"UPDATE ocr_batch_items SET status='staged' WHERE id=?1 AND status='queued' AND EXISTS (SELECT 1 FROM ocr_batch_jobs WHERE id=?2 AND status='paused') RETURNING id",itemId,jobId).first();
  // If Resume raced with Pause, do not ack a message that was never re-dispatched.
  if(staged||item.status==='staged'){msg.ack();return}
  msg.retry({delaySeconds:15});return;
 }
 const claim=await sql(db,
  "UPDATE ocr_batch_items SET status='processing',attempts=attempts+1,lease_until=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_id=?2 AND attempts<3 AND (status IN ('queued','staged') OR (status='processing' AND lease_until<?4)) AND EXISTS(SELECT 1 FROM ocr_batch_jobs WHERE id=?2 AND status='running') RETURNING attempts",
  itemId,jobId,Date.now()+180000,Date.now()).first();
 if(!claim){
  const latest=await sql(db,'SELECT status,attempts,lease_until FROM ocr_batch_items WHERE id=?1',itemId).first();
  const parent=await sql(db,'SELECT status FROM ocr_batch_jobs WHERE id=?1',jobId).first();
  if(!latest||!parent||['done','cancelled','failed'].includes(latest.status)||['cancelled','completed'].includes(parent.status)){msg.ack();return}
  if(parent.status==='paused'){
   const parked=await sql(db,"UPDATE ocr_batch_items SET status='staged' WHERE id=?1 AND status='queued' AND EXISTS (SELECT 1 FROM ocr_batch_jobs WHERE id=?2 AND status='paused') RETURNING id",itemId,jobId).first();
   if(parked||latest.status==='staged'){msg.ack();return}
  }
  if(latest.status==='processing'&&latest.attempts>=3&&latest.lease_until<Date.now()){
   await sql(db,"UPDATE ocr_batch_items SET status='failed',error_code='OCR_LEASE_EXPIRED',lease_until=NULL WHERE id=?1 AND status='processing' AND lease_until<?2",itemId,Date.now()).run();
   await settleJob(db,jobId);msg.ack();return;
  }
  msg.retry({delaySeconds:45});return;
 }
 const attempt=claim.attempts;
 let code='OCR_UPSTREAM_FAILED',retryable=false;
 try{
  const source=await env.OCR_JOB_ASSETS.get(item.asset_key);
  if(!source){code='OCR_STORAGE_UNAVAILABLE';throw Error(code)}
  const raw=await source.text();
  if(raw.length>MAX_BATCH_REQUEST_BYTES){code='OCR_INVALID_INPUT';throw Error(code)}
  const data=JSON.parse(raw);
  if(typeof data.image!=='string'||data.image.length>6000000||!/^data:image\/(webp|png|jpeg);base64,/.test(data.image)||typeof data.prompt!=='string'||data.prompt.length>9000){
   code='OCR_INVALID_INPUT';throw Error(code);
  }
  if(!(await quota(db,job.actor,env))){code='OCR_QUOTA';throw Error(code)}
  // Fail closed if audit storage fails; never infer without an audit event.
  await audit(db,job.actor,'started',jobId+':'+itemId);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  let response;
  try{
   response=await fetch('https://selection-studio-ocr-secure.zh-st-2.workers.dev/ocr',{
    method:'POST',headers:{Authorization:'Bearer '+env.OCR_SERVICE_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify(data),signal:controller.signal,redirect:'error'
   });
  }finally{clearTimeout(timer)}
  if(!response.ok){
   retryable=isRetryableOcrStatus(response.status);code=retryable?'OCR_UPSTREAM_RETRY':'OCR_UPSTREAM_FAILED';
   throw Error(code);
  }
  const result=extract(await response.json());
  if(!result){code='OCR_EMPTY_RESULT';throw Error(code)}
  const saved=await sql(db,
   "UPDATE ocr_batch_items SET status='done',result_json=?1,error_code=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND job_id=?3 AND status='processing' AND attempts=?4 AND EXISTS(SELECT 1 FROM ocr_batch_jobs WHERE id=?3 AND status IN ('running','paused')) RETURNING id",
   JSON.stringify(result),itemId,jobId,attempt).first();
  if(saved){
   await audit(db,job.actor,'completed',jobId+':'+itemId).catch(()=>{});
   await env.OCR_JOB_ASSETS.delete(item.asset_key).catch(()=>{});
  }
  await settleJob(db,jobId);
  msg.ack();
 }catch(e){
  if(e?.name==='AbortError'){code='OCR_UPSTREAM_RETRY';retryable=true}
  if(retryable&&attempt<3){
   await sql(db,"UPDATE ocr_batch_items SET status='queued',error_code=?1,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND job_id=?3 AND status='processing' AND attempts=?4",code,itemId,jobId,attempt).run();
   msg.retry({delaySeconds:queueRetryDelay(attempt)});return;
  }
  await sql(db,"UPDATE ocr_batch_items SET status='failed',error_code=?1,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND job_id=?3 AND status='processing' AND attempts=?4",code,itemId,jobId,attempt).run();
  await audit(db,job.actor,'failed',jobId+':'+itemId+':'+code).catch(()=>{});
  await settleJob(db,jobId);
  msg.ack();
 }
}
export async function consumeOcrBatch(batch,env){
 for(const message of batch.messages){
  try{await consumeOne(message,env)}
  catch{message.retry({delaySeconds:120})}
 }
}
/* Daily cleanup removes inputs/results older than 7 days, including abandoned jobs.
 * Delete stored image first: a failed R2 delete must not silently orphan pixels. */
export async function cleanupExpiredBatches(env){
 if(!env.SECURITY_DB?.prepare||!env.OCR_JOB_ASSETS?.delete)return 0;
 const db=env.SECURITY_DB;
 const expired=await sql(db,"SELECT id FROM ocr_batch_jobs WHERE created_at < datetime('now','-7 days') ORDER BY created_at ASC LIMIT 80").all();
 let purged=0;
 for(const job of expired.results||[]){
  const children=await sql(db,'SELECT asset_key FROM ocr_batch_items WHERE job_id=?1',job.id).all();
  try{
   for(const item of children.results||[])await env.OCR_JOB_ASSETS.delete(item.asset_key);
   await sql(db,'DELETE FROM ocr_batch_items WHERE job_id=?1',job.id).run();
   await sql(db,'DELETE FROM ocr_batch_jobs WHERE id=?1',job.id).run();
   purged++;
  }catch{ /* Next scheduled run retries. */ }
 }
 return purged;
}
export default {
 async queue(batch,env){return consumeOcrBatch(batch,env)},
 async scheduled(event,env){await cleanupExpiredBatches(env)}
};
