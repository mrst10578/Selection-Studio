import {installCloudDraftSync} from './cloud-draft.js';
/* Ember Atelier Pro: a progressive enhancement layer. Native question/crop logic
   remains owned by app.js; this module never stores PDF bytes or credentials. */
const $=selector=>document.querySelector(selector);
const workspace=$('.workbench');
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const layoutKey='selection-studio-layout-v3';
const draftKey='selection-studio-form-draft-v3';
const revisionsKey='selection-studio-form-revisions-v1';
const recordKey='testbank-studio.records.v1';
const formIds=['provider','examMonth','examDay','operator','sourceNumber','subject','grade','chapter','unit','difficulty','correctOption'];
const fields=formIds.map(id=>document.getElementById(id)).filter(Boolean);
const storage={
 get(key,fallback=null){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}},
 set(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
};
const safeRecords=()=>{
 const value=storage.get(recordKey,[]);
 return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&!x.trashed_at):[];
};
const layoutDefault={sidebar:270,inspector:370,projects:true,details:true};
let layout={...layoutDefault,...storage.get(layoutKey,{})};
const isTyping=target=>Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));
const pdfRefresh=()=>requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
const create=(tag,cls,text)=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(text!==undefined)el.textContent=text;
 return el;
};
const makeButton=(text,action,cls='')=>{
 const button=create('button',cls,text);
 button.type='button';button.addEventListener('click',action);return button;
};
const formSnapshot=()=>Object.fromEntries(fields.map(el=>[el.id,el.value]));
const stateString=()=>JSON.stringify(formSnapshot());
let history=[],historyIndex=0,applying=false,saveTimer=null,conflicted=false,lastStored='';
let draftNotice,sidebar,sidebarCount,sidebarProgress,sidebarRecent,projectsButton,inspectorButton,commandButton;
let cloudSync=null;

function applyLayout(persist=true){
 if(!workspace)return;
 layout.sidebar=clamp(Number(layout.sidebar)||270,230,420);
 layout.inspector=clamp(Number(layout.inspector)||370,320,480);
 document.documentElement.style.setProperty('--studio-sidebar',`${layout.sidebar}px`);
 document.documentElement.style.setProperty('--studio-inspector',`${layout.inspector}px`);
 workspace.classList.toggle('studio-projects-closed',!layout.projects);
 workspace.classList.toggle('studio-inspector-closed',!layout.details);
 if(projectsButton){projectsButton.setAttribute('aria-expanded',String(layout.projects));projectsButton.textContent=layout.projects?'بستن پروژه‌ها':'نمایش پروژه‌ها'}
 if(inspectorButton){inspectorButton.setAttribute('aria-expanded',String(layout.details));inspectorButton.textContent=layout.details?'بستن مشخصات':'نمایش مشخصات'}
 if(persist)storage.set(layoutKey,layout);
 pdfRefresh();
}
function resetLayout(){layout={...layoutDefault};applyLayout()}
function togglePanel(which){layout[which]=!layout[which];applyLayout()}
function installResizer(host,side){
 const button=create('button',`studio-resize-handle studio-resize-${side}`,'⋮');
 button.type='button';button.setAttribute('aria-label',side==='sidebar'?'تغییر عرض پنل پروژه‌ها':'تغییر عرض شناسنامه سؤال');
 button.setAttribute('title','با کشیدن یا کلیدهای جهت‌دار عرض پنل را تنظیم کن');
 button.setAttribute('aria-orientation','vertical');button.setAttribute('role','separator');button.tabIndex=0;
 const key=side==='sidebar'?'sidebar':'inspector';
 const bounds=side==='sidebar'?[230,420]:[320,480];
 const setWidth=width=>{
  const total=workspace?.clientWidth||1400;
  const other=layout[side==='sidebar'?'inspector':'sidebar'];
  const available=Math.max(bounds[0],total-other-380);
  layout[key]=clamp(width,bounds[0],Math.min(bounds[1],available));applyLayout();
 };
 button.setAttribute('aria-valuemin',String(bounds[0]));button.setAttribute('aria-valuemax',String(bounds[1]));
 const reflect=()=>button.setAttribute('aria-valuenow',String(layout[key]));
 button.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  e.preventDefault();button.setPointerCapture(e.pointerId);button.classList.add('is-dragging');
  const start=e.clientX,width=layout[key];
  const move=ev=>{if(ev.pointerId!==e.pointerId)return;setWidth(width+(ev.clientX-start)*(side==='sidebar'?-1:1));reflect()};
  const stop=()=>{button.classList.remove('is-dragging');button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',stop);button.removeEventListener('pointercancel',stop)};
  button.addEventListener('pointermove',move);button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop);
 });
 button.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();
  if(e.key==='Home')setWidth(bounds[0]);else if(e.key==='End')setWidth(bounds[1]);
  else setWidth(layout[key]+(e.key==='ArrowLeft'?-16:16)*(side==='sidebar'?-1:1));
  reflect();
 });
 button.addEventListener('dblclick',()=>{setWidth(layoutDefault[key]);reflect()});
 reflect();host.append(button);
}
function updateDashboard(){
 if(!sidebarCount)return;
 const records=safeRecords();
 sidebarCount.textContent=String(records.length);
 const recent=records.slice(-4).reverse();
 sidebarProgress.textContent=records.length?`${new Set(records.map(r=>r.exam_id).filter(Boolean)).size} آزمون فعال در آرشیو محلی`:'هنوز سؤالی ذخیره نشده';
 sidebarRecent.replaceChildren();
 if(!recent.length){sidebarRecent.append(create('p','studio-no-records','اولین سؤال را بعد از انتخاب PDF و تکمیل شناسنامه ثبت کن.'));return}
 for(const item of recent){
  const row=create('div','studio-recent-row');
  row.append(create('strong','',`سؤال ${item.source_question_number||'؟'}`),create('small','',String(item.exam_id||'بدون آزمون').slice(0,45)));
  sidebarRecent.append(row);
 }
}
function installSidebar(){
 if(!workspace)return;
 sidebar=create('aside','panel studio-projects');sidebar.setAttribute('aria-label','داشبورد پروژه‌ها');
 sidebar.innerHTML=`<div class="studio-brand"><span class="studio-brand-glyph" aria-hidden="true">✦</span><div><span class="studio-overline">SELECTION / WORKSPACE</span><h2>آتلیه گزینش</h2></div></div><p class="studio-slogan">از صفحه PDF تا سؤال آماده انتشار.</p><div class="studio-stat-block"><span>سؤال‌های ثبت‌شده</span><strong id="studioRecordCount">۰</strong><small id="studioProjectProgress">در حال بررسی آرشیو...</small></div><div class="studio-group-heading"><strong>مسیر سریع</strong><span>01 — 03</span></div><div class="studio-shortcuts"><a href="./selected.html"><span>▦</span> بانک سؤال‌های محلی <b aria-hidden="true">↗</b></a><a href="../admin/ocr-studio.html"><span>◈</span> بازتایپ هوشمند <b aria-hidden="true">↗</b></a><a href="./guide.html"><span>◇</span> راهنمای گزینش <b aria-hidden="true">↗</b></a></div><div class="studio-group-heading"><strong>آخرین فعالیت</strong><span>LOCAL</span></div><div class="studio-recent-rows" id="studioRecentRows"></div><div class="studio-sidebar-footer"><span class="studio-live-dot" aria-hidden="true"></span><span>پیش‌نویس‌ها روی همین دستگاه‌اند.</span></div>`;
 workspace.prepend(sidebar);
 sidebarCount=$('#studioRecordCount');sidebarProgress=$('#studioProjectProgress');sidebarRecent=$('#studioRecentRows');
 installResizer(sidebar,'sidebar');
 const inspector=$('.workbench > .inspector');if(inspector)installResizer(inspector,'inspector');
 const nav=$('.topbar nav');
 if(nav){
  const toolbar=create('div','studio-top-actions');
  projectsButton=makeButton('نمایش پروژه‌ها',()=>togglePanel('projects'),'studio-toggle studio-toggle-projects');
  inspectorButton=makeButton('نمایش مشخصات',()=>togglePanel('details'),'studio-toggle studio-toggle-inspector');
  commandButton=makeButton('⌘  فرمان‌ها',()=>openPalette(),'studio-palette-trigger');
  projectsButton.setAttribute('aria-controls','studioSidebarHolder');
  inspectorButton.setAttribute('aria-controls','questionForm');
  sidebar.id='studioSidebarHolder';
  toolbar.append(projectsButton,inspectorButton,commandButton);
  nav.insertAdjacentElement('afterend',toolbar);
 }
 applyLayout(false);updateDashboard();
 const list=$('#recentList'),count=$('#recordCount');
 if(count){new MutationObserver(updateDashboard).observe(count,{childList:true,characterData:true,subtree:true})}
 if(list){new MutationObserver(updateDashboard).observe(list,{childList:true,subtree:true})}
 window.addEventListener('storage',e=>{if(e.key===recordKey)updateDashboard()});
}
let palette,search,results,activeIndex=0,visibleCommands=[];
function normalize(value){return String(value||'').toLocaleLowerCase('fa').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').trim()}
function searchMatch(command,query){
 if(!query)return true;
 const haystack=normalize([command.label,command.description,...(command.tags||[])].join(' '));
 return query.split(' ').every(piece=>haystack.includes(piece));
}
function goto(id){const el=document.getElementById(id);if(!el)return;el.scrollIntoView({behavior:'smooth',block:'center'});el.focus({preventScroll:true})}
function commands(){
 const items=[
  {label:'تنظیمات آزمون',description:'نام، تاریخ، اپراتور و PDF',tags:['exam','session','آزمون'],run:()=>{$('#sessionCard')?.classList.remove('collapsed');goto('provider')}},
  {label:'افزودن PDF سؤال',description:'انتخاب سند مرجع سؤال',tags:['pdf','فایل'],run:()=>$('#questionPdf')?.click()},
  {label:'افزودن PDF پاسخ',description:'انتخاب سند پاسخنامه',tags:['pdf','فایل'],run:()=>$('#answerPdf')?.click()},
  {label:'نمایش PDF سؤال',description:'تغییر صفحه به سؤال',tags:['pdf','question'],run:()=>$('#questionTab')?.click()},
  {label:'نمایش PDF پاسخ',description:'تغییر صفحه به پاسخ',tags:['pdf','answer'],run:()=>$('#answerTab')?.click()},
  {label:'شماره سؤال',description:'انتقال به شناسنامه',tags:['metadata','number'],run:()=>{if(!layout.details)togglePanel('details');goto('sourceNumber')}},
  {label:'سؤال‌های ذخیره‌شده',description:'رفتن به فهرست ثبت‌شده',tags:['project','list'],run:()=>location.assign('./selected.html')},
  {label:'استودیوی OCR',description:'تبدیل تصویر به متن',tags:['OCR','ai'],run:()=>location.assign('../admin/ocr-studio.html')},
  {label:'داشبورد پروژه',description:'وضعیت آرشیو، نسخه‌ها و دریافت نسخه پشتیبان',tags:['backup','project','داشبورد'],run:openProjectDashboard},
  {label:layout.projects?'بستن پنل پروژه‌ها':'بازکردن پنل پروژه‌ها',description:'چیدمان میز کار',tags:['layout','sidebar'],run:()=>togglePanel('projects')},
  {label:layout.details?'بستن پنل شناسنامه':'بازکردن پنل شناسنامه',description:'چیدمان میز کار',tags:['layout','inspector'],run:()=>togglePanel('details')},
  {label:'تمام‌صفحه PDF',description:'حالت تمرکز روی سند',tags:['fullscreen','focus'],run:toggleFullscreen},
  {label:'بازنشانی چیدمان',description:'برگرداندن عرض و پنل‌های پیش‌فرض',tags:['reset','layout'],run:resetLayout},
  {label:'ذخیره نسخه پیش‌نویس',description:'نقطه بازگشت برای فرم جاری',tags:['version','draft'],run:saveRevision},
  {label:'بازگشت تغییر فرم',description:'Undo فقط برای فیلدهای شناسنامه',tags:['undo'],run:undo},
  {label:'تکرار تغییر فرم',description:'Redo فقط برای فیلدهای شناسنامه',tags:['redo'],run:redo},
  {label:'میان‌برهای صفحه',description:'کلیدهای سریع گزینش',tags:['help','keyboard'],run:()=>$('#hotkeysLauncher')?.click()}
 ];
 const match=normalize(search?.value||'').match(/^(?:page|صفحه)\s*([0-9۰-۹]+)$/);
 if(match){
  const page=Number(match[1].replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  if(page>0&&page<10000)items.unshift({label:`رفتن به صفحه ${page}`,description:'صفحه سند فعال',tags:['page'],run:()=>{
   const input=$('#answerTab')?.classList.contains('active')?$('#aPageJump'):$('#qPageJump');
   if(input){input.value=String(page);input.dispatchEvent(new Event('change',{bubbles:true}))}
  }});
 }
 return items;
}
function highlightCommand(){
 results?.querySelectorAll('.studio-command-item').forEach((el,i)=>{
  el.classList.toggle('active',i===activeIndex);
  el.setAttribute('aria-selected',String(i===activeIndex));
 });
 const active=results?.querySelectorAll('.studio-command-item')[activeIndex];
 if(active){search?.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'})}
 else search?.removeAttribute('aria-activedescendant');
}
function renderCommands(){
 if(!results)return;
 const query=normalize(search.value);
 visibleCommands=commands().filter(cmd=>searchMatch(cmd,query)).slice(0,14);
 activeIndex=0;results.replaceChildren();
 if(!visibleCommands.length){results.append(create('p','studio-command-empty','فرمانی پیدا نشد. عبارت کوتاه‌تری بنویس.'));highlightCommand();return}
 for(const [index,item] of visibleCommands.entries()){
  const button=create('button','studio-command-item');button.type='button';button.id=`studio-command-${index}`;
  button.setAttribute('role','option');button.append(create('strong','',item.label),create('small','',item.description));
  button.addEventListener('mouseenter',()=>{activeIndex=index;highlightCommand()});
  button.addEventListener('click',()=>runCommand(index));results.append(button);
 }
 highlightCommand();
}
function runCommand(index){const command=visibleCommands[index];if(!command)return;palette.close();command.run()}
function openPalette(){
 if(!palette||palette.open)return;
 search.value='';renderCommands();
 if($('#hotkeysDialog')?.open)$('#hotkeysDialog').close();
 palette.showModal();requestAnimationFrame(()=>search.focus());
}
function installPalette(){
 palette=create('dialog','studio-command-dialog');palette.id='studioCommandPalette';
 palette.setAttribute('aria-label','فرمان‌های سریع آتلیه');
 palette.innerHTML='<div class="studio-command-head"><span class="studio-brand-glyph" aria-hidden="true">✦</span><div><strong>فرمان‌های سریع</strong><small>نام یک ابزار، مرحله یا صفحه را جست‌وجو کن</small></div><kbd>ESC</kbd></div><label class="studio-command-search"><span aria-hidden="true">⌕</span><input id="studioCommandSearch" type="search" placeholder="مثلاً: PDF، آزمون، صفحه ۱۲…" autocomplete="off" role="combobox" aria-controls="studioCommandResults" aria-expanded="true" aria-autocomplete="list"></label><div class="studio-command-results" id="studioCommandResults" role="listbox" aria-label="نتایج فرمان‌ها"></div><div class="studio-command-footer"><span>↑ ↓ انتخاب</span><span>Enter اجرا</span><span>Ctrl + K بازکردن</span></div>';
 document.body.append(palette);search=$('#studioCommandSearch');results=$('#studioCommandResults');
 search.addEventListener('input',renderCommands);
 search.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();if(!visibleCommands.length)return;
   activeIndex=(activeIndex+(e.key==='ArrowDown'?1:-1)+visibleCommands.length)%visibleCommands.length;highlightCommand();
  }else if(e.key==='Enter'){e.preventDefault();runCommand(activeIndex)}
 });
 palette.addEventListener('click',e=>{if(e.target===palette)palette.close()});
 // Capture prevents the legacy Ctrl+K help handler in app.js from opening another modal.
 document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key.toLowerCase()==='k'||(e.shiftKey&&e.key.toLowerCase()==='p'))){
   e.preventDefault();e.stopImmediatePropagation();openPalette();return;
  }
  if(palette.open&&e.key==='Escape'){e.preventDefault();palette.close();return}
  if(palette.open)return;
  if(e.key==='Escape'&&document.body.classList.contains('studio-immersive')){closeFullscreen();return}
  if((e.ctrlKey||e.metaKey)&&e.altKey&&!isTyping(e.target)){
   if(e.key.toLowerCase()==='z'){e.preventDefault();undo()}
   if(e.key.toLowerCase()==='y'){e.preventDefault();redo()}
  }
 },true);
}
let immersive=false;
function closeFullscreen(){
 document.body.classList.remove('studio-immersive');immersive=false;
 if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
 pdfRefresh();
}
function toggleFullscreen(){
 const viewer=$('.workbench > .viewer');if(!viewer)return;
 if(document.fullscreenElement||immersive){closeFullscreen();return}
 viewer.requestFullscreen?.().then(()=>pdfRefresh()).catch(()=>{immersive=true;document.body.classList.add('studio-immersive');pdfRefresh()});
 if(!viewer.requestFullscreen){immersive=true;document.body.classList.add('studio-immersive');pdfRefresh()}
}
function installViewerToolbar(){
 const viewer=$('.workbench > .viewer');if(!viewer)return;
 const row=create('div','studio-viewer-actions');row.append(create('span','studio-viewer-label','PDF / DOCUMENT VIEWER'));
 const buttons=create('div','studio-viewer-buttons');
 buttons.append(makeButton('تمام‌صفحه',toggleFullscreen,'studio-viewer-fullscreen'),makeButton('فرمان‌ها',openPalette,'studio-viewer-command'));
 row.append(buttons);viewer.prepend(row);
 document.addEventListener('fullscreenchange',()=>{
  const full=Boolean(document.fullscreenElement);
  row.querySelector('.studio-viewer-fullscreen').textContent=full?'خروج از تمام‌صفحه':'تمام‌صفحه';pdfRefresh();
 });
}
function setDraftStatus(message,tone='neutral'){
 if(!draftNotice)return;draftNotice.textContent=message;draftNotice.dataset.tone=tone;
}
function emitChanges(id){
 const el=document.getElementById(id);if(!el)return;
 if(el.type==='hidden'&&['difficulty','correctOption'].includes(id)){
  document.querySelector(`.segmented[data-target="${id}"] button[data-value="${CSS.escape(el.value)}"]`)?.click();
 }else{el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
}
function applyForm(data){
 if(!data||typeof data!=='object')return;
 applying=true;
 try{
  const ordered=['provider','examMonth','examDay','operator','sourceNumber','subject','grade','chapter','unit','difficulty','correctOption'];
  for(const id of ordered){
   const el=document.getElementById(id);if(!el||el.type==='file'||!Object.prototype.hasOwnProperty.call(data,id))continue;
   const value=String(data[id]??'').slice(0,200);
   if(el.tagName==='SELECT'&&!Array.from(el.options).some(o=>o.value===value))continue;
   el.value=value;emitChanges(id);
  }
 }finally{applying=false}
}
function saveDraft(){
 clearTimeout(saveTimer);
 if(conflicted){setDraftStatus('تعارض بین دو تب؛ برای تصمیم‌گیری داشبورد را باز کن.','warning');return}
 const payload={version:3,savedAt:Date.now(),fields:formSnapshot()};
 if(storage.set(draftKey,payload)){lastStored=JSON.stringify(payload);setDraftStatus('پیش‌نویس محلی ذخیره شد','ok');cloudSync?.schedule()}
 else setDraftStatus('ذخیره محلی در دسترس نیست','warning');
}
function registerChange(){
 if(applying)return;
 const value=stateString();if(history[historyIndex]===value)return;
 history=history.slice(0,historyIndex+1);history.push(value);
 if(history.length>60)history.shift();historyIndex=history.length-1;
 setDraftStatus('در حال ذخیره تغییرات…');
 clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,600);
 updateHistoryButtons();
}
function updateHistoryButtons(){
 $('#studioUndo')?.toggleAttribute('disabled',historyIndex<=0);
 $('#studioRedo')?.toggleAttribute('disabled',historyIndex>=history.length-1);
}
function travel(delta){
 const next=historyIndex+delta;if(next<0||next>=history.length)return;
 historyIndex=next;applyForm(JSON.parse(history[historyIndex]));saveDraft();updateHistoryButtons();
}
function undo(){travel(-1)}
function redo(){travel(1)}
function revisions(){const list=storage.get(revisionsKey,[]);return Array.isArray(list)?list.slice(0,12):[]}
function saveRevision(){
 const list=revisions();list.unshift({id:Date.now(),time:new Date().toISOString(),fields:formSnapshot()});
 if(storage.set(revisionsKey,list.slice(0,12))){setDraftStatus('نسخه قابل بازیابی از فرم ذخیره شد','ok');renderProjectDashboard()}
 else setDraftStatus('ذخیره نسخه ممکن نیست','warning');
}
function restoreRevision(item){
 if(!item?.fields)return;
 applyForm(item.fields);registerChange();saveDraft();renderProjectDashboard();
}
function installDrafts(){
 const session=$('#sessionCard'),head=session?.querySelector('.section-head');
 draftNotice=create('small','studio-draft-status','پیش‌نویس فرم: آماده');draftNotice.setAttribute('role','status');draftNotice.setAttribute('aria-live','polite');
 head?.insertAdjacentElement('afterend',draftNotice);
 const controls=create('div','studio-history-controls');
 controls.append(
  makeButton('↶ بازگشت',undo,'studio-undo-button'),
  makeButton('↷ تکرار',redo,'studio-redo-button'),
  makeButton('◷ ذخیره نسخه',saveRevision),
  makeButton('پروژه‌ها',openProjectDashboard)
 );
 controls.children[0].id='studioUndo';controls.children[1].id='studioRedo';session?.append(controls);
 history=[stateString()];historyIndex=0;updateHistoryButtons();
 fields.forEach(el=>{el.addEventListener('input',registerChange);el.addEventListener('change',registerChange)});
 document.querySelectorAll('.segmented[data-target] button').forEach(button=>button.addEventListener('click',()=>queueMicrotask(registerChange)));
 const prior=storage.get(draftKey)||storage.get('selection-studio-form-draft-v2');
 if(prior?.fields&&Object.keys(prior.fields).length){
  const recovery=create('div','studio-recovery-banner');
  const label=create('div','studio-recovery-text','یک پیش‌نویس قدیمی برای فرم پیدا شد. PDFها در آن ذخیره نشده‌اند.');
  const apply=makeButton('بازیابی فرم',()=>{
   applyForm(prior.fields);history=[stateString()];historyIndex=0;saveDraft();recovery.remove();updateHistoryButtons();
  });
  const dismiss=makeButton('فعلاً نه',()=>recovery.remove());
  recovery.append(label,apply,dismiss);head?.insertAdjacentElement('afterend',recovery);
 }
 window.addEventListener('storage',e=>{
  if(e.key===draftKey&&e.newValue&&e.newValue!==lastStored){
   conflicted=true;setDraftStatus('پیش‌نویس در تب دیگری تغییر کرده است','warning');
  }
 });
}
let projectDialog,projectContent;
function renderProjectDashboard(){
 if(!projectContent)return;
 projectContent.replaceChildren();
 const records=safeRecords(),groups=new Map();
 for(const item of records){const key=String(item.exam_id||'بدون شناسه آزمون');groups.set(key,(groups.get(key)||0)+1)}
 const headline=create('div','studio-dashboard-hero');headline.append(create('span','studio-overline','LOCAL PROJECT OVERVIEW'),create('strong','',`${records.length} سؤال در ${groups.size} آزمون`),create('p','','اطلاعات این داشبورد فقط روی همین دستگاه هستند. تصاویر و PDFها در این خروجی JSON قرار نمی‌گیرند.'));
 projectContent.append(headline);
 const cloud=create('section','studio-cloud-sync');projectContent.append(cloud);cloudSync?.render(cloud);
 const area=create('div','studio-project-grid');
 if(!groups.size)area.append(create('p','studio-no-records','پروژه‌ای برای نمایش وجود ندارد.'));
 for(const [key,count] of groups){const row=create('article','studio-project-card');row.append(create('strong','',key),create('small','',`${count} سؤال ذخیره‌شده`));area.append(row)}
 projectContent.append(area);
 const label=create('div','studio-revision-heading');label.append(create('strong','','نسخه‌های قابل بازیابی فرم'),makeButton('ذخیره نسخه تازه',saveRevision));projectContent.append(label);
 const list=create('div','studio-revision-list');
 const options={dateStyle:'medium',timeStyle:'short'};
 const versions=revisions();if(!versions.length)list.append(create('p','studio-no-records','هنوز نسخه‌ای ساخته نشده است.'));
 for(const entry of versions){const row=create('div','studio-revision-row');
  row.append(create('span','',new Date(entry.time).toLocaleString('fa-IR',options)),makeButton('بازیابی',()=>restoreRevision(entry)));
  list.append(row)
 }
 projectContent.append(list);
 const actions=create('div','studio-dashboard-actions');
 actions.append(makeButton('دریافت JSON شناسنامه‌ها',()=>{
  const data={schema:'selection-studio-local-metadata-backup',version:1,exportedAt:new Date().toISOString(),records,form:formSnapshot(),revisions:versions};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=create('a');a.href=url;a.download=`selection-studio-metadata-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }));
 if(conflicted){
  actions.append(makeButton('بازیابی تغییرات تب دیگر',()=>{
   const ext=storage.get(draftKey);
   if(ext?.fields){applyForm(ext.fields);conflicted=false;history=[stateString()];historyIndex=0;setDraftStatus('فرم تب دیگر بازیابی شد','ok');updateHistoryButtons();renderProjectDashboard()}
  }));
  actions.append(makeButton('نگه‌داشتن نسخه این تب',()=>{conflicted=false;saveDraft();renderProjectDashboard()}));
 }
 projectContent.append(actions);
}
function openProjectDashboard(){if(!projectDialog)return;renderProjectDashboard();projectDialog.showModal()}
function installProjectDashboard(){
 projectDialog=create('dialog','studio-project-dialog');projectDialog.id='studioProjectDashboard';projectDialog.setAttribute('aria-label','داشبورد پروژه‌های محلی');
 const header=create('div','studio-dashboard-header');header.append(create('div','',''),makeButton('بستن',()=>projectDialog.close()));
 header.firstChild.append(create('span','studio-overline','PROJECT HUB'),create('h2','','داشبورد پروژه‌ها'));
 projectContent=create('div','studio-project-content');projectDialog.append(header,projectContent);document.body.append(projectDialog);
 projectDialog.addEventListener('click',e=>{if(e.target===projectDialog)projectDialog.close()});
}
installPalette();installProjectDashboard();installSidebar();installViewerToolbar();installDrafts();
cloudSync=installCloudDraftSync({getFields:formSnapshot,applyFields:applyForm,getLocal:()=>storage.get(draftKey),onStatus:setDraftStatus,onApplied:()=>{history=[stateString()];historyIndex=0;updateHistoryButtons();saveDraft();}});