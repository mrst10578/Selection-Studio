import {buildCatalog} from "./catalog.js";

const enc=s=>encodeURIComponent(String(s));
const BATCH_PREFIX="batches/";
const LOCK_PREFIX="locks/";

export async function putJson(bucket,key,value){
  await bucket.put(key,JSON.stringify(value),{httpMetadata:{contentType:"application/json; charset=utf-8"}});
}
export async function getJson(bucket,key){
  const obj=await bucket.get(key);
  if(!obj)return null;
  return JSON.parse(await obj.text());
}
export async function getBatch(env,id){return getJson(env.BATCH_BUCKET,BATCH_PREFIX+enc(id)+"/batch.json")}
export async function putBatch(env,batch){return putJson(env.BATCH_BUCKET,BATCH_PREFIX+enc(batch.id)+"/batch.json",batch)}
export async function putSource(env,batchId,questionId,kind,file){
  const key=BATCH_PREFIX+enc(batchId)+"/sources/"+enc(questionId)+"/"+kind;
  await env.BATCH_BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
}
export async function getSource(env,batchId,questionId,kind){
  return env.BATCH_BUCKET.get(BATCH_PREFIX+enc(batchId)+"/sources/"+enc(questionId)+"/"+kind);
}
export async function listBatches(env,status){
  const items=[];let cursor;
  do{
    const page=await env.BATCH_BUCKET.list({prefix:BATCH_PREFIX,cursor,limit:1000});
    for(const object of page.objects){
      if(!object.key.endsWith("/batch.json"))continue;
      const batch=await getJson(env.BATCH_BUCKET,object.key);
      if(!batch||batch.status!==status)continue;
      const active=(batch.questions||[]).filter(q=>!q.trashed_at);
      const reviewed=active.filter(q=>(q.review_status||"pending")!=="pending").length;
      items.push({
        id:batch.id,status:batch.status,exam_id:batch.exam?.id||null,
        exam_label:batch.exam?.provider?(batch.exam.provider+" — "+(batch.exam.date||"")):batch.exam?.id||batch.id,
        submitted_by:batch.submitted_by||null,question_count:active.length,reviewed_count:reviewed,
        created_at:batch.created_at||null,updated_at:batch.updated_at||null
      });
    }
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  return items.sort((a,b)=>String(b.updated_at||b.created_at||"").localeCompare(String(a.updated_at||a.created_at||"")));
}
export async function getLock(env,batchId){
  const key=LOCK_PREFIX+enc(batchId)+".json";
  const lock=await getJson(env.BATCH_BUCKET,key);
  if(lock&&Date.parse(lock.expires_at)>Date.now())return lock;
  if(lock)await env.BATCH_BUCKET.delete(key);
  return null;
}
export async function lockBatch(env,batchId,reviewer,ttlMs=30*60*1000){
  const current=await getLock(env,batchId);
  if(current&&current.reviewer!==reviewer)throw Object.assign(new Error("Batch توسط "+current.reviewer+" قفل شده است."),{status:409});
  const now=new Date(),lock={batch_id:batchId,reviewer,locked_at:now.toISOString(),expires_at:new Date(now.getTime()+ttlMs).toISOString()};
  await putJson(env.BATCH_BUCKET,LOCK_PREFIX+enc(batchId)+".json",lock);return lock;
}
export async function unlockBatch(env,batchId,reviewer){
  const key=LOCK_PREFIX+enc(batchId)+".json",current=await getLock(env,batchId);
  if(current&&reviewer&&current.reviewer!==reviewer)throw Object.assign(new Error("قفل متعلق به بازبین دیگری است."),{status:409});
  await env.BATCH_BUCKET.delete(key);return {ok:true};
}

function ghConfig(env){
  const parts=String(env.GITHUB_REPO||"").split("/"),owner=parts[0],repo=parts[1];
  if(!owner||!repo||!env.GITHUB_TOKEN)throw Object.assign(new Error("GitHub canonical configuration ناقص است."),{status:500});
  return {owner,repo,branch:env.GITHUB_BRANCH||"main",token:env.GITHUB_TOKEN};
}
async function gh(env,path,init={}){
  const c=ghConfig(env);
  const response=await fetch("https://api.github.com/repos/"+c.owner+"/"+c.repo+path,{
    ...init,headers:{
      accept:"application/vnd.github+json","x-github-api-version":"2022-11-28",
      authorization:"Bearer "+c.token,"user-agent":"selection-studio-worker",
      ...(init.headers||{})
    }
  });
  const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok){
    const err=new Error(data?.message||String(data||response.status));err.status=response.status===409?409:502;throw err;
  }
  return data;
}
function b64decode(value){
  const bytes=Uint8Array.from(atob(String(value||"").replace(/\n/g,"")),c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function jsonl(text){return String(text||"").split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))}
function toJsonl(rows){return rows.map(row=>JSON.stringify(row)).join("\n")+(rows.length?"\n":"")}

async function readRepoFile(env,path){
  const c=ghConfig(env),data=await gh(env,"/contents/"+path+"?ref="+encodeURIComponent(c.branch));
  return b64decode(data.content);
}
async function createBlob(env,content){
  return (await gh(env,"/git/blobs",{method:"POST",body:JSON.stringify({content,encoding:"utf-8"})})).sha;
}

export async function publishCanonical(env,batch,questions,reviewer){
  const c=ghConfig(env);
  const values=await Promise.all([
    readRepoFile(env,"data/questions.jsonl"),readRepoFile(env,"data/exams.jsonl"),readRepoFile(env,"taxonomy/taxonomy.json")
  ]);
  const canonicalQuestions=jsonl(values[0]),canonicalExams=jsonl(values[1]),taxonomy=JSON.parse(values[2]);
  const byId=new Map(canonicalQuestions.map(q=>[q.id,q]));let added=0;
  for(const q of questions){
    const existing=byId.get(q.id);
    if(existing){
      const same=existing.exam_id===q.exam_id&&Number(existing.source_question_number)===Number(q.source_question_number);
      if(!same)throw Object.assign(new Error("شناسه canonical متعارض است: "+q.id),{status:409});
      continue;
    }
    canonicalQuestions.push(q);byId.set(q.id,q);added++;
  }
  if(batch.exam?.id&&!canonicalExams.some(x=>x.id===batch.exam.id))canonicalExams.push(batch.exam);
  const catalog=buildCatalog(canonicalQuestions,taxonomy);
  const ref=await gh(env,"/git/ref/heads/"+encodeURIComponent(c.branch));
  const baseSha=ref.object.sha,commit=await gh(env,"/git/commits/"+baseSha);
  const blobs=await Promise.all([
    createBlob(env,toJsonl(canonicalQuestions)),createBlob(env,toJsonl(canonicalExams)),createBlob(env,JSON.stringify(catalog,null,2)+"\n")
  ]);
  const tree=await gh(env,"/git/trees",{method:"POST",body:JSON.stringify({
    base_tree:commit.tree.sha,
    tree:[
      {path:"data/questions.jsonl",mode:"100644",type:"blob",sha:blobs[0]},
      {path:"data/exams.jsonl",mode:"100644",type:"blob",sha:blobs[1]},
      {path:"runtime/catalog.json",mode:"100644",type:"blob",sha:blobs[2]}
    ]
  })});
  const newCommit=await gh(env,"/git/commits",{method:"POST",body:JSON.stringify({
    message:"publish: "+batch.id+" ("+added+" questions) by "+(reviewer||"reviewer"),
    tree:tree.sha,parents:[baseSha]
  })});
  try{
    await gh(env,"/git/refs/heads/"+encodeURIComponent(c.branch),{method:"PATCH",body:JSON.stringify({sha:newCommit.sha,force:false})});
  }catch(err){
    if(err.status===409)throw Object.assign(new Error("Canonical branch هم‌زمان تغییر کرده؛ دوباره Publish را بزن."),{status:409});
    throw err;
  }
  return {published_count:added,commit_sha:newCommit.sha,total_verified:catalog.total_verified};
}
