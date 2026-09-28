import {ReviewModel,questionIssues,reviewStatusLabel} from './model.js';
import {createLocalReviewApi} from './api.js';
import {difficultyLabel,subjectLabel,gradeLabel} from '../studio/store.js';
import {mountBiologyCombinationEditor} from '../studio/biology-combination.js';
import {isTypingTarget,createCommandPalette,toast} from '../studio/ui-runtime.js';
import {installWindowsMetadataShortcuts} from '../studio/windows-shortcuts.js';
import {TAXONOMY,taxonomySummary} from '../studio/taxonomy-data.js';

const $=value=>String(value).startsWith("#")?document.querySelector(value):document.getElementById(value);
const ADMIN_SESSION='selection-review-admin-user-v1';
const ADMIN_USERNAME='admin';
const ADMIN_PASSWORD='admin';
let selectedSubject='',selectedOperator='',operatorItems=[],quickIndex=-1,autosaveTimer=null,currentReason='',pendingSaveBatch=null,sourceLoadGeneration=0,operatorLoadGeneration=0,batchLoadGeneration=0,hydratingQuick=false,quickSourceReady={question:false,answer:false};

function adminUser(){return sessionStorage.getItem(ADMIN_SESSION)||''}
function reviewer(){return adminUser()||ADMIN_USERNAME}
function asciiDigits(value){return String(value||'').replace(/[۰-۹]/g,ch=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)).replace(/[٠-٩]/g,ch=>'٠١٢٣٤٥٦٧٨٩'.indexOf(ch))}

const api=createLocalReviewApi();
const model=new ReviewModel(()=>scheduleSave());

function fillQuickSelect(el,items,selected=""){
  el.innerHTML='<option value="">-</option>'+items.map(([value,label])=>`<option value="${value}">${label}</option>`).join("");
  el.value=items.some(([value])=>value===selected)?selected:"";
}
function quickCfg(){return TAXONOMY.subjects[$('#quickSubject').value]||{}}
function quickIsMath(){return $('#quickSubject').value==='MATH'}
function syncQuickMathGrade(){
  if(!quickIsMath())return;
  const unit=quickCfg().topics?.[$('#quickChapter').value]?.units?.[$('#quickUnit').value];
  if(unit?.grade)$('#quickGrade').value=String(unit.grade);
}
function renderQuickUnits(selected=""){
  const cfg=quickCfg(),chapter=$('#quickChapter').value;
  const units=quickIsMath()?cfg.topics?.[chapter]?.units:cfg.grades?.[$('#quickGrade').value]?.chapters?.[chapter]?.units;
  fillQuickSelect($('#quickUnit'),Object.entries(units||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,item])=>[id,quickIsMath()?(item.label_fa||item.name_fa):`${Number(id)} — ${item.name_fa}`]),selected);
  syncQuickMathGrade();
}
function renderQuickTaxonomy({chapter="",unit=""}={}){
  const cfg=quickCfg(),math=quickIsMath();
  $('#quickGradeField').hidden=math;
  $('#quickSubjectGradeRow').classList.toggle('single',math);
  $('#quickChapterLabel').textContent=cfg.chapter_name_fa||'فصل';
  $('#quickUnitLabel').textContent=cfg.unit_name_fa||($('#quickSubject').value==='BIO'?'گفتار':'مبحث');
  const chapters=math?cfg.topics:cfg.grades?.[$('#quickGrade').value]?.chapters;
  fillQuickSelect($('#quickChapter'),Object.entries(chapters||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,item])=>[id,`${Number(id)} — ${item.name_fa}`]),chapter);
  renderQuickUnits(unit);
}

const quickBio=mountBiologyCombinationEditor({
  host:$('#quickBioPanel'),subjectEl:$('#quickSubject'),gradeEl:$('#quickGrade'),chapterEl:$('#quickChapter'),unitEl:$('#quickUnit'),
  onChange:value=>{if(quickIndex>=0)model.patch(quickIndex,{biology_combination:value},reviewer())},
  onGateChange:()=>renderQuickIssues()
});

async function showAdmin(){
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  resetBrowser();
}
function login(event){
  event?.preventDefault();
  const user=$('#adminUsername').value.trim(),pass=$('#adminPassword').value;
  if(user!==ADMIN_USERNAME||pass!==ADMIN_PASSWORD){
    $('#adminLoginError').textContent='نام کاربری یا رمز عبور اشتباه است.';
    $('#adminPassword').value='';
    $('#adminPassword').focus();
    return;
  }
  sessionStorage.setItem(ADMIN_SESSION,user);
  $('#adminLoginError').textContent='';
  $('#loginView').classList.add('auth-success');
  document.querySelector('.login-card')?.classList.add('auth-success');
  $('#adminUsername').disabled=true;
  $('#adminPassword').disabled=true;
  $('#loginBtn').disabled=true;
  $('#loginBtn').textContent='ورود موفق';
  setTimeout(showAdmin,180);
}
$('#adminLoginForm').addEventListener('submit',login);

function statusClass(s){return s||'pending'}

$('#logoutBtn').onclick=async()=>{
  try{await flushPendingSave()}
  catch(e){$('#autosaveState').textContent='خطا';toast('خروج متوقف شد؛ ذخیرهٔ تغییرها ناموفق بود: '+e.message,'error');return}
  sessionStorage.removeItem(ADMIN_SESSION);
  location.reload();
};
$('#refreshBtn').onclick=async()=>{
  try{
    await flushPendingSave();
    const subject=selectedSubject,operator=selectedOperator;
    if(subject)await loadOperators(subject);
    if(subject&&operator&&selectedSubject===subject)await openOperator(operator,{skipFlush:true});
  }catch(e){toast('بروزرسانی ناموفق: '+e.message,'error')}
};

function resetBrowser(){
  operatorLoadGeneration++;batchLoadGeneration++;sourceLoadGeneration++;
  selectedSubject='';selectedOperator='';operatorItems=[];model.batch=null;model.undoStack=[];syncUndoControls();
  document.querySelectorAll('[data-subject]').forEach(btn=>btn.classList.remove('active'));
  $('#operatorHint').textContent='اول درس را انتخاب کن.';
  $('#operatorList').innerHTML='<div class="empty-box">درسی انتخاب نشده.</div>';
  $('#emptyBatch').classList.remove('hidden');
  $('#emptyBatch').textContent='درس و سپس username گزینشگر را انتخاب کن.';
  $('#batchEditor').classList.add('hidden');
}
document.querySelectorAll('[data-subject]').forEach(btn=>btn.onclick=async()=>{
  try{await flushPendingSave()}
  catch(e){$('#autosaveState').textContent='خطا';toast('تغییر درس متوقف شد؛ ذخیرهٔ تغییرها ناموفق بود: '+e.message,'error');return}
  batchLoadGeneration++;sourceLoadGeneration++;
  selectedSubject=btn.dataset.subject;selectedOperator='';model.batch=null;model.undoStack=[];syncUndoControls();
  document.querySelectorAll('[data-subject]').forEach(x=>x.classList.toggle('active',x===btn));
  $('#batchEditor').classList.add('hidden');$('#emptyBatch').classList.remove('hidden');
  $('#emptyBatch').textContent='حالا username گزینشگر را انتخاب کن.';
  try{await loadOperators(selectedSubject)}
  catch(e){toast('بارگذاری گزینشگرها ناموفق: '+e.message,'error')}
});

async function loadOperators(subject){
  const request=++operatorLoadGeneration;
  $('#operatorHint').textContent=subjectLabel(subject)+' · در حال بارگذاری…';
  const host=$('#operatorList');host.innerHTML='<div class="empty-box">در حال بارگذاری گزینشگرها…</div>';
  const items=await api.operators(subject);
  if(request!==operatorLoadGeneration||selectedSubject!==subject)return false;
  operatorItems=items;
  $('#operatorHint').textContent=subjectLabel(subject)+' · '+operatorItems.length+' گزینشگر';
  host.innerHTML='';
  if(!operatorItems.length){host.innerHTML='<div class="empty-box">برای این درس هنوز گزینشگری تست ثبت نکرده.</div>';return true}
  for(const item of operatorItems){
    const btn=document.createElement('button');
    btn.type='button';btn.className='operator-item';
    const name=document.createElement('strong'),total=document.createElement('span'),pending=document.createElement('small');
    name.textContent='@'+item.username;total.textContent=item.total+' تست';pending.textContent=item.pending+' در انتظار بررسی';
    btn.append(name,total,pending);
    btn.classList.toggle('active',item.username===selectedOperator);
    btn.onclick=()=>openOperator(item.username);
    host.appendChild(btn);
  }
  return true;
}
async function openOperator(username,{skipFlush=false}={}){
  const request=++batchLoadGeneration,subject=selectedSubject;
  try{
    if(!skipFlush)await flushPendingSave();
    if(request!==batchLoadGeneration||selectedSubject!==subject)return false;
    const previousBatchId=model.batch?.id||null;
    const batch=await api.batch(subject,username);
    if(request!==batchLoadGeneration||selectedSubject!==subject)return false;
    await api.lock(batch.id,reviewer()).catch(()=>{});
    if(request!==batchLoadGeneration||selectedSubject!==subject){
      await api.unlock(batch.id,reviewer()).catch(()=>{});
      return false;
    }
    if(previousBatchId&&previousBatchId!==batch.id)await api.unlock(previousBatchId,reviewer()).catch(()=>{});
    selectedOperator=username;
    model.load(batch);
    syncUndoControls();
    $('#emptyBatch').classList.add('hidden');$('#batchEditor').classList.remove('hidden');
    await loadOperators(subject);
    if(request!==batchLoadGeneration||selectedSubject!==subject)return false;
    renderBatch();
    return true;
  }catch(e){
    if(request===batchLoadGeneration&&selectedSubject===subject)toast('باز کردن تست‌های گزینشگر ناموفق: '+e.message,'error');
    return false;
  }
}

function filters(){return {search:$('#searchInput').value,status:$('#statusFilter').value,difficulty:$('#difficultyFilter').value,exam:$('#examFilter').value,incomplete:$('#incompleteFilter').checked}}
function renderBatch(){
  if(!model.batch)return;
  const c=model.counts(),total=c.pending+c.approved+c.needs_changes+c.rejected,reviewed=total-c.pending;
  $('#batchTitle').textContent=subjectLabel(selectedSubject)+' · @'+selectedOperator;
  $('#batchMeta').textContent=`${total} تست گزینش‌شده توسط این گزینشگر`;
  $('#approvedCount').textContent=c.approved;$('#needsCount').textContent=c.needs_changes;$('#rejectedCount').textContent=c.rejected;$('#pendingCount').textContent=c.pending;
  $('#progressBar').style.width=(total?Math.round(reviewed/total*100):0)+'%';$('#completionState').classList.toggle('hidden',!(total>0&&c.pending===0));
  const publishable=model.batch.questions.filter(q=>!q.trashed_at&&(q.review_status||'pending')==='approved'&&q.status!=='published'&&!questionIssues(q).length).length;
  $('#publishBtn').disabled=publishable===0;
  $('#publishBtn').dataset.publishable=String(publishable);
  syncExamFilter();
  const host=$('#questionList');host.innerHTML='';
  const indexes=model.visibleIndexes(filters());
  if(!indexes.length){host.innerHTML='<div class="empty-box">سوالی با این فیلتر نیست.</div>';return}
  for(const index of indexes){
    const q=model.batch.questions[index],frag=$('#questionItem').content.cloneNode(true),card=frag.querySelector('.review-question');
    card.dataset.status=q.review_status||'pending';frag.querySelector('.q-title').textContent='سؤال '+q.source_question_number;
    frag.querySelector('.status-badge').textContent=reviewStatusLabel(q.review_status||'pending');
    frag.querySelector('.q-meta').textContent=`${q.exam_id||'-'} · ${taxonomySummary(q)} · ${difficultyLabel(q.difficulty)} · کلید ${q.correct_option||'-'}`;
    frag.querySelector('.q-issues').innerHTML=questionIssues(q).map(x=>`<span>${x}</span>`).join('');
    frag.querySelector('.open-review').onclick=()=>openQuick(index);host.appendChild(frag);
  }
}
function syncExamFilter(){
  const select=$('#examFilter'),current=select.value;
  const exams=[...new Set((model.batch?.questions||[]).filter(q=>!q.trashed_at).map(q=>q.exam_id).filter(Boolean))].sort();
  const signature=JSON.stringify(exams);
  if(select.dataset.options!==signature){
    select.replaceChildren();
    const all=document.createElement('option');all.value='';all.textContent='همه آزمون‌ها';select.append(all);
    exams.forEach(id=>{const option=document.createElement('option');option.value=id;option.textContent=id;select.append(option)});
    select.dataset.options=signature;select.value=exams.includes(current)?current:'';
  }
}
['searchInput','statusFilter','examFilter','difficultyFilter','incompleteFilter'].forEach(id=>$('#'+id).addEventListener(id==='searchInput'?'input':'change',renderBatch));
$('#clearReviewFilters').onclick=()=>{
  $('#searchInput').value='';
  $('#statusFilter').value='';
  $('#examFilter').value='';
  $('#difficultyFilter').value='';
  $('#incompleteFilter').checked=false;
  renderBatch();
};

function syncUndoControls(){
  const disabled=model.undoStack.length===0;
  $('#undoBtn').disabled=disabled;
  $('#quickUndoBtn').disabled=disabled;
}
async function persistBatchSnapshot(batch){
  if(!batch)return;
  await api.save(batch);
  if(model.batch?.id===batch.id)$('#autosaveState').textContent='ذخیره در این مرورگر';
}
async function flushPendingSave(){
  clearTimeout(autosaveTimer);autosaveTimer=null;
  const batch=pendingSaveBatch;pendingSaveBatch=null;
  if(!batch)return;
  await persistBatchSnapshot(batch);
}
function scheduleSave(){
  if(!model.batch)return;
  pendingSaveBatch=structuredClone(model.batch);
  $('#autosaveState').textContent='در حال ذخیرهٔ محلی…';
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>flushPendingSave().catch(e=>{$('#autosaveState').textContent='خطا';toast(e.message,'error')}),650);
  syncUndoControls();
  renderBatch();
}
async function saveBatch(){
  if(!model.batch)return;
  pendingSaveBatch=structuredClone(model.batch);
  await flushPendingSave();
}
$('#saveBtn').onclick=()=>saveBatch().then(()=>toast('تغییرها در این مرورگر ذخیره شد','ok')).catch(e=>toast(e.message,'error'));
$('#undoBtn').onclick=()=>{if(model.undo())toast('Undo انجام شد','ok');syncUndoControls()};
$('#publishBtn').onclick=async()=>{
  const count=Number($('#publishBtn').dataset.publishable||0);
  if(!count)return;
  const accepted=window.confirm(`تعداد ${count} سؤال تأییدشده از ${subjectLabel(selectedSubject)} · @${selectedOperator} به‌صورت محلی برای انتشار آزمایشی ثبت شود؟`);
  if(!accepted)return;
  try{
    await saveBatch();
    const r=await api.publish(model.batch.id,reviewer());
    toast(`وضعیت انتشار آزمایشی در همین مرورگر ثبت شد: ${r?.published_count??0} سؤال`,'ok');
    await loadOperators(selectedSubject);
    await openOperator(selectedOperator,{skipFlush:true});
  }catch(e){toast('ثبت وضعیت ناموفق: '+e.message,'error')}
};
window.addEventListener('pagehide',()=>{if(pendingSaveBatch)api.save(pendingSaveBatch).catch(()=>{})});

function setQuickChoice(target,value){
  $('#'+target).value=value?String(value):'';
  document.querySelectorAll(`[data-target="${target}"] button`).forEach(b=>b.classList.toggle('active',b.dataset.value===String(value||'')));
  if(!hydratingQuick)syncQuickMeta();
}
document.querySelectorAll('[data-target] button').forEach(b=>b.onclick=()=>setQuickChoice(b.closest('[data-target]').dataset.target,b.dataset.value));
function syncBiologyOnlyReviewUi(){
  const bio=$('#quickSubject').value==='BIO',reason=$('#biologyCorrectionReason');
  if(reason){reason.hidden=!bio;reason.classList.toggle('hidden',!bio)}
  if(!bio&&currentReason==='biology_combination'){currentReason='';reason?.classList.remove('active')}
}
$('#quickSubject').addEventListener('change',()=>{renderQuickTaxonomy();syncBiologyOnlyReviewUi();syncQuickMeta()});
$('#quickGrade').addEventListener('change',()=>{if(!quickIsMath())renderQuickTaxonomy();syncQuickMeta()});
$('#quickChapter').addEventListener('change',()=>{renderQuickUnits();syncQuickMeta()});
$('#quickUnit').addEventListener('change',()=>{syncQuickMathGrade();syncQuickMeta()});

async function loadSource(img,kind,generation){
  const zoom=img.parentElement.querySelector('.image-expand');
  const baseAlt=kind==='question'?'برش سؤال':'برش پاسخ';
  quickSourceReady[kind]=false;
  img.alt=baseAlt;img.removeAttribute('src');zoom.disabled=true;renderQuickIssues();
  if(!model.batch||quickIndex<0)return;
  const batchId=model.batch.id,q=model.batch.questions[quickIndex],questionId=q.id;
  try{
    const blob=await api.source(batchId,questionId,kind);
    if(generation!==sourceLoadGeneration||model.batch?.id!==batchId||model.batch?.questions?.[quickIndex]?.id!==questionId)return;
    const url=URL.createObjectURL(blob);
    quickSourceReady[kind]=true;
    img.src=url;img.alt=baseAlt;zoom.disabled=false;renderQuickIssues();
    img.onload=()=>URL.revokeObjectURL(url);
    img.onerror=()=>{URL.revokeObjectURL(url);quickSourceReady[kind]=false;zoom.disabled=true;renderQuickIssues()};
  }catch{
    if(generation!==sourceLoadGeneration||model.batch?.id!==batchId||model.batch?.questions?.[quickIndex]?.id!==questionId)return;
    quickSourceReady[kind]=false;img.removeAttribute('src');img.alt='پیش‌نمایش در دسترس نیست';zoom.disabled=true;renderQuickIssues();
  }
}
function openQuick(index){
  quickIndex=index;const q=model.batch.questions[index];if(!q)return;
  syncUndoControls();
  const visible=model.visibleIndexes(filters()),position=visible.indexOf(index);
  $('#quickId').textContent=q.id;$('#quickPosition').textContent='سؤال '+q.source_question_number+' · '+(position>=0?position+1:index+1)+'/'+(visible.length||model.batch.questions.length)+' در صف';
  $('#quickViewers').dataset.activeView='question';document.querySelectorAll('[data-review-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.reviewView==='question')));
  hydratingQuick=true;
  try{
    $('#quickSubject').value=q.subject;$('#quickGrade').value=String(q.grade);renderQuickTaxonomy({chapter:q.chapter||'',unit:q.unit||''});
    setQuickChoice('quickDifficulty',q.difficulty||'');setQuickChoice('quickOption',q.correct_option||'');
    quickBio.setValue(q.subject==='BIO'?q.biology_combination:null,false);syncBiologyOnlyReviewUi();
  }finally{hydratingQuick=false}
  quickSourceReady={question:false,answer:false};
  const generation=++sourceLoadGeneration;
  loadSource($('#quickQuestionImage'),'question',generation);loadSource($('#quickAnswerImage'),'answer',generation);
  resetCorrection();renderQuickIssues();renderReviewHistory(model.batch.questions[index]);
  if(!$('#quickDialog').open)$('#quickDialog').showModal();
}
function syncQuickMeta(){
  if(quickIndex<0||!model.batch)return;const q=model.batch.questions[quickIndex];
  const values={subject:$('#quickSubject').value,grade:Number($('#quickGrade').value),chapter:$('#quickChapter').value,unit:$('#quickUnit').value,difficulty:$('#quickDifficulty').value,correct_option:Number($('#quickOption').value)||null,biology_combination:$('#quickSubject').value==='BIO'?quickBio.getValue():null};
  const changed=JSON.stringify(values)!==JSON.stringify({subject:q.subject,grade:q.grade,chapter:q.chapter,unit:q.unit,difficulty:q.difficulty,correct_option:q.correct_option,biology_combination:q.biology_combination??null});
  if(changed)model.patch(quickIndex,values,reviewer());
  renderQuickIssues();
  if(changed)renderReviewHistory(model.batch.questions[quickIndex]);
}
function renderQuickIssues(){
  if(quickIndex<0||!model.batch)return;
  const issues=questionIssues(model.batch.questions[quickIndex]);
  const sourcesReady=quickSourceReady.question&&quickSourceReady.answer;
  const displayed=[...issues,...(sourcesReady?[]:['پیش‌نمایش سؤال و پاسخ باید در دسترس باشد'])];
  $('#quickIssues').innerHTML=displayed.length?displayed.map(x=>'<span>'+x+'</span>').join(''):'<span class="issue-ready">همه موارد لازم کامل است.</span>';
  $('#approveBtn').disabled=Boolean(issues.length||!sourcesReady);
}
function renderReviewHistory(q){
  const events=(q.revision_history||[]).slice(-4).reverse();
  const host=$('#reviewHistory');host.replaceChildren();
  const title=document.createElement('strong');title.textContent='سابقهٔ بازبینی';host.append(title);
  const reasonNames={question_crop:'برش سؤال',answer_crop:'برش پاسخ',taxonomy:'طبقه‌بندی',answer_key:'کلید پاسخ',biology_combination:'ترکیب زیست',other:'سایر'};
  const current=document.createElement('span');current.textContent='وضعیت فعلی: '+reviewStatusLabel(q.review_status||'pending')+(q.review_reason?' · دلیل: '+(reasonNames[q.review_reason]||q.review_reason):'')+(q.review_note?' · '+q.review_note:'');host.append(current);
  if(!events.length){const empty=document.createElement('span');empty.textContent='هنوز تغییری ثبت نشده.';host.append(empty);return}
  const labels={difficulty:'سطح',correct_option:'کلید',subject:'درس',grade:'پایه',chapter:'فصل',unit:'مبحث',review_status:'وضعیت',review_reason:'دلیل',review_note:'یادداشت'};
  const value=(key,item)=>item==null?'ثبت نشده':key==='difficulty'?difficultyLabel(item):key==='subject'?subjectLabel(item):key==='grade'?gradeLabel(item):key==='review_status'?reviewStatusLabel(item):String(item);
  events.forEach(event=>{
    const row=document.createElement('span'),date=event.at?new Date(event.at).toLocaleString('fa-IR'):'';
    const changes=Object.entries(event.changes||{}).filter(([key])=>labels[key]).map(([key,change])=>labels[key]+': '+value(key,change.before)+' به '+value(key,change.after));
    row.textContent=[event.action||'ویرایش',changes.join('، '),event.reviewer||'مدیر',date].filter(Boolean).join(' · ');host.append(row);
  });
}
function nextIndex(delta){
  if(!model.batch)return;
  const next=model.nextVisibleIndex(quickIndex,delta,filters());
  if(next<0){toast(delta>0?'به پایان صف فعلی رسیدی.':'ابتدای صف فعلی است.','ok');return}
  openQuick(next);
}
$('#prevBtn').onclick=()=>nextIndex(-1);$('#nextBtn').onclick=()=>nextIndex(1);$('#quickClose').onclick=()=>{sourceLoadGeneration++;quickSourceReady={question:false,answer:false};$('#quickDialog').close()};
$('#quickUndoBtn').onclick=()=>{if(!model.undo()){toast('تغییری برای بازگردانی نیست.','ok');return}syncUndoControls();$('#quickDialog').close();openQuick(quickIndex)};
document.querySelectorAll('[data-review-view]').forEach(button=>button.addEventListener('click',()=>{
  $('#quickViewers').dataset.activeView=button.dataset.reviewView;
  document.querySelectorAll('[data-review-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
}));
document.querySelectorAll('.image-expand').forEach(button=>button.addEventListener('click',()=>{
  const image=$('#'+button.dataset.image),viewer=$('#reviewImage');viewer.src=image.src;viewer.alt=image.alt;
  $('#reviewImageTitle').textContent=image.alt;$('#reviewImageDialog').showModal();
}));
$('#reviewImageClose').onclick=()=>$('#reviewImageDialog').close();
function advanceAfterDecision(){
  const next=model.nextVisibleIndex(quickIndex,1,filters());
  if(next>=0){openQuick(next);return}
  sourceLoadGeneration++;
  resetCorrection();
  $('#quickDialog').close();
  renderBatch();
  toast('به پایان این بخش از صف بررسی رسیدی.','ok');
}
$('#approveBtn').onclick=()=>{syncQuickMeta();if(questionIssues(model.batch.questions[quickIndex]).length||!quickSourceReady.question||!quickSourceReady.answer){toast('سؤال هنوز شرط‌های کیفیت یا فایل‌های منبع را کامل نکرده است.','error');return}model.setStatus(quickIndex,'approved',reviewer());advanceAfterDecision()};
$('#rejectBtn').onclick=()=>{syncQuickMeta();model.setStatus(quickIndex,'rejected',reviewer());advanceAfterDecision()};
$('#needsBtn').onclick=()=>{$('#correctionSheet').classList.remove('hidden')};
function resetCorrection(){currentReason='';$('#correctionSheet').classList.add('hidden');$('#correctionNote').value='';document.querySelectorAll('[data-reason]').forEach(b=>b.classList.remove('active'))}
document.querySelectorAll('[data-reason]').forEach(b=>b.onclick=()=>{currentReason=b.dataset.reason;document.querySelectorAll('[data-reason]').forEach(x=>x.classList.toggle('active',x===b))});
$('#cancelCorrection').onclick=resetCorrection;$('#confirmCorrection').onclick=()=>{if(!currentReason){toast('علت اصلاح را انتخاب کن.','error');return}syncQuickMeta();model.setStatus(quickIndex,'needs_changes',reviewer(),$('#correctionNote').value.trim()||null,currentReason);resetCorrection();advanceAfterDecision()};
$('#quickReviewBtn').onclick=()=>{const i=model.firstPending(filters());if(i<0){toast('در این صف سؤال بررسی‌نشده‌ای نیست.','ok');return}openQuick(i)};

installWindowsMetadataShortcuts({
  enabled:()=>$('#quickDialog').open&&!$('#commandPalette').open&&$('#correctionSheet').classList.contains('hidden')&&matchMedia('(pointer:fine)').matches&&innerWidth>=900,
  setCorrectOption:n=>setQuickChoice('quickOption',n),setLevel:n=>setQuickChoice('quickDifficulty','level_'+n),
  gradeEnabled:()=>!quickIsMath(),
  setGrade:g=>{$('#quickGrade').value=String(g);$('#quickGrade').dispatchEvent(new Event('change',{bubbles:true}))},
  setChapter:n=>{$('#quickChapter').value=String(n).padStart(2,'0');$('#quickChapter').dispatchEvent(new Event('change',{bubbles:true}))},
  setUnit:n=>{$('#quickUnit').value=String(n).padStart(2,'0');$('#quickUnit').dispatchEvent(new Event('change',{bubbles:true}))}
});

document.addEventListener('keydown',e=>{
  if(!adminUser())return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();palette.open();return}
  if(!$('#quickDialog').open||$('#commandPalette').open||isTypingTarget(e.target)||!$('#correctionSheet').classList.contains('hidden'))return;
  const k=e.key.toLowerCase();if(k==='a'){e.preventDefault();$('#approveBtn').click()}if(k==='f'){e.preventDefault();$('#needsBtn').click()}if(k==='r'){e.preventDefault();$('#rejectBtn').click()}if(e.key==='ArrowLeft'){e.preventDefault();$('#prevBtn').click()}if(e.key==='ArrowRight'){e.preventDefault();$('#nextBtn').click()}
});

const palette=createCommandPalette({dialog:$('#commandPalette'),input:$('#commandInput'),list:$('#commandList'),getCommands:()=>{
  const cmds=[{label:'بروزرسانی',run:()=>$('#refreshBtn').click()},{label:'شروع / ادامه بررسی',run:()=>$('#quickReviewBtn').click()}];
  if($('#quickDialog').open)cmds.unshift({label:'تایید سوال',shortcut:'A',run:()=>$('#approveBtn').click()},{label:'نیاز به اصلاح',shortcut:'F',run:()=>$('#needsBtn').click()},{label:'رد سوال',shortcut:'R',run:()=>$('#rejectBtn').click()});
  return cmds;
},onQuery:q=>{const m=asciiDigits(q).match(/(?:سوال|q|question)?\s*(\d{1,4})/i);if(!m||!model.batch)return[];const n=Number(m[1]),i=model.batch.questions.findIndex(x=>Number(x.source_question_number)===n&&!x.trashed_at);return i<0?[]:[{label:`باز کردن سؤال ${n}`,run:()=>openQuick(i)}]}});
$('#commandLauncher').onclick=()=>palette.open();

syncUndoControls();
if(adminUser())showAdmin();
else requestAnimationFrame(()=>$('#adminUsername').focus());
