import {validRegion} from './pdf-crop.js';
import {createDetectionSnapshot} from './region-detector.js';
import {openRegionReview} from './region-review.js';
/* ZH-73: multiple non-destructive regions per question; original PDF stays untouched. */
export function uniqueRegions(regions){
 const seen=new Set();
 return regions.filter(validRegion).filter(region=>{
  const key=JSON.stringify([Number(region.page),region.bbox_norm.map(x=>Number(x).toFixed(5))]);
  if(seen.has(key))return false;
  seen.add(key);return true;
 }).map(region=>structuredClone(region));
}
export function createCropQueue({question,answer,switchPane,onNotice=()=>{},onChange=()=>{}}){
 const croppers={question,answer};
 const queued={question:[],answer:[]};
 const views={};
 const limit=12;
 const current=kind=>croppers[kind];
 const selections=kind=>uniqueRegions([...queued[kind],current(kind).region]);
 const notify=(text)=>onNotice(text);
 const changed=()=>onChange();
 function shift(kind,index,delta){
  const items=queued[kind],next=index+delta;
  if(next<0||next>=items.length)return false;
  [items[index],items[next]]=[items[next],items[index]];
  update(kind);changed();return true;
 }
 function update(kind){
  const host=views[kind];
  if(!host)return;
  const {count,list}=host;
  const items=queued[kind];
  count.textContent=items.length?items.length+' برش در صف':'صف برش خالی است';
  list.replaceChildren();
  for(const [index,item] of items.entries()){
   const group=document.createElement('span');group.className='studio-crop-chip';
   const jump=document.createElement('button');jump.type='button';jump.textContent='برش '+(index+1)+' · صفحه '+item.page;
   jump.title='بازکردن محدوده ثبت‌شده';jump.addEventListener('click',()=>{void activate(kind,item)});
   const remove=document.createElement('button');remove.type='button';remove.className='studio-chip-remove';remove.textContent='×';
   remove.setAttribute('aria-label','حذف برش '+(index+1));remove.addEventListener('click',()=>{
    queued[kind].splice(index,1);
    const crop=current(kind),region=crop.region;
    if(region&&Number(region.page)===Number(item.page)&&JSON.stringify(region.bbox_norm)===JSON.stringify(item.bbox_norm)){
     if(crop.isRegionLocked())crop.setRegionLocked(false);
     crop.clearRegion();
    }
    update(kind);changed();
   });
   const up=document.createElement('button');up.type='button';up.textContent='↑';up.disabled=index===0;up.setAttribute('aria-label','بالا بردن برش '+(index+1));up.addEventListener('click',()=>shift(kind,index,-1));
   const down=document.createElement('button');down.type='button';down.textContent='↓';down.disabled=index===items.length-1;down.setAttribute('aria-label','پایین بردن برش '+(index+1));down.addEventListener('click',()=>shift(kind,index,1));
   group.append(jump,up,down,remove);list.append(group);
  }
 }
 async function activate(kind,item){
  switchPane(kind);
  const crop=current(kind);
  if(crop.isRegionLocked())crop.setRegionLocked(false);
  await crop.setRegion(item);
 }
 function add(kind){
  const crop=current(kind);
  if(!crop.isRegionReady()){notify('اول محدوده برش را روی PDF انتخاب کن.');return false}
  const item=structuredClone(crop.region);
  const merged=uniqueRegions([...queued[kind],item]);
  if(merged.length>limit){notify('هر سؤال حداکثر ۱۲ برش می‌تواند داشته باشد.');return false}
  if(merged.length===queued[kind].length){notify('این محدوده قبلاً به صف اضافه شده است.');return false}
  queued[kind]=merged;
  if(crop.isRegionLocked())crop.setRegionLocked(false);
  crop.clearRegion();
  update(kind);changed();notify('برش به صف اضافه شد. کادر بعدی را انتخاب کن.');return true;
 }
 function clear(kind){queued[kind]=[];update(kind);changed()}
 function reset(){clear('question');clear('answer')}
 async function capture(kind){
  const crop=current(kind),regions=selections(kind);
  if(!regions.length||!crop.isRenderReady())throw Error('PDF_CROP_NOT_READY');
  if(regions.length===1){
   const original=structuredClone(crop.region),originalPage=crop.page;
   try{
    if(crop.page!==Number(regions[0].page))await crop.go(Number(regions[0].page));
    await crop.setRegion(regions[0]);
    const captured=await crop.captureCrop();
    return {...captured,regions};
   }finally{
    if(crop.page!==originalPage)await crop.go(originalPage);
    await crop.setRegion(original);
   }
  }
  const original=structuredClone(crop.region),originalPage=crop.page;
  const pieces=[];
  try{
   for(const region of regions){
    if(crop.page!==Number(region.page))await crop.go(Number(region.page));
    await crop.setRegion(region);
    const item=await crop.captureCrop();
    pieces.push(await createImageBitmap(item.blob));
   }
   const width=Math.min(1800,Math.max(...pieces.map(p=>p.width)));
   const scale=pieces.map(p=>Math.min(1,width/p.width));
   const heights=pieces.map((p,i)=>Math.max(1,Math.round(p.height*scale[i])));
   const height=heights.reduce((sum,h)=>sum+h+12,0);
   if(height>14000||width*height>16000000)throw Error('PDF_CROP_COMPOSITE_TOO_LARGE');
   const output=document.createElement('canvas');output.width=width;output.height=height;
   const ctx=output.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
   let y=0;
   for(let i=0;i<pieces.length;i++){
    ctx.drawImage(pieces[i],0,y,Math.round(pieces[i].width*scale[i]),heights[i]);
    y+=heights[i]+12;
   }
   const blob=await new Promise((resolve,reject)=>output.toBlob(result=>result?resolve(result):reject(Error('PDF_CROP_ENCODE_FAILED')),'image/webp',.92));
   return {blob,regions,region:regions[0]};
  }finally{
   pieces.forEach(p=>p.close?.());
   if(crop.page!==originalPage)await crop.go(originalPage);
   await crop.setRegion(original);
  }
 }
 function install(kind){
  const pane=document.getElementById(kind+'Pane'),toolbar=pane?.querySelector('.pdf-toolbar');
  if(!pane||!toolbar)return;
  const host=document.createElement('div');host.className='studio-crop-queue';host.setAttribute('aria-label','صف برش‌های '+(kind==='question'?'سؤال':'پاسخ'));
  const head=document.createElement('div');head.className='studio-crop-queue-head';
  const count=document.createElement('span');count.className='studio-crop-count';
  const btn=document.createElement('button');btn.type='button';btn.textContent='+ افزودن این برش';
  btn.addEventListener('click',()=>add(kind));
  const clearBtn=document.createElement('button');clearBtn.type='button';clearBtn.textContent='پاک‌کردن صف';
  clearBtn.addEventListener('click',()=>{if(!queued[kind].length||window.confirm('همه برش‌های این صف حذف شوند؟'))clear(kind)});
  const zoom=document.createElement('div');zoom.className='studio-crop-zoom';zoom.setAttribute('aria-label','کنترل بزرگ‌نمایی PDF');
  const percent=document.createElement('output');percent.textContent='۱۰۰٪';
  const zoomButton=(symbol,delta,label)=>{
   const button=document.createElement('button');button.type='button';button.textContent=symbol;button.setAttribute('aria-label',label);
   button.addEventListener('click',async()=>{try{const value=await current(kind).setZoom(current(kind).zoom+delta);percent.textContent=Math.round(value*100)+'٪'}catch{notify('بزرگ‌نمایی ممکن نشد.')}});
   return button;
  };
  zoom.append(zoomButton('−',-.25,'کوچک‌کردن PDF'),percent,zoomButton('+',.25,'بزرگ‌کردن PDF'));
  const preview=document.createElement('button');preview.type='button';preview.textContent='پیش‌نمایش برش‌ها';
  preview.addEventListener('click',async()=>{
   preview.disabled=true;
   try{
    const result=await capture(kind);
    const url=URL.createObjectURL(result.blob);
    const dialog=document.createElement('dialog');dialog.className='studio-crop-preview';
    const close=document.createElement('button');close.type='button';close.textContent='بستن پیش‌نمایش';
    const image=document.createElement('img');image.src=url;image.alt='ترکیب برش‌های انتخاب‌شده';
    const message=document.createElement('p');message.textContent=result.regions.length+' برش آماده ذخیره است';
    dialog.append(close,message,image);document.body.append(dialog);
    const clean=()=>{URL.revokeObjectURL(url);dialog.remove()};
    close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',clean,{once:true});dialog.showModal();
   }catch{notify('برای پیش‌نمایش، یک محدوده آماده روی PDF انتخاب کن.')}
   finally{preview.disabled=false}
  });
  const detect=document.createElement('button');detect.type='button';detect.textContent='پیشنهاد کادرها';
  detect.title='پیشنهاد آزمایشی مبتنی بر فضای سفید PDF؛ نیازمند تأیید انسانی';
  detect.addEventListener('click',()=>{
   const crop=current(kind);
   if(!crop.isRenderReady()){notify('اول PDF را باز کن.');return}
   const page=crop.page,generation=crop.documentGeneration,renderSeq=crop.readyFrame?.renderSeq;
   let snapshot;
   try{snapshot=createDetectionSnapshot(crop.canvas,page)}
   catch{notify('تحلیل تصویر PDF ممکن نشد؛ از برش دستی استفاده کن.');return}
   if(!snapshot?.candidates?.length){
    notify('محدوده قابل‌اعتمادی شناسایی نشد؛ برش دستی را انجام بده.');return;
   }
   const isFresh=()=>Boolean(crop.isRenderReady()&&crop.page===page&&crop.documentGeneration===generation&&crop.readyFrame?.renderSeq===renderSeq);
   openRegionReview({
    snapshot,
    onReview:region=>{
     if(!isFresh()){notify('صفحه PDF تغییر کرده است. پیشنهادها را دوباره بررسی کن.');return}
     void activate(kind,region);
     notify('کادر پیشنهادی روی PDF نمایش داده شد؛ می‌توانی با برش دستی اصلاحش کنی.');
    },
    onAccept:regions=>{
     if(!isFresh()){notify('صفحه PDF تغییر کرده است. پیشنهادها را دوباره بررسی کن.');return false}
     // Distinct, validated regions only; do not silently truncate beyond queue cap.
     const merged=uniqueRegions([...queued[kind],...regions]);
     if(merged.length>limit){notify('هر سؤال حداکثر ۱۲ برش دارد؛ تعداد پیشنهادهای انتخاب‌شده را کم کن.');return false}
     if(merged.length===queued[kind].length){notify('این محدوده‌ها قبلاً در صف بودند.');return false}
     queued[kind]=merged;update(kind);changed();
     notify(regions.length+' کادر بررسی‌شده به صف اضافه شد.');return true;
    }
   });
  });
  const download=document.createElement('button');download.type='button';download.textContent='دریافت تصویر برش‌ها';
  download.addEventListener('click',async()=>{
   download.disabled=true;
   try{
    const result=await capture(kind);
    const url=URL.createObjectURL(result.blob);
    const a=document.createElement('a');a.href=url;a.download='selection-'+kind+'-crops.webp';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch{notify('برای خروجی، حداقل یک برش آماده انتخاب کن.')}finally{download.disabled=false}
  });
  head.append(count,btn,clearBtn,zoom,preview,download,detect);
  const list=document.createElement('div');list.className='studio-crop-chips';
  const guide=document.createElement('p');guide.className='studio-crop-guide';
  guide.textContent='برای سؤال چندقسمتی، کادرها را یکی‌یکی به صف اضافه کن. ترتیب آن‌ها با ↑ و ↓ قابل تغییر است؛ هنگام ثبت، برش‌ها کنار هم ترکیب می‌شوند.';
  const help=document.createElement('details');help.className='studio-touch-guide';
  help.innerHTML='<summary>راهنمای استفاده در موبایل و تبلت</summary><p>ابتدا PDF را انتخاب کن. با دکمه قفل شناور بین حرکت سند و انتخاب برش جابه‌جا شو. بعد از انتخاب هر کادر، «افزودن این برش» را بزن. برای تغییر بین سؤال و پاسخ، روی زبانه‌ها بزن یا آن‌ها را افقی بکش. برای رفتن به صفحه دلخواه از کادر شماره صفحه استفاده کن.</p>';
  host.append(head,list,guide,help);toolbar.insertAdjacentElement('afterend',host);
  views[kind]={count,list};update(kind);
  // The caller clears the queue only once replacement PDF loading succeeds.
 }
 install('question');install('answer');
 // Swipe only the tab strip, not the PDF itself, so pan/zoom cannot turn pages accidentally.
 const tabs=document.querySelector('.viewer-tabs');let start=null;
 tabs?.addEventListener('touchstart',e=>{if(e.touches.length===1)start={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
 tabs?.addEventListener('touchend',e=>{
  if(!start||!e.changedTouches.length)return;
  const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;start=null;
  if(Math.abs(dx)<75||Math.abs(dy)>55)return;
  document.getElementById(dx>0?'questionTab':'answerTab')?.click();
 },{passive:true});
 // Keyboard page navigation only outside editable fields and modal dialogs.
 document.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||!['PageUp','PageDown'].includes(event.key))return;
  if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
  const kind=document.getElementById('answerPane')?.classList.contains('hidden')?'question':'answer';
  const crop=current(kind);
  if(!crop?.pdf||crop.loading||crop.rendering)return;
  event.preventDefault();void crop.go(crop.page+(event.key==='PageDown'?1:-1));
 });
 return {add,clear,reset,capture,selections,shift};
}
