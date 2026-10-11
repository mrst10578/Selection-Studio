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
 const commands=[["رفتن به گزینش",()=>location.assign("./")],["فهرست سؤال‌ها",()=>location.assign("./selected.html")],["استودیوی OCR",()=>location.assign("../admin/ocr-studio.html")],["تنظیم آزمون",()=>document.querySelector("#toggleSession")?.click()],["باز کردن PDF سؤال",()=>document.querySelector("#questionPdf")?.click()],["باز کردن PDF پاسخ",()=>document.querySelector("#answerPdf")?.click()],["راهنما",()=>location.assign("./guide.html")]];
 const dialog=document.createElement("dialog");dialog.className="studio-command-dialog";dialog.setAttribute("aria-label","فرمان‌های سریع");dialog.innerHTML='<strong>فرمان‌های سریع</strong><input aria-label="جست‌وجوی فرمان" placeholder="نام فرمان را بنویس..." autocomplete="off"><div class="studio-command-results"></div>';
 document.body.append(dialog);const input=dialog.querySelector("input"),results=dialog.querySelector(".studio-command-results");
 const render=()=>{results.replaceChildren();for(const [name,run] of commands.filter(([name])=>name.includes(input.value.trim()))){const button=document.createElement("button");button.type="button";button.textContent=name;button.onclick=()=>{dialog.close();run()};results.append(button)}if(!results.children.length)results.textContent="فرمانی پیدا نشد."};
 input.addEventListener("input",render);
 document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="p"){e.preventDefault();render();dialog.showModal();input.focus()}if(e.key==="Escape"&&dialog.open)dialog.close()});
}
