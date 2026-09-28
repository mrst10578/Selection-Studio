import {loadRecords,saveRecords} from "../studio/store.js";
import {getPreview} from "../studio/preview-db.js";
import {questionIssues} from "./model.js";

const operatorName=record=>String(record?.entered_by||"legacy").trim()||"legacy";
const scopedId=(subject,username)=>"LOCAL::"+subject+"::"+encodeURIComponent(username);
function parseScope(id){
  const match=String(id||"").match(/^LOCAL::([^:]+)::(.+)$/);
  return match?{subject:match[1],username:decodeURIComponent(match[2])}:null;
}
function scopedRecords(subject,username){
  return loadRecords().filter(record=>!record.trashed_at&&record.subject===subject&&operatorName(record)===username);
}
function saveBatchLocally(batch){
  const incoming=new Map((batch.questions||[]).map(q=>[q.id,q]));
  saveRecords(loadRecords().map(record=>incoming.has(record.id)?{...record,...incoming.get(record.id)}:record));
  return batch;
}
function batchFor(subject,username){
  const questions=scopedRecords(subject,username).map((q,index)=>({
    ...q,
    submission_order:q.submission_order||index+1,
    review_status:q.review_status||"pending",
    revision_history:q.revision_history||[]
  }));
  return {
    schema_version:3,
    id:scopedId(subject,username),
    status:"local",
    created_at:questions[0]?.created_at||new Date().toISOString(),
    updated_at:new Date().toISOString(),
    submitted_by:username,
    subject,
    username,
    exam:{id:"ALL-"+subject},
    questions,
    review:{reviewed_by:null,reviewed_at:null,note:null},
    revisions:[]
  };
}

export function createLocalReviewApi(){
  return {
    async operators(subject){
      const counts=new Map();
      for(const record of loadRecords()){
        if(record.trashed_at||record.subject!==subject)continue;
        const username=operatorName(record);
        const current=counts.get(username)||{username,total:0,pending:0,approved:0,needs_changes:0,rejected:0};
        current.total++;
        const status=record.review_status||"pending";
        current[status]=(current[status]||0)+1;
        counts.set(username,current);
      }
      return [...counts.values()].sort((a,b)=>a.username.localeCompare(b.username,"fa"));
    },
    async batch(subject,username){
      const batch=batchFor(subject,username);
      if(!batch.questions.length)throw new Error("برای این گزینشگر تستی در این درس پیدا نشد.");
      return batch;
    },
    async save(batch){
      saveBatchLocally(batch);
      return {ok:true,batch};
    },
    async source(_batchId,questionId,kind){
      const blob=await getPreview(questionId+":"+kind);
      if(!blob)throw new Error("Preview در دسترس نیست.");
      return blob;
    },
    async publish(batchId,reviewer){
      const scope=parseScope(batchId);
      if(!scope)throw new Error("محدوده گزینشگر نامعتبر است.");
      let published=0,skippedMissingSource=0;
      const now=new Date().toISOString(),next=[];
      for(const q of loadRecords()){
        if(q.trashed_at||q.subject!==scope.subject||operatorName(q)!==scope.username||(q.review_status||"pending")!=="approved"||q.status==="published"||questionIssues(q).length){next.push(q);continue}
        const [questionPreview,answerPreview]=await Promise.all([getPreview(q.id+":question"),getPreview(q.id+":answer")]);
        if(!questionPreview||!answerPreview){skippedMissingSource++;next.push(q);continue}
        published++;
        next.push({...q,status:"published",published_at:now,published_by:reviewer||"admin"});
      }
      saveRecords(next);
      return {published_count:published,skipped_missing_source:skippedMissingSource};
    },
    async lock(){return {ok:true}},
    async unlock(){return {ok:true}}
  };
}

// Worker-backed API kept for the later backend phase.
export function createReviewApi({getWorkerUrl,getAdminKey}){
  async function request(path,{method="GET",body}={}){
    const base=String(getWorkerUrl()||"").replace(/\/$/,"");
    if(!base)throw new Error("Worker URL تنظیم نشده است.");
    const response=await fetch(base+path,{method,headers:{"content-type":"application/json","x-testbank-admin-key":getAdminKey()||""},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!response.ok)throw new Error(typeof data==="string"?data:(data?.error||("HTTP "+response.status)));
    return data;
  }
  async function source(batchId,questionId,kind){
    const base=String(getWorkerUrl()||"").replace(/\/$/,"");
    const url=base+"/studio/admin/source?batch_id="+encodeURIComponent(batchId)+"&question_id="+encodeURIComponent(questionId)+"&kind="+encodeURIComponent(kind);
    const response=await fetch(url,{headers:{"x-testbank-admin-key":getAdminKey()||""}});
    if(!response.ok)throw new Error((await response.text())||("HTTP "+response.status));
    return response.blob();
  }
  return {
    source,
    list:status=>request("/studio/admin/list?status="+encodeURIComponent(status)),
    batch:(status,id)=>request("/studio/admin/batch?status="+encodeURIComponent(status)+"&id="+encodeURIComponent(id)),
    save:batch=>request("/studio/admin/save",{method:"POST",body:{batch}}),
    publish:(batchId,reviewer)=>request("/studio/admin/publish",{method:"POST",body:{batch_id:batchId,reviewer}}),
    reject:(batchId,reviewer,note)=>request("/studio/admin/reject",{method:"POST",body:{batch_id:batchId,reviewer,note}}),
    restore:(batchId,reviewer)=>request("/studio/admin/restore",{method:"POST",body:{batch_id:batchId,reviewer}}),
    lock:(batchId,reviewer)=>request("/studio/admin/lock",{method:"POST",body:{batch_id:batchId,reviewer}}),
    unlock:(batchId,reviewer)=>request("/studio/admin/unlock",{method:"POST",body:{batch_id:batchId,reviewer}})
  };
}
