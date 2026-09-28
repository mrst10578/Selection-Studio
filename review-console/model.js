import {biologyIssues} from "../studio/biology-combination.js";
import {taxonomyIssues} from "../studio/taxonomy-data.js";

export function clone(value){return structuredClone(value)}
export function questionIssues(question){
  const issues=[];
  const region=r=>r&&Number.isInteger(Number(r.page))&&Number(r.page)>0&&Array.isArray(r.bbox_norm)&&r.bbox_norm.length===4&&r.bbox_norm.every(v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1)&&Number(r.bbox_norm[2])>Number(r.bbox_norm[0])&&Number(r.bbox_norm[3])>Number(r.bbox_norm[1]);
  if(!question?.exam_id)issues.push("آزمون");
  if(!Number.isInteger(Number(question?.source_question_number))||Number(question.source_question_number)<1)issues.push("شماره");
  issues.push(...taxonomyIssues(question));
  if(!region(question?.question_regions?.[0]))issues.push("برش سؤال");
  if(!region(question?.answer_regions?.[0]))issues.push("برش پاسخ");
  if(!["level_1","level_2","level_3","level_4","level_5"].includes(question?.difficulty))issues.push("سطح سؤال");
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
  mutateQuestion(index,label,fn,reviewer=null){this.mutate(label,b=>{const before=clone(b.questions[index]);const after=fn(clone(before));const changes=Object.fromEntries(Object.keys(after).filter(key=>key!=="revision_history"&&JSON.stringify(before[key])!==JSON.stringify(after[key])).map(key=>[key,{before:clone(before[key]??null),after:clone(after[key]??null)}]));after.revision_history=[...(after.revision_history||[]),{at:new Date().toISOString(),reviewer,action:label,before_id:before.id,changes}].slice(-50);b.questions[index]=after},reviewer)}
  setStatus(index,status,reviewer,note=null,reason=null){this.mutateQuestion(index,"وضعیت "+reviewStatusLabel(status),q=>({...q,review_status:status,review_note:status==="needs_changes"?(note??q.review_note??null):(note??null),review_reason:status==="needs_changes"?(reason??q.review_reason??null):(reason??null),reviewed_by:reviewer,reviewed_at:new Date().toISOString()}),reviewer)}
  patch(index,values,reviewer){this.mutateQuestion(index,"ویرایش شناسنامه",q=>({...q,...values}),reviewer)}
  counts(){const c={pending:0,approved:0,needs_changes:0,rejected:0};for(const q of this.batch?.questions||[]){if(q.trashed_at)continue;const k=q.review_status||"pending";c[k]=(c[k]||0)+1}return c}
  firstPending(filters={}){return this.visibleIndexes(filters).find(i=>(this.batch.questions[i].review_status||"pending")==="pending")??-1}
  nextVisibleIndex(currentIndex,direction,filters={}){
    if(![-1,1].includes(Math.sign(direction)))return -1;
    const candidates=this.visibleIndexes(filters);
    return candidates.find(index=>direction>0?index>currentIndex:index<currentIndex)??-1;
  }
  visibleIndexes({status="",difficulty="",search="",incomplete=false,exam=""}={}){
    search=String(search).trim().toLowerCase();
    return (this.batch?.questions||[]).map((q,i)=>{if(q.trashed_at)return -1;if(status&&(q.review_status||"pending")!==status)return -1;if(difficulty&&q.difficulty!==difficulty)return -1;if(exam&&q.exam_id!==exam)return -1;if(search&&!String(q.id+" "+q.source_question_number).toLowerCase().includes(search))return -1;if(incomplete&&!questionIssues(q).length)return -1;return i}).filter(i=>i>=0)
  }
  undo(){const prev=this.undoStack.pop();if(!prev)return false;this.batch=prev.batch;this.onChange("Undo");return true}
}
