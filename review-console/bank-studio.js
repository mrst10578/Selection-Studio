import {findDuplicateCandidates,compareModelDrafts,suggestTaxonomy} from '../studio/question-intelligence.js';
import {saveOfflineDraft,listOfflineDrafts,readOfflineDraft,deleteOfflineDraft} from '../studio/offline-encrypted-vault.js';
const $=id=>document.getElementById(id);
const state={projects:[],questions:[],projectId:'',current:null,dirty:false,authenticated:false,actorEmail:'',questionLoadSeq:0,assetLoadSeq:0};
const apiRoot='/api/v1/projects';
const fields=['questionText','answerText','taxonomyId','sourceLabel'];
const catalog=[
 {id:'BIO',name:'زیست‌شناسی',keywords:['سلول','میتوکندری','ژنتیک','اندامک','کلروپلاست']},
 {id:'CHEM',name:'شیمی',keywords:['پیوند یونی','واکنش شیمیایی','اسید','مول']},
 {id:'MATH',name:'ریاضی',keywords:['تابع','مشتق','انتگرال','معادله']},
 {id:'PHY',name:'فیزیک',keywords:['نیرو','انرژی','شتاب','مقاومت الکتریکی']}
];
const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').dataset.state=error?'error':'ok'};
const elem=(tag,text,cls='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
function clearResults(){for(const id of ['duplicateList','categoryList','compareResult','historyList'])$(id).replaceChildren();$('historyPanel').hidden=true}
async function api(path='',options={}){
 const res=await fetch(path.startsWith('/api/')?path:apiRoot+path,{credentials:'same-origin',cache:'no-store',...options});
 let data;try{data=await res.json()}catch{throw Error('پاسخ نامعتبر از سرور دریافت شد')}
 if(!res.ok){const err=new Error(data.error||'خطای ارتباط با سرور');err.status=res.status;throw err}
 return data;
}
const json=(method,payload)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
function enableSession(){
 for(const id of ['projectSelect','projectName','createProject','newQuestion',...fields,'secondDraft','reviewerEmail','operatorConfirmed'])$(id).disabled=false;
 enableContext();
}
function enableContext(){
 const hasProject=!!state.projectId,hasQuestion=!!state.current;
 for(const id of ['newQuestion','questionText','answerText','taxonomyId','sourceLabel','saveDraft','findDuplicates','suggestCategories','compareDrafts','sourcePdf','answerPdf','figureImage','refreshAssets','sourceDigest','operatorConfirmed','reviewerEmail','assignReviewer','revokeReviewer','saveOfflineEncrypted','listOfflineEncrypted'])$(id).disabled=!state.authenticated||!hasProject;
 $('deleteDraft').disabled=!hasQuestion;
 $('showHistory').disabled=!hasQuestion;
 $('revision').textContent='نسخه: '+(hasQuestion?state.current.revision:'جدید');
}
function readEditor(){return {questionText:$('questionText').value,answerText:$('answerText').value,taxonomyId:$('taxonomyId').value,sourceLabel:$('sourceLabel').value,sourceDigest:$('sourceDigest').value,operatorConfirmed:$('operatorConfirmed').checked,scientificPending:state.current?.content?.scientificPending||0,latex:Array.isArray(state.current?.content?.latex)?state.current.content.latex:[]}}
function loadEditor(row){
 state.current=row||null;
 for(const id of fields)$(id).value=row?.content?.[id]||'';
 $('sourceDigest').value=row?.content?.sourceDigest||'';
 $('operatorConfirmed').checked=row?.content?.operatorConfirmed===true;
 state.dirty=false;
 clearResults();enableContext();
}
function safeLeave(){return !state.dirty||window.confirm('تغییرات ذخیره نشده‌اند. بدون ذخیره ادامه می‌دهی؟')}
function renderQuestions(){
 const host=$('questionList');host.replaceChildren();
 if(!state.questions.length)host.append(elem('p','هنوز سؤالی در این پروژه ذخیره نشده است.'));
 for(const row of state.questions){
  const name=row.content?.questionText?.slice(0,85)||'سؤال بدون متن';
  const btn=elem('button','نسخه '+row.revision+' · '+name);btn.type='button';
  btn.setAttribute('aria-current',String(row.id===state.current?.id));
  btn.addEventListener('click',()=>{if(!safeLeave())return;loadEditor(row);renderQuestions()});host.append(btn);
 }
}
async function loadProjects(selectId){
 const result=await api();state.projects=result.projects||[];
 const sel=$('projectSelect');sel.replaceChildren(new Option('انتخاب پروژه',''));
 for(const row of state.projects)sel.add(new Option(row.name,row.id));
 const id=selectId&&state.projects.some(p=>p.id===selectId)?selectId:state.projects[0]?.id||'';
 sel.value=id;state.projectId=id;
 if(id)await loadQuestions();else{state.questions=[];loadEditor(null);renderQuestions();$('assetList').replaceChildren()}
 enableContext();
}
async function loadQuestions(){
 const projectId=state.projectId,seq=++state.questionLoadSeq;
 if(!projectId)return;
 const result=await api('/'+projectId+'/questions');
 if(projectId!==state.projectId||seq!==state.questionLoadSeq)return;
 state.questions=result.questions||[];
 if(!state.dirty)loadEditor(null);
 renderQuestions();
 void loadAssets().catch(showAssetsUnavailable);
}

function showAssetsUnavailable(err){
 $('assetList').replaceChildren(elem('p',err?.message==='ASSET_STORAGE_NOT_CONFIGURED'?'فضای R2 هنوز فعال نیست؛ فایلی ارسال نشد.':'فایل‌های این پروژه فعلاً در دسترس نیستند.','bank-help'));
}
async function loadAssets(){
 const projectId=state.projectId,seq=++state.assetLoadSeq;
 const list=$('assetList');list.replaceChildren();if(!projectId)return;
 const result=await api('/'+projectId+'/assets').catch(e=>{
  if(projectId!==state.projectId||seq!==state.assetLoadSeq)return null;
  throw e;
 });
 if(!result||projectId!==state.projectId||seq!==state.assetLoadSeq)return;
 const sourceSelect=$('sourceDigest');
 const previous=state.dirty?sourceSelect.value:state.current?.content?.sourceDigest||sourceSelect.value;
 sourceSelect.replaceChildren(new Option('بدون PDF منبع',''));
 for(const a of result.assets||[])if(a.role==='question_pdf')sourceSelect.add(new Option('PDF · '+a.digest.slice(0,16),a.digest));
 sourceSelect.value=[...sourceSelect.options].some(o=>o.value===previous)?previous:'';
 if(!result.assets?.length){list.append(elem('p','هنوز فایلی ثبت نشده است.','bank-help'));return}
 for(const asset of result.assets){
  const box=elem('div',undefined,'bank-result');
  box.append(elem('span',({question_pdf:'دفترچه سؤال',answer_pdf:'پاسخنامه',figure:'شکل',export:'خروجی'}[asset.role]||asset.role)+' · '+Math.ceil(asset.size/1024)+' کیلوبایت'));
  const link=elem('a','دریافت خصوصی');link.className='bank-download';
  link.href='/api/v1/projects/'+encodeURIComponent(state.projectId)+'/assets/'+encodeURIComponent(asset.digest)+'?role='+encodeURIComponent(asset.role);
  link.rel='nofollow';box.append(link);
  const remove=elem('button','برداشتن پیوست');remove.type='button';
  remove.addEventListener('click',()=>void safely(async()=>{
   if(!window.confirm('این فایل از فهرست پروژه برداشته شود؟ فایل‌های مرجع سؤال‌های ثبت‌شده قابل حذف نیستند و پاک‌سازی فیزیکی جداگانه انجام می‌شود.'))return;
   const result=await api('/'+projectId+'/assets/'+asset.digest+'?role='+encodeURIComponent(asset.role),{method:'DELETE'});
   if(state.projectId!==projectId)return;
   notice(result.deleted?'پیوست از فهرست برداشته شد. پاک‌سازی فیزیکی فضای ذخیره‌سازی بعداً انجام می‌شود.':'این فایل قبلاً از فهرست حذف شده است.');
   await loadAssets();
  }));
  box.append(remove);list.append(box);
 }
}
async function uploadAsset(file,role){
 if(!state.projectId||!state.authenticated)throw Error('ابتدا پروژه را انتخاب کن');
 if(file.size>8*1024*1024)throw Error('سقف فایل ۸ مگابایت است');
 const mime=file.type||({'question_pdf':'application/pdf','answer_pdf':'application/pdf'}[role]||'');
 if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(mime))throw Error('نوع فایل پشتیبانی نمی‌شود');
 notice('در حال بارگذاری خصوصی فایل…');
 const projectId=state.projectId;
 const result=await api('/'+projectId+'/assets',{method:'POST',headers:{'Content-Type':mime,'X-Asset-Role':role},body:file});
 if(projectId!==state.projectId)return;
 notice('فایل خصوصی ثبت شد؛ OCR و انتشار اجرا نشده‌اند. '+result.digest.slice(0,12));
 await loadAssets();
}

async function refreshOfflineVault(){
 const host=$('offlineEncryptedList');host.replaceChildren();
 const entries=await listOfflineDrafts(state.actorEmail);
 if(!entries.length){host.append(elem('p','نسخه آفلاینی وجود ندارد.','bank-help'));return}
 for(const entry of entries){
  const box=elem('div',undefined,'bank-result');
  box.append(elem('span','نسخه رمزدار · '+new Date(entry.createdAt).toLocaleString('fa-IR')));
  const actions=elem('div',undefined,'bank-actions');
  const restore=elem('button','بازیابی');restore.type='button';
  restore.addEventListener('click',()=>void safely(async()=>{
   const pass=window.prompt('گذرواژه رمزگذاری این نسخه را وارد کن:');if(pass===null)return;
   const content=await readOfflineDraft(state.actorEmail,pass,entry.id);
   if(content.projectId!==state.projectId){notice('این نسخه متعلق به پروژه دیگری است. برای جلوگیری از ترکیب داده‌ها، ابتدا همان پروژه را انتخاب کن.',true);return}
   const source=state.questions.find(q=>q.id===content.questionId);
   const conflict=!!content.questionId&&(!source||source.revision!==content.baseRevision||source.content?.sourceDigest!==content.sourceFingerprint);
   if(conflict&&!window.confirm('نسخه اصلی تغییر کرده است. فقط به‌عنوان پیش‌نویس جدید و بدون جایگزینی نسخه سرور بازیابی شود؟'))return;
   loadEditor(conflict?null:source||null);
   $('questionText').value=content.questionText;$('answerText').value=content.answerText;
   $('taxonomyId').value=content.taxonomyId||'';
   if(!conflict&&content.sourceFingerprint&&[...$('sourceDigest').options].some(o=>o.value===content.sourceFingerprint))$('sourceDigest').value=content.sourceFingerprint;
   $('operatorConfirmed').checked=false;state.dirty=true;renderQuestions();
   notice(conflict?'تداخل تشخیص داده شد؛ متن فقط به‌صورت پیش‌نویس جدید و ذخیره‌نشده بازیابی شد.':'متن محلی بازیابی شد؛ هنوز روی D1 ثبت نشده و دوباره به تأیید نیاز دارد.');
  }));
  const remove=elem('button','حذف نسخه');remove.type='button';
  remove.addEventListener('click',()=>void safely(async()=>{
   if(!window.confirm('این نسخه رمزدار محلی پاک شود؟'))return;
   await deleteOfflineDraft(state.actorEmail,entry.id);await refreshOfflineVault();notice('نسخه رمزدار محلی حذف شد.');
  }));
  actions.append(restore,remove);box.append(actions);host.append(box);
 }
}
async function saveCurrentOffline(){
 if(!state.projectId||!$('questionText').value.trim())throw Error('پروژه و متن سؤال الزامی‌اند');
 const pass=window.prompt('یک گذرواژه حداقل ۱۲ کاراکتری برای رمزگذاری محلی وارد کن. بدون آن بازیابی ممکن نیست:');
 if(pass===null)return;
 const item={projectId:state.projectId,questionId:state.current?.id||null,baseRevision:state.current?.revision||0,
  sourceFingerprint:$('sourceDigest').value,questionText:$('questionText').value,
  answerText:$('answerText').value,taxonomyId:$('taxonomyId').value};
 await saveOfflineDraft(state.actorEmail,pass,item);notice('نسخه رمزدار فقط روی همین دستگاه ذخیره شد؛ هیچ اطلاعاتی به سرور ارسال نشد.');
 await refreshOfflineVault();
}
async function createProject(){
 const name=$('projectName').value.trim();if(!name){notice('نام پروژه را وارد کن',true);return}
 const created=await api('',json('POST',{name}));$('projectName').value='';await loadProjects(created.id);notice('پروژه جدید ایجاد شد');
}
async function saveDraft(){
 if(!state.projectId)return;
 const content=readEditor();if(!content.questionText.trim()){notice('متن سؤال نمی‌تواند خالی باشد',true);return}
 const wasCurrent=state.current;
 let data;
 try{
  data=wasCurrent?await api('/'+state.projectId+'/questions/'+wasCurrent.id,json('PATCH',{baseRevision:wasCurrent.revision,content}))
  :await api('/'+state.projectId+'/questions',json('POST',{content}));
 }catch(e){
  if(e.status===409){notice('تداخل نسخه: سؤال در جای دیگری تغییر کرده است. متن این صفحه را حفظ کن و تغییرات را دستی مقایسه کن.',true);return}
  throw e;
 }
 const latest=data.question;
 const i=state.questions.findIndex(x=>x.id===latest.id);if(i<0)state.questions.unshift(latest);else state.questions[i]=latest;
 loadEditor(latest);renderQuestions();notice('پیش‌نویس در D1 ذخیره شد. این کار تأیید علمی یا انتشار نیست.');
}
async function deleteDraft(){
 if(!state.current||!window.confirm('این پیش‌نویس به‌صورت نرم حذف شود؟'))return;
 try{await api('/'+state.projectId+'/questions/'+state.current.id,json('DELETE',{baseRevision:state.current.revision}))}
 catch(e){if(e.status===409){notice('نسخه تغییر کرده است؛ حذف انجام نشد.',true);return}throw e}
 await loadQuestions();notice('پیش‌نویس حذف نرم شد');
}
async function showHistory(){
 if(!state.current)return;
 const data=await api('/'+state.projectId+'/questions/'+state.current.id+'?history=1');
 const host=$('historyList');host.replaceChildren();$('historyPanel').hidden=false;
 for(const row of data.history||[]){host.append(elem('div','نسخه '+row.revision+' · '+row.happenedAt+'\n'+String(row.content?.questionText||'').slice(0,230),'bank-result'))}
}
function findDuplicates(){
 const content=readEditor();const suggestions=findDuplicateCandidates({id:state.current?.id,text:content.questionText},
  state.questions.map(q=>({id:q.id,text:q.content?.questionText||'',projectId:state.projectId,status:q.state})),{scope:state.projectId,threshold:.56});
 const host=$('duplicateList');host.replaceChildren();
 if(!suggestions.length){host.append(elem('div','مورد مشابهی در ۵۰ سؤال اخیر این پروژه پیدا نشد؛ این نتیجه تضمین نبودن تکرار نیست.','bank-result'));return}
 for(const item of suggestions){const found=state.questions.find(x=>x.id===item.id);
  host.append(elem('div','شباهت '+(item.score*100).toFixed(1)+'٪ · '+(item.flags.join('، ')||'نیازمند بازبینی')+'\n'+(found?.content?.questionText?.slice(0,130)||item.id),'bank-result'))}
}
function suggestCategories(){
 const list=suggestTaxonomy($('questionText').value,catalog);const host=$('categoryList');host.replaceChildren();
 if(!list.length){host.append(elem('p','موضوع پیشنهادی پیدا نشد؛ طبقه‌بندی را دستی بررسی کن.'));return}
 for(const item of list){
  const box=elem('div',item.label+' · '+item.matched.join('، '),'bank-result');
  const accept=elem('button','انتخاب این مبحث');accept.type='button';
  accept.addEventListener('click',()=>{
   $('taxonomyId').value=item.id;
   $('operatorConfirmed').checked=false;state.dirty=true;
   notice('موضوع '+item.label+' با انتخاب تو در پیش‌نویس قرار گرفت؛ هنوز ذخیره یا تأیید نشده است.');
  });box.append(accept);host.append(box);
 }
}
function compareDrafts(){
 const a=$('questionText').value,b=$('secondDraft').value;if(!a.trim()||!b.trim()){notice('برای مقایسه، هر دو متن را وارد کن',true);return}
 const r=compareModelDrafts({text:a},{text:b});$('compareResult').replaceChildren(elem('div','شباهت متنی '+(r.textScore*100).toFixed(1)+'٪\n'+(r.differences.join('، ')||'اختلاف آشکار شناسایی نشد')+'\nتأیید انسانی همچنان الزامی است.','bank-result'));
}
async function safely(action){try{await action()}catch(e){
 const message=e.status===401?'ابتدا وارد Cloudflare Access شو':
  e.message==='SOURCE_PDF_REFERENCED_BY_QUESTION'?'این PDF در تاریخچه سؤال‌ها استفاده شده و برای حفظ مدرک علمی قابل حذف نیست.':
  e.message==='SOURCE_PDF_NOT_REGISTERED'?'برای تأیید متن، ابتدا PDF مرجعِ فعال را در همین پروژه بارگذاری و انتخاب کن.':
  e.message==='SOURCE_PDF_MISSING_IN_STORAGE'?'نسخه خصوصی PDF مرجع در فضای ذخیره‌سازی موجود نیست. این سؤال قابل تأیید نیست.':
  e.message==='SOURCE_STORAGE_NOT_CONFIGURED'?'فضای خصوصی R2 فعال نیست؛ تأیید سؤال با PDF ممکن نیست.':
  e.message==='ASSET_MISSING_IN_STORAGE'?'فایل در فهرست ثبت شده، اما نسخه خصوصی آن در ذخیره‌سازی پیدا نشد. از این فایل استفاده نکن.':
  e.message==='ASSET_QUOTA_EXCEEDED'?'سقف تعداد یا حجم فایل‌های خصوصی این حساب/پروژه تکمیل شده است.':
  e.message||'خطا در دسترسی امن';
 notice(message,true);
}}
for(const id of fields)$(id).addEventListener('input',()=>{state.dirty=true;$('operatorConfirmed').checked=false});
$('sourceDigest').addEventListener('change',()=>{state.dirty=true;$('operatorConfirmed').checked=false});
$('operatorConfirmed').addEventListener('change',()=>{state.dirty=true});
$('projectSelect').addEventListener('change',e=>void safely(async()=>{
 if(!safeLeave()){e.target.value=state.projectId;return}
 state.projectId=e.target.value;
 ++state.questionLoadSeq;++state.assetLoadSeq;
 state.questions=[];loadEditor(null);renderQuestions();
 $('assetList').replaceChildren();
 $('sourceDigest').replaceChildren(new Option('بدون PDF منبع',''));
 await loadQuestions();enableContext();
}));
$('createProject').addEventListener('click',()=>void safely(createProject));
$('saveOfflineEncrypted').addEventListener('click',()=>void safely(saveCurrentOffline));
$('listOfflineEncrypted').addEventListener('click',()=>void safely(refreshOfflineVault));
$('assignReviewer').addEventListener('click',()=>void safely(async()=>{
 const reviewerEmail=$('reviewerEmail').value.trim();
 const projectId=state.projectId;
 if(!reviewerEmail||!projectId)throw Error('ایمیل بازبین و پروژه الزامی است');
 await api('/api/v1/reviews/assignments',json('POST',{projectId,reviewerEmail}));
 $('reviewerEmail').value='';
 notice('دسترسی بازبین مستقل فقط برای این پروژه ثبت شد.');
}));
$('revokeReviewer').addEventListener('click',()=>void safely(async()=>{
 const reviewerEmail=$('reviewerEmail').value.trim();
 const projectId=state.projectId;
 if(!reviewerEmail||!projectId)throw Error('ایمیل بازبین و پروژه الزامی است');
 if(!window.confirm('دسترسی این بازبین لغو شود؟ تأییدهای قبلی او حتی پس از دعوت مجدد معتبر نخواهند بود.'))return;
 const result=await api('/api/v1/reviews/assignments',json('DELETE',{projectId,reviewerEmail}));
 notice(result.revoked?'دسترسی بازبین لغو شد؛ تأییدهای قبلی او دیگر معتبر نیستند.':'این بازبین دسترسی فعالی نداشت.');
}));
$('newQuestion').addEventListener('click',()=>{if(!safeLeave())return;loadEditor(null);renderQuestions();notice('پیش‌نویس جدید؛ برای ذخیره روی ثبت بزن.')});
$('saveDraft').addEventListener('click',()=>void safely(saveDraft));
$('deleteDraft').addEventListener('click',()=>void safely(deleteDraft));
$('showHistory').addEventListener('click',()=>void safely(showHistory));
$('findDuplicates').addEventListener('click',findDuplicates);
$('suggestCategories').addEventListener('click',suggestCategories);
$('compareDrafts').addEventListener('click',compareDrafts);
$('refreshAssets').addEventListener('click',()=>void loadAssets().catch(showAssetsUnavailable));
for(const [id,role] of [['sourcePdf','question_pdf'],['answerPdf','answer_pdf'],['figureImage','figure']]){
 $(id).addEventListener('change',event=>void safely(async()=>{
  const file=event.target.files?.[0];if(!file)return;
  try{await uploadAsset(file,role)}finally{event.target.value=''}
 }));
}
void safely(async()=>{
 const session=await api('/api/session');
 if(!session.authenticated||session.role!=='operator')throw Error('دسترسی اپراتور تأیید نشد');
 state.authenticated=true;state.actorEmail=String(session.email||'').toLowerCase();enableSession();await loadProjects();notice('اتصال امن برقرار است. سؤال‌های ذخیره‌شده همچنان پیش‌نویس هستند.');
});
