import {batchIssues,publishableQuestions,questionIssues,normalizePublishedQuestion} from "./quality.js";
import {getBatch,putBatch,putSource,getSource,listBatches,lockBatch,unlockBatch,publishCanonical} from "./storage.js";

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8",...headers}});
const fail=(message,status=400,headers={})=>json({error:message},status,headers);

function cors(request,env){
  const origin=request.headers.get("origin");
  const allowed=String(env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
  const selected=!origin?"*":allowed.includes("*")||allowed.includes(origin)?origin:null;
  return selected?{
    "access-control-allow-origin":selected,
    "vary":"Origin",
    "access-control-allow-headers":"content-type,x-testbank-submit-key,x-testbank-admin-key",
    "access-control-allow-methods":"GET,POST,OPTIONS"
  }:{};
}
function sameSecret(a,b){
  a=String(a||"");b=String(b||"");if(!a||!b||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function requireKey(request,expected,header){
  if(!sameSecret(request.headers.get(header),expected))throw Object.assign(new Error("Unauthorized"),{status:401});
}
async function bodyJson(request){try{return await request.json()}catch{throw Object.assign(new Error("JSON نامعتبر است."),{status:400})}}
function requireReviewer(value){const reviewer=String(value||"").trim();if(!reviewer)throw Object.assign(new Error("نام بازبین لازم است."),{status:400});return reviewer}
function asBatchStatus(value){return ["pending","completed","rejected"].includes(value)?value:null}

async function intake(request,env){
  requireKey(request,env.SUBMIT_KEY,"x-testbank-submit-key");
  const type=request.headers.get("content-type")||"";
  if(!type.includes("multipart/form-data"))throw Object.assign(new Error("Intake باید multipart/form-data باشد."),{status:415});
  const form=await request.formData(),raw=form.get("batch");
  if(!raw)throw Object.assign(new Error("فیلد batch وجود ندارد."),{status:400});
  const batch=JSON.parse(typeof raw==="string"?raw:await raw.text());
  const issues=batchIssues(batch);if(issues.length)throw Object.assign(new Error(issues.join(" | ")),{status:422});
  if(await getBatch(env,batch.id))throw Object.assign(new Error("این Batch قبلاً ثبت شده است."),{status:409});
  const sources=new Map();
  for(const [name,value] of form.entries()){
    const match=/^(question|answer)__(.+)$/.exec(name);if(!match||typeof value==="string")continue;
    const kind=match[1],questionId=decodeURIComponent(match[2]);
    sources.set(questionId+":"+kind,value);
  }
  for(const q of batch.questions){
    if(!sources.get(q.id+":question")||!sources.get(q.id+":answer"))throw Object.assign(new Error("Crop منبع برای "+q.id+" کامل نیست."),{status:422});
  }
  for(const q of batch.questions){
    await Promise.all([
      putSource(env,batch.id,q.id,"question",sources.get(q.id+":question")),
      putSource(env,batch.id,q.id,"answer",sources.get(q.id+":answer"))
    ]);
  }
  const now=new Date().toISOString();
  batch.status="pending";batch.created_at=batch.created_at||now;batch.updated_at=now;
  await putBatch(env,batch);
  return {ok:true,id:batch.id,question_count:batch.questions.length};
}

async function admin(request,env,url){
  requireKey(request,env.ADMIN_KEY,"x-testbank-admin-key");
  const path=url.pathname;
  if(request.method==="GET"&&path==="/studio/admin/list"){
    const status=asBatchStatus(url.searchParams.get("status"));if(!status)throw Object.assign(new Error("status نامعتبر است."),{status:400});
    return {items:await listBatches(env,status)};
  }
  if(request.method==="GET"&&path==="/studio/admin/batch"){
    const id=url.searchParams.get("id"),status=asBatchStatus(url.searchParams.get("status"));
    const batch=id?await getBatch(env,id):null;if(!batch||status&&batch.status!==status)throw Object.assign(new Error("Batch پیدا نشد."),{status:404});
    return {batch};
  }
  if(request.method==="GET"&&path==="/studio/admin/source"){
    const id=url.searchParams.get("batch_id"),qid=url.searchParams.get("question_id"),kind=url.searchParams.get("kind");
    if(!id||!qid||!["question","answer"].includes(kind))throw Object.assign(new Error("پارامتر source نامعتبر است."),{status:400});
    const source=await getSource(env,id,qid,kind);if(!source)throw Object.assign(new Error("منبع پیدا نشد."),{status:404});
    const headers=new Headers();source.writeHttpMetadata(headers);headers.set("etag",source.httpEtag);
    return new Response(source.body,{headers});
  }
  const payload=await bodyJson(request);
  if(request.method==="POST"&&path==="/studio/admin/save"){
    const incoming=payload.batch;if(!incoming?.id)throw Object.assign(new Error("Batch نامعتبر است."),{status:400});
    const current=await getBatch(env,incoming.id);if(!current)throw Object.assign(new Error("Batch پیدا نشد."),{status:404});
    incoming.status=current.status;incoming.created_at=current.created_at;incoming.updated_at=new Date().toISOString();
    await putBatch(env,incoming);return {ok:true,updated_at:incoming.updated_at};
  }
  const id=payload.batch_id,current=id?await getBatch(env,id):null;
  if(!current)throw Object.assign(new Error("Batch پیدا نشد."),{status:404});
  const reviewer=requireReviewer(payload.reviewer);
  if(path==="/studio/admin/lock"){return {lock:await lockBatch(env,id,reviewer)}}
  if(path==="/studio/admin/unlock"){return await unlockBatch(env,id,reviewer)}
  if(path==="/studio/admin/reject"){
    current.status="rejected";current.updated_at=new Date().toISOString();
    current.review={...(current.review||{}),reviewed_by:reviewer,reviewed_at:current.updated_at,note:payload.note||null};
    await putBatch(env,current);await unlockBatch(env,id,reviewer).catch(()=>{});
    return {ok:true,status:current.status};
  }
  if(path==="/studio/admin/restore"){
    if(current.status!=="rejected")throw Object.assign(new Error("فقط Batch ردشده قابل بازگردانی است."),{status:409});
    current.status="pending";current.updated_at=new Date().toISOString();await putBatch(env,current);return {ok:true,status:current.status};
  }
  if(path==="/studio/admin/publish"){
    if(current.status!=="pending")throw Object.assign(new Error("فقط Batch در حال بررسی قابل انتشار است."),{status:409});
    const candidates=publishableQuestions(current);
    if(!candidates.length)throw Object.assign(new Error("هیچ سوال تاییدشده‌ی منتشرنشده‌ای وجود ندارد."),{status:409});
    const bad=candidates.map(q=>({q,issues:questionIssues(q)})).filter(x=>x.issues.length);
    if(bad.length)throw Object.assign(new Error(bad.map(x=>x.q.id+": "+x.issues.join("، ")).join(" | ")),{status:422});
    const now=new Date().toISOString(),normalized=candidates.map(q=>normalizePublishedQuestion(q,reviewer,now));
    const result=await publishCanonical(env,current,normalized,reviewer);
    const publishedIds=new Set(normalized.map(q=>q.id));
    current.questions=(current.questions||[]).map(q=>publishedIds.has(q.id)?{...q,status:"verified",published_at:now,published_by:reviewer}:q);
    const remaining=current.questions.filter(q=>!q.trashed_at&&!q.published_at&&(q.review_status==="pending"||q.review_status==="needs_changes"));
    current.status=remaining.length?"pending":"completed";current.updated_at=now;
    current.review={...(current.review||{}),reviewed_by:reviewer,reviewed_at:now};
    await putBatch(env,current);if(current.status==="completed")await unlockBatch(env,id,reviewer).catch(()=>{});
    return {...result,status:current.status};
  }
  throw Object.assign(new Error("Endpoint پیدا نشد."),{status:404});
}

export default {
  async fetch(request,env){
    const headers=cors(request,env);
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
    try{
      const url=new URL(request.url);
      if(request.method==="GET"&&url.pathname==="/health")return json({ok:true,service:"selection-studio-worker"},200,headers);
      if(request.method==="POST"&&url.pathname==="/studio/intake")return json(await intake(request,env),201,headers);
      if(url.pathname.startsWith("/studio/admin/")){
        const result=await admin(request,env,url);
        if(result instanceof Response){for(const [k,v] of Object.entries(headers))result.headers.set(k,v);return result}
        return json(result,200,headers);
      }
      return fail("Not found",404,headers);
    }catch(err){
      return fail(err?.message||"Internal error",Number(err?.status)||500,headers);
    }
  }
};
