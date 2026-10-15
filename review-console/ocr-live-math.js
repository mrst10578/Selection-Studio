import {tokenizeMath} from './ocr-pipeline.js';
/* Only text nodes and KaTeX's own safe DOM are used: model text is never innerHTML. */
let rendererPromise=null;
async function getRenderer(){
 if(typeof globalThis.katex?.render==='function')return globalThis.katex;
 if(!rendererPromise)rendererPromise=import('https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.mjs')
  .then(m=>m.default||m).catch(()=>null);
 return rendererPromise;
}
const current=new WeakMap();
export function renderLiveMath(host,value,{status=null}={}){
 if(!host)return Promise.resolve(false);
 const generation=(current.get(host)||0)+1;current.set(host,generation);
 host.replaceChildren();
 const text=String(value??'').slice(0,30000);
 const chunks=tokenizeMath(text),spans=[];
 if(!text.trim()){const p=document.createElement('p');p.className='ocr-preview-empty';p.textContent='متن سؤال را تایپ کن یا از OCR بگیر تا پیش‌نمایش اینجا ساخته شود.';host.append(p);if(status)status.textContent='بدون متن';return Promise.resolve(false)}
 const rows=document.createElement('div');rows.className='ocr-preview-lines';
 for(const chunk of chunks){
  if(chunk.type==='text'){rows.append(document.createTextNode(chunk.value));continue}
  const math=document.createElement('span');math.className='ocr-math-source';
  math.textContent=(chunk.display?'$$':'$')+chunk.value+(chunk.display?'$$':'$');
  math.setAttribute('aria-label','فرمول LaTeX');math.setAttribute('dir','ltr');
  if(chunk.display)math.classList.add('ocr-math-display');
  spans.push({node:math,chunk});rows.append(math);
 }
 host.append(rows);
 if(!spans.length){if(status)status.textContent='متن معمولی';return Promise.resolve(true)}
 if(status)status.textContent='در حال آماده‌سازی فرمول‌ها…';
 return getRenderer().then(renderer=>{
  if(current.get(host)!==generation)return false;
  if(!renderer){if(status)status.textContent='نمایش خام LaTeX (کتابخانه در دسترس نیست)';return false}
  let invalid=0;
  for(const {node,chunk} of spans){
   try{renderer.render(chunk.value,node,{throwOnError:true,trust:false,strict:'warn',maxExpand:100,maxSize:10,displayMode:chunk.display,output:'htmlAndMathml'});node.classList.add('ocr-math-rendered')}
   catch{invalid++;node.classList.add('ocr-math-invalid')}
  }
  if(status)status.textContent=invalid?'فرمول‌های نامعتبر: '+invalid+' مورد؛ متن خام حفظ شده است':'فرمول‌ها نمایش داده شدند';
  return !invalid;
 }).catch(()=>{if(status&&current.get(host)===generation)status.textContent='نمایش خام LaTeX فعال است';return false});
}
