/* ZH-78 | Operator-reviewed multi-item OCR queue.
 * In-memory captures are staged only after explicit clicks. Already submitted jobs
 * remain accessible from D1 after closing or reloading this browser. */
import {prepareOcrImage,buildOcrPrompt} from './ocr-core.js';
import {isOperatorAuthenticated} from './operator-auth.js';
const node=(tag,cls='',value='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value)e.textContent=value;return e};
const states={running:'در حال پردازش',paused:'متوقف‌شده',completed:'پایان‌یافته',cancelled:'لغوشده',
 staged:'منتظر ارسال',queued:'در صف',processing:'در حال OCR',done:'آماده بازبینی',failed:'ناموفق'};
function stateLabel(s){return states[s]||'نامشخص'}
function apiError(status,body){
 if(body?.error==='BATCH_DISABLED')return 'OCR گروهی تا پایان تنظیم و تست مصرف‌کننده صف عمداً غیرفعال است؛ فعلاً پردازشی آغاز نمی‌شود.';
 if(status===401||status===403)return 'برای استفاده از صف، ورود اپراتور لازم است.';
 if(status===429)return 'محدودیت تعداد درخواست‌ها یا صف فعال پر شده است.';
 if(status===503)return 'زیرساخت صف هنوز متصل یا آماده نیست.';
 return 'عملیات صف ناموفق بود: '+String(body?.error||status).slice(0,90);
}
async function fetchJob(path,method='GET',payload){
 const response=await fetch('/api/ocr/jobs'+path,{
  method,credentials:'same-origin',cache:'no-store',
  headers:payload?{'Content-Type':'application/json'}:{},
  ...(payload?{body:JSON.stringify(payload)}:{})
 });
 let body=null;try{body=await response.json()}catch{}
 if(!response.ok)throw Error(apiError(response.status,body));
 return body;
}
export function createBatchOcrPanel({capture,getFingerprint,getIdentity,onNotice=()=>{},onUse=()=>{}}){
 const host=node('section','studio-batch-ocr');
 host.id='studioBatchOcr';host.setAttribute('aria-label','صف پردازش گروهی OCR');
 const heading=node('div','studio-batch-heading');
 heading.append(node('strong','','صف OCR گروهی'),node('p','','چند برش را اضافه کن، پردازش را آغاز کن و بعداً نتیجه را بررسی کن. خروجی بدون تأیید وارد بانک سؤال نمی‌شود.'));
 const actions=node('div','studio-batch-actions');
 const addQ=node('button','','+ افزودن برش سؤال'),addA=node('button','','+ افزودن برش پاسخ');
 const start=node('button','','شروع پردازش گروهی'),reload=node('button','','به‌روزرسانی صف');
 const clear=node('button','','پاک‌کردن لیست آماده');
 for(const button of [addQ,addA,start,reload,clear]){button.type='button';actions.append(button)}
 addQ.id='studioBatchAddQuestion';addA.id='studioBatchAddAnswer';start.id='studioBatchStart';reload.id='studioBatchRefresh';
 const status=node('p','studio-batch-status','صف آماده است. هر تصویر فقط با اقدام مستقیم تو ارسال می‌شود.');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const staged=node('div','studio-batch-staged'),history=node('div','studio-batch-history');
 const summary=node('h4','','درخواست‌های ثبت‌شده');
 host.append(heading,actions,status,staged,summary,history);
 const pending=[],own=new Map();
 let jobs=[],busy=false,poll=null,pendingKey=null;
 function button(label,fn,disabled=false){
  const e=node('button','',label);e.type='button';e.disabled=disabled;e.addEventListener('click',fn);return e;
 }
 function setStatus(message){status.textContent=message}
 function draw(){
  addQ.disabled=busy||pending.length>=6||!getFingerprint('question')||!isOperatorAuthenticated();
  addA.disabled=busy||pending.length>=6||!getFingerprint('answer')||!isOperatorAuthenticated();
  start.disabled=busy||pending.length===0||!isOperatorAuthenticated();
  clear.disabled=busy||pending.length===0;
  reload.disabled=busy||!isOperatorAuthenticated();
  staged.replaceChildren();
  if(!pending.length)staged.append(node('p','studio-batch-empty','برشی برای ارسال آماده نشده است.'));
  pending.forEach((item,index)=>{
   const row=node('div','studio-batch-row');
   row.append(node('span','',(index+1)+' · '+(item.kind==='question'?'سؤال':'پاسخ')+' · '+item.label),
    button('حذف',()=>{pending.splice(index,1);pendingKey=null;draw()},busy));
   staged.append(row);
  });
  history.replaceChildren();
  if(!jobs.length)history.append(node('p','studio-batch-empty','درخواستی در تاریخچه اخیر وجود ندارد.'));
  jobs.forEach(job=>{
   const card=node('article','studio-batch-job');
   const top=node('div','studio-batch-job-header');
   top.append(node('strong','','درخواست '+job.id.slice(0,8)+' · '+stateLabel(job.status)),
    node('small','',job.percent+'٪ · '+job.counts.done+' موفق · '+job.counts.failed+' ناموفق'));
   card.append(top);
   const progress=node('progress');progress.max=Math.max(1,job.total);progress.value=(job.counts.done||0)+(job.counts.failed||0)+(job.counts.cancelled||0);
   progress.setAttribute('aria-label','پیشرفت پردازش OCR');card.append(progress);
   const controls=node('div','studio-batch-job-actions');
   if(job.status==='running')controls.append(button('توقف صف',()=>void act(job.id,'pause')));
   if(job.status==='paused'||job.status==='running'&&job.counts.staged>0)controls.append(button('ادامه',()=>void act(job.id,'resume')));
   if(job.counts.failed>0&&job.status!=='cancelled')controls.append(button('تلاش مجدد ناموفق‌ها',()=>void act(job.id,'retry')));
   if(['running','paused'].includes(job.status))controls.append(button('لغو باقی‌مانده',()=>void act(job.id,'cancel')));
   card.append(controls);
   const entries=node('div','studio-batch-results');
   for(const item of job.items||[]){
    const row=node('details','studio-batch-result');
    const title=node('summary','',(item.kind==='question'?'سؤال':'پاسخ')+' · '+stateLabel(item.status)+(item.attempts?' · تلاش '+item.attempts:''));
    row.append(title);
    if(item.error)row.append(node('p','studio-batch-error','خطای پردازش: '+item.error));
    if(item.status==='done'&&item.result){
     const result=node('pre','studio-batch-transcription',item.result.text||item.result.latex?.join('\n')||'');
     row.append(result);
     const commands=node('div','studio-batch-result-actions');
     commands.append(button('کپی متن',()=>void navigator.clipboard?.writeText((item.result.text||'')+'\n'+(item.result.latex||[]).join('\n'))));
     const context=own.get(item.clientRef);
     if(context)commands.append(button('انتقال به ویرایشگر',()=>{
      if(getIdentity()!==context.identity||getFingerprint(item.kind)!==context.fingerprint){
       onNotice('PDF یا برش تغییر کرده؛ نتیجه فقط قابل مشاهده و کپی است.');return;
      }
      if(!window.confirm('نتیجه صف جای پیش‌نویس OCR این بخش قرار بگیرد؟ تأیید نهایی همچنان لازم است.'))return;
      onUse(item.kind,context.signature,item.result);
     }));
     row.append(commands);
    }
    entries.append(row);
   }
   card.append(entries);history.append(card);
  });
 }
 async function append(kind){
  if(busy||pending.length>=6||!isOperatorAuthenticated()||!getFingerprint(kind))return;
  const identity=getIdentity(),fingerprint=getFingerprint(kind),signature=JSON.stringify([String(identity||''),fingerprint||'']);
  busy=true;draw();setStatus('در حال آماده‌کردن برش '+(kind==='question'?'سؤال':'پاسخ')+' …');
  try{
   const captured=await capture(kind);
   if(getIdentity()!==identity||getFingerprint(kind)!==fingerprint)throw Error('PDF یا برش در حین آماده‌سازی تغییر کرد.');
   const image=await prepareOcrImage(captured.blob);
   if(pending.reduce((n,x)=>n+x.image.length,0)+image.length>15500000)throw Error('حجم تصاویر آماده از ظرفیت یک درخواست بیشتر شده؛ ابتدا موارد فعلی را ارسال کن.');
   const clientRef=crypto.randomUUID();
   pendingKey=null;
   pending.push({kind,image,clientRef,prompt:buildOcrPrompt({kind,pass:1}),
    label:(kind==='question'?'سؤال':'پاسخ')+' · '+String(identity).slice(0,48),identity,fingerprint,signature});
   setStatus('برش آماده شد. تا «شروع پردازش گروهی» را نزنی هیچ درخواست OCR ارسال نمی‌شود.');
  }catch(e){onNotice(String(e?.message||'آماده‌سازی تصویر ناموفق بود.'))}
  finally{busy=false;draw()}
 }
 async function startJob(){
  if(busy||!pending.length||!isOperatorAuthenticated())return;
  busy=true;draw();
  const requestKey=pendingKey||(pendingKey=crypto.randomUUID());
  const input=pending.map(({clientRef,kind,image,prompt})=>({clientRef,kind,image,prompt}));
  try{
   const created=await fetchJob('','POST',{requestKey,items:input});
   for(const item of pending)own.set(item.clientRef,{identity:item.identity,fingerprint:item.fingerprint,signature:item.signature});
   pending.splice(0);pendingKey=null;jobs=[created,...jobs.filter(x=>x.id!==created.id)].slice(0,8);
   setStatus('درخواست ثبت شد؛ وضعیت روی سرور ذخیره شده و بعد از خروج هم قابل مشاهده است.');
   beginPolling();
  }catch(e){onNotice(e.message);setStatus('ثبت صف انجام نشد. تصاویر آماده باقی مانده‌اند و می‌توانی دوباره تلاش کنی.')}
  finally{busy=false;draw()}
 }
 async function refresh(){
  if(busy||!isOperatorAuthenticated())return;
  try{
   const data=await fetchJob('');
   jobs=Array.isArray(data.jobs)?data.jobs:[];
   draw();
  }catch(e){setStatus(e.message)}
 }
 async function act(id,action){
  if(busy)return;
  busy=true;draw();
  try{
   const update=await fetchJob('/'+id+'/'+action,'POST');
   jobs=jobs.map(x=>x.id===id?update:x);
   setStatus('وضعیت صف به‌روزرسانی شد: '+stateLabel(update.status));
  }catch(e){onNotice(e.message)}
  finally{busy=false;draw()}
 }
 function beginPolling(){
  if(poll)return;
  poll=setInterval(()=>{
   if(!document.hidden&&jobs.some(x=>x.status==='running'||x.status==='paused'))void refresh();
   if(!jobs.some(x=>x.status==='running'||x.status==='paused')){clearInterval(poll);poll=null}
  },5500);
 }
 addQ.addEventListener('click',()=>void append('question'));
 addA.addEventListener('click',()=>void append('answer'));
 start.addEventListener('click',()=>void startJob());
 clear.addEventListener('click',()=>{if(busy)return;pending.splice(0);pendingKey=null;draw()});
 reload.addEventListener('click',()=>{void refresh();beginPolling()});
 draw();
 const restore=async()=>{if(!isOperatorAuthenticated())return;await refresh();if(jobs.some(j=>j.status==='running'||j.status==='paused'))beginPolling()};
 document.addEventListener('selectionstudio:operator-authenticated',()=>void restore());
 if(isOperatorAuthenticated())void restore();
 // Results are rehydrated from the server after verified login. Poll only active work.
 return {host,refresh,resetPending:()=>{pending.splice(0);pendingKey=null;draw()},sync:draw};
}
