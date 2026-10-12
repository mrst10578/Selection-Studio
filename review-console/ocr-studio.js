import {getPreview,putPreview,deletePreview} from "../studio/preview-db.js";
import {buildOcrPrompt,parseOcrResponse,formatOcrQuestion,inspectOcrQuestion,inspectCriticalChanges} from "./ocr-pipeline.js";
import {renderLiveMath} from "./ocr-live-math.js";

const HANDOFF="selection-ocr-handoff-v1";
const DRAFT_KEY="selection-ocr-drafts-v1";
const SOURCE_KEY="examforge:source:";
const $=id=>document.getElementById(id);
const state={items:[],selected:"",busy:false,figureMode:false,dragStart:null,candidate:null};
let mathTimer=null;
const digits=s=>String(s).replace(/\d/g,c=>"۰۱۲۳۴۵۶۷۸۹"[Number(c)]);
const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cleanImage=s=>/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(s||"")?s:"";
const selected=()=>state.items.find(x=>x.id===state.selected);
function notice(message){$("ocrStatus").textContent=message}

function snapshot(){
 try{localStorage.setItem(DRAFT_KEY,JSON.stringify(state.items.map(({id,title,text,reviewed,warnings,figure,sourceName,structured,ocrStage})=>({id,title,text,reviewed,warnings,figure,sourceName,structured:structured||null,ocrStage:ocrStage||"manual"}))))}
 catch{notice("فضای ذخیره مرورگر پر است؛ خروجی پروژه را ذخیره کن.")}
}
function restore(){
 try{const value=JSON.parse(localStorage.getItem(DRAFT_KEY)||"[]");if(Array.isArray(value))state.items=value.filter(q=>q&&typeof q.id==="string").slice(0,300).map(q=>({id:q.id,title:String(q.title||""),text:String(q.text||""),reviewed:!!q.reviewed,warnings:Array.isArray(q.warnings)?q.warnings:[],figure:cleanImage(q.figure),sourceName:String(q.sourceName||""),structured:q.structured&&typeof q.structured==="object"?q.structured:null,ocrStage:String(q.ocrStage||"manual")}))}catch{state.items=[]}
 if(state.items.length)state.selected=state.items[0].id;
}
function newId(){return globalThis.crypto?.randomUUID?.()||"ocr-"+Date.now()+"-"+Math.random().toString(36).slice(2)}
async function addBlob(blob,title,id=newId(),persist=true){
 if(!blob?.type?.startsWith("image/"))throw Error("تصویر PNG، JPG یا WebP لازم است.");
 if(persist)await putPreview(SOURCE_KEY+id,blob);
 const q={id,title:String(title||"سؤال"),text:"",reviewed:false,warnings:[],figure:"",sourceName:String(title||""),structured:null,ocrStage:"manual"};
 state.items.push(q);state.selected=id;snapshot();render();return q;
}
async function importHandoff(){
 const raw=sessionStorage.getItem(HANDOFF);
 if(!raw)return;
 sessionStorage.removeItem(HANDOFF);
 try{
  const meta=JSON.parse(raw),blob=await getPreview("examforge:handoff");
  if(!blob)throw Error("تصویر انتقالی پیدا نشد.");
  const q=await addBlob(blob,meta.title||("سؤال "+(meta.sourceNumber||"")),newId());
  q.sourceName=String(meta.questionId||meta.title||"");
  snapshot();notice("تصویر سؤال از مدیریت وارد شد؛ مرجع اصلی تغییر نکرد.");
  await deletePreview("examforge:handoff");
 }catch(error){notice("ورود برش از پنل مدیریت ناموفق بود: "+error.message)}
}
let imageUrl=null;
async function renderSource(){
 const q=selected(),image=$("referenceImage"),stage=$("imageStage");
 if(imageUrl){URL.revokeObjectURL(imageUrl);imageUrl=null}
 $("figureCanvas").hidden=true;
 if(!q){image.hidden=true;$("imageEmpty").hidden=false;$("sourceInfo").textContent="بدون تصویر";return}
 const blob=await getPreview(SOURCE_KEY+q.id);
 if(selected()?.id!==q.id)return;
 if(!blob){image.hidden=true;$("imageEmpty").hidden=false;$("sourceInfo").textContent="سؤال تایپی";return}
 imageUrl=URL.createObjectURL(blob);
 image.onload=()=>{if(selected()?.id===q.id&&state.figureMode)alignCanvas()};
 image.src=imageUrl;image.hidden=false;$("imageEmpty").hidden=true;$("sourceInfo").textContent=(blob.size/1024).toFixed(0)+" KB";
 stage.setAttribute("aria-label",q.title);
 if(state.figureMode)alignCanvas();
}
function render(){
 $("count").textContent=digits(state.items.length);
 const list=$("questionList");list.replaceChildren();
 state.items.forEach((q,i)=>{
  const row=document.createElement("div");row.className="ocr-list-row"+(q.id===state.selected?" active":"");
  const b=document.createElement("button");b.className="ocr-pick";b.type="button";b.textContent=digits(i+1)+". "+q.title+(q.reviewed?" ✓":"");b.onclick=()=>{state.selected=q.id;render()};
  const up=document.createElement("button");up.type="button";up.textContent="↑";up.setAttribute("aria-label","انتقال به بالا");up.onclick=()=>move(i,-1);
  const down=document.createElement("button");down.type="button";down.textContent="↓";down.setAttribute("aria-label","انتقال به پایین");down.onclick=()=>move(i,1);
  const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label","حذف از پیش‌نویس");remove.onclick=async()=>{if(!confirm("این سؤال از پیش‌نویس بازتایپ حذف شود؟"))return;state.items.splice(i,1);await deletePreview(SOURCE_KEY+q.id);if(state.selected===q.id)state.selected=state.items[0]?.id||"";snapshot();render()};
  row.append(b,up,down,remove);list.append(row);
 });
 const q=selected();
 $("questionTitle").disabled=!q;$("questionText").disabled=!q;$("reviewed").disabled=!q;
 $("questionTitle").value=q?.title||"";$("questionText").value=q?.text||"";$("reviewed").checked=!!q?.reviewed;
 $("figureState").textContent=q?.figure?"شکل علمی انتخاب شده":"شکلی برای خروجی انتخاب نشده";
 $("warnings").replaceChildren();(q?.warnings||[]).forEach(w=>{let span=document.createElement("span");span.textContent=w;$("warnings").append(span)});
 $("extractBtn").disabled=!q||state.busy;
 $("verifyBtn").disabled=!q||!q.text.trim()||state.busy;
 $("formulaBtn").disabled=!q||!q.text.trim()||state.busy;
 $("extractAllBtn").disabled=!state.items.length||state.busy;
 renderSource().catch(e=>notice(e.message));
 renderCandidatePanel();
 scheduleLivePreview();
}
function move(i,delta){let j=i+delta;if(j<0||j>=state.items.length)return;[state.items[i],state.items[j]]=[state.items[j],state.items[i]];state.selected=state.items[j].id;snapshot();render()}

$("questionTitle").addEventListener("input",e=>{const q=selected();if(q){q.title=e.target.value;snapshot();renderListTitle()}});
function renderListTitle(){const q=selected();const i=state.items.indexOf(q);if(i>=0){const button=$("questionList").children[i]?.querySelector(".ocr-pick");if(button)button.textContent=digits(i+1)+". "+q.title+(q.reviewed?" ✓":"")}}
$("questionText").addEventListener("input",e=>{const q=selected();if(q){q.text=e.target.value;q.reviewed=false;q.structured=null;q.ocrStage="edited";$("reviewed").checked=false;state.candidate=null;renderCandidatePanel();scheduleLivePreview();snapshot()}});
$("reviewed").addEventListener("change",e=>{const q=selected();if(q){q.reviewed=e.target.checked;snapshot();renderListTitle()}});
$("addImages").onclick=()=>$("images").click();
let pdfModule=null;
async function loadPdf(){
 if(pdfModule)return pdfModule;
 let last=null;
 for(const base of ["https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38","https://unpkg.com/pdfjs-dist@4.10.38"]){
  try{const mod=await import(base+"/build/pdf.min.mjs");mod.GlobalWorkerOptions.workerSrc=base+"/build/pdf.worker.min.mjs";pdfModule=mod;return mod}catch(e){last=e}
 }
 throw Error("کتابخانه PDF.js دریافت نشد؛ اتصال اینترنت را بررسی کن. "+(last?.message||""));
}
async function importPdf(file){
 const mod=await loadPdf(),doc=await mod.getDocument({data:await file.arrayBuffer()}).promise;
 if(doc.numPages>50)throw Error("این نسخه حداکثر ۵۰ صفحه در هر بار ورود می‌پذیرد. PDF را به بخش‌های کوچک‌تر تقسیم کن.");
 let count=0;
 try{
  for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
   notice("در حال رندر صفحه "+digits(pageNo)+" از "+digits(doc.numPages));
   const page=await doc.getPage(pageNo),initial=page.getViewport({scale:1}),scale=Math.min(2,2500/Math.max(initial.width,initial.height));
   const viewport=page.getViewport({scale});
   const canvas=document.createElement("canvas");canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
   await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(Error("رندر PDF ناموفق بود")),"image/jpeg",.93));
   await addBlob(blob,file.name+" • صفحه "+digits(pageNo));
   canvas.width=0;canvas.height=0;page.cleanup();count++;
  }
 }finally{await doc.destroy()}
 return count;
}
$("images").onchange=async e=>{
 const files=[...e.target.files];e.target.value="";let n=0;
 for(const file of files){
  try{
   if(file.type==="application/pdf"||/\.pdf$/i.test(file.name))n+=await importPdf(file);
   else if(file.type.startsWith("image/")){await addBlob(file,file.name);n++}
   else throw Error("فرمت فایل پشتیبانی نمی‌شود.");
  }catch(error){notice("خطا برای "+file.name+": "+error.message)}
 }
 if(n)notice(digits(n)+" صفحه یا تصویر به پیش‌نویس بانک تست اضافه شد.");
};
$("newQuestion").onclick=()=>{const q={id:newId(),title:"سؤال تایپی جدید",text:"",reviewed:false,warnings:[],figure:"",sourceName:"",structured:null,ocrStage:"manual"};state.items.push(q);state.selected=q.id;snapshot();render();$("questionText").focus()};
$("removeFigure").onclick=()=>{const q=selected();if(!q)return;q.figure="";snapshot();render();notice("شکل از خروجی تایپی حذف شد؛ تصویر مرجع باقی است.")};

function alignCanvas(){
 const img=$("referenceImage"),canvas=$("figureCanvas"),stage=$("imageStage");
 if(!state.figureMode){canvas.hidden=true;return}
 if(img.hidden||!img.complete||!img.naturalWidth){canvas.hidden=true;return}
 const box=img.getBoundingClientRect(),outer=stage.getBoundingClientRect();
 canvas.style.left=(box.left-outer.left)+"px";canvas.style.top=(box.top-outer.top)+"px";
 canvas.style.width=box.width+"px";canvas.style.height=box.height+"px";
 canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.hidden=false;
 const context=canvas.getContext("2d");context.clearRect(0,0,canvas.width,canvas.height);
}
$("figureMode").onclick=()=>{state.figureMode=!state.figureMode;$("figureMode").setAttribute("aria-pressed",String(state.figureMode));$("figureMode").textContent=state.figureMode?"خروج از انتخاب شکل":"انتخاب ناحیه شکل";alignCanvas();if(state.figureMode)notice("دور شکل یا نمودار علمی یک مستطیل بکش؛ زمینه‌های اضافی را انتخاب نکن.")};
window.addEventListener("resize",()=>{if(state.figureMode)alignCanvas()});
function pointerPoint(e){const r=$("figureCanvas").getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
$("figureCanvas").onpointerdown=e=>{if(!state.figureMode)return;state.dragStart=pointerPoint(e);$("figureCanvas").setPointerCapture(e.pointerId)};
$("figureCanvas").onpointermove=e=>{if(!state.dragStart)return;const c=$("figureCanvas"),p=pointerPoint(e),s=state.dragStart,g=c.getContext("2d");g.clearRect(0,0,c.width,c.height);g.strokeStyle="#dd5729";g.lineWidth=Math.max(3,c.width/320);g.strokeRect(Math.min(s.x,p.x)*c.width,Math.min(s.y,p.y)*c.height,Math.abs(s.x-p.x)*c.width,Math.abs(s.y-p.y)*c.height)};
$("figureCanvas").onpointerup=e=>{const q=selected(),s=state.dragStart;if(!s||!q)return;state.dragStart=null;const p=pointerPoint(e),w=Math.abs(s.x-p.x),h=Math.abs(s.y-p.y);if(w<.015||h<.015){alignCanvas();return}
 const img=$("referenceImage"),c=document.createElement("canvas");
 c.width=Math.max(1,Math.round(w*img.naturalWidth));c.height=Math.max(1,Math.round(h*img.naturalHeight));
 c.getContext("2d").drawImage(img,Math.min(s.x,p.x)*img.naturalWidth,Math.min(s.y,p.y)*img.naturalHeight,w*img.naturalWidth,h*img.naturalHeight,0,0,c.width,c.height);
 q.figure=c.toDataURL("image/png");state.figureMode=false;$("figureMode").textContent="انتخاب ناحیه شکل";$("figureMode").setAttribute("aria-pressed","false");alignCanvas();snapshot();render();notice("شکل علمی برای خروجی ذخیره شد.")};
$("figureCanvas").onpointercancel=()=>{state.dragStart=null;alignCanvas()};


/* The candidate is deliberately ephemeral until an operator accepts it. */
function scheduleLivePreview(){
 clearTimeout(mathTimer);
 const text=$("questionText").value;
 mathTimer=setTimeout(()=>{void renderLiveMath($("liveMathPreview"),text,{status:$("latexStatus")})},180);
}
function renderCandidatePanel(){
 const q=selected(),candidate=state.candidate,panel=$("ocrCandidatePanel");
 if(!candidate||!q||candidate.questionId!==q.id){panel.hidden=true;return}
 panel.hidden=false;
 $("ocrCandidateHeading").textContent=candidate.stage==="formula"?"پیشنهاد بازبینی تخصصی فرمول‌ها":"پیشنهاد بازبینی دوم متن";
 $("ocrCandidateText").value=candidate.text;
 const host=$("ocrDiffWarnings");host.replaceChildren();
 for(const warning of candidate.warnings){
  const span=document.createElement("span");span.textContent=warning;host.append(span);
 }
 void renderLiveMath($("ocrCandidatePreview"),candidate.text);
}
$("ocrCandidateText").addEventListener("input",event=>{
 const candidate=state.candidate,q=selected();if(!candidate||candidate.questionId!==q?.id)return;
 candidate.text=event.target.value;
 const critical=inspectCriticalChanges(q.text,candidate.text);
 candidate.warnings=[...new Set([...candidate.baseWarnings,...critical])];
 const host=$("ocrDiffWarnings");host.replaceChildren();
 candidate.warnings.forEach(w=>{const node=document.createElement("span");node.textContent=w;host.append(node)});
 void renderLiveMath($("ocrCandidatePreview"),candidate.text);
});
$("acceptOcrCandidate").onclick=()=>{
 const q=selected(),candidate=state.candidate;
 if(!q||!candidate||candidate.questionId!==q.id)return;
 if(!candidate.text.trim()){notice("متن پیشنهادی خالی است؛ پذیرش ممکن نیست.");return}
 q.text=candidate.text;
 q.structured=candidate.text===candidate.originalText?candidate.structured:null;
 q.ocrStage=candidate.stage+(q.structured?"":"-manual");
 q.reviewed=false;q.warnings=[...candidate.warnings];state.candidate=null;
 snapshot();render();notice("پیشنهاد پذیرفته شد؛ قبل از تأیید نهایی، متن و تصویر را تطبیق بده.");
};
$("rejectOcrCandidate").onclick=()=>{
 state.candidate=null;render();notice("پیشنهاد رد شد؛ متن قبلی بدون تغییر حفظ شد.");
};
async function imageData(blob){
 const bitmap=await createImageBitmap(blob),canvas=document.createElement("canvas");
 const ratio=Math.min(1,2500/Math.max(bitmap.width,bitmap.height));
 canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
 const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 return canvas.toDataURL("image/jpeg",.88);
}
async function recognize(q,stage="extract"){
 const blob=await getPreview(SOURCE_KEY+q.id);if(!blob)throw Error("این سؤال فایل تصویر ندارد؛ از تایپ دستی استفاده کن.");
 const prompt=buildOcrPrompt(stage,q.text);
 const url="/api/ocr";
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
 try{
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({mode:stage,image:await imageData(blob),prompt}),signal:controller.signal});
  const data=await response.json().catch(()=>({error:"پاسخ نامعتبر سرور"}));
  if(!response.ok){const err=new Error(data.error||"خطای HTTP "+response.status);err.status=response.status;throw err}
  return parseOcrResponse(data);
 }finally{clearTimeout(timer)}
}
async function process(q,stage="extract"){
 if(stage==="extract"&&q.text.trim()&&!confirm("متن فعلی با استخراج جدید جایگزین شود؟"))return;
 if(stage!=="extract"&&!q.text.trim())throw Error("ابتدا متن سؤال را استخراج یا تایپ کن.");
 const names={extract:"استخراج",verify:"بازبینی دوم",formula:"بازبینی فرمول‌ها"};
 notice("در حال "+names[stage]+" با موتور OCR…");
 const result=await recognize(q,stage);
 if(!state.items.includes(q))return;
 const first=result.questions[0],text=formatOcrQuestion(first);
 const warnings=[...inspectOcrQuestion(first),...(result.page_notes?[result.page_notes]:[])];
 if(stage==="extract"){
  q.text=text;q.reviewed=false;q.structured=first;q.ocrStage="extract";
  q.warnings=[...new Set(warnings)];state.candidate=null;
  if(result.questions.length>1){
   const blob=await getPreview(SOURCE_KEY+q.id);
   for(let i=1;i<result.questions.length;i++){
    const entry=result.questions[i],id=newId();
    if(blob)await putPreview(SOURCE_KEY+id,blob);
    state.items.splice(state.items.indexOf(q)+i,0,{
     id,title:q.title+" • "+(entry.number||digits(i+1)),sourceName:q.sourceName,
     text:formatOcrQuestion(entry),reviewed:false,figure:"",warnings:inspectOcrQuestion(entry),
     structured:entry,ocrStage:"extract"
    });
   }
  }
  snapshot();render();notice("استخراج انجام شد. اعداد، نفی، گزینه‌ها و فرمول‌ها نیازمند تطبیق با منبع هستند.");
  return;
 }
 const critical=inspectCriticalChanges(q.text,text);
 if(result.questions.length>1)warnings.push("چند سؤال در بازبینی دیده شد؛ فقط نخستین پیشنهاد نمایش داده شده است.");
 const baseWarnings=[...new Set(warnings)];
 state.candidate={questionId:q.id,stage,text,originalText:text,structured:first,baseWarnings,warnings:[...new Set([...baseWarnings,...critical])]};
 render();notice("پیشنهاد بازبینی آماده است؛ آن را بپذیر یا رد کن. متن فعلی تغییر نکرده است.");
}
async function guarded(fn){
 if(state.busy)return;state.busy=true;render();
 try{await fn()}
 catch(e){
  const suffix=e.name==="AbortError"?"مهلت پاسخ‌گویی تمام شد":e.status===429?"سهمیه OCR تمام شده است؛ می‌توانی دستی ادامه بدهی":e.status===401||e.status===403?"نشست دسترسی معتبر نیست؛ ابتدا وارد حساب مجاز شو":e.message;
  notice("خطا: "+suffix);
 }finally{state.busy=false;render()}
}
$("extractBtn").onclick=()=>{const q=selected();if(q)void guarded(()=>process(q,"extract"))};
$("verifyBtn").onclick=()=>{const q=selected();if(q)void guarded(()=>process(q,"verify"))};
$("formulaBtn").onclick=()=>{const q=selected();if(q)void guarded(()=>process(q,"formula"))};
$("extractAllBtn").onclick=()=>void guarded(async()=>{
 const todo=state.items.filter(q=>!q.text.trim()).slice(0,8);
 if(!todo.length){notice("سؤال بدون متن برای استخراج وجود ندارد.");return}
 if(!confirm("برای "+digits(todo.length)+" تصویر، درخواست OCR ارسال شود؟ هر تصویر سهمیه مصرف می‌کند."))return;
 let successes=0,failed=0;
 for(const q of todo){
  notice("در حال استخراج تصویر "+digits(successes+failed+1)+" از "+digits(todo.length));
  try{await process(q,"extract");successes++}
  catch(e){failed++;q.warnings.push("خطای استخراج: "+e.message);snapshot();if([401,403,429,503].includes(e.status))break}
 }
 notice("استخراج گروهی: "+digits(successes)+" موفق، "+digits(failed)+" ناموفق. سایر سؤال‌ها محفوظ‌اند.");
});

function verifyExport(){
 if(!state.items.length){notice("بانک سؤال خالی است.");return false}
 if(state.items.some(q=>!q.text.trim())){notice("متن بعضی سؤال‌ها خالی است؛ ابتدا بازتایپشان کن.");return false}
 const pending=state.items.filter(q=>!q.reviewed).length;
 return !pending||confirm(digits(pending)+" سؤال هنوز با تصویر اصلی تأیید نشده‌اند. خروجی ساخته شود؟");
}
function exportHtml(){
 const title=escapeHtml($("bankTitle").value),font=$("fontFamily").value,fontSize=Number($("fontSize").value),line=Number($("lineHeight").value),columns=Number($("columns").value);
 const articles=state.items.map((q,i)=>'<article><h2>سؤال '+digits(i+1)+'</h2><p>'+escapeHtml(q.text)+'</p>'+(q.figure?'<img src="'+cleanImage(q.figure)+'" alt="شکل مربوط به سؤال">':"")+'</article>').join("\n");
 return '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>@page{size:A4;margin:16mm}body{font-family:'+font+',sans-serif;color:#111;background:#fff;font-size:'+fontSize+'px;line-height:'+line+';direction:rtl}h1{text-align:center;border-bottom:2px solid #333;padding-bottom:8px}h2{font-size:1em}main{columns:'+columns+';column-gap:24px}article{break-inside:avoid;padding:12px 0;border-bottom:1px solid #ddd}p{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;max-height:320px;object-fit:contain;margin:auto}@media print{article{break-inside:avoid}}</style><h1>'+title+'</h1><main>'+articles+'</main></html>';
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000)}
$("htmlExport").onclick=()=>{if(verifyExport())download(new Blob([exportHtml()],{type:"text/html;charset=utf-8"}),"TestBank_Typed.html")};
$("previewAll").onclick=()=>{if(!verifyExport())return;buildPreview()};
function buildPreview(){const host=$("previewContent");host.replaceChildren();const h=document.createElement("h1");h.textContent=$("bankTitle").value;host.append(h);state.items.forEach((q,i)=>{const article=document.createElement("article"),title=document.createElement("strong"),body=document.createElement("p");title.textContent="سؤال "+digits(i+1);body.textContent=q.text;article.append(title,body);if(q.figure){const image=new Image();image.src=cleanImage(q.figure);image.alt="شکل مرتبط";article.append(image)}host.append(article)});host.style.fontFamily=$("fontFamily").value;host.style.fontSize=$("fontSize").value+"px";host.style.lineHeight=$("lineHeight").value;$("previewDialog").showModal()}
$("closePreview").onclick=()=>$("previewDialog").close();
$("printBtn").onclick=()=>{if(!verifyExport())return;buildPreview();if(!$("previewDialog").open)return;const el=$("printContainer");el.replaceChildren($("previewContent").cloneNode(true));$("previewDialog").close();window.print()};
$("fontSize").oninput=()=>{$("fontSizeValue").textContent=digits($("fontSize").value)};
async function blobToData(blob){return new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(reader.result);reader.onerror=()=>rej(reader.error);reader.readAsDataURL(blob)})}
$("sidecarExport").onclick=()=>{
 const records=state.items.map((q,i)=>({
  question_id:q.sourceName||null,
  draft_id:q.id,
  sequence:i+1,
   typed_text:q.text,
   reviewed:q.reviewed,
   ocr_stage:q.ocrStage||"manual",
   structured_ocr:q.structured||null,
  warnings:q.warnings,
  figure_data:q.figure||null
 }));
 download(new Blob([JSON.stringify({schema:"selection-ocr-sidecar",version:1,canonical_metadata_unchanged:true,records},null,2)],{type:"application/json"}),"TestBank_Typed_Sidecar.json");
 notice("فایل متادیتای تکمیلی مستقل صادر شد. برای ادغام رسمی، بازبینی و تطبیق شناسه‌ها لازم است.");
};
$("saveProject").onclick=()=>guarded(async()=>{const entries=[];for(const q of state.items){const blob=await getPreview(SOURCE_KEY+q.id);entries.push({...q,image:blob?await blobToData(blob):null})}download(new Blob([JSON.stringify({type:"selection-studio-ocr-draft",version:1,items:entries})],{type:"application/json"}),"Selection_OCR_Draft.json");notice("پیش‌نویس OCR به‌طور مستقل صادر شد.")});
$("loadProject").onclick=()=>$("projectFile").click();
$("projectFile").onchange=async e=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;await guarded(async()=>{const project=JSON.parse(await f.text());if(project.type!=="selection-studio-ocr-draft"||!Array.isArray(project.items)||project.items.length>300)throw Error("فایل پروژه معتبر نیست.");const next=[];for(const q of project.items){const id=newId();if(q.image){if(!cleanImage(q.image))throw Error("فرمت تصویر نامعتبر است.");const blob=await (await fetch(q.image)).blob();await putPreview(SOURCE_KEY+id,blob)}next.push({id,title:String(q.title||""),text:String(q.text||""),reviewed:!!q.reviewed,warnings:Array.isArray(q.warnings)?q.warnings:[],figure:cleanImage(q.figure),sourceName:String(q.sourceName||""),structured:q.structured&&typeof q.structured==="object"?q.structured:null,ocrStage:String(q.ocrStage||"manual")})}state.items=next;state.selected=next[0]?.id||"";snapshot();notice("پروژه وارد شد.")})};
restore();await importHandoff();render();
