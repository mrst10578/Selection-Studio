import {biologyIssues} from "../studio/biology-combination.js";

export function clone(value){return structuredClone(value)}
export function questionIssues(question){
  const issues=[];
  const region=r=>r&&Number.isInteger(Number(r.page))&&Number(r.page)>0&&Array.isArray(r.bbox_norm)&&r.bbox_norm.length===4&&r.bbox_norm.every(v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1)&&Number(r.bbox_norm[2])>Number(r.bbox_norm[0])&&Number(r.bbox_norm[3])>Number(r.bbox_norm[1]);
  if(!region(question?.question_regions?.[0]))issues.push("Crop سوال");
  if(!region(question?.answer_regions?.[0]))issues.push("Crop پاسخ");
  if(!question?.chapter)issues.push("فصل");
  if(!question?.unit)issues.push(question?.subject==="BIO"?"گفتار":"مبحث");
  if(!["level_1","level_2","level_3","level_4","level_5"].includes(question?.difficulty))issues.push("Level");
  if(![1,2,3,4].includes(Number(question?.correct_option)))issues.push("کلید");
  if(question?.subject==="BIO")issues.push(...biologyIssues({subject:"BIO",combination:question.biology_combination,primaryGrade:question.grade,primaryChapter:question.chapter,primaryUnit:question.unit}).map(x=>"زیست: "+x));
  return issues;
}
export function reviewStatusLabel(value){return {pending:"بررسی‌نشده",approved:"تایید",needs_changes:"نیاز به اصلاح",rejected:"رد"}[value]||value}
export class ReviewModel{
  constructor(onChange=()=>{}){this.onChange=onChange;this.batch=null;this.selected=new Set();this.undoStack=[]}
  load(batch){this.batch=clone(batch);this.selected.clear();this.undoStack=[];this.batch.questions=(this.batch.questions||[]).map(q=>({...q,review_status:q.review_status||"pending",revision_history:q.revision_history||[]}))}
  snapshot(label){if(!this.batch)return;this.undoStack.push({label,batch:clone(this.batch)});if(this.undoStack.length>30)this.undoStack.shift()}
  mutate(label,fn,reviewer=null){if(!this.batch)return;this.snapshot(label);fn(this.batch);this.batch.updated_at=new Date().toISOString();this.batch.revisions=[...(this.batch.revisions||[]),{at:new Date().toISOString(),reviewer,action:label}].slice(-100);this.onChange(label)}
  mutateQuestion(index,label,fn,reviewer=null){this.mutate(label,b=>{const before=clone(b.questions[index]);const after=fn(clone(before));after.revision_history=[...(after.revision_history||[]),{at:new Date().toISOString(),reviewer,action:label,before_id:before.id}].slice(-50);b.questions[index]=after},reviewer)}
  setStatus(index,status,reviewer,note=null,reason=null){this.mutateQuestion(index,"وضعیت "+reviewStatusLabel(status),q=>({...q,review_status:status,review_note:note??q.review_note??null,review_reason:reason??q.review_reason??null,reviewed_by:reviewer,reviewed_at:new Date().toISOString()}),reviewer)}
  patch(index,values,reviewer){this.mutateQuestion(index,"ویرایش شناسنامه",q=>({...q,...values}),reviewer)}
  counts(){const c={pending:0,approved:0,needs_changes:0,rejected:0};for(const q of this.batch?.questions||[]){if(q.trashed_at)continue;const k=q.review_status||"pending";c[k]=(c[k]||0)+1}return c}
  firstPending(){return (this.batch?.questions||[]).findIndex(q=>!q.trashed_at&&(q.review_status||"pending")==="pending")}
  visibleIndexes({status="",difficulty="",search="",incomplete=false}={}){
    search=String(search).trim().toLowerCase();
    return (this.batch?.questions||[]).map((q,i)=>{if(q.trashed_at)return -1;if(status&&(q.review_status||"pending")!==status)return -1;if(difficulty&&q.difficulty!==difficulty)return -1;if(search&&!String(q.id+" "+q.source_question_number).toLowerCase().includes(search))return -1;if(incomplete&&!questionIssues(q).length)return -1;return i}).filter(i=>i>=0)
  }
  undo(){const prev=this.undoStack.pop();if(!prev)return false;this.batch=prev.batch;this.onChange("Undo");return true}
}
