import {loadRecords,saveRecords,loadExamDraft} from "../studio/store.js";
import {getPreview} from "../studio/preview-db.js";

function activeQuestions(records){return records.filter(q=>!q.trashed_at)}
function localStatus(questions){
  const active=activeQuestions(questions);
  if(active.length&&active.every(q=>(q.review_status||"pending")==="rejected"))return "rejected";
  if(active.length&&active.every(q=>["approved","rejected"].includes(q.review_status||"pending")))return "completed";
  return "pending";
}
function groups(){
  const map=new Map();
  for(const record of loadRecords()){
    if(record.trashed_at)continue;
    const id=record.exam_id||"UNKNOWN";
    if(!map.has(id))map.set(id,[]);
    map.get(id).push(record);
  }
  return [...map.entries()].map(([id,questions])=>({id,questions}));
}
function examFor(id){
  const draft=loadExamDraft();
  return draft?.id===id?draft:{id};
}
function batchFromGroup(group){
  const questions=group.questions.map((q,index)=>({
    ...q,
    submission_order:q.submission_order||index+1,
    review_status:q.review_status||"pending",
    revision_history:q.revision_history||[]
  }));
  return {
    schema_version:3,
    id:group.id,
    status:localStatus(questions),
    created_at:questions[0]?.created_at||new Date().toISOString(),
    updated_at:new Date().toISOString(),
    submitted_by:questions[0]?.entered_by||"admin",
    exam:examFor(group.id),
    questions,
    review:{reviewed_by:null,reviewed_at:null,note:null},
    revisions:[]
  };
}
function saveBatchLocally(batch){
  const incoming=new Map((batch.questions||[]).map(q=>[q.id,q]));
  const next=loadRecords().map(record=>incoming.has(record.id)?{...record,...incoming.get(record.id)}:record);
  saveRecords(next);
  return batch;
}

export function createLocalReviewApi(){
  return {
    async list(status="pending"){
      return groups().map(group=>{
        const batch=batchFromGroup(group);
        const active=activeQuestions(batch.questions);
        const reviewed=active.filter(q=>(q.review_status||"pending")!=="pending").length;
        return {
          id:batch.id,
          exam_id:batch.exam?.id||batch.id,
          exam_label:batch.exam?.provider?batch.exam.provider+(batch.exam.date?" — "+batch.exam.date:""):batch.id,
          question_count:active.length,
          reviewed_count:reviewed,
          submitted_by:batch.submitted_by,
          status:batch.status
        };
      }).filter(item=>item.status===status);
    },
    async batch(_status,id){
      const group=groups().find(x=>x.id===id);
      if(!group)throw new Error("Batch محلی پیدا نشد.");
      return batchFromGroup(group);
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
      const records=loadRecords();
      let published=0;
      const now=new Date().toISOString();
      const next=records.map(q=>{
        if(q.exam_id!==batchId||q.trashed_at||(q.review_status||"pending")!=="approved")return q;
        published++;
        return {...q,status:"published",published_at:now,published_by:reviewer||"admin"};
      });
      saveRecords(next);
      return {published_count:published};
    },
    async reject(batchId,reviewer,note=null){
      const now=new Date().toISOString();
      saveRecords(loadRecords().map(q=>q.exam_id===batchId&&!q.trashed_at?{...q,review_status:"rejected",reviewed_by:reviewer||"admin",reviewed_at:now,review_note:note}:q));
      return {ok:true};
    },
    async restore(batchId){
      saveRecords(loadRecords().map(q=>q.exam_id===batchId&&!q.trashed_at?{...q,review_status:"pending",review_note:null,review_reason:null}:q));
      return {ok:true};
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
