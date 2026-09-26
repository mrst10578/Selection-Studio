import {ReviewModel,questionIssues,reviewStatusLabel} from './model.js';
import {createLocalReviewApi} from './api.js';
import {difficultyLabel,subjectLabel,gradeLabel} from '../studio/store.js';
import {mountBiologyCombinationEditor} from '../studio/biology-combination.js';
import {installAdaptiveDensity,isTypingTarget,createCommandPalette,toast} from '../studio/ui-runtime.js';
import {installWindowsMetadataShortcuts} from '../studio/windows-shortcuts.js';
import {TAXONOMY,taxonomySummary} from '../studio/taxonomy-data.js';

const $=id=>document.getElementById(id);
const ADMIN_SESSION='selection-review-admin-user-v1';
const ADMIN_USERNAME='admin';
const ADMIN_PASSWORD='admin';
let queueStatus='pending', queueItems=[], quickIndex=-1, autosaveTimer=null, currentReason='';

function adminUser(){return sessionStorage.getItem(ADMIN_SESSION)||''}
function reviewer(){return adminUser()||ADMIN_USERNAME}

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
  try{
    await loadQueue('pending');
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
  }catch(e){toast('باز کردن پنل ناموفق: '+e.message,'error')}
}
function login(event){
  event?.preventDefault();
  const user=$('#adminUsername').value.trim(),pass=$('#adminPassword').value;
  if(user!==ADMIN_USERNAME||pass!==ADMIN_PASSWORD){
    $('#adminLoginError').textContent='Username یا Password اشتباه است.';
    $('#adminPassword').value='';
    $('#adminPassword').focus();
    return;
  }
  sessionStorage.setItem(ADMIN_SESSION,user);
  $('#adminLoginError').textContent='';
  $('#loginView').classList.add('auth-success');
  $('.login-card')?.classList?.add?.('auth-success');
  $('#adminUsername').disabled=true;
  $('#adminPassword').disabled=true;
  $('#loginBtn').disabled=true;
  $('#loginBtn').textContent='ورود موفق';
  setTimeout(showAdmin,1500);
}
$('#adminLoginForm').addEventListener('submit',login);

function statusClass(s){return s||'pending'}

async function login(){
  saveSettings();
  if(!workerUrl()||!adminKey()||!reviewer()){toast('Worker، کلید مدیر و نام بازبین لازم است.','error');return}
  try{await loadQueue('pending');$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden')}catch(e){toast('ورود ناموفق: '+e.message,'error')}
}
$('#logoutBtn').onclick=()=>{sessionStorage.removeItem(ADMIN_SESSION);location.reload()};
$('#refreshBtn').onclick=()=>loadQueue(queueStatus).catch(e=>toast(e.message,'error'));

document.querySelectorAll('[data-queue]').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('[data-queue]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');loadQueue(btn.dataset.queue).catch(e=>toast(e.message,'error'))});

async function loadQueue(status){
  queueStatus=status;
  const result=await api.list(status);
  queueItems=Array.isArray(result)?result:(result?.items||result?.batches||[]);
  renderQueue();
}
function renderQueue(){
  const host=$('#batchList');host.innerHTML='';
  if(!queueItems.length){host.innerHTML='<div class="empty-box">صف خالی است.</div>';return}
  for(const item of queueItems){
    const frag=$('#batchItem').content.cloneNode(true),btn=frag.querySelector('.batch-item');
    btn.querySelector('strong').textContent=item.exam_label||item.exam_id||item.id;
    btn.querySelector('span').textContent=`${item.question_count||0} سوال · ${item.submitted_by||'-'}`;
    btn.querySelector('small').textContent=`بررسی‌شده ${item.reviewed_count||0}/${item.question_count||0}`;
    btn.classList.toggle('active',model.batch?.id===item.id);
    btn.onclick=()=>openBatch(item.id,status);
    host.appendChild(frag);
  }
}

async function openBatch(id,status=queueStatus){
  try{
    if(model.batch?.id&&model.batch.id!==id){await api.unlock(model.batch.id,reviewer()).catch(()=>{})}
    const result=await api.batch(status,id);const batch=result?.batch||result;
    await api.lock(batch.id,reviewer()).catch(()=>{});
    model.load(batch);$('#emptyBatch').classList.add('hidden');$('#batchEditor').classList.remove('hidden');renderBatch();renderQueue();
  }catch(e){toast('باز کردن Batch ناموفق: '+e.message,'error')}
}

function filters(){return {search:$('#searchInput').value,status:$('#statusFilter').value,difficulty:$('#difficultyFilter').value,incomplete:$('#incompleteFilter').checked}}
function renderBatch(){
  if(!model.batch)return;
  const c=model.counts(),total=c.pending+c.approved+c.needs_changes+c.rejected,reviewed=total-c.pending;
  $('#batchTitle').textContent=model.batch.exam?.provider?`${model.batch.exam.provider} — ${model.batch.exam.date||''}`:(model.batch.exam?.id||model.batch.id);
  $('#batchMeta').textContent=`اپراتور ${model.batch.submitted_by||'-'} · ${total} سوال`;
  $('#approvedCount').textContent=c.approved;$('#needsCount').textContent=c.needs_changes;$('#rejectedCount').textContent=c.rejected;$('#pendingCount').textContent=c.pending;
  $('#progressBar').style.width=(total?Math.round(reviewed/total*100):0)+'%';$('#completionState').classList.toggle('hidden',!(total>0&&c.pending===0));
  $('#publishBtn').disabled=c.approved===0;
  const host=$('#questionList');host.innerHTML='';
  const indexes=model.visibleIndexes(filters());
  if(!indexes.length){host.innerHTML='<div class="empty-box">سوالی با این فیلتر نیست.</div>';return}
  for(const index of indexes){
    const q=model.batch.questions[index],frag=$('#questionItem').content.cloneNode(true),card=frag.querySelector('.review-question');
    card.dataset.status=q.review_status||'pending';frag.querySelector('.q-title').textContent='سوال '+q.source_question_number;
    frag.querySelector('.status-badge').textContent=reviewStatusLabel(q.review_status||'pending');
    frag.querySelector('.q-meta').textContent=`${subjectLabel(q.subject)} · ${taxonomySummary(q)} · ${difficultyLabel(q.difficulty)} · کلید ${q.correct_option||'-'}`;
    frag.querySelector('.q-issues').innerHTML=questionIssues(q).map(x=>`<span>${x}</span>`).join('');
    frag.querySelector('.open-review').onclick=()=>openQuick(index);host.appendChild(frag);
  }
}
['searchInput','statusFilter','difficultyFilter','incompleteFilter'].forEach(id=>$('#'+id).addEventListener(id==='searchInput'?'input':'change',renderBatch));

function scheduleSave(){
  $('#autosaveState').textContent='در حال ذخیره…';clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveBatch().catch(e=>{$('#autosaveState').textContent='خطا';toast(e.message,'error')}),650);renderBatch();
}
async function saveBatch(){if(!model.batch)return;await api.save(model.batch);$('#autosaveState').textContent='ذخیره شد'}
$('#saveBtn').onclick=()=>saveBatch().then(()=>toast('ذخیره شد','ok')).catch(e=>toast(e.message,'error'));
$('#undoBtn').onclick=()=>{if(model.undo())toast('Undo انجام شد','ok')};
$('#publishBtn').onclick=async()=>{try{await saveBatch();const r=await api.publish(model.batch.id,reviewer());toast(`انتشار انجام شد: ${r?.published_count??'OK'}`,'ok');await loadQueue(queueStatus)}catch(e){toast('انتشار ناموفق: '+e.message,'error')}};

function setQuickChoice(target,value){
  $('#'+target).value=value?String(value):'';document.querySelectorAll(`[data-target="${target}"] button`).forEach(b=>b.classList.toggle('active',b.dataset.value===String(value||'')));syncQuickMeta();
}
document.querySelectorAll('[data-target] button').forEach(b=>b.onclick=()=>setQuickChoice(b.closest('[data-target]').dataset.target,b.dataset.value));
$('#quickSubject').addEventListener('change',()=>{renderQuickTaxonomy();syncQuickMeta()});
$('#quickGrade').addEventListener('change',()=>{if(!quickIsMath())renderQuickTaxonomy();syncQuickMeta()});
$('#quickChapter').addEventListener('change',()=>{renderQuickUnits();syncQuickMeta()});
$('#quickUnit').addEventListener('change',()=>{syncQuickMathGrade();syncQuickMeta()});

async function loadSource(img,kind){
  if(!model.batch||quickIndex<0)return;const q=model.batch.questions[quickIndex];
  try{const blob=await api.source(model.batch.id,q.id,kind);const url=URL.createObjectURL(blob);img.src=url;img.onload=()=>URL.revokeObjectURL(url)}catch{img.removeAttribute('src');img.alt='Preview در دسترس نیست'}
}
function openQuick(index){
  quickIndex=index;const q=model.batch.questions[index];if(!q)return;
  $('#quickId').textContent=q.id;$('#quickPosition').textContent=`سوال ${q.source_question_number} · ${index+1}/${model.batch.questions.length}`;
  $('#quickSubject').value=q.subject;$('#quickGrade').value=String(q.grade);renderQuickTaxonomy({chapter:q.chapter||'',unit:q.unit||''});
  setQuickChoice('quickDifficulty',q.difficulty||'');setQuickChoice('quickOption',q.correct_option||'');quickBio.setValue(q.subject==='BIO'?q.biology_combination:null,false);
  loadSource($('#quickQuestionImage'),'question');loadSource($('#quickAnswerImage'),'answer');resetCorrection();renderQuickIssues();$('#quickDialog').showModal();
}
function syncQuickMeta(){
  if(quickIndex<0||!model.batch)return;const q=model.batch.questions[quickIndex];
  const values={subject:$('#quickSubject').value,grade:Number($('#quickGrade').value),chapter:$('#quickChapter').value,unit:$('#quickUnit').value,difficulty:$('#quickDifficulty').value,correct_option:Number($('#quickOption').value)||null,biology_combination:$('#quickSubject').value==='BIO'?quickBio.getValue():null};
  if(JSON.stringify(values)!==JSON.stringify({subject:q.subject,grade:q.grade,chapter:q.chapter,unit:q.unit,difficulty:q.difficulty,correct_option:q.correct_option,biology_combination:q.biology_combination??null}))model.patch(quickIndex,values,reviewer());
  renderQuickIssues();
}
function renderQuickIssues(){if(quickIndex<0||!model.batch)return;$('#quickIssues').innerHTML=questionIssues(model.batch.questions[quickIndex]).map(x=>`<span>${x}</span>`).join('')}
function nextIndex(delta){if(!model.batch)return;const qs=model.batch.questions;let i=quickIndex;for(let n=0;n<qs.length;n++){i=(i+delta+qs.length)%qs.length;if(!qs[i].trashed_at){openQuick(i);return}}}
$('#prevBtn').onclick=()=>nextIndex(-1);$('#nextBtn').onclick=()=>nextIndex(1);$('#quickClose').onclick=()=>$('#quickDialog').close();
$('#approveBtn').onclick=()=>{syncQuickMeta();if(questionIssues(model.batch.questions[quickIndex]).length){toast('سوال هنوز Quality Gate را رد نکرده است.','error');return}model.setStatus(quickIndex,'approved',reviewer());nextIndex(1)};
$('#rejectBtn').onclick=()=>{syncQuickMeta();model.setStatus(quickIndex,'rejected',reviewer());nextIndex(1)};
$('#needsBtn').onclick=()=>{$('#correctionSheet').classList.remove('hidden')};
function resetCorrection(){currentReason='';$('#correctionSheet').classList.add('hidden');$('#correctionNote').value='';document.querySelectorAll('[data-reason]').forEach(b=>b.classList.remove('active'))}
document.querySelectorAll('[data-reason]').forEach(b=>b.onclick=()=>{currentReason=b.dataset.reason;document.querySelectorAll('[data-reason]').forEach(x=>x.classList.toggle('active',x===b))});
$('#cancelCorrection').onclick=resetCorrection;$('#confirmCorrection').onclick=()=>{if(!currentReason){toast('علت اصلاح را انتخاب کن.','error');return}syncQuickMeta();model.setStatus(quickIndex,'needs_changes',reviewer(),$('#correctionNote').value.trim()||null,currentReason);resetCorrection();nextIndex(1)};
$('#quickReviewBtn').onclick=()=>{const i=model.firstPending();openQuick(i>=0?i:0)};

installWindowsMetadataShortcuts({
  enabled:()=>$('#quickDialog').open&&!$('#commandPalette').open&&$('#correctionSheet').classList.contains('hidden')&&matchMedia('(pointer:fine)').matches&&innerWidth>=900,
  setCorrectOption:n=>setQuickChoice('quickOption',n),setLevel:n=>setQuickChoice('quickDifficulty','level_'+n),
  gradeEnabled:()=>!quickIsMath(),
  setGrade:g=>{$('#quickGrade').value=String(g);$('#quickGrade').dispatchEvent(new Event('change',{bubbles:true}))},
  setChapter:n=>{$('#quickChapter').value=String(n).padStart(2,'0');$('#quickChapter').dispatchEvent(new Event('change',{bubbles:true}))},
  setUnit:n=>{$('#quickUnit').value=String(n).padStart(2,'0');$('#quickUnit').dispatchEvent(new Event('change',{bubbles:true}))}
});

document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();palette.open();return}
  if(!$('#quickDialog').open||$('#commandPalette').open||isTypingTarget(e.target)||!$('#correctionSheet').classList.contains('hidden'))return;
  const k=e.key.toLowerCase();if(k==='a'){e.preventDefault();$('#approveBtn').click()}if(k==='f'){e.preventDefault();$('#needsBtn').click()}if(k==='r'){e.preventDefault();$('#rejectBtn').click()}if(e.key==='ArrowLeft'){e.preventDefault();$('#prevBtn').click()}if(e.key==='ArrowRight'){e.preventDefault();$('#nextBtn').click()}
});

const palette=createCommandPalette({dialog:$('#commandPalette'),input:$('#commandInput'),list:$('#commandList'),getCommands:()=>{
  const cmds=[{label:'بروزرسانی صف',run:()=>$('#refreshBtn').click()},{label:'شروع / ادامه بررسی',run:()=>$('#quickReviewBtn').click()}];
  if($('#quickDialog').open)cmds.unshift({label:'تایید سوال',shortcut:'A',run:()=>$('#approveBtn').click()},{label:'نیاز به اصلاح',shortcut:'F',run:()=>$('#needsBtn').click()},{label:'رد سوال',shortcut:'R',run:()=>$('#rejectBtn').click()});
  return cmds;
},onQuery:q=>{const m=q.match(/(?:سوال|q|question)?\s*(\d{1,4})/i);if(!m||!model.batch)return[];const n=Number(m[1]),i=model.batch.questions.findIndex(x=>Number(x.source_question_number)===n&&!x.trashed_at);return i<0?[]:[{label:`باز کردن سوال ${n}`,run:()=>openQuick(i)}]}});
$('#commandLauncher').onclick=()=>palette.open();

installAdaptiveDensity();
if(adminUser())showAdmin();
else requestAnimationFrame(()=>$('#adminUsername').focus());
