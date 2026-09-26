import {
  loadRecords,saveRecords,loadExamDraft,loadIntakeSettings,saveIntakeSettings,getSessionKey,setSessionKey,
  createBatch,rememberLastBatch,downloadText,subjectLabel,gradeLabel,difficultyLabel,buildQuestionId
} from "./store.js";
import {getPreview} from "./preview-db.js";
import {validRegion} from "./pdf-crop.js";
import {biologyIssues,mountBiologyCombinationEditor} from "./biology-combination.js";
import {installAdaptiveDensity,toast} from "./ui-runtime.js";

const $=id=>document.getElementById(id);
let records=loadRecords(),exam=loadExamDraft(),editIndex=-1;
for(let i=1;i<=12;i++)$("editChapter").insertAdjacentHTML("beforeend",`<option value="${String(i).padStart(2,"0")}">${i}</option>`);
for(let i=1;i<=8;i++)$("editUnit").insertAdjacentHTML("beforeend",`<option value="${String(i).padStart(2,"0")}">${i}</option>`);

const editBio=mountBiologyCombinationEditor({
  host:$("editBioPanel"),subjectEl:$("editSubject"),gradeEl:$("editGrade"),chapterEl:$("editChapter"),unitEl:$("editUnit"),
  onGateChange:()=>{}
});

function active(){return records.filter(x=>!x.trashed_at)}
function missing(record){
  const out=[];
  if(!record.exam_id)out.push("آزمون");
  if(!Number.isInteger(Number(record.source_question_number))||Number(record.source_question_number)<1)out.push("شماره");
  if(!["BIO","MATH","PHY","CHEM"].includes(record.subject))out.push("درس");
  if(![10,11,12].includes(Number(record.grade)))out.push("پایه");
  if(!record.chapter)out.push("فصل");
  if(!record.unit)out.push(record.subject==="BIO"?"گفتار":"مبحث");
  if(!["level_1","level_2","level_3","level_4","level_5"].includes(record.difficulty))out.push("Level");
  if(![1,2,3,4].includes(Number(record.correct_option)))out.push("کلید");
  if(!validRegion(record.question_regions?.[0]))out.push("Crop سوال");
  if(!validRegion(record.answer_regions?.[0]))out.push("Crop پاسخ");
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
  if(!s.workerUrl||!s.submittedBy||!s.key)blockers.push("Worker، کلید یا نام اپراتور تنظیم نضمصد.");
  if(incomplete.length)blockers.push(`${incomplete.length} سوال ناقҔ است.`);
  return {ready:!blockers.length,blockers,incomplete};
}

async function preview(img,key){
  const blob=await getPreview(key);
  if(!blob){img.removeAttribute("src");img.classList.add("missing");return}
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
  $("batchBadge").textContent=gate.ready?"آماده ارسال":"قفل";
  $("batchBadge").classList.toggle("ready",gate.ready);
  $("submitBatch").disabled=!gate.ready;
  $("batchGateText").textContent=gate.ready?`${qs.length} سوال کامل است و Batch آماده ارسال است.`:gate.blockers.join(" ");
  $("batchIssues").innerHTML=gate.incomplete.slice(0,8).map(x=>`<span>سوال ${x.r.source_question_number}: ${x.issues.join("، ")}</span>`).join("");

  const host=$("questionList");
  host.innerHTML="";
  if(!qs.length){host.innerHTML='<div class="empty-box">هنوز سوالو انتخاب نشده.</div>';return}

  for(const record of qs){
    const index=records.indexOf(record);
    const frag=$("questionCard").content.cloneNode(true);
    const card=frag.querySelector(".question-card");
    const issues=missing(record);
    card.dataset.quality=issues.length?"warn":"ok";
    frag.querySelector(".question-title strong").textContent="سوال "+record.source_question_number;
    const badge=frag.querySelector(".quality-badge");
    badge.textContent=issues.length?"ناقص":"آماده";
    badge.className="quality-badge "+(issues.length?"warn":"ok");
    frag.querySelector(".question-meta").textContent=
      `${subjectLabel(record.subject)} · ${gradeLabel(record.grade)} · فصل ${Number(record.chapter)||"-"} · `+
      `${record.subject==="BIO"?"گفتار":"مبحث"} ${Number(record.unit)||"-"} · ${difficultyLabel(record.difficulty)} · `+
      `‎ةليد ${record.correct_option||"-"}${record.subject==="BIO"&&record.biology_combination?.is_combined?` ´ برکيبی × ${record.biology_combination.topics.length}`:""}`;
    frag.querySelector(".question-missing").innerHTML=issues.map(x=>`<span>${x}</span>`).join("");
    frag.querySelector(".edit-btn").onclick=()=>openEdit(index);
    frag.querySelector(".delete-btn").onclick=async()=>{
      records[index]={...records[index],trashed_at:new Date().toISOString()};
      saveRecords(records);
      toast("سوال به Trash ر؁ت","ok");
      await render();
    };
    preview(frag.querySelector(".q-preview"),record.id+":question");
    preview(frag.querySelector(".a-preview"),record.id+":answer");
    host.appendChild(frag);
  }
}

function openEdit(index){
  editIndex=index;
  const r=records[index];
  $("editTitle").textContent="‍ویرایش سوال "+r.source_question_number;
  $("editNumber").value=r.source_question_number;
  $("editSubject").value=r.subject;
  $("editGrade").value=String(r.grade);
  $("editChapter").value=r.chapter||"";
  $("editUnit").value=r.unit||"";
  $("editDifficulty").value=r.difficulty||"";
  $("editOption").value=r.correct_option||"";
  updateEditUnit();
  editBio.setValue(r.subject==="BIO"?r.biology_combination:null,false);
  $("editDialog").showModal();
}
function updateEditUnit(){$("editUnitLabel").textContent=$("editSubject").value==="BIO"?"گفتار":"مبحث"}
$("editSubject").onchange=updateEditUnit;
$("closeEdit").onclick=()=>$("editDialog").close();

$("editForm").onsubmit=e=>{
  e.preventDefault();
  const old=records[editIndex],n=Number($("editNumber").value),newId=buildQuestionId(old.exam_id,n);
  if(records.some((r,i)=>i!==editIndex&&!r.trashed_at&&r.id===newId)){toast("سوال تکراری است","error");return}
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
  records[editIndex]=next;
  saveRecords(records);
  $("editDialog").close();
  render();
  toast("تغییرات ذخیره ضد","ok");
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
  toast("تنظیمات ذخیره ضد","ok");
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
      if(!qBlob||!aBlob)throw new Error("Crop محلی برای "+question.id+" کامل نیست.");
      form.append("question__"+encodeURIComponent(question.id),qBlob,question.id+"-question.webp");
      form.append("answer__"+encodeURIComponent(question.id),aBlob,question.id+"-answer.webp");
    }
    const response=await fetch(s.workerUrl+"/studio/intake",{
      method:"POST",
      headers:{"x-testbank-submit-key":s.key},
      body:form
    });
    if(!response.ok)throw new Error((await response.text())||("HTTP "+response.status));
    rememberLastBatch(batch);
    toast("Batch و Cropها برای بررسی ارسال شد","ok");
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

installAdaptiveDensity();
render();
