import {
  RECORDS_KEY,loadRecords,saveRecords,loadSticky,saveSticky,loadExamDraft,saveExamDraft,
  buildQuestionId,difficultyLabel,subjectLabel,gradeLabel
} from "./store.js";
import {putPreview,deletePreview} from "./preview-db.js";
import {PdfCropper,validRegion} from "./pdf-crop.js";
import {isTypingTarget,toast} from "./ui-runtime.js";
import {isOperatorAuthenticated} from "./operator-auth.js";
import {installWindowsMetadataShortcuts} from "./windows-shortcuts.js";
import {mountBiologyCombinationEditor,biologyIssues} from "./biology-combination.js";
import {TAXONOMY,taxonomySummary} from "./taxonomy-data.js";

const $=id=>document.getElementById(id);
let records=loadRecords();
let exam=loadExamDraft();
let activePane="question";
let submittingQuestion=false;
let biologyGate={ready:false,issues:["مشخص کن سؤال زیست ترکیبی هست یا نه"]};


function pdfViewerError(error){
  const name=error?.name||"";
  if(name==="PasswordException")return "این PDF رمز دارد یا رمز آن پذیرفته نشد.";
  if(name==="InvalidPDFException")return "فایل PDF معتبر نیست یا آسیب دیده است.";
  if(name==="MissingPDFException")return "فایل PDF در دسترس نیست.";
  return "بازکردن یا نمایش PDF ناموفق بود. فایل را دوباره انتخاب کن.";
}
const cropError=error=>toast(pdfViewerError(error),"error");
function syncCropFreezeButton(buttonId,clearId,locked){
  const button=$(buttonId),clear=$(clearId);
  button.classList.toggle("locked",locked);
  button.classList.toggle("unlocked",!locked);
  button.setAttribute("aria-pressed",String(locked));
  button.textContent=locked?"باز کردن قفل کراپ":"قفل کراپ";
  clear.disabled=locked;
}
function installCropFreeze(crop,buttonId,clearId){
  crop.onRegionLockChange=locked=>syncCropFreezeButton(buttonId,clearId,locked);
  $(buttonId).onclick=()=>{
    if(!crop.isRegionLocked()&&!crop.isRegionReady()){
      toast("اول محدودهٔ کراپ را مشخص کن.","error");
      return;
    }
    crop.toggleRegionLock();
  };
  syncCropFreezeButton(buttonId,clearId,crop.isRegionLocked());
}
const qCrop=new PdfCropper({canvas:$("qCanvas"),stage:$("qStage"),pageLabel:$("qPage"),prevBtn:$("qPrev"),nextBtn:$("qNext"),modeBtn:$("qCropLock"),onChange:()=>renderGate(),onPageChange:(page,total)=>updatePageJump("qPageJump",page,total),onError:cropError});
const aCrop=new PdfCropper({canvas:$("aCanvas"),stage:$("aStage"),pageLabel:$("aPage"),prevBtn:$("aPrev"),nextBtn:$("aNext"),modeBtn:$("aCropLock"),onChange:()=>renderGate(),onPageChange:(page,total)=>updatePageJump("aPageJump",page,total),onError:cropError});
installCropFreeze(qCrop,"qRegionLock","qClear");installCropFreeze(aCrop,"aRegionLock","aClear");
function updatePageJump(id,page,total){const input=$(id);if(!input)return;input.value=page||"";input.max=total||"";input.disabled=!total}
function installPageJump(id,crop){const input=$(id);input.addEventListener("change",()=>{const page=Number(input.value);if(Number.isInteger(page)&&page>=1&&page<=crop.pdf?.numPages)crop.go(page);else input.value=crop.page||""})}
installPageJump("qPageJump",qCrop);installPageJump("aPageJump",aCrop);
$("qClear").onclick=()=>qCrop.clearRegion();
$("aClear").onclick=()=>aCrop.clearRegion();

const FIXED_EXAM_YEAR="1405";
const PERSIAN_EXAM_NAME=/^[\u0600-\u06FF\u200c\s]+$/u;
function providerName(value){return String(value||"").replace(/\s+/g," ").trim()}
function validProviderName(value){const name=providerName(value);return Boolean(name)&&PERSIAN_EXAM_NAME.test(name)}
function renderProviderWarning(){
  const value=providerName($("provider").value);
  $("providerWarning").classList.toggle("hidden",!value||validProviderName(value));
}
function providerSlug(value){return providerName(value).replace(/[\s\u200c]+/g,"-")}
function asciiDigits(value){return String(value||"").replace(/[۰-۹]/g,ch=>"۰۱۲۳۴۵۶۷۸۹".indexOf(ch)).replace(/[٠-٩]/g,ch=>"٠١٢٣٤٥٦٧٨٩".indexOf(ch))}
function normalizedDate(value){return asciiDigits(value).replace(/[^0-9]/g,"")}
function datePartValue(value,max){
  const digits=normalizedDate(value).slice(0,2);
  if(!digits)return null;
  const number=Number(digits);
  return Number.isInteger(number)&&number>=1&&number<=max?number:null;
}
function validExamDateParts(){
  return datePartValue($("examMonth").value,12)!==null&&datePartValue($("examDay").value,31)!==null;
}
function syncExamDate(){
  const monthDigits=normalizedDate($("examMonth").value).slice(0,2);
  const dayDigits=normalizedDate($("examDay").value).slice(0,2);
  $("examYear").value=FIXED_EXAM_YEAR;
  const month=datePartValue(monthDigits,12);
  const day=datePartValue(dayDigits,31);
  const mm=month===null?(monthDigits?monthDigits.padStart(2,"0"):""):String(month).padStart(2,"0");
  const dd=day===null?(dayDigits?dayDigits.padStart(2,"0"):""):String(day).padStart(2,"0");
  $("examDate").value=`${FIXED_EXAM_YEAR}/${mm}/${dd}`;
}
function setDateParts(value){
  const d=normalizedDate(value);
  $("examYear").value=FIXED_EXAM_YEAR;
  $("examMonth").value=d.length>=6?d.slice(4,6):"";
  $("examDay").value=d.length>=8?d.slice(6,8):"";
  $("examMonth").dataset.lastAccepted=$("examMonth").value;
  $("examDay").dataset.lastAccepted=$("examDay").value;
  syncExamDate();
}
function focusExamMonth(){
  const month=$("examMonth");
  month.focus();
  requestAnimationFrame(()=>month.select());
}
function installDateField(){
  const field=$("examDateField"),month=$("examMonth"),day=$("examDay");
  $("examYear").value=FIXED_EXAM_YEAR;
  const installBoundedPart=(input,max,onAccepted)=>{
    input.dataset.lastAccepted=normalizedDate(input.value).slice(0,2);
    input.addEventListener("input",()=>{
      const digits=normalizedDate(input.value).slice(0,2);
      const number=digits?Number(digits):null;
      const validPartial=digits===""||digits==="0"||(Number.isInteger(number)&&number>=1&&number<=max);
      if(!validPartial){
        input.value=input.dataset.lastAccepted||"";
        return;
      }
      input.value=digits;
      input.dataset.lastAccepted=digits;
      syncExamDate();renderSession();
      onAccepted?.(digits);
    });
    input.addEventListener("blur",()=>{
      const value=datePartValue(input.value,max);
      if(value!==null){
        input.value=String(value).padStart(2,"0");
        input.dataset.lastAccepted=input.value;
      }
      syncExamDate();renderSession();
    });
  };
  field.addEventListener("pointerdown",e=>{
    if(document.activeElement!==month&&document.activeElement!==day){
      e.preventDefault();
      focusExamMonth();
    }
  });
  installBoundedPart(month,12,digits=>{
    if(digits.length===2&&datePartValue(digits,12)!==null){
      day.focus();
      requestAnimationFrame(()=>day.select());
    }
  });
  installBoundedPart(day,31);
  day.addEventListener("keydown",e=>{
    if(e.key==="Backspace"&&!day.value){
      e.preventDefault();
      month.focus();
      month.setSelectionRange(month.value.length,month.value.length);
    }
  });
}
function examId(){
  const provider=providerSlug($("provider").value),date=normalizedDate($("examDate").value);
  if(!validProviderName($("provider").value)||!validExamDateParts()||date.length!==8) return null;
  return `${provider}-${date}`;
}
function humanDate(value){
  const d=normalizedDate(value); return d.length===8?`${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`:value||"-";
}
function dispatchChange(el){el.dispatchEvent(new Event("change",{bubbles:true}))}

function sessionMatchesForm(){
  return Boolean(
    exam?.id&&exam.id===examId()&&
    exam.entered_by=== $("operator").value.trim()&&
    exam.question_pdf_name===qCrop.file?.name&&
    exam.answer_pdf_name===aCrop.file?.name
  );
}
function renderSession(){
  const ready=Boolean(sessionMatchesForm()&&qCrop.isRenderReady()&&aCrop.isRenderReady());
  $("sessionCard").classList.toggle("ready",ready);
  $("sessionCard").classList.toggle("collapsed",ready);
  $("toggleSession").textContent=ready?"ویرایش آزمون":"تنظیم آزمون";
  $("sessionSummary").textContent=exam?.id?`${exam.provider} — ${exam.date} | اپراتور: ${exam.entered_by||"-"}`:"هنوز تنظیم نشده";
  renderGate();
}
$("toggleSession").onclick=()=>$("sessionCard").classList.toggle("collapsed");
$("saveSession").onclick=async()=>{
  const provider=providerName($("provider").value),operator=$("operator").value.trim();
  const previousExamId=exam?.id||null;
  if(!validProviderName(provider)){toast("نام آزمون را فقط با حروف فارسی وارد کن؛ مثل قلمچی.","error");$("provider").focus();return}
  if(!validExamDateParts()){toast("ماه و روز آزمون را دو رقمی و معتبر وارد کن؛ مثل 03/07.","error");focusExamMonth();return}
  const id=examId();
  if(!id||!operator){toast("نام آزمون، تاریخ و اپراتور لازم است.","error");return}
  if(!qCrop.isRenderReady()||!aCrop.isRenderReady()){toast("هر دو PDF باید با موفقیت باز و آمادهٔ نمایش باشند.","error");return}
  exam={id,provider,date:humanDate($("examDate").value),entered_by:operator,question_pdf_name:qCrop.file.name,answer_pdf_name:aCrop.file.name};
  saveExamDraft(exam);
  if(previousExamId!==id)$("sourceNumber").value=String(nextSourceNumberFor(id));
  renderSession(); toast("آزمون آماده شد","ok");
};
function updatePdfState(crop,stateId){
  const host=$(stateId);
  if(crop.loading){
    host.dataset.state="busy";
    host.textContent="در حال بازکردن فایل تازه...";
    return;
  }
  if(crop.rendering){
    host.dataset.state="busy";
    host.textContent="در حال آماده‌سازی صفحه...";
    return;
  }
  host.dataset.state=crop.file?.name?"active":"empty";
  host.textContent=crop.file?.name?"سند فعال: "+crop.file.name:"فایلی فعال نیست.";
}
async function loadPdfInput(input,crop,label,stateId){
  const selected=input.files[0]||null;
  updatePdfState(crop,stateId);
  try{
    const result=await crop.loadFile(selected);
    if(result?.status==="stale")return;
    if(result?.status==="ready")toast(label+" آماده شد","ok");
  }catch(error){
    input.value="";
    const kept=crop.file?.name?" سند فعال قبلی «"+crop.file.name+"» حفظ شد.":"";
    toast(pdfViewerError(error)+kept,"error");
  }finally{
    updatePdfState(crop,stateId);
    renderSession();
  }
}
$("questionPdf").onchange=()=>loadPdfInput($("questionPdf"),qCrop,"PDF سؤال","questionPdfState");
$("answerPdf").onchange=()=>loadPdfInput($("answerPdf"),aCrop,"PDF پاسخ","answerPdfState");

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

function activeRecords(){
  const active=records.filter(x=>!x.trashed_at);
  return exam?.id?active.filter(record=>record.exam_id===exam.id):active;
}
function nextSourceNumberFor(examIdValue){
  const numbers=records
    .filter(record=>record.exam_id===examIdValue)
    .map(record=>Number(record.source_question_number))
    .filter(value=>Number.isInteger(value)&&value>0);
  return numbers.length?Math.max(...numbers)+1:1;
}
function sourceQuestionNumber(){
  const digits=normalizedDate($("sourceNumber").value);
  if(!/^\d+$/.test(digits))return null;
  const value=Number(digits);
  return Number.isInteger(value)&&value>0?value:null;
}
function gateState(){
  const source=sourceQuestionNumber();
  const currentExamId=exam?.id||examId();
  const unique=source!==null&&(!currentExamId||!records.some(x=>x.exam_id===currentExamId&&Number(x.source_question_number)===source));
  const checks={
    exam:Boolean(sessionMatchesForm()&&qCrop.isRenderReady()&&aCrop.isRenderReady()),
    number:Boolean(source!==null&&unique),
    question:qCrop.isRegionReady(),
    answer:aCrop.isRegionReady(),
    taxonomy:Boolean($("chapter").value&&$("unit").value&&[10,11,12].includes(Number($("grade").value))),
    difficulty:["level_1","level_2","level_3","level_4","level_5"].includes($("difficulty").value),
    key:[1,2,3,4].includes(Number($("correctOption").value)),
    biology:$("subject").value!=="BIO"||biologyGate.ready
  };
  const labels={exam:"آزمون و فایل‌ها",number:unique?"شمارهٔ سؤال":"شمارهٔ معتبر و غیرتکراری",question:"برش سؤال",answer:"برش پاسخ",taxonomy:"درس و مبحث",difficulty:"سطح سؤال",key:"گزینهٔ درست",biology:"ترکیبی‌بودن زیست"};
  const missing=Object.keys(checks).filter(k=>!checks[k]).map(k=>labels[k]);
  return {checks,missing};
}
function stage(checks){
  if(!checks.exam)return "exam"; if(!checks.question)return "question"; if(!checks.answer)return "answer";
  if(!checks.number||!checks.taxonomy||!checks.biology||!checks.difficulty||!checks.key)return "meta"; return "ready";
}
function renderGate(){
  const {checks,missing}=gateState(),isBio=$("subject").value==="BIO",relevantEntries=Object.entries(checks).filter(([key])=>key!=="biology"||isBio),complete=relevantEntries.filter(([,ready])=>ready).length,total=relevantEntries.length,s=stage(checks);
  const bioCheck=$("bioReadinessCheck");
  if(bioCheck){bioCheck.hidden=!isBio;bioCheck.classList.toggle("hidden",!isBio)}
  document.querySelectorAll("[data-check]").forEach(el=>el.classList.toggle("done",Boolean(checks[el.dataset.check])));
  $("gateBadge").textContent=missing.length?`${complete}/${total}`:"آماده"; $("gateBadge").classList.toggle("ready",!missing.length);$("gateBadge").classList.toggle("blocked",!!missing.length);
  $("saveQuestion").disabled=!!missing.length||submittingQuestion;
  const msg={exam:"مرحلهٔ بعد: آزمون و دو فایل",question:"مرحلهٔ بعد: برش سؤال",answer:"مرحلهٔ بعد: برش پاسخ",meta:"مرحلهٔ بعد: تکمیل شناسنامه",ready:"آمادهٔ ثبت"}[s];
  $("nextAction").textContent=msg;
  const order=["exam","question","answer","meta","ready"],idx=order.indexOf(s);
  document.querySelectorAll("[data-step]").forEach(el=>{const i=order.indexOf(el.dataset.step);el.classList.toggle("done",i>=0&&i<idx);el.classList.toggle("active",i===idx)});
  $("questionCropState").textContent=qCrop.loading||qCrop.rendering?"در حال آماده‌سازی":qCrop.isRegionReady()?"ثبت شد":qCrop.region?"نیازمند رندر":"بدون برش";
  $("answerCropState").textContent=aCrop.loading||aCrop.rendering?"در حال آماده‌سازی":aCrop.isRegionReady()?"ثبت شد":aCrop.region?"نیازمند رندر":"بدون برش";
  $("questionIdentity").textContent="سؤال "+($("sourceNumber").value||"-");
}
document.querySelectorAll("[data-check]").forEach(button=>button.addEventListener("click",()=>{
  const target=button.dataset.check;
  if(target==="exam"){
    $("sessionCard").classList.remove("collapsed");$("provider").focus();$("sessionCard").scrollIntoView({behavior:"smooth",block:"start"});return;
  }
  if(target==="question"||target==="answer"){
    switchPane(target);$(target+"Tab").scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  const focusTarget={number:"sourceNumber",taxonomy:"chapter",difficulty:"difficulty",key:"correctOption",biology:"bioCombinationPanel"}[target];
  if(target==="difficulty"||target==="key")$("questionForm").querySelector(`[data-target="${focusTarget}"] button`)?.focus();
  else if(target==="biology")$("bioCombinationPanel").querySelector("button:not([disabled])")?.focus();
  else $(focusTarget)?.focus();
}));
function renderRecent(){
  const active=activeRecords(); $("recordCount").textContent=String(active.length);$("navCount").textContent=String(active.length);
  const host=$("recentList"); if(!active.length){host.innerHTML='<div class="empty-box">هنوز سوالی ثبت نشده.</div>';return}
  host.innerHTML=active.slice(-8).reverse().map(r=>`<article class="recent-item"><strong>سؤال ${r.source_question_number}</strong><span>${subjectLabel(r.subject)} · ${taxonomySummary(r)} · ${difficultyLabel(r.difficulty)}</span></article>`).join("");
}
function persistSticky(){saveSticky({subject:$("subject").value,grade:$("grade").value,chapter:$("chapter").value,unit:$("unit").value})}
function restore(){
  if(exam){$("provider").value=exam.provider||"";setDateParts(exam.date||"");$("operator").value=exam.entered_by||""}else setDateParts("");
  const sticky=loadSticky();
  if(sticky.subject)$("subject").value=sticky.subject;
  if(sticky.grade)$("grade").value=sticky.grade;
  renderTaxonomy({chapter:sticky.chapter||"",unit:sticky.unit||""});
  biologyEditor.refresh();
  $("sourceNumber").value=String(nextSourceNumberFor(exam?.id||""));
}
$("subject").addEventListener("change",()=>{renderTaxonomy();persistSticky();renderGate()});
$("grade").addEventListener("change",()=>{if(!isMath())renderTaxonomy();persistSticky();renderGate()});
$("chapter").addEventListener("change",()=>{renderUnits();persistSticky();renderGate()});
$("unit").addEventListener("change",()=>{syncMathGradeFromUnit();persistSticky();renderGate()});
$("sourceNumber").addEventListener("input",()=>{$("sourceNumber").value=normalizedDate($("sourceNumber").value);renderGate()});
$("provider").addEventListener("input",()=>{renderProviderWarning();renderSession()});
$("operator").addEventListener("input",renderSession);

$("questionForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(submittingQuestion)return;
  const gate=gateState();
  if(gate.missing.length){toast("سؤال ناقص است: "+gate.missing.join("، "),"error");return}
  submittingQuestion=true;
  renderGate();
  const source=sourceQuestionNumber(),id=buildQuestionId(exam.id,source);
  let committed=false;
  try{
    const [qCapture,aCapture]=await Promise.all([qCrop.captureCrop(),aCrop.captureCrop()]);
    const visualHash=await qCrop.visualHash(qCapture.blob);
    const record={
      id,exam_id:exam.id,source_question_number:source,subject:$("subject").value,grade:Number($("grade").value),
      chapter:$("chapter").value,unit:$("unit").value,difficulty:$("difficulty").value,correct_option:Number($("correctOption").value),
      question_regions:[qCapture.region],answer_regions:[aCapture.region],visual_hash:visualHash,
      biology_combination:$("subject").value==="BIO"?biologyEditor.getValue():null,status:"draft",review_status:"pending",
      entered_by:$("operator").value.trim(),created_at:new Date().toISOString()
    };
    await Promise.all([putPreview(id+":question",qCapture.blob),putPreview(id+":answer",aCapture.blob)]);
    const nextRecords=[...records,record];
    try{saveRecords(nextRecords)}
    catch(error){
      await Promise.allSettled([deletePreview(id+":question"),deletePreview(id+":answer")]);
      throw error;
    }
    records=nextRecords;
    committed=true;
    $("sourceNumber").value=String(source+1);
    qCrop.setRegionLocked(false);aCrop.setRegionLocked(false);qCrop.clearRegion();aCrop.clearRegion();setSegmented("difficulty","");setSegmented("correctOption","");biologyEditor.reset();switchPane("question");
    renderRecent();
    toast(`سؤال ${source} ثبت شد · ${activeRecords().length} سؤال در فهرست`,"ok");
  }catch(error){
    if(!committed)await Promise.allSettled([deletePreview(id+":question"),deletePreview(id+":answer")]);
    const message=String(error?.message||"");
    toast(message.startsWith("PDF_CROP_")?"برش PDF هنوز آماده نیست؛ بعد از کامل‌شدن نمایش دوباره ثبت کن.":"ثبت سؤال کامل نشد؛ هیچ رکورد ناقصی ذخیره نشد.","error");
  }finally{
    submittingQuestion=false;
    renderGate();
  }
});

installWindowsMetadataShortcuts({
  enabled:()=>isOperatorAuthenticated()&&matchMedia("(pointer:fine)").matches&&innerWidth>=900&&!hotkeysDialog.open,
  setCorrectOption:n=>setSegmented("correctOption",n),
  setLevel:n=>setSegmented("difficulty","level_"+n),
  gradeEnabled:()=>!isMath(),
  setGrade:g=>{$("grade").value=String(g);dispatchChange($("grade"))},
  setChapter:n=>{$("chapter").value=String(n).padStart(2,"0");dispatchChange($("chapter"))},
  setUnit:n=>{$("unit").value=String(n).padStart(2,"0");dispatchChange($("unit"))}
});
const hotkeysDialog=$("hotkeysDialog");
function openHotkeys(){if(!hotkeysDialog.open)hotkeysDialog.showModal()}
$("hotkeysLauncher").onclick=openHotkeys;
$("hotkeysClose").onclick=()=>hotkeysDialog.close();
hotkeysDialog.addEventListener("click",e=>{if(e.target===hotkeysDialog)hotkeysDialog.close()});
document.addEventListener("keydown",e=>{
  if(!isOperatorAuthenticated())return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openHotkeys();return}
  if(isTypingTarget(e.target)||hotkeysDialog.open)return;
  const key=e.key.toLowerCase();
  if(key==="q")switchPane("question");
  if(key==="w")switchPane("answer");
  if(key==="n")$("sourceNumber").focus();
  if(key==="l")location.href="./selected.html";
});

installDateField();restore();renderProviderWarning();updatePdfState(qCrop,"questionPdfState");updatePdfState(aCrop,"answerPdfState");renderSession();renderRecent();renderGate();
