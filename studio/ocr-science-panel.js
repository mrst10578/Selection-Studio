/* ZH-77: human-reviewed scientific warnings and separate figure crops.
 * This view does not change the original PDF or silently approve AI geometry. */
import {cropOcrBox} from './ocr-bbox.js';

const node=(tag,cls='',label='')=>{
 const e=document.createElement(tag);if(cls)e.className=cls;if(label)e.textContent=label;return e;
};
export function createSciencePanel({
 onAcknowledge=()=>{},onFigureAdd=()=>{},onFigureApprove=()=>{},
 onFigureRemove=()=>{},onRestoreBaseline=()=>{},onNotice=()=>{}
}={}){
 const host=node('section','studio-science-review');host.id='studioScienceReview';
 host.setAttribute('aria-label','کنترل خطاهای علمی و جداسازی شکل');
 const heading=node('div','studio-science-heading');
 heading.append(node('strong','','بازبینی علمی و استخراج شکل'),
  node('p','','هشدارها فقط احتمال خطا را نشان می‌دهند؛ داوری نهایی با اپراتور است.'));
 const status=node('p','studio-science-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const restore=node('button','studio-science-restore','بازگردانی متن مرحله اول');restore.type='button';restore.hidden=true;
 restore.addEventListener('click',()=>onRestoreBaseline());
 const warnings=node('div','studio-science-warnings');warnings.setAttribute('aria-label','موارد نیازمند بررسی');
 const figureHeader=node('div','studio-science-figure-head');
 figureHeader.append(node('strong','','شکل‌ها و نمودارهای سؤال'),
  node('p','','کادرهای پیشنهادشده تا زمان تأیید وارد اطلاعات نهایی نمی‌شوند. هر تصویر فقط از برش فعلی جدا می‌شود.'));
 const figControls=node('div','studio-science-figure-actions');
 const mark=node('button','','انتخاب شکل روی تصویر');mark.id='studioFigureMark';mark.type='button';
 figControls.append(mark);
 const frame=node('div','studio-science-figure-frame');frame.hidden=true;
 const img=node('img','studio-science-figure-image');img.alt='برش تصویر OCR برای انتخاب شکل';img.draggable=false;
 const overlay=node('div','studio-science-figure-overlay');
 const dragBox=node('div','studio-science-figure-draw');dragBox.hidden=true;
 frame.append(img,overlay,dragBox);
 const candidates=node('div','studio-science-figure-list');
 const thumb=node('div','studio-science-figure-preview');thumb.hidden=true;
 const thumbHeading=node('strong','','پیش‌نمایش برش مستقل شکل');
 const thumbImage=node('img');thumbImage.alt='شکل استخراج‌شده از برش PDF';
 const thumbDownload=node('a','','دریافت شکل WebP');thumbDownload.download='exam-figure.webp';
 thumb.append(thumbHeading,thumbImage,thumbDownload);
 host.append(heading,status,restore,warnings,figureHeader,figControls,frame,candidates,thumb);
 let current=null,draw=false,pointer=null,previewUrl='',imageSrc='',previewFor='';
 const normalize=(x,y)=>{
  const r=overlay.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  return [Math.max(0,Math.min(1,(x-r.left)/r.width)),Math.max(0,Math.min(1,(y-r.top)/r.height))];
 };
 const clearPreview=()=>{
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl='';previewFor='';thumb.hidden=true;thumbImage.removeAttribute('src');thumbDownload.removeAttribute('href');
 };
 const cancelDraw=()=>{draw=false;pointer=null;dragBox.hidden=true;overlay.classList.remove('is-drawing');mark.setAttribute('aria-pressed','false')};
 mark.addEventListener('click',()=>{
  if(!current?.imageBlob||current.busy)return;
  draw=!draw;pointer=null;dragBox.hidden=true;
  mark.setAttribute('aria-pressed',String(draw));overlay.classList.toggle('is-drawing',draw);
  if(draw)onNotice('کادر شکل را روی تصویر بکش؛ هیچ OCR یا دانلود خودکاری انجام نمی‌شود.');
 });
 overlay.addEventListener('pointerdown',e=>{
  if(!draw||e.target!==overlay||e.button!==0)return;
  const p=normalize(e.clientX,e.clientY);if(!p)return;
  pointer={id:e.pointerId,start:p,end:p};overlay.setPointerCapture(e.pointerId);e.preventDefault();
  dragBox.hidden=false;
 });
 overlay.addEventListener('pointermove',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const p=normalize(e.clientX,e.clientY);if(!p)return;pointer.end=p;
  const [x1,y1]=pointer.start,[x2,y2]=pointer.end;
  Object.assign(dragBox.style,{left:(Math.min(x1,x2)*100)+'%',top:(Math.min(y1,y2)*100)+'%',
   width:(Math.abs(x2-x1)*100)+'%',height:(Math.abs(y2-y1)*100)+'%'});
 });
 overlay.addEventListener('pointerup',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const end=normalize(e.clientX,e.clientY);if(!end)return;
  const [x1,y1]=pointer.start,[x2,y2]=end;
  const box=[Math.min(x1,x2),Math.min(y1,y2),Math.max(x1,x2),Math.max(y1,y2)].map(n=>Number(n.toFixed(6)));
  cancelDraw();
  if((box[2]-box[0])*(box[3]-box[1])<.0005){onNotice('کادر شکل بیش از حد کوچک است.');return}
  onFigureAdd(box);
 });
 overlay.addEventListener('pointercancel',cancelDraw);
 async function showFigure(index){
  const figure=current?.figures?.[index],stamp=current?.signature,blob=current?.imageBlob;
  if(!figure||!blob)return;
  const token=JSON.stringify([stamp,index,figure.bbox_norm,blob.size,blob.type]);
  clearPreview();
  try{
   const part=await cropOcrBox(blob,figure.bbox_norm);
   if(!current||current.signature!==stamp||current.figures?.[index]!==figure||current.imageBlob!==blob)return;
   previewUrl=URL.createObjectURL(part);previewFor=token;
   thumbImage.src=previewUrl;thumbDownload.href=previewUrl;thumb.hidden=false;
   thumb.scrollIntoView({block:'nearest',behavior:'auto'});
  }catch{onNotice('جداکردن شکل از تصویر ممکن نشد؛ محدوده را دوباره مشخص کن.')}
 }
 function render(s){
  const newImage=s?.imageUrl||'';
  if(newImage!==imageSrc){imageSrc=newImage;cancelDraw();clearPreview();if(newImage)img.src=newImage;else img.removeAttribute('src')}
  if(!s||!s.figures?.some(f=>f.status==='pending_review')&&!s.figures?.length&&previewUrl)clearPreview();
  current=s;
  const list=s?.scienceWarnings||[],acks=new Set(s?.acknowledged||[]);
  const unresolved=list.filter(w=>!acks.has(w.id));
  const critical=unresolved.filter(w=>w.severity==='critical').length;
  status.textContent=!list.length?'هشدار مبتنی بر متن شناسایی نشد؛ تطبیق با تصویر همچنان لازم است.':
   unresolved.length?'بررسی‌نشده: '+unresolved.length+' مورد'+(critical?'، شامل '+critical+' اختلاف حساس':'')+'.':
   'تمام هشدارهای موجود توسط اپراتور بررسی شده‌اند.';
  status.dataset.state=critical?'critical':unresolved.length?'review':'clear';
  warnings.replaceChildren();
  for(const item of list){
   const row=node('label','studio-science-warning');
   row.dataset.severity=item.severity;
   const checkbox=node('input');checkbox.type='checkbox';checkbox.checked=acks.has(item.id);
   checkbox.disabled=Boolean(s.busy);checkbox.setAttribute('aria-label','بررسی شد: '+item.message);
   checkbox.addEventListener('change',()=>onAcknowledge(item.id,checkbox.checked));
   const body=node('span');
   body.append(node('strong','',item.message));
   if(item.detail)body.append(node('small','',item.detail));
   const tag=node('small','studio-science-warning-tag',item.severity==='critical'?'اختلاف حساس':'بررسی پیشنهادی');
   row.append(checkbox,body,tag);warnings.append(row);
  }
  restore.hidden=!s?.baseline||s?.passes<2;
  restore.disabled=Boolean(s?.busy);
  mark.disabled=!s?.imageBlob||Boolean(s?.busy);
  frame.hidden=!s?.imageBlob;
  candidates.replaceChildren();
  overlay.replaceChildren();
  const figures=s?.figures||[];
  figures.forEach((fig,index)=>{
   const [x1,y1,x2,y2]=fig.bbox_norm;
   const box=node('button','studio-science-figure-box',String(index+1));
   box.type='button';
   box.setAttribute('aria-label','نمایش شکل '+(index+1)+' '+fig.label);
   box.setAttribute('aria-pressed',String(fig.status==='operator_confirmed'));
   Object.assign(box.style,{left:(x1*100)+'%',top:(y1*100)+'%',
    width:((x2-x1)*100)+'%',height:((y2-y1)*100)+'%'});
   box.addEventListener('click',()=>void showFigure(index));
   overlay.append(box);
   const row=node('div','studio-science-figure-item');
   const desc=node('span','',fig.label+' · '+(fig.source==='operator'?'کادر دستی':'پیشنهاد مدل')+
    (fig.model_confidence===undefined?'':' · اطمینان گزارش‌شده مدل: '+Math.round(fig.model_confidence*100)+'٪'));
   const preview=node('button','','پیش‌نمایش / دریافت');preview.type='button';
   preview.addEventListener('click',()=>void showFigure(index));
   const accept=node('button','',fig.status==='operator_confirmed'?'تأیید شده':'تأیید شکل');
   accept.type='button';accept.disabled=fig.status==='operator_confirmed'||Boolean(s.busy);
   accept.addEventListener('click',()=>onFigureApprove(index));
   const remove=node('button','','حذف کادر');remove.type='button';remove.disabled=Boolean(s.busy);
   remove.setAttribute('aria-label','حذف کادر شکل '+(index+1));
   remove.addEventListener('click',()=>{clearPreview();onFigureRemove(index)});
   row.append(desc,preview,accept,remove);candidates.append(row);
  });
  if(!figures.length)candidates.append(node('p','studio-science-empty','شکلی علامت‌گذاری نشده است. اگر شکل وجود دارد، آن را روی تصویر مشخص کن.'));
 }
 return {host,render,clearPreview,cancelDraw};
}
