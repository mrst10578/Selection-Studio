import {exportExamHTML,exportExamJSONL} from '../engine/test-composer.js';
const $=id=>document.getElementById(id);
const state={bank:[],selected:[]};
const notice=(s,error=false)=>{$('composerNotice').textContent=s;$('composerNotice').dataset.state=error?'error':'ok'};
const e=(tag,text)=>{const node=document.createElement(tag);node.textContent=text||'';return node};
async function api(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 let data;try{data=await res.json()}catch{throw Error('پاسخ API نامعتبر است')}
 if(!res.ok){const err=Error(data?.error||'اتصال برقرار نشد');err.status=res.status;throw err}return data;
}
async function safe(fn){try{await fn()}catch(error){notice(error?.status===409?'سؤال‌ها تغییر کرده‌اند یا تأییدشان منقضی شده است؛ بانک را دوباره بررسی کن.':error.message||'خطا در ساخت آزمون',true)}}
function controls(){for(const id of ['previewExam','exportJsonl','exportHtml','printExam'])$(id).disabled=!state.selected.length}
function render(){
 const available=$('approvedList');available.replaceChildren();
 if(!state.bank.length)available.append(e('p','سؤال تأییدشده‌ای با این جست‌وجو پیدا نشد.'));
 for(const question of state.bank){
  const selected=state.selected.some(x=>x.id===question.id);
  const row=e('button',(selected?'✓ ':'+ ')+'سؤال '+(question.sourceNumber||'?')+' · '+question.questionText.slice(0,100));
  row.type='button';row.setAttribute('aria-pressed',String(selected));
  row.addEventListener('click',()=>{
   if(selected)state.selected=state.selected.filter(x=>x.id!==question.id);
   else if(state.selected.length<100)state.selected.push(question);
   else{notice('هر آزمون حداکثر ۱۰۰ سؤال دارد',true);return}
   render();
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
    const copy=[...state.selected];[copy[i],copy[i+move]]=[copy[i+move],copy[i]];state.selected=copy;render()
   });buttons.append(button);
  }
  const remove=e('button','حذف');remove.type='button';
  remove.addEventListener('click',()=>{state.selected=state.selected.filter(x=>x.id!==question.id);render()});
  buttons.append(remove);row.append(buttons);list.append(row);
 });
 controls();
}
async function loadBank(){
 const project=$('composerProject').value,query=$('composerQuery').value;
 const qs=new URLSearchParams();
 if(project)qs.set('projectId',project);if(query.trim())qs.set('q',query.trim());
 const result=await api('/api/v1/bank/questions?'+qs);
 state.bank=result.questions||[];
 const ids=new Set(state.bank.map(x=>x.id));
 // Previously selected items may be from another filter; preserve only in same project.
 state.selected=state.selected.filter(x=>(!project||x.projectId===project));
 render();notice(state.bank.length+' سؤال دارای تأیید علمی معتبر در نتیجه جست‌وجو است. پیش از خروجی دوباره در سرور بررسی می‌شوند.');
}
async function manifest(){
 if(!state.selected.length)throw Error('سؤالی انتخاب نشده است');
 const data=await api('/api/v1/bank/exams/compose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  title:$('examTitle').value,includeAnswers:$('includeExamAnswers').checked,
  questionIds:state.selected.map(x=>x.id),sourceRevisions:state.selected.map(x=>x.revision)
 })});
 if(data.status!=='draft_export_only'||data.manifest?.publishable!==false)throw Error('سرور خروجی امن برنگرداند');
 return data.manifest;
}
function download(text,name,type){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('loadBank').addEventListener('click',()=>void safe(loadBank));
$('composerProject').addEventListener('change',()=>{state.selected=[];void safe(loadBank)});
$('previewExam').addEventListener('click',()=>void safe(async()=>{
 const exam=await manifest(),host=$('examPreviewPaper');host.replaceChildren();
 host.append(e('h2',exam.title));
 for(const question of exam.items){
  const section=e('section','');section.append(e('strong','سؤال '+question.index),e('p',question.question));
  if('answer'in question)section.append(e('p','پاسخ: '+question.answer));host.append(section);
 }
 $('examPreviewDialog').showModal();notice('پیش‌نمایش بدون انتشار ساخته شد.');
}));
$('closeExamPreview').addEventListener('click',()=>$('examPreviewDialog').close());
$('exportJsonl').addEventListener('click',()=>void safe(async()=>{
 download(exportExamJSONL(await manifest()),'examforge-exam.jsonl','application/x-ndjson;charset=utf-8');
 notice('خروجی JSONL ساخته شد. هیچ انتشار خارجی انجام نشد.');
}));
$('exportHtml').addEventListener('click',()=>void safe(async()=>{
 download(exportExamHTML(await manifest()),'examforge-exam.html','text/html;charset=utf-8');
 notice('فایل HTML آماده شد. هیچ انتشار خارجی انجام نشد.');
}));
$('printExam').addEventListener('click',()=>{
 const windowRef=window.open('','_blank');
 if(!windowRef){notice('مرورگر پنجره چاپ را مسدود کرده است. از خروجی HTML استفاده کن.',true);return}
 void safe(async()=>{
  try{
   const html=exportExamHTML(await manifest());
   windowRef.document.open();windowRef.document.write(html);windowRef.document.close();windowRef.focus();
   windowRef.addEventListener('load',()=>windowRef.print(),{once:true});
   setTimeout(()=>{try{windowRef.print()}catch{}},500);
   notice('پنجره چاپ باز شد؛ برای ساخت PDF گزینه ذخیره PDF را انتخاب کن.');
  }catch(err){windowRef.close();throw err}
 });
});
void safe(async()=>{
 const session=await api('/api/session');if(session.role!=='operator')throw Error('ورود به حساب اپراتور لازم است');
 const projects=await api('/api/v1/projects');
 const select=$('composerProject');select.replaceChildren(new Option('همه پروژه‌های خودم',''));
 for(const p of projects.projects||[])select.add(new Option(p.name,p.id));
 select.disabled=false;$('loadBank').disabled=false;await loadBank();
});
