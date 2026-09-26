import {safeSegment} from "./github.js";

export const INTAKE_STATUSES=new Set(["pending","approved","rejected"]);
export const REVIEW_STATUSES=new Set(["pending","approved","needs_changes","rejected"]);
export const DIFFICULTIES=new Set(["level_1","level_2","level_3","level_4","level_5"]);

export function intakePath(status,batchId){return "data/intake/"+normalizeIntakeStatus(status)+"/"+safeSegment(batchId,"batch id")+".json"}
export function lockPath(batchId){return "ops/review-locks/"+safeSegment(batchId,"batch id")+".json"}
export function questionPath(batchId,questionId){return "data/questions.d/approved/"+safeSegment(batchId,"batch id")+"/"+safeSegment(questionId,"question id")+".jsonl"}
export function examPath(examId){return "data/exams.d/approved/"+safeSegment(examId,"exam id")+".jsonl"}
export function assetPath(batchId,questionId,kind){if(!["question","answer"].includes(kind))throw new Error("invalid source kind");return "data/intake/assets/"+safeSegment(batchId,"batch id")+"/"+safeSegment(questionId,"question id")+"-"+kind+".webp"}

export function normalizeIntakeStatus(value){
  const status=String(value||"").toLowerCase();
  if(!INTAKE_STATUSES.has(status)){const e=new Error("invalid intake status");e.status=400;throw e}
  return status;
}
export function validRegion(region){
  if(!region||!Number.isInteger(Number(region.page))||Number(region.page)<1)return false;
  const b=region.bbox_norm;
  return Array.isArray(b)&&b.length===4&&b.every(v=>typeof v==="number"&&v>=0&&v<=1)&&b[0]<b[2]&&b[1]<b[3];
}
export function validBiologyCombination(question){
  if(question?.subject!=="BIO")return true;
  const combo=question?.biology_combination;
  if(!combo||typeof combo.is_combined!=="boolean"||!Array.isArray(combo.topics))return false;
  if(!combo.is_combined)return combo.topics.length===0;
  if(!combo.topics.length)return false;
  const primary=`${Number(question.grade)}:${String(question.chapter||"")}:${String(question.unit||"")}`;
  const seen=new Set();
  for(const topic of combo.topics){
    if(![10,11,12].includes(Number(topic?.grade)))return false;
    if(!/^(0[1-9]|1[0-2])$/.test(String(topic?.chapter||"")))return false;
    if(!/^0[1-8]$/.test(String(topic?.unit||"")))return false;
    const key=`${Number(topic.grade)}:${topic.chapter}:${topic.unit}`;
    if(key===primary||seen.has(key))return false;
    seen.add(key);
  }
  return true;
}
export function questionReady(question){
  return Boolean(
    question&&
    Number.isInteger(Number(question.source_question_number))&&Number(question.source_question_number)>0&&
    ["BIO","MATH","PHY","CHEM"].includes(question.subject)&&
    [10,11,12].includes(Number(question.grade))&&
    question.question_regions?.length&&question.question_regions.every(validRegion)&&
    question.answer_regions?.length&&question.answer_regions.every(validRegion)&&
    String(question.chapter||"").trim()&&String(question.unit||"").trim()&&
    DIFFICULTIES.has(question.difficulty)&&
    [1,2,3,4].includes(Number(question.correct_option))&&
    validBiologyCombination(question)
  );
}
export function validateBatch(batch,{requireReady=false,forPublish=false}={}){
  if(!batch||typeof batch!=="object"){const e=new Error("batch is required");e.status=400;throw e}
  safeSegment(batch.id,"batch id");
  if(!batch.exam?.id)throw new Error("batch.exam is required");
  safeSegment(batch.exam.id,"exam id");
  if(!Array.isArray(batch.questions)||!batch.questions.length)throw new Error("batch.questions must not be empty");
  if(batch.questions.length>500)throw new Error("batch is too large");
  const ids=new Set();
  for(const q of batch.questions){
    safeSegment(q.id,"question id");
    if(ids.has(q.id))throw new Error("duplicate question id: "+q.id);ids.add(q.id);
    if(q.exam_id!==batch.exam.id)throw new Error(q.id+": exam_id mismatch");
    if(!["BIO","MATH","PHY","CHEM"].includes(q.subject))throw new Error(q.id+": invalid subject");
    if(![10,11,12].includes(Number(q.grade)))throw new Error(q.id+": invalid grade");
    if(!DIFFICULTIES.has(q.difficulty))throw new Error(q.id+": invalid Level");
    const rs=q.review_status||"pending";
    if(!REVIEW_STATUSES.has(rs))throw new Error(q.id+": invalid review_status");
    if(requireReady&&!questionReady(q))throw new Error(q.id+": question did not pass Quality Gate");
    if(forPublish&&rs==="approved"&&!questionReady(q))throw new Error(q.id+": approved question did not pass Quality Gate");
  }
  return true;
}
export function summarizeBatch(batch){
  const qs=batch.questions||[],reviewed=qs.filter(q=>(q.review_status||"pending")!=="pending").length;
  const flags=[];
  if(qs.some(q=>q.review_status==="needs_changes"))flags.push("needs_changes");
  if(qs.some(q=>q.duplicate_candidates?.length))flags.push("duplicates");
  if(qs.some(q=>!questionReady(q)))flags.push("incomplete");
  return {
    id:batch.id,status:batch.status||"pending",exam_id:batch.exam?.id||null,
    exam_label:batch.exam?.provider&&batch.exam?.date?batch.exam.provider+" — "+batch.exam.date:(batch.exam?.id||null),
    submitted_by:batch.submitted_by||null,question_count:qs.length,reviewed_count:reviewed,
    created_at:batch.created_at||null,updated_at:batch.updated_at||null,reviewed_by:batch.review?.reviewed_by||null,flags
  };
}
export function lockExpired(lock){return !lock?.expires_at||Date.parse(lock.expires_at)<=Date.now()}
export function makeLock(batchId,reviewer){const now=Date.now();return {batch_id:batchId,reviewer,acquired_at:new Date(now).toISOString(),expires_at:new Date(now+5*60*1000).toISOString()}}
