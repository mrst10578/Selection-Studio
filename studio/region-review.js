import {validateEditedBounds} from './region-detector.js';
/* Operator-reviewed suggestions. Detection does not modify crop state or queue.
 * No image data, annotations or PDFs leave the browser. */
export function openRegionReview({snapshot,onReview,onAccept,onClose=()=>{}}){
 if(!snapshot?.candidates?.length)return null;
 const entries=snapshot.candidates.map(c=>({...c,bbox_norm:[...c.bbox_norm],selected:false}));
 const make=(tag,cls='',content='')=>{
  const el=document.createElement(tag);if(cls)el.className=cls;if(content)el.textContent=content;return el;
 };
 const dialog=make('dialog','studio-region-suggestions studio-region-review');
 dialog.setAttribute('aria-label','بررسی و اصلاح کادرهای پیشنهادی');
 const heading=make('div','studio-region-review-header');
 heading.append(make('h2','','بررسی کادرهای پیشنهادی · صفحه '+entries[0].page),
  make('p','','این یک تشخیص تقریبی بر اساس تیرگی و فاصله خطوط است. پیش از افزودن، کادرهای موردنظر را بررسی یا اصلاح کن.'));
 const body=make('div','studio-region-review-body');
 const illustration=make('div','studio-region-image');
 const image=make('img');image.alt='پیش‌نمایش صفحه PDF با محدوده‌های پیشنهادی';image.src=snapshot.thumbnail.toDataURL('image/webp',.86);
 illustration.append(image);
 const overlay=make('div','studio-region-overlay');illustration.append(overlay);
 const list=make('div','studio-region-editor-list');
 body.append(illustration,list);
 const actions=make('div','studio-crop-proposal-actions');
 const feedback=make('p','studio-region-feedback','هیچ کادری انتخاب نشده است.');
 feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
 const selected=()=>entries.filter(x=>x.selected);
 const syncFeedback=message=>{
  const count=selected().length;
  feedback.textContent=message||(`کادرهای انتخاب‌شده: ${count} از ${entries.length}`);
  if(submit)submit.disabled=count===0;
 };
 let submit=null;
 const rows=[];
 for(const [index,entry] of entries.entries()){
  const row=make('div','studio-region-editor-row');
  const top=make('div','studio-region-editor-top');
  const check=make('input');check.type='checkbox';check.id='studioRegionCheck'+index;
  check.setAttribute('aria-label','انتخاب '+entry.label);
  const label=make('label','studio-region-editor-title',entry.label+' · صفحه '+entry.page);
  label.htmlFor=check.id;
  const hint=make('span','studio-region-confidence',entry.kind==='option'?'گزینه احتمالی':entry.kind==='question'?'متن سؤال احتمالی':'بخش پیشنهادی');
  const preview=make('button','studio-region-inspect','بازبینی روی PDF');
  preview.type='button';
  preview.addEventListener('click',()=>{
   const bounds=[...entry.bbox_norm];
   dialog.close();void onReview?.({page:entry.page,bbox_norm:bounds});
  });
  top.append(check,label,hint,preview);
  const inputs=make('div','studio-region-coordinate-inputs');
  const coords=['چپ','بالا','راست','پایین'];
  const controls=coords.map((name,i)=>{
   const wrap=make('label','studio-region-coordinate');
   wrap.append(make('span','',name+' (٪)'));
   const input=make('input');input.type='number';input.min='0';input.max='100';input.step='.1';
   input.value=String(Math.round(entry.bbox_norm[i]*1000)/10);
   input.setAttribute('aria-label',name+' کادر '+(index+1));
   wrap.append(input);inputs.append(wrap);return input;
  });
  const toggle=make('button','studio-region-overlay-box',String(index+1));toggle.type='button';
  toggle.setAttribute('aria-label','انتخاب یا حذف کادر '+(index+1));
  overlay.append(toggle);
  const place=()=>{
   const [x1,y1,x2,y2]=entry.bbox_norm;
   Object.assign(toggle.style,{left:(x1*100)+'%',top:(y1*100)+'%',width:((x2-x1)*100)+'%',height:((y2-y1)*100)+'%'});
  };
  const mark=()=>{
   row.classList.toggle('selected',entry.selected);toggle.classList.toggle('selected',entry.selected);
   toggle.setAttribute('aria-pressed',String(entry.selected));check.checked=entry.selected;syncFeedback();
  };
  check.addEventListener('change',()=>{entry.selected=check.checked;mark()});
  toggle.addEventListener('click',()=>{entry.selected=!entry.selected;mark();row.scrollIntoView({block:'nearest'})});
  controls.forEach(input=>input.addEventListener('change',()=>{
   const bounds=validateEditedBounds(controls.map(i=>i.value));
   for(const field of controls)field.setAttribute('aria-invalid',String(!bounds));
   if(!bounds){syncFeedback('محدوده نامعتبر است: هر کادر باید حداقل یک درصد عرض و ارتفاع داشته باشد.');return}
   entry.bbox_norm=bounds;place();syncFeedback();
  }));
  row.append(top,inputs);list.append(row);place();mark();rows.push({entry,controls,mark});
 }
 const selectAll=make('button','','انتخاب همه');selectAll.type='button';
 selectAll.addEventListener('click',()=>{for(const row of rows){row.entry.selected=true;row.mark()}});
 const deselect=make('button','','لغو انتخاب');deselect.type='button';
 deselect.addEventListener('click',()=>{for(const row of rows){row.entry.selected=false;row.mark()}});
 submit=make('button','primary','افزودن کادرهای تأییدشده');submit.type='button';submit.disabled=true;
 submit.addEventListener('click',()=>{
  // Revalidate all selected fields even if focus never left the edited input.
  const chosen=[];
  for(const row of rows.filter(row=>row.entry.selected)){
   const bounds=validateEditedBounds(row.controls.map(input=>input.value));
   if(!bounds){row.controls.forEach(input=>input.setAttribute('aria-invalid','true'));syncFeedback('لطفاً مختصات کادرهای انتخاب‌شده را اصلاح کن.');return}
   chosen.push({page:row.entry.page,bbox_norm:bounds});
  }
  if(!chosen.length)return;
  try{
   const ok=onAccept?.(chosen);
   if(ok!==false)dialog.close();
   else syncFeedback('ثبت کادرها انجام نشد؛ وضعیت صفحه و ظرفیت صف را بررسی کن.');
  }catch{syncFeedback('خطایی در افزودن کادرها رخ داد. مجدداً تلاش کن.')}
 });
 const cancel=make('button','','انصراف');cancel.type='button';cancel.addEventListener('click',()=>dialog.close());
 actions.append(selectAll,deselect,submit,cancel);
 dialog.append(heading,body,feedback,actions);document.body.append(dialog);
 dialog.addEventListener('close',()=>{dialog.remove();onClose()},{once:true});
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
 syncFeedback();dialog.showModal();return {dialog,entries};
}
