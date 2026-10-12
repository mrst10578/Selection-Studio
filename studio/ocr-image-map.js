/* ZH-76: accessible, bidirectional OCR text ↔ composite image selector.
 * Never changes the PDF cropper or sends pixels on its own. */
const el=(tag,cls='',label='')=>{
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(label)node.textContent=label;
 return node;
};
export function createOcrImageMap({textInput,onNotice=()=>{},onCapture,onAdd,onSelect,onReocr,onAccept,onReject,onCandidateEdit}){
 const host=el('section','studio-ocr-image-map');host.id='studioOcrImageMap';
 host.setAttribute('aria-label','تطبیق متن OCR با تصویر');
 const header=el('div','studio-ocr-map-heading');
 header.append(el('strong','','اتصال متن و تصویر'),el('p','','مختصات روی تصویر ترکیبی برش‌ها هستند، نه مختصات صفحهٔ PDF. برای اطمینان، هر تطبیق را بررسی کن.'));
 const controls=el('div','studio-ocr-map-actions');
 const load=el('button','','نمایش برش بدون OCR');load.type='button';load.id='studioOcrMapLoad';
 const link=el('button','','اتصال متن انتخاب‌شده به تصویر');link.type='button';link.id='studioOcrMapLink';
 const retry=el('button','','OCR مجدد همین محدوده');retry.type='button';retry.id='studioOcrMapRetry';
 controls.append(load,link,retry);
 const info=el('p','studio-ocr-map-info','برای شروع برش PDF را نمایش بده، قسمتی از متن را انتخاب کن و روی تصویر کادر بکش.');
 info.setAttribute('aria-live','polite');
 const imageFrame=el('div','studio-ocr-map-frame');
 const img=el('img','studio-ocr-map-image');
 img.alt='تصویر برش ترکیبی PDF برای تطبیق OCR';img.draggable=false;
 const overlay=el('div','studio-ocr-map-overlay');
 overlay.setAttribute('aria-label','ناحیه‌های متن در تصویر');
 const dragBox=el('div','studio-ocr-map-drag');dragBox.hidden=true;
 imageFrame.append(img,overlay,dragBox);
 const links=el('div','studio-ocr-map-links');
 links.setAttribute('aria-label','پیوندهای متن و تصویر');
 const candidate=el('section','studio-ocr-map-candidate');candidate.hidden=true;
 const candidateLabel=el('label','studio-ocr-field');
 candidateLabel.append(el('span','','پیشنهاد OCR انتخابی؛ قبل از اعمال ویرایش کن'));
 const candidateText=el('textarea');candidateText.id='studioOcrMapProposal';candidateText.rows=3;candidateText.dir='auto';
 candidateLabel.append(candidateText);
 const candidateActions=el('div','studio-ocr-map-candidate-actions');
 const accept=el('button','','اعمال متن پیشنهادی');accept.type='button';accept.id='studioOcrMapAccept';
 const reject=el('button','','رد پیشنهاد');reject.type='button';reject.id='studioOcrMapReject';
 candidateActions.append(accept,reject);candidate.append(candidateLabel,candidateActions);
 host.append(header,controls,info,imageFrame,links,candidate);
 let current=null,pending=null,drag=null;
 const urlSeen={value:''};
 const norm=(x,y)=>{const b=overlay.getBoundingClientRect();return [Math.max(0,Math.min(1,(x-b.left)/b.width)),Math.max(0,Math.min(1,(y-b.top)/b.height))]};
 const clearPending=()=>{pending=null;drag=null;dragBox.hidden=true;overlay.classList.remove('is-drawing')};
 function render(state){
  current=state;
  const ready=Boolean(state?.imageBlob&&state?.imageUrl);
  if(ready&&urlSeen.value!==state.imageUrl){img.src=state.imageUrl;urlSeen.value=state.imageUrl;clearPending()}
  if(!ready){img.removeAttribute('src');urlSeen.value='';clearPending()}
  imageFrame.hidden=!ready;
  load.disabled=Boolean(state?.busy);
  link.disabled=!ready||Boolean(state?.busy)||!state?.text;
  retry.disabled=!ready||Boolean(state?.busy)||!state?.links?.[state?.selected];
  links.replaceChildren();overlay.replaceChildren();
  const items=state?.links||[];
  items.forEach((item,index)=>{
   const selected=index===state.selected;
   const label=(state.text.slice(item.start,item.end).replace(/\s+/g,' ').slice(0,62)||'ناحیه '+(index+1));
   const button=el('button','studio-ocr-map-region',String(index+1));
   button.type='button';button.setAttribute('aria-label','نمایش ناحیه '+(index+1)+': '+label);
   button.setAttribute('aria-pressed',String(selected));
   const [x1,y1,x2,y2]=item.bbox_norm;
   Object.assign(button.style,{left:(x1*100)+'%',top:(y1*100)+'%',width:((x2-x1)*100)+'%',height:((y2-y1)*100)+'%'});
   button.addEventListener('click',()=>onSelect(index));
   overlay.append(button);
   const chip=el('button','studio-ocr-map-chip',(selected?'● ':'○ ')+label);
   chip.type='button';chip.setAttribute('aria-pressed',String(selected));
   chip.title=item.source==='model'?'محدوده پیشنهادی مدل؛ نیازمند تأیید':item.source==='operator'?'مختصات تعیین‌شده توسط اپراتور':'مختصات پس از OCR مجدد';
   chip.addEventListener('click',()=>onSelect(index));
   links.append(chip);
  });
  if(state?.candidate){
   candidate.hidden=false;
   if(document.activeElement!==candidateText)candidateText.value=state.candidate.text;
   accept.disabled=Boolean(state.busy)||!state.candidate.text.trim();
   reject.disabled=Boolean(state.busy);
  }else{candidate.hidden=true;candidateText.value=''}
  const drawing=pending!==null;
  link.setAttribute('aria-pressed',String(drawing));
  overlay.classList.toggle('is-drawing',drawing);
  if(ready){
   const selected=items[state?.selected];
   info.textContent=drawing?'کادر قسمت انتخاب‌شده را روی تصویر بکش. با لمس یا ماوس می‌توانی محدوده را تعیین کنی.':
    selected?'ناحیه '+(state.selected+1)+' انتخاب شده؛ متن متناظر هم در ویرایشگر مشخص است.':
    items.length?items.length+' تطبیق موجود است. یکی را از روی تصویر یا فهرست انتخاب کن.':
    'هنوز تطبیقی ثبت نشده. بخشی از متن را انتخاب و برای آن روی تصویر کادر بکش.';
  }else info.textContent='ابتدا با «نمایش برش بدون OCR» تصویر را بارگذاری کن؛ هیچ درخواست هوش مصنوعی ارسال نمی‌شود.';
 }
 load.addEventListener('click',()=>onCapture());
 link.addEventListener('click',()=>{
  if(!current?.imageBlob||current.busy)return;
  const start=textInput.selectionStart,end=textInput.selectionEnd;
  if(start===end||end-start>1200){onNotice('ابتدا عبارتی تا ۱۲۰۰ نویسه را در کادر متن انتخاب کن.');return}
  pending={start,end,original:current.text.slice(start,end)};
  overlay.classList.add('is-drawing');link.setAttribute('aria-pressed','true');
  info.textContent='حالا روی تصویر کادری برای همین عبارت بکش.';
 });
 overlay.addEventListener('pointerdown',e=>{
  if(!pending||!current?.imageBlob||e.button!==0||e.target!==overlay)return;
  const p=norm(e.clientX,e.clientY);
  drag={pointerId:e.pointerId,start:p,end:p};
  overlay.setPointerCapture(e.pointerId);e.preventDefault();
  dragBox.hidden=false;
 });
 overlay.addEventListener('pointermove',e=>{
  if(!drag||drag.pointerId!==e.pointerId)return;
  drag.end=norm(e.clientX,e.clientY);
  const [x1,y1]=drag.start,[x2,y2]=drag.end;
  Object.assign(dragBox.style,{left:(Math.min(x1,x2)*100)+'%',top:(Math.min(y1,y2)*100)+'%',width:(Math.abs(x1-x2)*100)+'%',height:(Math.abs(y1-y2)*100)+'%'});
 });
 overlay.addEventListener('pointerup',e=>{
  if(!drag||drag.pointerId!==e.pointerId)return;
  drag.end=norm(e.clientX,e.clientY);
  const [x1,y1]=drag.start,[x2,y2]=drag.end;
  const box=[Math.min(x1,x2),Math.min(y1,y2),Math.max(x1,x2),Math.max(y1,y2)].map(v=>Number(v.toFixed(6)));
  const saved=pending;
  clearPending();
  if(box[2]-box[0]<.02||box[3]-box[1]<.02){onNotice('کادر انتخابی خیلی کوچک است؛ محدوده را بزرگ‌تر بکش.');render(current);return}
  onAdd(saved,box);
 });
 overlay.addEventListener('pointercancel',()=>{clearPending();if(current)render(current)});
 retry.addEventListener('click',()=>onReocr());
 candidateText.addEventListener('input',()=>onCandidateEdit(candidateText.value));
 accept.addEventListener('click',()=>onAccept());
 reject.addEventListener('click',()=>onReject());
 function selectFromCursor(){
  if(!current||pending)return;
  const start=textInput.selectionStart,end=textInput.selectionEnd;
  const found=current.links.findIndex(item=>start===end?(start>=item.start&&start<=item.end):(start<item.end&&end>item.start));
  if(found>=0&&found!==current.selected)onSelect(found,{focus:false});
 }
 textInput.addEventListener('select',selectFromCursor);
 textInput.addEventListener('click',selectFromCursor);
 textInput.addEventListener('keyup',selectFromCursor);
 return {host,render,clearPending};
}