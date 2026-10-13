/* ZH-77 | Conservative scientific transcription checks and figure metadata.
 * These are review prompts, NEVER authoritative correctness verdicts or calibrated AI scores. */
import {validOcrBox} from './ocr-bbox.js';

const digits=input=>String(input??'').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
const cap=(v,max)=>String(v??'').replace(/\u0000/g,'').slice(0,max);
const normalize=value=>digits(value).replace(/[‐‑‒–—−]/g,'-').replace(/[٫]/g,'.').replace(/[\u200c\u200e\u200f]/g,'').normalize('NFKC');
export function modelConfidence(value){
 return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?Number(value.toFixed(3)):null;
}
export function normalizeFigureCandidates(raw,{source='model'}={}){
 if(!Array.isArray(raw))return [];
 const result=[];
 for(const value of raw.slice(0,24)){
  if(!value||typeof value!=='object')continue;
  const box=value.bbox_norm??value.bbox;
  if(!validOcrBox(box)||(box[2]-box[0])*(box[3]-box[1])<.0005)continue;
  if(result.some(prev=>prev.bbox_norm.every((v,i)=>Math.abs(v-box[i])<.002)))continue;
  const type=['diagram','graph','table','image','other'].includes(value.type)?value.type:'other';
  const candidate={
   bbox_norm:box.map(n=>Number(n.toFixed(6))),
   type,label:cap(value.label||({diagram:'شکل',graph:'نمودار',table:'جدول',image:'تصویر',other:'عنصر تصویری'}[type]),90),
   source:value.source==='operator'?'operator':source==='operator'?'operator':'model',
   status:'pending_review'
  };
  const score=modelConfidence(value.confidence);
  if(score!==null)candidate.model_confidence=score;
  result.push(candidate);
  if(result.length>=8)break;
 }
 return result;
}
export function manualFigure(box,label='شکل انتخاب‌شده'){
 const [figure]=normalizeFigureCandidates([{bbox_norm:box,type:'diagram',label}],{source:'operator'});
 if(!figure)throw Error('FIGURE_BOX_INVALID');
 return figure;
}
export function confirmedFigures(figures){
 if(!Array.isArray(figures))return [];
 return normalizeFigureCandidates(figures).filter((_,i)=>figures[i]?.status==='operator_confirmed').map(x=>({
  bbox_norm:x.bbox_norm,type:x.type,label:x.label,source:x.source,status:'operator_confirmed',
  ...(x.model_confidence===undefined?{}:{model_confidence:x.model_confidence})
 }));
}
export function scientificWarnings({text='',latex=[],kind='question',previous=null,modelFlags=[],confidence=null}={}){
 const combined=normalize(cap(text,12000)+'\n'+(Array.isArray(latex)?latex.slice(0,18).map(x=>cap(x,1200)).join('\n'):''));
 const prior=previous?normalize(cap(previous.text,12000)+'\n'+(Array.isArray(previous.latex)?previous.latex.slice(0,18).join('\n'):'')):null;
 const warnings=[],seen=new Set();
 const add=(code,severity,message,detail='',origin='heuristic')=>{
  if(seen.has(code))return;
  seen.add(code);
  warnings.push({id:code,severity,message,detail:cap(detail,220),origin});
 };
 const negation=s=>Array.from(s.matchAll(/(?:نمی\s*|نمی‌|نباید|نیست|نادرست|غلط|به\s*جز|بجز|مگر|فاقد|به\s*غیر\s*از|not\b|except\b|without\b|incorrect\b)/giu)).map(x=>x[0].replace(/\s+/g,''));
 const negative=s=>Array.from(s.matchAll(/[-−]\s*(?:\d+(?:[.,]\d+)?|[a-zA-Z]|\\(?:frac|sqrt))/g)).map(x=>x[0].replace(/\s+/g,''));
 const decimal=s=>Array.from(s.matchAll(/(?<![\w\d])\d+[.,]\d+(?![\w\d])/g)).map(x=>x[0].replace(',','.'));
 const exponent=s=>Array.from(s.matchAll(/(?:\^\s*(?:\{[^}\r\n]{1,18}\}|[-+]?\w{1,8})|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/gu)).map(x=>x[0].replace(/\s+/g,''));
 const numerical=s=>Array.from(s.matchAll(/\d+(?:[.,]\d+)?/g)).map(x=>x[0].replace(',','.'));
 const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
 if(prior!==null){
  for(const [id,fn,label] of [
   ['negation_changed',negation,'واژه‌های نفی یا استثنا'],
   ['minus_changed',negative,'علامت‌های منفی'],
   ['decimal_changed',decimal,'اعداد اعشاری'],
   ['exponent_changed',exponent,'توان‌ها و اندیس‌های بالانویس'],
   ['numbers_changed',numerical,'اعداد و ضرایب']
  ]){
   const a=fn(prior),b=fn(combined);
   if(!same(a,b))add(id,'critical','تفاوت در '+label+' میان دو مرحلهٔ OCR',
    'اول: '+(a.join('، ')||'ندارد')+' | دوم: '+(b.join('، ')||'ندارد'),'comparison');
  }
 }
 if(negation(combined).length)add('negation_present','review','عبارت نفی یا استثنا در سؤال دیده شد','تفاوت «است/نیست» یا «به جز» را با تصویر بررسی کن.');
 if(negative(combined).length)add('minus_present','review','علامت منفی وجود دارد','منفی را از خط تیره و علامت تفریق تفکیک کن.');
 if(decimal(combined).length)add('decimal_present','review','عدد اعشاری وجود دارد','محل ممیز و رقم‌های قبل و بعد از آن را با PDF تطبیق بده.');
 if(exponent(combined).length)add('exponent_present','review','توان یا بالانویس وجود دارد','در صورت نیاز فرمول LaTeX را با تصویر تطبیق بده.');
 if(kind==='question'){
  const optionLabels=new Set();
  const optionLines=normalize(cap(text,12000)).split(/\r?\n/);
  for(const line of optionLines){
   const m=line.match(/^\s*(?:([1-4])\s*[\).:٫\-]|([الفبجد])\s*[\).:\-])/u);
   if(m)optionLabels.add(m[1]||({الف:'1',ب:'2',ج:'3',د:'4'}[m[2]]));
  }
  if(optionLabels.size&&optionLabels.size<4)add('options_incomplete','critical','گزینه‌های سؤال ناقص به نظر می‌رسند','گزینه‌های شناسایی‌شده: '+[...optionLabels].sort().join('، ')+'؛ انتظار ۱ تا ۴.','heuristic');
  if(prior!==null){
   const previousLabels=new Set();
   for(const line of prior.split(/\r?\n/)){
    const m=line.match(/^\s*(?:([1-4])\s*[\).:\-]|([الفبجد])\s*[\).:\-])/u);
    if(m)previousLabels.add(m[1]||({الف:'1',ب:'2',ج:'3',د:'4'}[m[2]]));
   }
   if(previousLabels.size===4&&optionLabels.size<4)add('options_lost','critical','در بازبینی تعدادی از گزینه‌ها حذف شده‌اند','گزینه‌ها را با مرحلهٔ اول مقایسه کن.','comparison');
  }
 }
 const score=modelConfidence(confidence);
 if(score!==null&&score<.75)add('low_model_confidence','review','مدل OCR اطمینان پایینی گزارش کرده است','این عدد ادعای خود مدل است و کالیبره یا تأییدشده نیست: '+Math.round(score*100)+'٪','model');
 const allowedKinds=new Set(['minus','negation','decimal','exponent','missing_option','formula','illegible','other']);
 if(Array.isArray(modelFlags)){
  for(const item of modelFlags.slice(0,12)){
   if(!item||typeof item!=='object'||!allowedKinds.has(item.kind))continue;
   const detail=cap(item.detail??item.message,180).trim();
   if(!detail)continue;
   const id='model_'+item.kind+'_'+warnings.filter(x=>x.id.startsWith('model_'+item.kind)).length;
   add(id,'review','مدل دربارهٔ '+({minus:'منفی',negation:'نفی',decimal:'اعشار',exponent:'توان',missing_option:'گزینه گمشده',formula:'فرمول',illegible:'ناخوانایی',other:'متن'}[item.kind])+' هشدار داده',detail,'model');
  }
 }
 return warnings.slice(0,24);
}
export function safeScientificReview(warnings,acknowledged,confidence){
 const allowed=new Set((Array.isArray(warnings)?warnings:[]).map(x=>x.id));
 const checked=Array.isArray(acknowledged)?[...new Set(acknowledged.filter(x=>allowed.has(x)))]:[];
 const evidence=(Array.isArray(warnings)?warnings:[]).slice(0,24).map(x=>({
  id:cap(x.id,60),severity:x.severity==='critical'?'critical':'review',
  message:cap(x.message,200),detail:cap(x.detail,220),origin:['comparison','model','heuristic'].includes(x.origin)?x.origin:'heuristic'
 }));
 const score=modelConfidence(confidence);
 return {status:'operator_checked',warnings:evidence,acknowledged_ids:checked,
  pending_count:evidence.filter(x=>!checked.includes(x.id)).length,
  ...(score===null?{}:{model_reported_confidence:score,confidence_calibrated:false})};
}
