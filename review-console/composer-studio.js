import {exportExamHTML,exportExamJSONL} from '../engine/test-composer.js';
const $=id=>document.getElementById(id);
const state={bank:[],selected:[],nextCursor:null,bankFilterKey:'',bankRequestSeq:0,seenBankCursors:new Set(),emptyContinuationPages:0,bankLoading:false,bankLoadError:false,ready:false,composeBusy:false};
let renderedSelectedKey=null;
const fingerprintPlaceholder='شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.';
let compositionVersion=0;
// A fingerprint describes one exact title, answer policy and ordered selection.
function invalidateFingerprint(){
 ++compositionVersion;
 const label=$('examFingerprint');
 if(label.textContent!==fingerprintPlaceholder)label.textContent=fingerprintPlaceholder;
 // A visible modal preview is also tied to this exact draft snapshot.
 const dialog=$('examPreviewDialog');
 if(dialog?.open){
  dialog.close();
  notice('پیش‌نمایش قبلی پس از تغییر آزمون منقضی شد؛ دوباره پیش‌نمایش بگیر.',true);
 }
}
// Use the already-authorized project list to identify questions in cross-project search.
const projectNames=new Map();
// A stable, human-readable selection order distinguishes questions without exposing IDs.
const selectionOrder=new WeakMap();
let nextSelectionOrder=0;
const notice=(s,error=false)=>{
 const node=$('composerNotice'),status=error?'error':'ok';
 // A live region must not re-announce identical guidance on every keystroke.
 if(node.textContent!==s)node.textContent=s;
 if(node.dataset.state!==status)node.dataset.state=status;
};
const e=(tag,text)=>{const node=document.createElement(tag);node.textContent=text||'';return node};
async function api(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 // Access can redirect an API request to its login URL. The landing page
 // may return HTML 200 or another status (including a missing mocked page).
 // Detect the *final known same-origin login URL*, never arbitrary HTML or
 // a 401/403 response from the original API endpoint.
 let accessLogin=false;
 try{
  const finalUrl=new URL(res.url);
  const requestedUrl=new URL(path,location.href);
  accessLogin=finalUrl.origin===location.origin&&finalUrl.href!==requestedUrl.href&&
   (finalUrl.pathname==='/cdn-cgi/access/login'||finalUrl.pathname.startsWith('/cdn-cgi/access/login/'));
 }catch{}
 if(accessLogin){
  const err=Error('نشست ورود منقضی شده است');err.status=401;throw err;
 }
 let data;try{data=await res.json()}catch{
  // Access/session gateways may return an HTML login/denial page instead of JSON.
  // Preserve the HTTP status so compose errors remain distinct from outages.
  if(res.status===401||res.status===403){
   const err=Error('ورود یا مجوز حساب نیاز به بررسی دارد');err.status=res.status;throw err;
  }
  throw Error('پاسخ API نامعتبر است');
 }
 if(!res.ok){const err=Error(data?.error||'اتصال برقرار نشد');err.status=res.status;throw err}return data;
}
async function safe(fn,context='general'){
 try{await fn()}catch(error){
  if(error?.status===409){
   notice('سؤال‌ها تغییر کرده‌اند یا تأییدشان منقضی شده است؛ بانک را بازخوانی کن و سؤال‌های تغییرکرده را حذف و دوباره انتخاب کن. اگر سؤالی از بانک حذف شده یا تأییدش لغو شده است، آن را از آزمون حذف کن؛ انتخاب مجددش ممکن نیست.',true);
  }else if(context==='compose'&&error?.status===401){
   // An expired session is not a transient compose failure or a 403 role denial.
   // Do not expose backend authentication codes or suggest retrying anonymously.
   notice('نشست ورود منقضی شده است؛ دوباره وارد حساب اپراتور شو و سپس ساخت خروجی را تکرار کن. سؤال‌های انتخاب‌شده حفظ شدند.',true);
  }else if(context==='compose'&&error?.status===403){
   // Authorization failures are not transient. Never encourage blind retries
   // or reveal internal access-policy error codes to an operator.
   notice('این حساب اجازه ساخت خروجی آزمون را ندارد؛ برای بررسی دسترسی با مدیر سامانه هماهنگ کن. سؤال‌های انتخاب‌شده حفظ شدند.',true);
  }else if(context==='compose'&&(error instanceof TypeError||(error?.status>=500&&error.status<600))){
   // Keep transient validation failures distinct from 409 and access errors.
   // Never expose backend error codes to an operator who can simply retry.
   notice('اعتبارسنجی آزمون موقتاً ناموفق بود؛ سؤال‌های انتخاب‌شده حفظ شدند. دوباره تلاش کن.',true);
  }else if(error?.status===401){
   // Bank/session requests must not expose raw authentication error codes.
   notice('نشست ورود منقضی شده است؛ دوباره وارد حساب اپراتور شو. سؤال‌های انتخاب‌شده حفظ شدند.',true);
  }else if(error?.status===403){
   // A role denial is not a transient outage and must not leak policy details.
   notice('این حساب اجازه دسترسی به این بخش را ندارد؛ برای بررسی مجوز با مدیر سامانه هماهنگ کن. سؤال‌های انتخاب‌شده حفظ شدند.',true);
  }else notice(error?.message||'خطا در ساخت آزمون',true);
 }
}
async function runComposeAction(fn){
 if(state.composeBusy)return;
 const trigger=document.activeElement;
 state.composeBusy=true;controls();
 try{await safe(fn,'compose')}finally{
  state.composeBusy=false;controls();
  // Disabling a focused action can move focus to body; restore it only if untouched.
  if(['previewExam','exportJsonl','exportHtml','printExam'].includes(trigger?.id)&&
     document.activeElement===document.body&&!trigger.disabled)trigger.focus();
 }
}
function controls(){for(const id of ['previewExam','exportJsonl','exportHtml','printExam'])$(id).disabled=!state.selected.length||state.composeBusy}
// Never silently upgrade a selected revision: the server must revalidate the exact snapshot.
const staleSelectionCount=()=>state.selected.filter(selected=>
 state.bank.some(current=>current.id===selected.id&&current.revision!==selected.revision)).length;
function warnOnStaleSelection(unchecked=0){
 const count=staleSelectionCount();
 if(count){
  // A newly discovered server revision invalidates even an unchanged draft's
  // previously validated fingerprint and any preview opened during refresh.
  const previewWasOpen=$('examPreviewDialog').open;
  invalidateFingerprint();
  notice(new Intl.NumberFormat('fa-IR').format(count)+' سؤال انتخاب‌شده نسخه متفاوتی در بانک دارد؛ برای انتخاب نسخه جدید، آن را حذف و دوباره انتخاب کن.'+
   (unchecked?' '+new Intl.NumberFormat('fa-IR').format(unchecked)+' سؤال انتخاب‌شده در نتایج فعلی نیست و نسخه آن در این بازخوانی بررسی نشد.':'')+
   (previewWasOpen?' پیش‌نمایش قبلی بسته شد چون نسخه سؤال تغییر کرده است.':''),true);
 }
 return count;
}
function render(){
 const available=$('approvedList');
 // Keep keyboard focus on the same question when a same-filter refresh
 // replaces or reorders bank rows. Never restore focus for a removed row.
 const focusedBankId=available.contains(document.activeElement)&&document.activeElement.tagName==='BUTTON'
  ?document.activeElement.dataset.questionId:null;
 available.replaceChildren();
 available.setAttribute('aria-busy',String(state.bankLoading));
 const more=$('loadMoreBank');more.hidden=!state.nextCursor;more.disabled=state.bankLoading||!state.nextCursor;
 $('loadBank').disabled=!state.ready||state.bankLoading;
 if(!state.bank.length)available.append(e('p',state.bankLoading?'در حال دریافت سؤال‌ها…':state.bankLoadError?'دریافت سؤال‌ها ناموفق بود؛ برای تلاش دوباره «جست‌وجو و بازخوانی» را بزن.':'سؤال تأییدشده‌ای با این جست‌وجو پیدا نشد.'));
 // Avoid rescanning up to 100 selected questions for every bank row on each render.
 // The selection set is recreated after each toggle, so aria-pressed stays current.
 const selectedIds=new Set(state.selected.map(question=>question.id));
 for(const [index,question] of state.bank.entries()){
  const selected=selectedIds.has(question.id);
  // In an all-project search, source numbers alone are ambiguous.
  const projectLabel=$('composerProject').value?'':' · پروژه: '+(projectNames.get(question.projectId)||'نامشخص');
  const row=e('button',(selected?'✓ ':'+ ')+'سؤال '+(question.sourceNumber||'?')+projectLabel+' · '+question.questionText.slice(0,100));
  row.type='button';row.dataset.questionId=question.id;row.setAttribute('aria-pressed',String(selected));
  row.addEventListener('click',()=>{
   if(selected)state.selected=state.selected.filter(x=>x.id!==question.id);
   else if(state.selected.length<100){state.selected.push(question);selectionOrder.set(question,++nextSelectionOrder)}
   else{notice('هر آزمون حداکثر ۱۰۰ سؤال دارد',true);return}
   const hadStaleWarning=$('composerNotice').textContent.includes('نسخه متفاوتی در بانک دارد');
   render();
   if(!warnOnStaleSelection()&&hadStaleWarning)notice('انتخاب سؤال‌ها با نسخه فعلی بانک هماهنگ شد.');
   // Rebuilding the list removes the clicked button; restore keyboard focus.
   available.querySelectorAll('button')[index]?.focus();
  });available.append(row);
 }
 if(focusedBankId&&document.activeElement===document.body){
  const matching=Array.from(available.querySelectorAll('button'))
   .find(button=>button.dataset.questionId===focusedBankId);
  matching?.focus();
 }
 // A bank refresh changes available rows, not the selected question controls.
 // Keep those DOM nodes and their keyboard focus until selection/order/text changes.
 const selectedKey=JSON.stringify(state.selected.map(q=>[q.id,q.revision,q.questionText]));
 if(selectedKey!==renderedSelectedKey){
 invalidateFingerprint();
 const list=$('selectedList');list.replaceChildren();
 if(!state.selected.length){
  const empty=e('li','هنوز سؤالی انتخاب نشده است.');empty.setAttribute('role','presentation');list.append(empty);
 }
 state.selected.forEach((question,i)=>{
  const row=e('li','');row.className='bank-result composer-selection';
  // Cross-project selections need the same source context as search results.
  const projectLabel=$('composerProject').value?'':'پروژه: '+(projectNames.get(question.projectId)||'نامشخص')+' · ';
  row.append(e('span',(i+1)+'. '+projectLabel+question.questionText.slice(0,110)));
  const buttons=e('div','');buttons.className='bank-actions';
  // Repeated "بالا", "پایین" and "حذف" controls need a unique accessible
  // name so screen-reader users know which selected question will change.
  const actionContext='سؤال '+(i+1)+'، پروژه '+(projectNames.get(question.projectId)||'نامشخص')+
   '، '+question.questionText.slice(0,80);
  for(const [label,move] of [['بالا',-1],['پایین',1]]){
   const button=e('button',label);button.type='button';button.setAttribute('aria-label',label+'، '+actionContext);button.disabled=i+move<0||i+move>=state.selected.length;
   button.addEventListener('click',()=>{
    const target=i+move;
    const copy=[...state.selected];[copy[i],copy[target]]=[copy[target],copy[i]];state.selected=copy;render();
    // Keep focus with the moved question, even when its move button becomes disabled at an edge.
    const movedButtons=list.querySelectorAll('.composer-selection')[target]?.querySelectorAll('button');
    const preferred=movedButtons?.[move===-1?0:1];
    const fallback=movedButtons?.[move===-1?1:0];
    (preferred&&!preferred.disabled?preferred:fallback)?.focus();
    // Reordering leaves the selection count unchanged; announce the new position
    // through the existing polite live region without exposing answer content.
    // A source number is not unique when missing or repeated in the selection.
    // Fall back to stable selection order; never expose internal question IDs.
    const number=new Intl.NumberFormat('fa-IR');
    const uniqueSource=Number.isSafeInteger(question.sourceNumber)&&question.sourceNumber>0&&
     !state.selected.some(other=>other.id!==question.id&&other.sourceNumber===question.sourceNumber);
    const identityLabel=uniqueSource?' (شماره منبع '+number.format(question.sourceNumber)+')':
     ' (انتخاب شماره '+number.format(selectionOrder.get(question))+')';
    notice('سؤال «'+question.questionText.slice(0,60)+'»'+identityLabel+' به جایگاه '+
     number.format(target+1)+' منتقل شد.');
   });buttons.append(button);
  }
  const remove=e('button','حذف');remove.type='button';remove.setAttribute('aria-label','حذف، '+actionContext);
  remove.addEventListener('click',()=>{
   state.selected=state.selected.filter(x=>x.id!==question.id);render();
   // Confirm deletion independently of the changing selection-count live region.
   // Keep the message concise and never include the answer text.
   notice('سؤال «'+question.questionText.slice(0,60)+'» از آزمون حذف شد. '+
     new Intl.NumberFormat('fa-IR').format(state.selected.length)+' سؤال باقی ماند.');
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
  renderedSelectedKey=selectedKey;
 }
 const count=$('composerSelectionCount');
 const message=new Intl.NumberFormat('fa-IR').format(state.selected.length)+' سؤال انتخاب شده است.';
 // Announce changes only: unrelated re-renders must not repeat the screen-reader message.
 if(count.textContent!==message)count.textContent=message;
 controls();
}
const currentBankFilter=()=>JSON.stringify([$('composerProject').value,$('composerQuery').value.trim()]);
function invalidateBankSearch(){
 // Rebuild only when visible bank state actually needs clearing. Repeated
 // keystrokes after the first edit must not replace selection buttons or
 // the empty bank placeholder, which disrupts focus and wastes DOM work.
 const needsRender=Boolean(state.bank.length||state.nextCursor||state.bankLoading||state.bankLoadError);
 ++state.bankRequestSeq;state.bank=[];state.nextCursor=null;state.bankFilterKey='';state.bankLoading=false;state.bankLoadError=false;state.seenBankCursors.clear();state.emptyContinuationPages=0;
 if(needsRender)render();
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
 // A same-filter refresh must not discard visible results if the network fails.
 const previousSearch=!append&&state.bankFilterKey===key?{
  bank:state.bank,nextCursor:state.nextCursor,seenBankCursors:new Set(state.seenBankCursors),emptyContinuationPages:state.emptyContinuationPages
 }:null;
 state.bankLoading=true;state.bankLoadError=false;state.bankFilterKey=key;
 // Keep same-filter results visible during refresh; only clear them when filters change.
 if(!append){if(!previousSearch)state.bank=[];state.nextCursor=null;state.seenBankCursors.clear();state.emptyContinuationPages=0}
 notice(append?'در حال بارگذاری سؤال‌های بیشتر…':'در حال جست‌وجوی سؤال‌های تأییدشده…');
 render();
 const qs=new URLSearchParams();
 if(project)qs.set('projectId',project);if(query)qs.set('q',query);
 if(cursor)qs.set('cursor',cursor);
 let result;
 try{
  result=await api('/api/v1/bank/questions?'+qs);
  // Reject malformed successful responses before replacing the visible bank.
  // Otherwise one broken row can crash render() and discard the previous results.
  if(!Array.isArray(result?.questions)||!result.questions.every(q=>
   q&&typeof q.id==='string'&&q.id.trim()&&typeof q.projectId==='string'&&
   typeof q.questionText==='string'&&Number.isSafeInteger(q.revision)))
   throw Error('پاسخ بانک سؤال نامعتبر است');
  // Never display rows from another project when the operator filtered by one.
  // Treat a mixed-project API page as invalid rather than leaking its contents.
  if(project&&result.questions.some(q=>q.projectId!==project))
   throw Error('پاسخ بانک سؤال با پروژه انتخاب‌شده مطابقت ندارد');
  // The project list is scoped to the signed-in operator. Never display or
  // select an API row from a project absent from that authorized list,
  // including when searching across all projects.
  if(result.questions.some(q=>!projectNames.has(q.projectId)))
   throw Error('پاسخ بانک سؤال شامل پروژه خارج از دسترسی است');
 }
 catch(error){
  if(seq!==state.bankRequestSeq)return;
  // A 403 can mean the operator's project access was revoked while a bank
  // request was pending. Never leave previously authorized rows, selections
  // or project names visible after the server denies bank access.
  if(error?.status===403){
   ++state.bankRequestSeq;
   state.ready=false;state.bank=[];state.selected=[];state.nextCursor=null;
   state.bankFilterKey='';state.bankLoading=false;state.bankLoadError=true;
   state.seenBankCursors.clear();state.emptyContinuationPages=0;
   projectNames.clear();
   const select=$('composerProject');
   select.replaceChildren(new Option('دسترسی نیاز به بررسی دارد',''));
   select.disabled=true;
   const retry=$('retryComposerBootstrap');
   retry.hidden=false;retry.disabled=false;
   render();
   notice('مجوز مشاهده بانک سؤال تأیید نشد؛ نتایج و انتخاب‌ها پاک شدند. پس از بررسی دسترسی، «بررسی ورود و دسترسی» را بزن.',true);
   if((focusFromSearch||focusFromMore)&&document.activeElement===document.body)retry.focus();
   return;
  }
  // A server-rejected continuation cannot succeed on retry. Keep the existing
  // questions and selections, but require a fresh search for a new cursor.
  const invalidCursor=append&&error?.status===400&&error?.message==='INVALID_CURSOR';
  if(invalidCursor){state.nextCursor=null;state.seenBankCursors.clear()}
  if(previousSearch){
   state.bank=previousSearch.bank;state.nextCursor=previousSearch.nextCursor;
   state.seenBankCursors=previousSearch.seenBankCursors;state.emptyContinuationPages=previousSearch.emptyContinuationPages;
  }
  state.bankLoadError=!append&&!state.bank.length;
  state.bankLoading=false;render();
  // Failed requests must also restore the keyboard trigger without stealing moved focus.
  if((focusFromSearch||focusFromMore)&&
     (document.activeElement===document.body||document.activeElement===$('loadBank')||document.activeElement===$('loadMoreBank'))){
   (focusFromMore&&!$('loadMoreBank').hidden?$('loadMoreBank'):$('loadBank')).focus();
  }
  if(invalidCursor){
   notice('نشانگر صفحه‌بندی نامعتبر یا منقضی شده است؛ برای ادامه «جست‌وجو و بازخوانی» را بزن. سؤال‌های انتخاب‌شده حفظ شدند.',true);
   return;
  }
  // Network/5xx failures are recoverable, even for a new filter or the first
  // page. Never show raw server codes or old-filter rows as new search results.
  if(error instanceof TypeError||(error?.status>=500&&error.status<600)){
   if(previousSearch){
    notice('بازخوانی بانک موقتاً ناموفق بود؛ '+
     (state.bank.length?'نتایج قبلی و سؤال‌های انتخاب‌شده حفظ شدند.':'سؤال‌های انتخاب‌شده حفظ شدند.')+
     ' دوباره تلاش کن.',true);
   }else if(append){
    notice('دریافت سؤال‌های بیشتر موقتاً ناموفق بود؛ نتایج فعلی و سؤال‌های انتخاب‌شده حفظ شدند. دوباره تلاش کن.',true);
   }else{
    notice('جست‌وجوی بانک موقتاً ناموفق بود؛ نتایج جدید نمایش داده نشدند و سؤال‌های انتخاب‌شده حفظ شدند. برای تلاش دوباره «جست‌وجو و بازخوانی» را بزن.',true);
   }
   return;
  }
  throw error;
 }
 if(seq!==state.bankRequestSeq||key!==currentBankFilter())return;
 const incoming=Array.isArray(result.questions)?result.questions:[];
 const seen=new Set(append?state.bank.map(x=>x.id):[]);
 // De-duplicate within each API page as well as across pagination boundaries.
 const uniqueIncoming=incoming.filter(question=>{
  if(seen.has(question.id))return false;
  seen.add(question.id);
  return true;
 });
 state.bank=append?[...state.bank,...uniqueIncoming]:uniqueIncoming;
 // A broken API cursor must not trap the operator in endless pagination.
 if(append)state.seenBankCursors.add(cursor);
 const returnedCursor=typeof result.nextCursor==='string'&&result.nextCursor?result.nextCursor:null;
 const repeatedCursor=returnedCursor!==null&&state.seenBankCursors.has(returnedCursor);
 // Duplicate-only pages indicate a broken gateway; a genuinely empty page
 // may be a valid gap. Permit one manual continuation, never an endless chain.
 const noProgressPage=append&&incoming.length>0&&uniqueIncoming.length===0&&returnedCursor!==null;
 const emptyContinuation=append&&incoming.length===0&&returnedCursor!==null;
 state.emptyContinuationPages=emptyContinuation?state.emptyContinuationPages+1:0;
 const tooManyEmptyPages=state.emptyContinuationPages>=2;
 state.nextCursor=repeatedCursor||noProgressPage||tooManyEmptyPages?null:returnedCursor;
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
 // The loaded bank is only a page/filter subset. Absence is not evidence that a
 // selected revision is current, stale, or unapproved; compose validates it server-side.
 const visibleIds=new Set(state.bank.map(question=>question.id));
 const unchecked=state.selected.filter(question=>!visibleIds.has(question.id)).length;
 if(repeatedCursor)notice('نشانگر صفحه‌بندی تکراری دریافت شد؛ بارگذاری بیشتر متوقف شد. برای تلاش مجدد جست‌وجو را بازخوانی کن.',true);
 else if(noProgressPage)notice('صفحه بعدی سؤال تازه‌ای نداشت؛ بارگذاری بیشتر متوقف شد. برای بررسی مجدد «جست‌وجو و بازخوانی» را بزن. سؤال‌های انتخاب‌شده حفظ شدند.',true);
 else if(tooManyEmptyPages)notice('دو صفحه پیاپی خالی بود؛ برای جلوگیری از درخواست‌های بی‌نتیجه بارگذاری متوقف شد. «جست‌وجو و بازخوانی» را بزن.',true);
 else if(emptyContinuation)notice('این صفحه سؤال تازه‌ای نداشت؛ برای بررسی صفحه بعد «نمایش سؤال‌های بیشتر» را بزن.');
 else if(!warnOnStaleSelection(unchecked))notice(state.bank.length+' سؤال تأییدشده در فهرست است.'+
  (state.nextCursor?' برای موارد قدیمی‌تر «نمایش سؤال‌های بیشتر» را بزن.':'')+
  (unchecked?' '+new Intl.NumberFormat('fa-IR').format(unchecked)+' سؤال انتخاب‌شده در نتایج فعلی نیست و نسخه آن در این بازخوانی بررسی نشد.':'')+
  ' پیش از خروجی دوباره در سرور بررسی می‌شوند.');
}
async function manifest(){
 if(!state.selected.length)throw Error('سؤالی انتخاب نشده است');
 const requestedVersion=compositionVersion;
 // Capture the operator's exact draft options before awaiting the server.
 const requestedTitle=$('examTitle').value;
 const requestedAnswers=$('includeExamAnswers').checked;
 // A previous successful fingerprint must never appear valid after a failed revalidation.
 $('examFingerprint').textContent=fingerprintPlaceholder;
 const data=await api('/api/v1/bank/exams/compose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  title:requestedTitle,includeAnswers:requestedAnswers,
  questionIds:state.selected.map(x=>x.id),sourceRevisions:state.selected.map(x=>x.revision)
 })});
 // An operator may edit the draft while the network request is in flight.
 // Never display, preview or export a response for a superseded draft.
 if(requestedVersion!==compositionVersion)throw Error('آزمون هنگام ساخت خروجی تغییر کرد؛ برای نسخه جدید دوباره پیش‌نمایش یا خروجی بگیر.');
 if(data.status!=='draft_export_only'||data.manifest?.publishable!==false)throw Error('سرور خروجی امن برنگرداند');
 // A successful HTTP response is not proof that the export payload is usable.
 // Validate before showing a fingerprint, previewing, printing or downloading.
 const exam=data.manifest;
 if(typeof exam.title!=='string'||!exam.title.trim()||exam.title!==requestedTitle.trim()||
    exam.answersIncluded!==requestedAnswers||!Array.isArray(exam.items)||
    exam.items.length!==state.selected.length||!exam.items.every((item,index)=>
     item&&item.index===index+1&&item.id===state.selected[index].id&&
     Number.isSafeInteger(item.revision)&&item.revision===state.selected[index].revision&&
     typeof item.question==='string'&&item.question.trim()&&
     Object.prototype.hasOwnProperty.call(item,'answer')===requestedAnswers&&
     (!requestedAnswers||(typeof item.answer==='string'&&item.answer.trim()))))
  throw Error('پاسخ آزمون ناقص است؛ هیچ پیش‌نمایش یا خروجی ساخته نشد. دوباره تلاش کن.');
 if(data.manifestHash!==undefined&&!/^[a-f0-9]{64}$/i.test(data.manifestHash))throw Error('شناسه نسخه خروجی نامعتبر است');
 $('examFingerprint').textContent=data.manifestHash?'اثر انگشت نسخه ثبت‌شده: '+data.manifestHash:'خروجی آزمایشی فاقد شناسه سرور';
 return data.manifestHash?{...data.manifest,fingerprint:data.manifestHash}:data.manifest;
}
function download(text,name,type){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('examTitle').addEventListener('input',invalidateFingerprint);
$('includeExamAnswers').addEventListener('change',invalidateFingerprint);
$('loadBank').addEventListener('click',()=>void safe(()=>loadBank()));
$('composerQuery').addEventListener('keydown',event=>{
 // Search with Enter without requiring a pointer; do not submit during IME composition.
 if(event.key!=='Enter'||event.isComposing||event.repeat||!state.ready||state.bankLoading)return;
 event.preventDefault();
 void safe(()=>loadBank());
});

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
// Bootstrap access errors should be recoverable after the operator signs in
// or an administrator grants access, without losing the draft or reloading.
let bootstrapBusy=false;
async function bootstrap(){
 if(bootstrapBusy||state.ready)return;
 bootstrapBusy=true;
 const retry=$('retryComposerBootstrap');
 const retryWasFocused=document.activeElement===retry;
 retry.hidden=true;retry.disabled=true;
 notice('در حال بررسی ورود و دسترسی…');
 try{
  await safe(async()=>{
   const session=await api('/api/session');if(session.role!=='operator')throw Error('ورود به حساب اپراتور لازم است');
   const projects=await api('/api/v1/projects');
   // Fail closed on malformed successful responses. Never unlock bank search
   // with a partial project list or leave half-populated options on screen.
   if(!Array.isArray(projects?.projects)||!projects.projects.every(p=>
    p&&typeof p.id==='string'&&p.id.trim()&&typeof p.name==='string'&&p.name.trim()))
    throw Error('فهرست پروژه‌ها نامعتبر است؛ برای تلاش دوباره دکمه بررسی ورود و دسترسی را بزن.');
   const select=$('composerProject');select.replaceChildren(new Option('همه پروژه‌های خودم',''));
   projectNames.clear();
   for(const p of projects.projects){select.add(new Option(p.name,p.id));projectNames.set(p.id,p.name)}
   select.disabled=false;state.ready=true;await loadBank();
  });
 }finally{
  bootstrapBusy=false;
  // Failed session/project initialization can be retried manually; never
  // bypass the API authorization checks or start background polling.
  retry.hidden=state.ready;retry.disabled=false;
  if(retryWasFocused&&document.activeElement===document.body){
   (state.ready?$('composerProject'):retry).focus();
  }
 }
}
$('retryComposerBootstrap').addEventListener('click',()=>void bootstrap());
void bootstrap();
