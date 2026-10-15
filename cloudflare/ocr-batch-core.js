/* ZH-78 | bounded, dependency-free OCR batch API contracts.
 * No image, JWT, email or service credential is copied into queue messages or D1. */
export const MAX_BATCH_ITEMS=6;
export const MAX_BATCH_REQUEST_BYTES=18500000;
export const MAX_BATCH_IMAGE_CHARS=6000000;
export const MAX_BATCH_RESPONSE_TEXT=12000;
export const BATCH_STATUSES=new Set(['running','paused','cancelled','completed']);
export const ITEM_STATUSES=new Set(['staged','queued','processing','done','failed','cancelled']);
export const idPattern=/^[A-Za-z0-9_-]{12,80}$/;
export const internalIdPattern=/^[a-f0-9-]{36}$/i;
const maxString=(value,max)=>typeof value==='string'&&value.length<=max;
export function parseBatchInput(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||!idPattern.test(data.requestKey||''))throw Error('INVALID_BATCH_REQUEST');
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>MAX_BATCH_ITEMS)throw Error('INVALID_BATCH_COUNT');
 const seen=new Set(),items=[];
 let total=0;
 for(const raw of data.items){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_BATCH_ITEM');
  const {clientRef,kind,image,prompt}=raw;
  if(!idPattern.test(clientRef||'')||seen.has(clientRef)||!['question','answer'].includes(kind))throw Error('INVALID_BATCH_ITEM');
  if(!maxString(image,MAX_BATCH_IMAGE_CHARS)||!/^data:image\/(webp|png|jpeg);base64,[a-zA-Z0-9+/]+={0,2}$/.test(image))throw Error('INVALID_BATCH_IMAGE');
  if(!maxString(prompt,9000)||prompt.trim().length<20)throw Error('INVALID_BATCH_PROMPT');
  total+=image.length+prompt.length;
  if(total>MAX_BATCH_REQUEST_BYTES)throw Error('BATCH_TOO_LARGE');
  seen.add(clientRef);
  items.push({clientRef,kind,image,prompt});
 }
 return {requestKey:data.requestKey,items};
}
export async function batchDigest(parsed){
 const ordered=parsed.items.map(item=>[item.clientRef,item.kind,item.prompt,item.image]);
 const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ordered)));
 return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function normalizeBatchResult(data){
 if(!data||typeof data!=='object')return null;
 const text=String(data.text??'').slice(0,MAX_BATCH_RESPONSE_TEXT).trim();
 const latex=Array.isArray(data.latex)?data.latex.filter(x=>typeof x==='string').slice(0,18).map(x=>x.slice(0,1200)):[];
 const notes=typeof data.notes==='string'?data.notes.slice(0,700):'';
 if(!text&&!latex.length)return null;
 return {text,latex,notes,format:data.format==='plain'?'plain':'structured'};
}
export function batchSnapshot(job,items,{includeResults=true}={}){
 const list=Array.isArray(items)?items:[];
 const counts={staged:0,queued:0,processing:0,done:0,failed:0,cancelled:0};
 for(const item of list)if(Object.hasOwn(counts,item.status))counts[item.status]++;
 return {id:job.id,status:job.status,createdAt:job.created_at,updatedAt:job.updated_at,
  total:list.length,counts,percent:list.length?Math.round((counts.done+counts.failed+counts.cancelled)*100/list.length):0,
  items:list.map(item=>({id:item.id,clientRef:item.client_ref,kind:item.kind,status:item.status,attempts:item.attempts,
   error:item.error_code||null,
   ...(includeResults&&item.status==='done'&&item.result_json?{result:JSON.parse(item.result_json)}:{})}))
 };
}
export function queueRetryDelay(attempt){return Math.min(3600,Math.max(15,15*2**Math.min(7,Math.max(0,attempt-1))))}
export function isRetryableOcrStatus(status){return status===429||status===408||status===502||status===503||status===504||status>=500}
export function finiteCount(value){return Number.isInteger(value)&&value>=0?value:0}
