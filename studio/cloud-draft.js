/* Selection Studio cloud drafts. Stores only whitelisted form metadata; no PDF bytes. */
export const DRAFT_FIELDS=Object.freeze(['provider','examMonth','examDay','operator','sourceNumber','subject','grade','chapter','unit','difficulty','correctOption']);
export const sameFields=(left,right)=>JSON.stringify(left||{})===JSON.stringify(right||{});
export function installCloudDraftSync({getFields,applyFields,getLocal,onStatus,onApplied}){
 let remote=null,loaded=false,conflict=false,busy=false,timer=null;
 let message='در حال بررسی اتصال به پیش‌نویس ابری',versions=[],host=null;
 const endpoint='/api/draft?project=workspace';
 function notify(msg,tone='neutral'){message=msg;onStatus(msg,tone);render()}
 async function load(){
  try{
   const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Unavailable');
   const item=await response.json();
   if(!Number.isSafeInteger(item.revision)||item.revision<0)throw Error('Invalid response');
   remote=item;loaded=true;
   const local=getLocal()?.fields;
   conflict=Boolean(item.fields&&local&&!sameFields(item.fields,local));
   if(conflict)notify('فرم محلی و نسخه سرور متفاوت‌اند؛ یکی را انتخاب کن','warning');
   else if(item.fields&&local&&sameFields(item.fields,local))notify('فرم محلی و سرور یکسان‌اند','ok');
   else if(item.fields)notify('نسخه ابری موجود است؛ می‌توانی آن را بازیابی کنی','warning');
   else notify('فضای ابری آماده دریافت پیش‌نویس است','ok');
  }catch{loaded=false;notify('همگام‌سازی ابری در دسترس نیست؛ ذخیره محلی برقرار است','warning')}
 }
 async function push(force=false){
  if(!loaded||busy||(conflict&&!force))return;
  const fields=getFields();
  if(!force&&sameFields(fields,remote?.fields))return;
  const startSignature=JSON.stringify(fields);
  busy=true;
  try{
   const response=await fetch(endpoint,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:remote.revision,fields})});
   const result=await response.json();
   if(response.status===409){
    remote=result;conflict=true;notify('پیش‌نویس سرور جدیدتر است. انتخاب با شماست.','warning');return;
   }
   if(!response.ok||!result.saved||!Number.isSafeInteger(result.revision))throw Error('Invalid save');
   remote={...result,fields};conflict=false;notify('نسخه '+result.revision+' در سرور ذخیره شد','ok');
  }catch{notify('ارتباط سرور قطع شد؛ نسخه محلی محفوظ است','warning')}
  finally{
   busy=false;
   if(!conflict&&loaded&&JSON.stringify(getFields())!==startSignature)schedule();
  }
 }
 function schedule(){
  if(!loaded||conflict)return;
  clearTimeout(timer);timer=setTimeout(()=>{void push()},2200);
 }
 function recover(fields,confirmChoice=false){
  if(!fields)return;
  clearTimeout(timer);
  conflict=confirmChoice;
  applyFields(fields);onApplied();
  notify(confirmChoice?'نسخه قدیمی بازیابی شد؛ برای ثبت ابری تصمیم بگیر':'نسخه ابری بازیابی شد','ok');
 }
 function keepLocal(){
  if(!loaded)return;
  conflict=false;
  void push(true);
 }
 async function history(){
  if(!loaded)return;
  try{
   const response=await fetch(endpoint+'&history=1',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('History unavailable');
   const result=await response.json();
   versions=Array.isArray(result.versions)?result.versions.slice(0,12):[];
   render();
  }catch{notify('تاریخچه ابری موقتاً در دسترس نیست','warning')}
 }
 function render(target=null){
  if(target)host=target;
  if(!host)return;
  host.replaceChildren();
  const title=document.createElement('strong');title.textContent='پیش‌نویس امن ابری';
  const info=document.createElement('p');info.textContent=message;
  host.append(title,info);
  const actions=document.createElement('div');actions.className='studio-cloud-controls';
  const button=(caption,handler)=>{
   const b=document.createElement('button');b.type='button';b.textContent=caption;b.addEventListener('click',handler);actions.append(b);
  };
  button('بررسی اتصال',()=>{void load()});
  if(loaded){
   if(remote?.fields)button('بازیابی از سرور',()=>recover(remote.fields));
   button(conflict?'نگه‌داشتن این فرم و ثبت روی سرور':'همگام‌سازی الان',keepLocal);
   button('نسخه‌های قبلی',()=>{void history()});
  }
  host.append(actions);
  if(conflict){
   const note=document.createElement('p');note.className='studio-cloud-warning';note.textContent='هیچ نسخه‌ای خودکار جایگزین نشده است. برای رفع تعارض، فرم محلی یا نسخه ابری را انتخاب کن.';host.append(note);
  }
  if(versions.length){
   const list=document.createElement('div');list.className='studio-cloud-versions';
   for(const item of versions){
    const row=document.createElement('div');row.className='studio-revision-row';
    const label=document.createElement('span');label.textContent='نسخه '+item.revision+' · '+(item.updatedAt||'');
    const restore=document.createElement('button');restore.type='button';restore.textContent='بازیابی';restore.addEventListener('click',()=>recover(item.fields,true));
    row.append(label,restore);list.append(row);
   }
   host.append(list);
  }
 }
 void load();
 return {schedule,render,refresh:load};
}
