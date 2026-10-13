/* ZH-86 | Pure, print-ready exam generator; NEVER triggers publication. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';
export function composeApprovedExam(questions,{title='آزمون',includeAnswers=false}={}){
 if(!Array.isArray(questions)||!questions.length||questions.length>200)throw Error('INVALID_EXAM_COUNT');
 if(typeof title!=='string'||title.trim().length<1||title.length>140)throw Error('INVALID_TITLE');
 const ids=new Set(),items=[];
 for(const q of questions){
  if(!q||typeof q.id!=='string'||!q.id||ids.has(q.id))throw Error('DUPLICATE_OR_MISSING_ID');
  if(q.reviewStatus!=='approved'||q.scientificPending>0||q.softDeleted||q.state==='draft'||!Number.isSafeInteger(q.revision)||q.revision<1)throw Error('QUESTION_NOT_APPROVED');
  if(typeof q.questionText!=='string'||!q.questionText.trim())throw Error('EMPTY_QUESTION');
  if(includeAnswers&&typeof q.answerText!=='string')throw Error('ANSWER_MISSING');
  ids.add(q.id);
  items.push({index:items.length+1,id:q.id,revision:q.revision,question:text(q.questionText,16000),
   ...(includeAnswers?{answer:text(q.answerText,16000)}:{})});
 }
 return {title:title.trim(),items,answersIncluded:includeAnswers,publishable:false,reviewRequired:true};
}
export function exportExamJSONL(exam){
 if(!exam?.items?.length)throw Error('EMPTY_EXAM');
 return exam.items.map(item=>JSON.stringify({number:item.index,id:item.id,revision:item.revision,question:item.question,...('answer'in item?{answer:item.answer}:{})})).join('\n')+'\n';
}
export function exportExamHTML(exam){
 if(!exam?.items?.length)throw Error('EMPTY_EXAM');
 let parts=['<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(exam.title)+'</title>',
  '<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:auto;padding:25px;line-height:2;color:#171717}h1{text-align:center}section{break-inside:avoid;margin-block:24px;border-bottom:1px solid #ddd;padding-bottom:18px;white-space:pre-wrap}aside{background:#f2f2f2;padding:12px;margin-top:15px}@media print{body{padding:0}section{break-inside:avoid}}</style></head><body><h1>'+esc(exam.title)+'</h1>'];
 for(const item of exam.items){parts.push('<section><strong>سؤال '+item.index+'</strong><div>'+esc(item.question)+'</div>');if('answer'in item)parts.push('<aside><strong>پاسخ '+item.index+'</strong><div>'+esc(item.answer)+'</div></aside>');parts.push('</section>')}
 parts.push('</body></html>');return parts.join('');
}
