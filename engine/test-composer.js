/* ZH-86 | Pure, print-ready exam generator; NEVER triggers publication. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function composeApprovedExam(questions,{title='آزمون',includeAnswers=false}={}){
 if(!Array.isArray(questions)||!questions.length||questions.length>200)throw Error('INVALID_EXAM_COUNT');
 if(typeof title!=='string'||title.trim().length<1||title.length>140)throw Error('INVALID_TITLE');
 const ids=new Set(),items=[];
 for(const q of questions){
  if(!q||typeof q.id!=='string'||!q.id||ids.has(q.id))throw Error('DUPLICATE_OR_MISSING_ID');
  if(q.reviewStatus!=='approved'||q.scientificPending>0||q.softDeleted||q.state==='draft'||!Number.isSafeInteger(q.revision)||q.revision<1)throw Error('QUESTION_NOT_APPROVED');
  if(typeof q.questionText!=='string'||!q.questionText.trim())throw Error('EMPTY_QUESTION');
  if(q.questionText.length>16000)throw Error('QUESTION_TOO_LONG');
  if(includeAnswers&&typeof q.answerText!=='string')throw Error('ANSWER_MISSING');
  if(includeAnswers&&q.answerText.length>16000)throw Error('ANSWER_TOO_LONG');
  ids.add(q.id);
  items.push({index:items.length+1,id:q.id,revision:q.revision,question:q.questionText,
   ...(includeAnswers?{answer:q.answerText}:{})});
 }
 return {title:title.trim(),items,answersIncluded:includeAnswers,publishable:false,reviewRequired:true};
}
export function exportExamJSONL(exam){
 if(!exam?.items?.length)throw Error('EMPTY_EXAM');
 return exam.items.map(item=>JSON.stringify({number:item.index,id:item.id,revision:item.revision,question:item.question,...('answer'in item?{answer:item.answer}:{})})).join('\n')+'\n';
}
export function exportExamHTML(exam){
 if(!exam?.items?.length)throw Error('EMPTY_EXAM');
 const head='<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(exam.title)+'</title>';
 const css='<style>@page{size:A4;margin:18mm 17mm}body{font-family:Tahoma,Arial,sans-serif;margin:auto;max-width:180mm;color:#171717;line-height:1.9}h1{text-align:center;font-size:22px;margin:0 0 25px}h2{font-size:18px}.question{break-inside:avoid;page-break-inside:avoid;border-bottom:1px solid #ddd;padding:0 0 17px;margin:0 0 24px;white-space:pre-wrap}.question strong{display:block;margin-bottom:10px}.answer-key{break-before:page;page-break-before:always;display:block;border-top:1px solid #aaa;padding-top:15px}.answer{break-inside:avoid;page-break-inside:avoid;margin:16px 0;border-bottom:1px dashed #bbb;padding-bottom:12px;white-space:pre-wrap}.review-note{font-size:11px;color:#555;border-top:1px solid #ddd;margin-top:28px;padding-top:8px}@media print{body{max-width:none}.question{break-inside:avoid}.answer-key{break-before:page}}</style>';
 const parts=[head,css,'</head><body><main><h1>'+esc(exam.title)+'</h1>'];
 const answers=[];
 for(const item of exam.items){
  if(!Number.isSafeInteger(item.index)||item.index<1||typeof item.question!=='string')throw Error('INVALID_EXAM_ITEM');
  parts.push('<section class="question"><strong>سؤال '+item.index+'</strong><div>'+esc(item.question)+'</div></section>');
  if('answer'in item)answers.push('<section class="answer"><strong>پاسخ '+item.index+'</strong><div>'+esc(item.answer)+'</div></section>');
 }
 if(answers.length)parts.push('<section class="answer-key"><h2>پاسخنامه · '+esc(exam.title)+'</h2>',...answers,'</section>');
 parts.push('<footer class="review-note">نسخه چاپی خصوصی برای بازبینی اپراتور؛ انتشار عمومی انجام نشده است.</footer></main></body></html>');
 return parts.join('');
}
