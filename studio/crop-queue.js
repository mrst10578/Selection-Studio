import {validRegion} from './pdf-crop.js';
/* ZH-73: multiple non-destructive regions per question; original PDF stays untouched. */
export function uniqueRegions(regions){
 const seen=new Set();
 return regions.filter(validRegion).filter(region=>{
  const key=JSON.stringify([Number(region.page),region.bbox_norm.map(x=>Number(x).toFixed(5))]);
  if(seen.has(key))return false;
  seen.add(key);return true;
 }).map(region=>structuredClone(region));
}
export function createCropQueue({question,answer,switchPane,onNotice=()=>{}}){
 const croppers={question,answer};
 const queued={question:[],answer:[]};
 const views={};
 const limit=12;
 const current=kind=>croppers[kind];
 const selections=kind=>uniqueRegions([...queued[kind],current(kind).region]);
 const notify=(text)=>onNotice(text);
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
   remove.setAttribute('aria-label','حذف برش '+(index+1));remove.addEventListener('click',()=>{queued[kind].splice(index,1);update(kind)});
   group.append(jump,remove);list.append(group);
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
  update(kind);notify('برش به صف اضافه شد. کادر بعدی را انتخاب کن.');return true;
 }
 function clear(kind){queued[kind]=[];update(kind)}
 function reset(){clear('question');clear('answer')}
 async function capture(kind){
  const crop=current(kind),regions=selections(kind);
  if(!regions.length||!crop.isRenderReady())throw Error('PDF_CROP_NOT_READY');
  if(regions.length===1){
   if(crop.page!==Number(regions[0].page))await crop.go(Number(regions[0].page));
   await crop.setRegion(regions[0]);
   const captured=await crop.captureCrop();
   return {...captured,regions};
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
  clearBtn.addEventListener('click',()=>clear(kind));
  head.append(count,btn,clearBtn);
  const list=document.createElement('div');list.className='studio-crop-chips';
  const guide=document.createElement('p');guide.className='studio-crop-guide';
  guide.textContent='برای سؤال چندقسمتی هر کادر را به صف اضافه کن؛ هنگام ثبت، برش‌ها کنار هم ترکیب می‌شوند.';
  host.append(head,list,guide);toolbar.insertAdjacentElement('afterend',host);
  views[kind]={count,list};update(kind);
  document.getElementById(kind==='question'?'questionPdf':'answerPdf')?.addEventListener('change',()=>clear(kind));
 }
 install('question');install('answer');
 return {add,clear,reset,capture,selections};
}
