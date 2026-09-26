import {
  RECORDS_KEY,loadRecords,saveRecords,loadSticky,saveSticky,loadExamDraft,saveExamDraft,
  buildQuestionId,difficultyLabel,subjectLabel,gradeLabel
} from "./store.js";
import {putPreview} from "./preview-db.js";
import {PdfCropper,validRegion} from "./pdf-crop.js";
import {installAdaptiveDensity,isTypingTarget,createCommandPalette,toast} from "./ui-runtime.js";
import {installWindowsMetadataShortcuts} from "./windows-shortcuts.js";
import {mountBiologyCombinationEditor,biologyIssues} from "./biology-combination.js";
import {TAXONOMY,taxonomySummary} from "./taxonomy-data.js";

const $=id=>document.getElementById(id);
let records=loadRecords();
let exam=loadExamDraft();
let activePane="question";
let biologyGate={ready:false,issues:["مشخص کن سوال زیست ترکیبی هست یا نه"]};


const qCrop=new PdfCropper({canvas:$("qCanvas"),stage:$("qStage"),pageLabel:$("qPage"),prevBtn:$("qPrev"),nextBtn:$("qNext"),modeBtn:$("qCropLock"),onChange:region=>{renderGate();if(region&&$("answerPdf").files[0])switchPane("answer")}});
const aCrop=new PdfCropper({canvas:$("aCanvas"),stage:$("aStage"),pageLabel:$("aPage"),prevBtn:$("aPrev"),nextBtn:$("aNext"),modeBtn:$("aCropLock"),onChange:()=>renderGate()});
$("qClear").onclick=()=>qCrop.clearRegion();
$("aClear").onclick=()=>aCrop.clearRegion();

function providerSlug(value){return String(value||"").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"")}
function asciiDigits(value){return String(value||"").replace(/[۰-۹]/g,ch=>"۰۱۲۳۴۵۶۷۸۹".indexOf(ch)).replace(/[٠-٩]/g,ch=>"٠١٢٣٤٥٦٧٨٩".indexOf(ch))}
function normalizedDate(value){return asciiDigits(value).replace(/[^0-9]/g,"")}
function syncExamDate(){
  const year=normalizedDate($("examYear").value).slice(0,4);
  const month=normalizedDate($("examMonth").value).slice(0,2);
  const day=normalizedDate($("examDay").value).slice(0,2);
  $("examYear").value=year;$("examMonth").value=month;$("examDay").value=day;
  $("examDate").value=`${year}/${month}/${day}`;
}
function setDateParts(value){
  const d=normalizedDate(value);
  $("examYear").value=d.slice(0,4);
  $("examMonth").value=d.slice(4,6);
  $("examDay").value=d.slice(6,8);
  syncExamDate();
}
function installDateField(){
  const parts=[["examYear",4],["examMonth",2],["examDay",2]];
  parts.forEach(([id,max],index)=>{
    const el=$(id);
    el.addEventListener("input",()=>{
      el.value=normalizedDate(el.value).slice(0,max);
      syncExamDate();renderGate();
      if(el.value.length===max&&index<parts.length-1)$(parts[index+1][0]).focus();
    });
    el.addEventListener("keydown",e=>{
      if(e.key==="Backspace"&&!el.value&&index>0){e.preventDefault();const prev=$(parts[index-1][0]);prev.focus();prev.setSelectionRange(prev.value.length,prev.value.length)}
    });
  });
}
function examId(){
  const provider=providerSlug($("provider").value),date=normalizedDate($("examDate").value);
  if(!provider||date.length!==8) return null;
  return `${provider}-${date}`;
}
function humanDate(value){
  const d=normalizedDate(value); return d.length===8?`${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`:value||"-";
}
function dispatchChange(el){el.dispatchEvent(new Event("change",{bubbles:true}))}

function renderSession(){
  const ready=Boolean(exam?.id&&qCrop.file&&aCrop.file);
  $("sessionCard").classList.toggle("collapsed",ready);
  $("toggleSession").textContent=ready?"ویرایش آزمون":"تنظیم آزمون";
  $("sessionSummary").textContent=exam?.id?`${exam.provider} — ${exam.date} | اپراتور: ${exam.entered_by||"-"}`:"هنوز تنظیم نشده";
  renderGate();
}
$("toggleSession").onclick=()=>$("sessionCard").classList.toggle("collapsed");
$("saveSession").onclick=async()=>{
  const id=examId(); const operator=$("operator").value.trim();
  if(!id||!operator){toast("موسسه، تاریخ و اپراتور لازم است.","error");return}
  if(!$("questionPdf").files[0]||!$("answerPdf").files[0]){toast("هر دو PDF را انتخاب کن.","error");return}
  exam={id,provider:providerSlug($("provider").value),date:humanDate($("examDate").value),entered_by:operator,question_pdf_name:$("questionPdf").files[0].name,answer_pdf_name:$("answerPdf").files[0].name};
  saveExamDraft(exam); renderSession(); toast("آزمون آماده شد","ok");
};
$("questionPdf").onchange=async()=>{await qCrop.loadFile($("questionPdf").files[0]);renderSession()};
$("answerPdf").onchange=async()=>{await aCrop.loadFile($("answerPdf").files[0]);renderSession()};

function switchPane(name){
  activePane=name;
  $("questionPane").classList.toggle("hidden",name!=="question");
  $("answerPane").classList.toggle("hidden",name!=="answer");
  $("questionTab").classList.toggle("active",name==="question");
  $("answerTab").classList.toggle("active",name==="answer");
  requestAnimationFrame(()=>{(name==="question"?qCrop:aCrop).refresh()});
}
$("questionTab").onclick=()=>switchPane("question");
$("answerTab").onclick=()=>switchPane("answer");

function setSegmented(target,value){
  $(target).value=value?String(value):"";
  document.querySelectorAll(`[data-target="${target}"] button`).forEach(b=>b.classList.toggle("active",b.dataset.value===String(value||"")));
  renderGate();
}
document.querySelectorAll("[data-target] button").forEach(b=>b.onclick=()=>setSegmented(b.closest("[data-target]").dataset.target,b.dataset.value));

function fillSelect(el,items,selected=""){
  el.innerHTML='<option value="">انتخاب</option>'+items.map(([value,label])=>`<option value="${value}">${label}</option>`).join("");
  el.value=items.some(([value])=>value===selected)?selected:"";
}
function subjectCfg(){return TAXONOMY.subjects[$("subject").value]||{}}
function isMath(){return $("subject").value==="MATH"}
function updateUnitLabel(){
  const cfg=subjectCfg();
  $("unitLabel").textContent=cfg.unit_name_fa||($("subject").value==="BIO"?"گفتار":"مبحث");
  $("chapterLabel").textContent=cfg.chapter_name_fa||"فصل";
}
function mathUnitConfig(){
  return subjectCfg().topics?.[$("chapter").value]?.units?.[$("unit").value]||null;
}
function syncMathGradeFromUnit(){
  if(!isMath())return;
  const unit=mathUnitConfig();
  if(unit?.grade)$("grade").value=String(unit.grade);
}
function renderUnits(selected=""){
  const cfg=subjectCfg(),chapter=$("chapter").value;
  const units=isMath()?cfg.topics?.[chapter]?.units:cfg.grades?.[$("grade").value]?.chapters?.[chapter]?.units;
  const items=Object.entries(units||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,item])=>[
    id,
    isMath()?(item.label_fa||`${item.name_fa} (${gradeLabel(item.grade)})`):`${Number(id)} — ${item.name_fa}`
  ]);
  fillSelect($("unit"),items,selected);
  syncMathGradeFromUnit();
}
function renderTaxonomy({chapter="",unit=""}={}){
  const cfg=subjectCfg(),math=isMath();
  $("gradeField").hidden=math;
  $("subjectGradeRow").classList.toggle("single",math);
  updateUnitLabel();
  const chapters=math?cfg.topics:cfg.grades?.[$("grade").value]?.chapters;
  fillSelect($("chapter"),Object.entries(chapters||{}).sort((a,b)=>Number(a[0])-Number(b[0])).map(([id,item])=>[id,`${Number(id)} — ${item.name_fa}`]),chapter);
  renderUnits(unit);
}
const biologyEditor=mountBiologyCombinationEditor({
  host:$("bioCombinationPanel"),subjectEl:$("subject"),gradeEl:$("grade"),chapterEl:$("chapter"),unitEl:$("unit"),
  onGateChange:value=>{biologyGate=value;renderGate()}
});

function activeRecords(){return records.filter(x=>!x.trashed_at)}
function gateState(){
  const source=Number($("sourceNumber").value);
  const id=examId()&&Number.isInteger(source)&&source>0?buildQuestionId(examId(),source):null;
  const unique=Boolean(id&&!activeRecords().some(x=>x.id===id));
  const checks={
    exam:Boolean(exam?.id&&qCrop.file&&aCrop.file&&$("operator").value.trim()),
    number:Boolean(Number.isInteger(source)&&source>0&&unique),
    question:validRegion(qCrop.region),
    answer:validRegion(aCrop.region),
    taxonomy:Boolean($("chapter").value&&$("unit").value&&[10,11,12].includes(Number($("grade").value))),
    difficulty:["level_1","level_2","level_3","level_4","level_5"].includes($("difficulty").value),
    key:[1,2,3,4].includes(Number($("correctOption").value)),
    biology:$("subject").value!=="BIO"||biologyGate.ready
  };
  const labels={exam:"آزمون و PDFها",number:unique?"شماره سوال":"شماره معتبر و غیرتکراری",question:"Crop سوال",answer:"Crop پاسخ",taxonomy:"طبقه‌بندی",difficulty:"Level",key:"کلید صحیح",biology:"UX ترکیبی زیست"};
  const missing=Object.keys(checks).filter(k=>!checks[k]).map(k=>labels[k]);
  return {checks,missing};
}
function stage(checks){
  if(!checks.exam)return "exam"; if(!checks.question)return "question"; if(!checks.answer)return "answer";
  if(!checks.number||!checks.taxonomy||!checks.biology||!checks.difficulty||!checks.key)return "meta"; return "ready";
}
function renderGate(){
  const {checks,missing}=gateState(),complete=Object.values(checks).filter(Boolean).length,s=stage(checks);
  document.querySelectorAll("[data-check]").forEach(el=>el.classList.toggle("done",Boolean(checks[el.dataset.check])));
  $("gateBadge").textContent=missing.length?`${complete}/8`:"آماده"; $("gateBadge").classList.toggle("ready",!missing.length);$("gateBadge").classList.toggle("blocked",!!missing.length);
  $("saveQuestion").disabled=!!missing.length;
  $("gateHint").textContent=missing.length?"مانده: "+missing.join(" • "):"همه موارد کامل است؛ سوال آماده ثبت است.";
  const msg={exam:"مرحله بعد: آزمون و هر دو PDF",question:"مرحله بعد: Crop سوال",answer:"مرحله بعد: Crop پاسخ",meta:"مرحله بعد: شناسنامه را کامل کن",ready:"آماده ثبت"}[s];
  $("nextAction").textContent=msg;
  const order=["exam","question","answer","meta","ready"],idx=order.indexOf(s);
  document.querySelectorAll("[data-step]").forEach(el=>{const i=order.indexOf(el.dataset.step);el.classList.toggle("done",i>=0&&i<idx);el.classList.toggle("active",i===idx)});
  $("questionCropState").textContent=qCrop.region?"ثبت شد":"بدون Crop"; $("answerCropState").textContent=aCrop.region?"ثبت شد":"بدون Crop";
  $("questionIdentity").textContent="سوال "+($("sourceNumber").value||"-");
}
function renderRecent(){
  const active=activeRecords(); $("recordCount").textContent=String(active.length);$("navCount").textContent=String(active.length);
  const host=$("recentList"); if(!active.length){host.innerHTML='<div class="empty-box">هنوز سوالی ثبت نشده.</div>';return}
  host.innerHTML=active.slice(-8).reverse().map(r=>`<article class="recent-item"><strong>سوال ${r.source_question_number}</strong><span>${subjectLabel(r.subject)} · ${taxonomySummary(r)} · ${difficultyLabel(r.difficulty)}</span></article>`).join("");
}
function persistSticky(){saveSticky({subject:$("subject").value,grade:$("grade").value,chapter:$("chapter").value,unit:$("unit").value})}
function restore(){
  if(exam){$("provider").value=exam.provider||"";setDateParts(exam.date||"");$("operator").value=exam.entered_by||""}else setDateParts("");
  const sticky=loadSticky();
  if(sticky.subject)$("subject").value=sticky.subject;
  if(sticky.grade)$("grade").value=sticky.grade;
  renderTaxonomy({chapter:sticky.chapter||"",unit:sticky.unit||""});
  const last=activeRecords().at(-1);$("sourceNumber").value=String((Number(last?.source_question_number)||0)+1||1);
}
$("subject").addEventListener("change",()=>{renderTaxonomy();persistSticky();renderGate()});
$("grade").addEventListener("change",()=>{if(!isMath())renderTaxonomy();persistSticky();renderGate()});
$("chapter").addEventListener("change",()=>{renderUnits();persistSticky();renderGate()});
$("unit").addEventListener("change",()=>{syncMathGradeFromUnit();persistSticky();renderGate()});
$("sourceNumber").addEventListener("input",renderGate);
["provider","operator"].forEach(id=>$(id).addEventListener("input",renderGate));

$("questionForm").addEventListener("submit",async e=>{
  e.preventDefault(); const gate=gateState(); if(gate.missing.length){toast("سوال ناقص است: "+gate.missing.join("، "),"error");return}
  const source=Number($("sourceNumber").value),id=buildQuestionId(exam.id,source);
  const visualHash=await qCrop.visualHash();
  const record={
    id,exam_id:exam.id,source_question_number:source,subject:$("subject").value,grade:Number($("grade").value),
    chapter:$("chapter").value,unit:$("unit").value,difficulty:$("difficulty").value,correct_option:Number($("correctOption").value),
    question_regions:[structuredClone(qCrop.region)],answer_regions:[structuredClone(aCrop.region)],visual_hash:visualHash,
    biology_combination:$("subject").value==="BIO"?biologyEditor.getValue():null,status:"draft",review_status:"pending",
    entered_by:$("operator").value.trim(),created_at:new Date().toISOString()
  };
  records.push(record); saveRecords(records);
  const [qBlob,aBlob]=await Promise.all([qCrop.cropBlob(),aCrop.cropBlob()]);
  if(qBlob)await putPreview(id+":question",qBlob);if(aBlob)await putPreview(id+":answer",aBlob);
  $("sourceNumber").value=String(source+1);qCrop.clearRegion();aCrop.clearRegion();setSegmented("difficulty","");setSegmented("correctOption","");biologyEditor.reset();switchPane("question");
  renderRecent();renderGate();toast("سوال ثبت شد","ok");
});

installAdaptiveDensity();
installWindowsMetadataShortcuts({
  enabled:()=>matchMedia("(pointer:fine)").matches&&innerWidth>=900&&!$("commandPalette").open,
  setCorrectOption:n=>setSegmented("correctOption",n),
  setLevel:n=>setSegmented("difficulty","level_"+n),
  gradeEnabled:()=>!isMath(),
  setGrade:g=>{$("grade").value=String(g);dispatchChange($("grade"))},
  setChapter:n=>{$("chapter").value=String(n).padStart(2,"0");dispatchChange($("chapter"))},
  setUnit:n=>{$("unit").value=String(n).padStart(2,"0");dispatchChange($("unit"))}
});
const palette=createCommandPalette({
  dialog:$("commandPalette"),input:$("commandInput"),list:$("commandList"),
  getCommands:()=>[
    {label:"نمایش سوال",hint:"PDF سوال",shortcut:"Q",run:()=>switchPane("question")},
    {label:"نمایش پاسخ",hint:"PDF پاسخ",shortcut:"W",run:()=>switchPane("answer")},
    {label:"شماره سوال",hint:"تمرکز روی شماره",shortcut:"N",run:()=>$("sourceNumber").focus()},
    {label:"ثبت سوال",hint:$("saveQuestion").disabled?"Gate هنوز کامل نیست":"ثبت سوال کامل",shortcut:"Enter",run:()=>{if(!$("saveQuestion").disabled)$("questionForm").requestSubmit()}},
    {label:"لیست سوالات",shortcut:"L",run:()=>location.href="./selected.html"},
    {label:"راهنما",run:()=>location.href="./guide.html"}
  ]
});
$("commandLauncher").onclick=()=>palette.open();
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();palette.open();return}
  if(isTypingTarget(e.target)||$("commandPalette").open)return;
  if(e.key.toLowerCase()==="q")switchPane("question");if(e.key.toLowerCase()==="w")switchPane("answer");if(e.key.toLowerCase()==="n")$("sourceNumber").focus();if(e.key.toLowerCase()==="l")location.href="./selected.html";
});

installDateField();restore();renderSession();renderRecent();renderGate();
