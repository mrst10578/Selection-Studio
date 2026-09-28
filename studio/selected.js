import {
  loadRecords,saveRecords,loadExamDraft,loadIntakeSettings,saveIntakeSettings,getSessionKey,setSessionKey,
  createBatch,rememberLastBatch,loadLastBatch,downloadText,subjectLabel,gradeLabel,difficultyLabel,buildQuestionId
} from "./store.js";
import {getPreview,putPreview,deletePreview} from "./preview-db.js";
import {validRegion} from "./pdf-crop.js";
import {biologyIssues,mountBiologyCombinationEditor} from "./biology-combination.js";
import {toast} from "./ui-runtime.js";
import {TAXONOMY,taxonomySummary,taxonomyIssues} from "./taxonomy-data.js";
import "./operator-auth.js";

const $=id=>document.getElementById(id);
let records=loadRecords(),exam=loadExamDraft(),editIndex=-1;
let lastBatch=loadLastBatch();
const FILTERS_KEY="testbank-selected-filters-v1";
function loadFilterState(){try{return JSON.parse(sessionStorage.getItem(FILTERS_KEY)||"{}")}catch{return {}}}
function saveFilterState(){sessionStorage.setItem(FILTERS_KEY,JSON.stringify({search:$("questionSearch").value,quality:$("questionQuality").value}))}

function fillEditSelect(el,items,selected=""){
  el.innerHTML='<option value="">انتخاب</option>'+items.map(([value,label])=>`<option value="${value}">${label}</option>`).join("");
  el.value=items.some(([value])=>value===selected)?selected:"";
}
function editCfg(){return TAXONOMY.subjects[$("editSubject").value]||{}}
function editIsMath(){return $("editSubject").value==="MATH"}
function syncEditMathGrade(){
  if(!editIsMath())return;
  const unit=editCfg().topics?.[$("editChapter").value]?.units?.[$("editUnit").value];
  if(unit?.grade)$("editGrade").value=String(unit.grade);
}
function renderEditUnits(selected=""){
  const cfg=editCfg(),chapter=$("editChapter").value;
  const units=editIsMath()?cfg.topics?.[chapter]?.units:cfg.grades?.[$("editGrade").value]?.chapters?.[chapter]?.units;
  fillEditSelect($("editUnit"),Object.entries(units||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,item])=>[id,editIsMath()?(item.label_fa||item.name_fa):`${Number(id)} — ${item.name_fa}`]),selected);
  syncEditMathGrade();
}
function renderEditTaxonomy({chapter="",unit=""}={}){
  const cfg=editCfg(),math=editIsMath();
  $("editGradeField").hidden=math;
  $("editGradeChapterRow").classList.toggle("single",math);
  $("editChapterLabel").textContent=cfg.chapter_name_fa||"فصل";
  $("editUnitLabel").textContent=cfg.unit_name_fa||($("editSubject").value==="BIO"?"گفتار":"مبحث");
  const chapters=math?cfg.topics:cfg.grades?.[$("editGrade").value]?.chapters;
  fillEditSelect($("editChapter"),Object.entries(chapters||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,item])=>[id,`${Number(id)} — ${item.name_fa}`]),chapter);
  renderEditUnits(unit);
}

const editBio=mountBiologyCombinationEditor({
  host:$("editBioPanel"),subjectEl:$("editSubject"),gradeEl:$("editGrade"),chapterEl:$("editChapter"),unitEl:$("editUnit"),
  onGateChange:()=>{}
});

function active(){
  const visible=records.filter(x=>!x.trashed_at);
  return exam?.id?visible.filter(record=>record.exam_id===exam.id):visible;
}
function missing(record){
  const out=[];
  if(!record.exam_id)out.push("آزمون");
  if(!Number.isInteger(Number(record.source_question_number))||Number(record.source_question_number)<1)out.push("شماره");
  out.push(...taxonomyIssues(record));
  if(!["level_1","level_2","level_3","level_4","level_5"].includes(record.difficulty))out.push("سطح سؤال");
  if(![1,2,3,4].includes(Number(record.correct_option)))out.push("کلید");
  if(!validRegion(record.question_regions?.[0]))out.push("برش سؤال");
  if(!validRegion(record.answer_regions?.[0]))out.push("برش پاسخ");
  if(record.subject==="BIO"){
    out.push(...biologyIssues({
      subject:"BIO",
      combination:record.biology_combination,
      primaryGrade:record.grade,
      primaryChapter:record.chapter,
      primaryUnit:record.unit
    }).map(x=>"زیست: "+x));
  }
  return out;
}

function settingsState(){
  const s=loadIntakeSettings();
  return {workerUrl:s.workerUrl||"",submittedBy:s.submittedBy||"",key:getSessionKey()};
}

function batchGate(){
  const qs=active();
  const incomplete=qs.map(r=>({r,issues:missing(r)})).filter(x=>x.issues.length);
  const s=settingsState(),blockers=[];
  if(!qs.length)blockers.push("هیچ سوالی برای ارسال وجود ندارد.");
  if(!exam?.id)blockers.push("شناسنامه آزمون موجود نیست.");
  if(!s.workerUrl||!s.submittedBy||!s.key)blockers.push("Worker، کلید یا نام اپراتور تنظیم نشده است.");
  if(incomplete.length)blockers.push(`${incomplete.length} سؤال ناقص است.`);
  const fingerprint=activeFingerprint(qs);
  const alreadySent=Boolean(lastBatch?.fingerprint&&lastBatch.fingerprint===fingerprint);
  if(alreadySent)blockers.push("این نسخه از مجموعه قبلاً با موفقیت ارسال شده است.");
  return {ready:!blockers.length,blockers,incomplete,alreadySent,fingerprint};
}

function activeFingerprint(qs=active()){
  return JSON.stringify({exam:exam?.id||"",questions:qs.map(q=>({id:q.id,subject:q.subject,grade:q.grade,chapter:q.chapter,unit:q.unit,difficulty:q.difficulty,correct_option:q.correct_option,question_regions:q.question_regions,answer_regions:q.answer_regions,biology_combination:q.biology_combination}))});
}

async function preview(img,key){
  const blob=await getPreview(key);
  if(!blob){
    img.removeAttribute("src");
    img.classList.add("missing");
    img.setAttribute("aria-disabled","true");
    return;
  }
  img.classList.remove("missing");
  img.removeAttribute("aria-disabled");
  const url=URL.createObjectURL(blob);
  img.src=url;
  img.onload=()=>URL.revokeObjectURL(url);
}

async function render(){
  const qs=active(),gate=batchGate();
  $("navCount").textContent=String(qs.length);
  $("questionCount").textContent=String(qs.length);
  $("readyCount").textContent=String(qs.filter(r=>!missing(r).length).length);
  $("examLabel").textContent=exam?.id?`${exam.provider||exam.id} — ${exam.date||""}`:"آزمون تنظیم نشده";
  $("batchBadge").textContent=gate.ready?"آمادهٔ ارسال":gate.alreadySent?"ارسال‌شده":"نیاز به تکمیل";
  $("batchBadge").classList.toggle("ready",gate.ready);
  $("submitBatch").disabled=!gate.ready;
  $("batchGateText").textContent=gate.ready?`${qs.length} سؤال کامل است و مجموعه آمادهٔ ارسال است.`:gate.blockers.join(" ");
  $("lastSubmission").textContent=lastBatch?.sent_at?`آخرین ارسال موفق: ${lastBatch.question_count} سؤال · ${new Date(lastBatch.sent_at).toLocaleString("fa-IR")} · شناسه ${lastBatch.id}`:"هنوز ارسالی ثبت نشده است.";
  $("batchIssues").innerHTML=gate.incomplete.slice(0,8).map(x=>`<span>سؤال ${x.r.source_question_number}: ${x.issues.join("، ")}</span>`).join("");

  const host=$("questionList");
  host.innerHTML="";
  const query=$("questionSearch").value.trim().toLocaleLowerCase("fa-IR"),quality=$("questionQuality").value;
  const shown=qs.filter(record=>{
    const issues=missing(record);
    if(quality==="ready"&&issues.length)return false;
    if(quality==="incomplete"&&!issues.length)return false;
    return !query||(`${record.source_question_number} ${record.id} ${subjectLabel(record.subject)} ${taxonomySummary(record)}`).toLocaleLowerCase("fa-IR").includes(query);
  });
  if(!shown.length){host.innerHTML=`<div class="empty-box">${qs.length?"با این فیلتر سؤالی پیدا نشد.":"هنوز سؤالی انتخاب نشده است."}</div>`;renderTrash();return}

  for(const record of shown){
    const index=records.indexOf(record);
    const frag=$("questionCard").content.cloneNode(true);
    const card=frag.querySelector(".question-card");
    const issues=missing(record);
    card.dataset.quality=issues.length?"warn":"ok";
    frag.querySelector(".question-title strong").textContent="سؤال "+record.source_question_number;
    const badge=frag.querySelector(".quality-badge");
    badge.textContent=issues.length?"ناقص":"آماده";
    badge.className="quality-badge "+(issues.length?"warn":"ok");
    frag.querySelector(".question-meta").textContent=
      `${subjectLabel(record.subject)} · ${taxonomySummary(record)} · ${difficultyLabel(record.difficulty)} · `+
      `کلید ${record.correct_option||"-"}${record.subject==="BIO"&&record.biology_combination?.is_combined?`  · ترکیبی × ${record.biology_combination.topics.length}`:""}`;
    frag.querySelector(".question-missing").innerHTML=issues.map(x=>`<span>${x}</span>`).join("");
    frag.querySelector(".edit-btn").onclick=()=>openEdit(index);
    frag.querySelector(".delete-btn").onclick=async()=>{
      records[index]={...records[index],trashed_at:new Date().toISOString()};
      saveRecords(records);
      toast("سؤال به Trash رفت","ok");
      await render();
    };
    preview(frag.querySelector(".q-preview"),record.id+":question");
    preview(frag.querySelector(".a-preview"),record.id+":answer");
    frag.querySelectorAll(".previews img").forEach(img=>img.addEventListener("click",()=>openPreview(img)));
    host.appendChild(frag);
  }
  renderTrash();
}

function renderTrash(){
  const removed=records.map((r,index)=>({r,index})).filter(x=>x.r.trashed_at&&(!exam?.id||x.r.exam_id===exam.id));
  const section=$("trashSection"),host=$("trashList");section.hidden=!removed.length;host.replaceChildren();
  for(const {r,index} of removed){
    const frag=$("trashItem").content.cloneNode(true);frag.querySelector("strong").textContent=`سؤال ${r.source_question_number} · ${subjectLabel(r.subject)}`;
    frag.querySelector(".restore-btn").onclick=()=>{
      if(records.some((item,i)=>i!==index&&!item.trashed_at&&item.id===r.id)){toast("این شماره سؤال دوباره استفاده شده و تا رفع تداخل قابل بازگردانی نیست.","error");return}
      const restored={...records[index]};delete restored.trashed_at;records[index]=restored;saveRecords(records);toast("سؤال بازگردانده شد","ok");render()
    };host.appendChild(frag);
  }
}
function openPreview(img){
  if(!img?.getAttribute("src")||img.classList.contains("missing"))return;
  const dialog=$("previewDialog"),target=$("previewImage");
  target.src=img.src;target.alt=img.alt;$("previewTitle").textContent=img.alt;dialog.showModal();
}
$("previewClose").onclick=()=>$("previewDialog").close();
const savedFilters=loadFilterState();
$("questionSearch").value=savedFilters.search||"";
$("questionQuality").value=["","ready","incomplete"].includes(savedFilters.quality)?savedFilters.quality:"";
document.querySelectorAll("#questionSearch,#questionQuality").forEach(el=>el.addEventListener(el.id==="questionSearch"?"input":"change",()=>{saveFilterState();render()}));
$("clearQuestionFilters").onclick=()=>{$("questionSearch").value="";$("questionQuality").value="";saveFilterState();render()};

function openEdit(index){
  editIndex=index;
  const r=records[index];
  $("editTitle").textContent="‍ویرایش سؤال "+r.source_question_number;
  $("editNumber").value=r.source_question_number;
  $("editSubject").value=r.subject;
  $("editGrade").value=String(r.grade);
  renderEditTaxonomy({chapter:r.chapter||"",unit:r.unit||""});
  $("editDifficulty").value=r.difficulty||"";
  $("editOption").value=r.correct_option||"";
  editBio.setValue(r.subject==="BIO"?r.biology_combination:null,false);
  $("editDialog").showModal();
}
$("editSubject").onchange=()=>renderEditTaxonomy();
$("editGrade").onchange=()=>{if(!editIsMath())renderEditTaxonomy()};
$("editChapter").onchange=()=>renderEditUnits();
$("editUnit").onchange=syncEditMathGrade;
$("closeEdit").onclick=()=>$("editDialog").close();

$("editForm").onsubmit=async e=>{
  e.preventDefault();
  const old=records[editIndex],n=Number($("editNumber").value);
  if(!Number.isInteger(n)||n<1){toast("شماره سؤال باید یک عدد صحیح بزرگ‌تر از صفر باشد.","error");$("editNumber").focus();return}
  let newId="";
  try{newId=buildQuestionId(old.exam_id,n)}catch(error){toast(error.message||"شماره سؤال معتبر نیست.","error");return}
  if(records.some((r,i)=>i!==editIndex&&r.id===newId)){toast("این شماره قبلاً استفاده شده است؛ حتی سؤال‌های Trash شده تا زمان بازگردانی/اصلاح شماره رزرو می‌مانند.","error");return}
  const next={
    ...old,
    id:newId,
    source_question_number:n,
    subject:$("editSubject").value,
    grade:Number($("editGrade").value),
    chapter:$("editChapter").value,
    unit:$("editUnit").value,
    difficulty:$("editDifficulty").value,
    correct_option:Number($("editOption").value)||null,
    biology_combination:$("editSubject").value==="BIO"?editBio.getValue():null
  };

  const idChanged=newId!==old.id;
  if(idChanged){
    try{
      const [questionBlob,answerBlob]=await Promise.all([getPreview(old.id+":question"),getPreview(old.id+":answer")]);
      await Promise.all([
        questionBlob?putPreview(newId+":question",questionBlob):Promise.resolve(),
        answerBlob?putPreview(newId+":answer",answerBlob):Promise.resolve()
      ]);
    }catch{
      toast("جابجایی پیش‌نمایش‌های سؤال ناموفق بود؛ تغییر ذخیره نشد.","error");
      return;
    }
  }

  records[editIndex]=next;
  saveRecords(records);
  if(idChanged){
    await Promise.allSettled([deletePreview(old.id+":question"),deletePreview(old.id+":answer")]);
  }
  $("editDialog").close();
  render();
  toast("تغییرات ذخیره شد","ok");
};

$("settingsBtn").onclick=()=>{
  const s=settingsState();
  $("workerUrl").value=s.workerUrl;
  $("submittedBy").value=s.submittedBy;
  $("submitKey").value=s.key;
  $("settingsDialog").showModal();
};
$("saveSettings").onclick=e=>{
  e.preventDefault();
  saveIntakeSettings({
    workerUrl:$("workerUrl").value.trim().replace(/\/$/,""),
    submittedBy:$("submittedBy").value.trim()
  });
  setSessionKey($("submitKey").value);
  $("settingsDialog").close();
  render();
  toast("تنظیمات ذخیره شد","ok");
};

$("submitBatch").onclick=async()=>{
  const gate=batchGate();
  if(!gate.ready){toast(gate.blockers.join(" "),"error");return}
    const s=settingsState(),batch=createBatch(active(),exam,s.submittedBy);
  $("submitBatch").disabled=true;
  try{
    const form=new FormData();
    form.append("batch",new Blob([JSON.stringify(batch)],{type:"application/json"}),"batch.json");
    for(const question of batch.questions){
      const [qBlob,aBlob]=await Promise.all([getPreview(question.id+":question"),getPreview(question.id+":answer")]);
      if(!qBlob||!aBlob)throw new Error("برش محلی برای "+question.id+" کامل نیست.");
      form.append("question__"+encodeURIComponent(question.id),qBlob,question.id+"-question.webp");
      form.append("answer__"+encodeURIComponent(question.id),aBlob,question.id+"-answer.webp");
    }
    const response=await fetch(s.workerUrl+"/studio/intake",{
      method:"POST",
      headers:{"x-testbank-submit-key":s.key},
      body:form
    });
    if(!response.ok)throw new Error((await response.text())||("HTTP "+response.status));
    rememberLastBatch(batch,gate.fingerprint);lastBatch=loadLastBatch();
    toast("مجموعه و برش‌ها برای بررسی ارسال شد","ok");
  }catch(err){
    toast("ارسال ناموفق: "+err.message,"error");
  }finally{
    render();
  }
};

$("exportQuestions").onclick=()=>downloadText(
  "questions.jsonl",
  active().map(x=>JSON.stringify(x)).join("\n")+"\n",
  "application/x-ndjson"
);
$("exportExam").onclick=()=>downloadText(
  "exam.jsonl",
  exam?JSON.stringify(exam)+"\n":"",
  "application/x-ndjson"
);

render();
