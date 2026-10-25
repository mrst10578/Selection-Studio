import {exportExamHTML,exportExamJSONL} from '../engine/test-composer.js';
const $=id=>document.getElementById(id);
const state={bank:[],selected:[],nextCursor:null,bankFilterKey:'',bankRequestSeq:0,bankLoading:false,ready:false,composeBusy:false};
const notice=(s,error=false)=>{$('composerNotice').textContent=s;$('composerNotice').dataset.state=error?'error':'ok'};
const e=(tag,text)=>{const node=document.createElement(tag);node.textContent=text||'';return node};
async function api(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 let data;try{data=await res.json()}catch{throw Error('پاسخ API نامعتبر است')}
 if(!res.ok){const err=Error(data?.error||'اتصال برقرار نشد');err.status=res.status;throw err}return data;
}
async function safe(fn){try{await fn()}catch(error){notice(error?.status===409?'سؤال‌ها تغییر کرده‌اند یا تأییدشان منقضی شده است؛ بانک را دوباره بررسی کن.':error.message||'خطا در ساخت آزمون',true)}}
async function runComposeAction(fn){
 if(state.composeBusy)return;
 const trigger=document.activeElement;
 state.composeBusy=true;controls();
 try{await safe(fn)}finally{
  state.composeBusy=false;controls();
  // Disabling a focused action can move focus to body; restore it only if untouched.
  if(['previewExam','exportJsonl','exportHtml','printExam'].includes(trigger?.id)&&
     document.activeElement===document.body&&!trigger.disabled)trigger.focus();
 }
}
function controls(){for(const id of ['previewExam','exportJsonl','exportHtml','printExam'])$(id).disabled=!state.selected.length||state.composeBusy}
function render(){
 const available=$('approvedList');available.replaceChildren();
 available.setAttribute('aria-busy',String(state.bankLoading));
 const more=$('loadMoreBank');more.hidden=!state.nextCursor;more.disabled=state.bankLoading||!state.nextCursor;
 $('loadBank').disabled=!state.ready||state.bankLoading;
 if(!state.bank.length)available.append(e('p',state.bankLoading?'در حال دریافت سؤال‌ها…':'سؤال تأییدشده‌ای با این جست‌وجو پیدا نشد.'));
 for(const [index,question] of state.bank.entries()){
  const selected=state.selected.some(x=>x.id===question.id);
  const row=e('button',(selected?'✓ ':'+ ')+'سؤال '+(question.sourceNumber||'?')+' · '+question.questionText.slice(0,100));
  row.type='button';row.setAttribute('aria-pressed',String(selected));
  row.addEventListener('click',()=>{
   if(selected)state.selected=state.selected.filter(x=>x.id!==question.id);
   else if(state.selected.length<100)state.selected.push(question);
   else{notice('هر آزمون حداکثر ۱۰۰ سؤال دارد',true);return}
   render();
   // Rebuilding the list removes the clicked button; restore keyboard focus.
   available.querySelectorAll('button')[index]?.focus();
  });available.append(row);
 }
 const list=$('selectedList');list.replaceChildren();
 if(!state.selected.length)list.append(e('p','هنوز سؤالی انتخاب نشده است.'));
 state.selected.forEach((question,i)=>{
  const row=e('div','');row.className='bank-result composer-selection';
  row.append(e('span',(i+1)+'. '+question.questionText.slice(0,110)));
  const buttons=e('div','');buttons.className='bank-actions';
  for(const [label,move] of [['بالا',-1],['پایین',1]]){
   const button=e('button',label);button.type='button';button.disabled=i+move<0||i+move>=state.selected.length;
   button.addEventListener('click',()=>{
    const target=i+move;
    const copy=[...state.selected];[copy[i],copy[target]]=[copy[target],copy[i]];state.selected=copy;render();
    // Keep focus with the moved question, even when its move button becomes disabled at an edge.
    const movedButtons=list.querySelectorAll('.composer-selection')[target]?.querySelectorAll('button');
    const preferred=movedButtons?.[move===-1?0:1];
    const fallback=movedButtons?.[move===-1?1:0];
    (preferred&&!preferred.disabled?preferred:fallback)?.focus();
   });buttons.append(button);
  }
  const remove=e('button','حذف');remove.type='button';
  remove.addEventListener('click',()=>{
   state.selected=state.selected.filter(x=>x.id!==question.id);render();
   // A removed button no longer exists: focus the next removal action, then the previous one.
   const remaining=list.querySelectorAll('.composer-selection');
   if(remaining.length){
    remaining[Math.min(i,remaining.length-1)].querySelectorAll('button')[2]?.focus();
   }else{
    // When the selection becomes empty, return to its bank entry (or the search control).
    const bankIndex=state.bank.findIndex(x=>x.id===question.id);
    const bankButton=bankIndex>=0?available.querySelectorAll('button')[bankIndex]:null;
    (bankButton||$('loadBank')).focus();
   }
  });
  buttons.append(remove);row.append(buttons);list.append(row);
 });
 const count=$('composerSelectionCount');
 const message=new Intl.NumberFormat('fa-IR').format(state.selected.length)+' سؤال انتخاب شده است.';
 // Announce changes only: unrelated re-renders must not repeat the screen-reader message.
 if(count.textContent!==message)count.textContent=message;
 controls();
}
const currentBankFilter=()=>JSON.stringify([$('composerProject').value,$('composerQuery').value.trim()]);
function invalidateBankSearch(){
 ++state.bankRequestSeq;state.bank=[];state.nextCursor=null;state.bankFilterKey='';state.bankLoading=false;
 render();
}
async function loadBank(append=false){
 const project=$('composerProject').value,query=$('composerQuery').value.trim(),key=currentBankFilter();
 const cursor=append&&state.bankFilterKey===key?state.nextCursor:null;
 if(append&&!cursor)return;
 const seq=++state.bankRequestSeq;
 // Preserve keyboard navigation when the focused pagination control disappears.
 const focusFromMore=append&&document.activeElement===$('loadMoreBank');
 // A keyboard-triggered refresh disables its own button; recover focus after the results arrive.
 const focusFromSearch=!append&&document.activeElement===$('loadBank');
 const previousCount=state.bank.length;
 state.bankLoading=true;state.bankFilterKey=key;
 if(!append){state.bank=[];state.nextCursor=null}
 notice(append?'در حال بارگذاری سؤال‌های بیشتر…':'در حال جست‌وجوی سؤال‌های تأییدشده…');
 render();
 const qs=new URLSearchParams();
 if(project)qs.set('projectId',project);if(query)qs.set('q',query);
 if(cursor)qs.set('cursor',cursor);
 let result;
 try{result=await api('/api/v1/bank/questions?'+qs)}
 catch(error){
  if(seq!==state.bankRequestSeq)return;
  state.bankLoading=false;render();
  // Failed requests must also restore the keyboard trigger without stealing moved focus.
  if((focusFromSearch||focusFromMore)&&
     (document.activeElement===document.body||document.activeElement===$('loadBank')||document.activeElement===$('loadMoreBank'))){
   (focusFromMore&&!$('loadMoreBank').hidden?$('loadMoreBank'):$('loadBank')).focus();
  }
  throw error;
 }
 if(seq!==state.bankRequestSeq||key!==currentBankFilter())return;
 const incoming=Array.isArray(result.questions)?result.questions:[];
 const seen=new Set(append?state.bank.map(x=>x.id):[]);
 state.bank=append?[...state.bank,...incoming.filter(x=>!seen.has(x.id))]:incoming;
 state.nextCursor=typeof result.nextCursor==='string'&&result.nextCursor?result.nextCursor:null;
 // Selected questions survive pagination and text filters, but not project switches.
 state.selected=state.selected.filter(x=>!project||x.projectId===project);
 state.bankLoading=false;render();
 // Do not override focus if the operator moved to another control while the request was pending.
 if(focusFromSearch&&(document.activeElement===document.body||document.activeElement===$('loadBank'))){
  ($('approvedList').querySelector('button')||$('loadBank')).focus();
 }
 if(focusFromMore&&(document.activeElement===document.body||document.activeElement===$('loadMoreBank'))){
  const firstNew=$('approvedList').querySelectorAll('button')[previousCount];
  const more=$('loadMoreBank');
  (firstNew||(!more.hidden?more:$('loadBank'))).focus();
 }
 notice(state.bank.length+' سؤال تأییدشده در فهرست است.'+(state.nextCursor?' برای موارد قدیمی‌تر «نمایش سؤال‌های بیشتر» را بزن.':'')+' پیش از خروجی دوباره در سرور بررسی می‌شوند.');
}
async function manifest(){
 if(!state.selected.length)throw Error('سؤالی انتخاب نشده است');
 const data=await api('/api/v1/bank/exams/compose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  title:$('examTitle').value,includeAnswers:$('includeExamAnswers').checked,
  questionIds:state.selected.map(x=>x.id),sourceRevisions:state.selected.map(x=>x.revision)
 })});
 if(data.status!=='draft_export_only'||data.manifest?.publishable!==false)throw Error('سرور خروجی امن برنگرداند');
 if(data.manifestHash!==undefined&&!/^[a-f0-9]{64}$/i.test(data.manifestHash))throw Error('شناسه نسخه خروجی نامعتبر است');
 $('examFingerprint').textContent=data.manifestHash?'اثر انگشت نسخه ثبت‌شده: '+data.manifestHash:'خروجی آزمایشی فاقد شناسه سرور';
 return data.manifestHash?{...data.manifest,fingerprint:data.manifestHash}:data.manifest;
}
function download(text,name,type){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('loadBank').addEventListener('click',()=>void safe(()=>loadBank()));
$('loadMoreBank').addEventListener('click',()=>void safe(()=>loadBank(true)));
$('composerQuery').addEventListener('input',()=>{invalidateBankSearch();notice('عبارت جست‌وجو تغییر کرد؛ برای دریافت نتایج جدید «جست‌وجو و بازخوانی» را بزن.');});
$('composerProject').addEventListener('change',()=>{state.selected=[];invalidateBankSearch();void safe(()=>loadBank())});
$('previewExam').addEventListener('click',()=>void runComposeAction(async()=>{
 const exam=await manifest(),host=$('examPreviewPaper');host.replaceChildren();
 host.append(e('h2',exam.title));
 for(const question of exam.items){
  const section=e('section','');section.append(e('strong','سؤال '+question.index),e('p',question.question));
  if('answer'in question)section.append(e('p','پاسخ: '+question.answer));host.append(section);
 }
 $('examPreviewDialog').showModal();notice('پیش‌نمایش بدون انتشار ساخته شد.');
}));
$('closeExamPreview').addEventListener('click',()=>$('examPreviewDialog').close());
$('exportJsonl').addEventListener('click',()=>void runComposeAction(async()=>{
 download(exportExamJSONL(await manifest()),'examforge-exam.jsonl','application/x-ndjson;charset=utf-8');
 notice('خروجی JSONL ساخته شد. هیچ انتشار خارجی انجام نشد.');
}));
$('exportHtml').addEventListener('click',()=>void runComposeAction(async()=>{
 download(exportExamHTML(await manifest()),'examforge-exam.html','text/html;charset=utf-8');
 notice('فایل HTML آماده شد. هیچ انتشار خارجی انجام نشد.');
}));
$('printExam').addEventListener('click',()=>{
 if(state.composeBusy)return;
 // Capture the keyboard trigger before opening a popup can move focus away.
 const printTrigger=document.activeElement===$('printExam')?$('printExam'):null;
 const windowRef=window.open('','_blank');
 if(!windowRef){notice('مرورگر پنجره چاپ را مسدود کرده است. از خروجی HTML استفاده کن.',true);return}
 void runComposeAction(async()=>{
  try{
   const html=exportExamHTML(await manifest());
   windowRef.document.open();windowRef.document.write(html);windowRef.document.close();windowRef.focus();
   // A fast load event and the fallback timer must never open two print dialogs.
   let printRequested=false;
   const printOnce=()=>{
    if(printRequested||windowRef.closed)return;
    printRequested=true;
    try{windowRef.print()}catch{}
   };
   windowRef.addEventListener('load',printOnce,{once:true});
   setTimeout(printOnce,500);
   notice('پنجره چاپ باز شد؛ برای ساخت PDF گزینه ذخیره PDF را انتخاب کن.');
  }catch(err){
   windowRef.close();
   // Once a failed popup closes, return keyboard focus only if the operator did not move it.
   setTimeout(()=>{
    if(printTrigger&&document.activeElement===document.body&&!printTrigger.disabled)printTrigger.focus();
   },0);
   throw err;
  }
 });
});
void safe(async()=>{
 const session=await api('/api/session');if(session.role!=='operator')throw Error('ورود به حساب اپراتور لازم است');
 const projects=await api('/api/v1/projects');
 const select=$('composerProject');select.replaceChildren(new Option('همه پروژه‌های خودم',''));
 for(const p of projects.projects||[])select.add(new Option(p.name,p.id));
 select.disabled=false;state.ready=true;await loadBank();
});
