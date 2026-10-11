const KEY="selection-studio-layout-v2";
const workspace=document.querySelector(".workbench");
if(workspace){
 const sidebar=document.createElement("aside");sidebar.className="panel studio-projects";sidebar.setAttribute("aria-label","داشبورد و ابزارهای پروژه");
 sidebar.innerHTML='<span class="eyebrow">EMBER ATELIER PRO</span><h2>میز کار پروژه</h2><p>مدیریت مسیر تولید سؤال، از PDF تا بازبینی و خروجی.</p><div class="studio-links"><a href="./selected.html">سؤال‌های ذخیره‌شده ↗</a><a href="../admin/ocr-studio.html">استودیوی OCR ↗</a><a href="./guide.html">راهنمای گزینش ↗</a></div><div class="studio-hint"><p>برای پیدا کردن سریع فرمان‌ها، Ctrl + Shift + P را بزن.</p><div class="studio-layout-controls"><button type="button" id="studioNarrow">پنل باریک</button><button type="button" id="studioWide">پنل پهن</button><button type="button" id="studioReset">بازنشانی چیدمان</button></div></div>';
 workspace.prepend(sidebar);
 const apply=w=>document.documentElement.style.setProperty("--studio-sidebar",w+"px");
 try{const w=Number(localStorage.getItem(KEY));if(w>=230&&w<=420)apply(w)}catch{}
 const set=w=>{apply(w);try{localStorage.setItem(KEY,String(w))}catch{}};
 sidebar.querySelector("#studioNarrow").onclick=()=>set(230);
 sidebar.querySelector("#studioWide").onclick=()=>set(360);
 sidebar.querySelector("#studioReset").onclick=()=>{document.documentElement.style.removeProperty("--studio-sidebar");try{localStorage.removeItem(KEY)}catch{}};
 const commands=[["رفتن به گزینش",()=>location.assign("./")],["فهرست سؤال‌ها",()=>location.assign("./selected.html")],["استودیوی OCR",()=>location.assign("../admin/ocr-studio.html")],["تنظیم آزمون",()=>document.querySelector("#toggleSession")?.click()],["باز کردن PDF سؤال",()=>document.querySelector("#questionPdf")?.click()],["باز کردن PDF پاسخ",()=>document.querySelector("#answerPdf")?.click()],["راهنما",()=>location.assign("./guide.html")],["تمام‌صفحه کردن PDF",()=>document.querySelector(".viewer")?.requestFullscreen?.()],["بازگشت از تمام‌صفحه",()=>document.fullscreenElement&&document.exitFullscreen()]];
 const dialog=document.createElement("dialog");dialog.className="studio-command-dialog";dialog.setAttribute("aria-label","فرمان‌های سریع");dialog.innerHTML='<strong>فرمان‌های سریع</strong><input aria-label="جست‌وجوی فرمان" placeholder="نام فرمان را بنویس..." autocomplete="off"><div class="studio-command-results"></div>';
 document.body.append(dialog);const input=dialog.querySelector("input"),results=dialog.querySelector(".studio-command-results");
 const render=()=>{results.replaceChildren();for(const [name,run] of commands.filter(([name])=>name.includes(input.value.trim()))){const button=document.createElement("button");button.type="button";button.textContent=name;button.onclick=()=>{dialog.close();run()};results.append(button)}if(!results.children.length)results.textContent="فرمانی پیدا نشد."};
 input.addEventListener("input",render);
 document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&((e.shiftKey&&e.key.toLowerCase()==="p")||e.key.toLowerCase()==="k")){e.preventDefault();render();dialog.showModal();input.focus()}if(e.key==="Escape"&&dialog.open)dialog.close()});
}

/* UI-only recoverable drafts: PDF binaries and credentials are never persisted. */
const draftKey="selection-studio-form-draft-v2";
const ids=["provider","examMonth","examDay","operator","sourceNumber","subject","grade","chapter","unit","difficulty","correctOption"];
const fields=ids.map(id=>document.getElementById(id)).filter(Boolean);
const notice=document.createElement("small");notice.className="studio-draft-status";notice.setAttribute("role","status");notice.setAttribute("aria-live","polite");notice.textContent="پیش‌نویس فرم: آماده";
document.querySelector(".session .section-head")?.append(notice);
const snapshot=()=>Object.fromEntries(fields.map(el=>[el.id,el.value]));
const history=[];let index=-1;let debounce;
const store=()=>{try{localStorage.setItem(draftKey,JSON.stringify({version:2,savedAt:Date.now(),fields:snapshot()}));notice.textContent="پیش‌نویس فرم ذخیره شد"}catch{notice.textContent="ذخیره محلی در دسترس نیست"}};
const record=()=>{const state=JSON.stringify(snapshot());if(history[index]===state)return;history.splice(index+1);history.push(state);if(history.length>50)history.shift();index=history.length-1;notice.textContent="تغییرات ذخیره‌نشده";clearTimeout(debounce);debounce=setTimeout(store,450)};
const restore=state=>{for(const [id,value] of Object.entries(state||{})){const el=document.getElementById(id);if(!el||el.type==="file")continue;el.value=String(value??"");el.dispatchEvent(new Event("change",{bubbles:true}))} };
try{const draft=JSON.parse(localStorage.getItem(draftKey)||"null");if(draft?.version===2&&draft.fields&&confirm("پیش‌نویس فرم قبلی پیدا شد. بازیابی شود؟")){restore(draft.fields);notice.textContent="پیش‌نویس بازیابی شد"}}catch{}
history.push(JSON.stringify(snapshot()));index=0;
fields.forEach(el=>{el.addEventListener("input",record);el.addEventListener("change",record)});
const undo=()=>{if(index<=0)return;index--;restore(JSON.parse(history[index]));clearTimeout(debounce);store()};
const redo=()=>{if(index>=history.length-1)return;index++;restore(JSON.parse(history[index]));clearTimeout(debounce);store()};
const toolsRow=document.createElement("div");toolsRow.className="studio-history-controls";
toolsRow.innerHTML='<button type="button" id="studioUndo" aria-label="برگشت تغییر فرم">↶ بازگشت</button><button type="button" id="studioRedo" aria-label="تکرار تغییر فرم">↷ تکرار</button><button type="button" id="studioClearDraft">حذف پیش‌نویس</button>';
document.querySelector(".session")?.append(toolsRow);
toolsRow.querySelector("#studioUndo").onclick=undo;toolsRow.querySelector("#studioRedo").onclick=redo;
toolsRow.querySelector("#studioClearDraft").onclick=()=>{if(confirm("پیش‌نویس ذخیره‌شده این فرم حذف شود؟")){localStorage.removeItem(draftKey);notice.textContent="پیش‌نویس حذف شد"}};
document.addEventListener("keydown",e=>{if(!(e.ctrlKey||e.metaKey)||!e.altKey)return;if(e.key.toLowerCase()==="z"){e.preventDefault();undo()}if(e.key.toLowerCase()==="y"){e.preventDefault();redo()}});
