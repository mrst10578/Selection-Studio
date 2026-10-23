import {parseNumberedBlocks,matchExamAnswers,explicitMatchReview} from '../engine/answer-matcher.js';
const $=id=>document.getElementById(id);
const state={operator:'',project:'',snapshot:null,reviewed:new Set(),imported:new Set(),importing:false};
const note=(text,error=false)=>{$('importNotice').textContent=text;$('importNotice').dataset.state=error?'error':'ok'};
const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e};
async function api(path,opts={}){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...opts});
 let data;try{data=await r.json()}catch{throw Error('پاسخ API خوانا نیست')}
 if(!r.ok){const e=Error(data?.error||'خطا در اتصال به بانک سؤال');e.status=r.status;throw e}return data;
}
async function safely(fn){try{await fn()}catch(e){note(e?.message==='ASSET_STORAGE_NOT_CONFIGURED'?'اتصال R2 هنوز فعال نیست. ورود پیش‌نویس فعلاً متوقف است.':e.message||'خطا',true)}}
const path=()=>'/api/v1/projects/'+state.project;
// Preserve successfully imported keys across re-analysis and project switches during this page session.
function reset(){state.snapshot=null;state.reviewed.clear();$('matchList').replaceChildren();$('importDrafts').disabled=true}
// Import deduplication is scoped to the exact reviewed question and source, not a global number.
function importKey(number){
 const match=state.snapshot?.matches.find(item=>item.number===number);
 return JSON.stringify([state.project,$('importSource').value,number,match?.question,match?.answer]);
}
function ready(){
 $('importDrafts').disabled=state.importing||!state.project||!/^[a-f0-9]{64}$/i.test($('importSource').value)||![...state.reviewed].some(n=>!state.imported.has(importKey(n)));
}
let sourcesGeneration=0;
async function sources(){
 const generation=++sourcesGeneration,project=state.project;
 const selection=$('importSource');selection.replaceChildren(new Option('انتخاب PDF سؤال',''));selection.disabled=true;
 if(!project)return;
 let data;
 try{data=await api('/api/v1/projects/'+project+'/assets')}
 catch(error){if(generation!==sourcesGeneration)return;throw error}
 if(generation!==sourcesGeneration||project!==state.project)return;
 for(const asset of data.assets||[])if(asset.role==='question_pdf')selection.add(new Option('PDF · '+asset.digest.slice(0,16),asset.digest));
 selection.disabled=selection.options.length<2;
 if(selection.disabled)note('PDF منبع در این پروژه وجود ندارد. ابتدا فایل را در بانک پیش‌نویس بارگذاری کن.',true);
 ready();
}
function analyze(){
 reset();
 const q=parseNumberedBlocks($('rawQuestions').value,{kind:'question'});
 const a=parseNumberedBlocks($('rawAnswers').value,{kind:'answer'});
 const combined=matchExamAnswers(q.blocks,a.blocks);state.snapshot=combined;
 const host=$('matchList');
 const warnings=[...q.warnings.map(x=>'سؤال: '+x.type+(x.number?' #'+x.number:'')),...a.warnings.map(x=>'پاسخ: '+x.type+(x.number?' #'+x.number:''))];
 if(warnings.length)host.append(el('div','هشدارهای شماره‌گذاری: '+warnings.join(' | ')));
 if(!combined.matches.length)host.append(el('p','شماره معتبر شناسایی نشد. قالب ۱) یا 1. را امتحان کن.'));
 for(const match of combined.matches){
  const row=el('div','');row.className='bank-result';
  if(match.status==='awaiting_operator_review'){
   const label=el('label','');
   label.className='bank-confirm';
   const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.number=String(match.number);
   checkbox.addEventListener('change',()=>{
    if(checkbox.checked)state.reviewed.add(match.number);else state.reviewed.delete(match.number);
    ready();
   });
   label.append(checkbox,el('span','تطبیق سؤال '+match.number+' را با پاسخ و PDF بررسی کردم.'));
   row.append(label,el('div',match.question.slice(0,220)),el('div','پاسخ: '+match.answer.slice(0,220)));
  }else{
   row.append(el('strong','شماره '+match.number+' · نیازمند اصلاح'),el('div',match.problems.join('، ')));
  }
  host.append(row);
 }
 note('تطبیق اولیه: '+combined.stats.paired+' جفت قابل بررسی، '+combined.stats.mismatched+' مورد مغایرت. هنوز هیچ سؤالی ذخیره نشده است.');
 ready();
}
async function importSelected(){
 if(state.importing)return;
 // Keep the destination, source PDF, and reviewed text fixed until this batch finishes.
 const controls=['importProject','importSource','importLabel','rawQuestions','rawAnswers','matchNow']
  .map(id=>[$(id),$(id).disabled]);
 state.importing=true;
 for(const [control] of controls)control.disabled=true;
 ready();
 let completed=0;
 try{
  if(!state.snapshot||!state.project)throw Error('ابتدا شماره‌ها را تطبیق بده');
  const chosen=[...state.reviewed].filter(n=>!state.imported.has(importKey(n))).sort((a,b)=>a-b);
  if(!chosen.length)throw Error('هیچ جفت تأییدشده‌ای انتخاب نشده است');
  if(chosen.length>50)throw Error('هر مرحله حداکثر ۵۰ سؤال را بپذیر');
  const sourceDigest=$('importSource').value;
  if(!/^[a-f0-9]{64}$/i.test(sourceDigest))throw Error('PDF خصوصی منبع را انتخاب کن');
  // This evidence is local only; the server stores every imported question as an UNAPPROVED DRAFT.
  const review=explicitMatchReview(state.snapshot,{actor:state.operator,acceptedNumbers:chosen,sourceFingerprint:sourceDigest});
  for(const number of review.accepted){
   if(state.imported.has(importKey(number)))continue;
   const matched=state.snapshot.matches.find(x=>x.number===number);
   const content={questionText:matched.question,answerText:matched.answer,latex:[],
     sourceLabel:$('importLabel').value.slice(0,160),sourceDigest,sourceNumber:number,
     taxonomyId:'',operatorConfirmed:false,scientificPending:0};
   const data=await api(path()+'/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});
   if(data.question?.state!=='draft')throw Error('سرور پیش‌نویس معتبر برنگرداند');
   state.imported.add(importKey(number));completed++;ready();
  }
  note(completed+' سؤال جدید به D1 منتقل شد. هیچ‌کدام تأیید علمی یا منتشر نشده‌اند.');
 }catch(error){
  if(!completed)throw error;
  note(completed+' سؤال ثبت شد، اما انتقال بقیه متوقف شد. پیش از تلاش مجدد، بانک پیش‌نویس‌ها را بررسی کن.',true);
 }finally{
  state.importing=false;
  for(const [control,wasDisabled] of controls)control.disabled=wasDisabled;
  ready();
 }
}
$('matchNow').addEventListener('click',analyze);
for(const id of ['rawQuestions','rawAnswers'])$(id).addEventListener('input',reset);
$('importSource').addEventListener('change',reset);
$('importProject').addEventListener('change',e=>void safely(async()=>{state.project=e.target.value;reset();await sources()}));
$('importDrafts').addEventListener('click',()=>void safely(importSelected));
void safely(async()=>{
 const session=await api('/api/session');
 if(session.role!=='operator')throw Error('ورود به حساب اپراتور لازم است');
 state.operator=String(session.email||'operator').slice(0,128);
 const data=await api('/api/v1/projects');
 const select=$('importProject');select.replaceChildren(new Option('انتخاب پروژه',''));
 for(const project of data.projects||[])select.add(new Option(project.name,project.id));
 select.disabled=false;state.project=data.projects?.[0]?.id||'';select.value=state.project;
 await sources();if(state.project)note('پروژه آماده است. متن OCR بازبینی‌شده را وارد کن.');
});
