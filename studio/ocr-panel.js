import {
 buildOcrPrompt,normalizeManualLatex,prepareOcrImage,requestOcr,safeOcrReview,formatOcrError
} from './ocr-core.js';
import {isOperatorAuthenticated} from './operator-auth.js';

/* ZH-75: the OCR workbench is optional, and cannot silently alter question metadata.
 * Operator-edited text is NOT part of the Cloudflare form autosave or any network sync.
 * Only confirmed transcription metadata accompanies a saved question. */
const make=(tag,className='',label='')=>{
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(label)node.textContent=label;
 return node;
};
function emptyState(signature=''){
 return {signature,text:'',latex:'',notes:'',passes:0,source:'manual',confirmed:false,busy:false,stage:0,abort:null,version:0};
}
let katexPromise;
function loadKatex(){
 if(globalThis.katex?.render)return Promise.resolve(true);
 if(katexPromise)return katexPromise;
 katexPromise=new Promise(resolve=>{
  const stylesheet=document.createElement('link');
  stylesheet.rel='stylesheet';stylesheet.href='https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';
  document.head.append(stylesheet);
  const script=document.createElement('script');script.async=true;
  script.src='https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js';
  script.onload=()=>resolve(Boolean(globalThis.katex?.render));
  script.onerror=()=>resolve(false);
  document.head.append(script);
 });
 return katexPromise;
}
export function installOcrWorkbench({capture,getFingerprint,getIdentity,onNotice=()=>{}}){
 const form=document.getElementById('questionForm');
 const readiness=form?.querySelector('.readiness');
 if(!form||!readiness)return null;
 const state={question:emptyState(),answer:emptyState()};
 let active='question',disposed=false,contextPause=0;
 const host=make('section','studio-ocr-panel');host.id='studioOcrPanel';
 host.setAttribute('aria-label','تشخیص و بازبینی متن سؤال و فرمول');
 const header=make('div','studio-ocr-head');
 header.append(make('span','studio-ocr-overline','TRANSCRIPTION / LATEX'),make('h3','','استودیو OCR'));
 header.append(make('p','','فارسی، انگلیسی، اعداد و فرمول‌ها. تشخیص با اجازه تو؛ تأیید نهایی هم با تو.'));
 const switcher=make('div','studio-ocr-tabs');switcher.setAttribute('role','group');switcher.setAttribute('aria-label','انتخاب متن');
 const tabs={
  question:make('button','','متن سؤال'),answer:make('button','','متن پاسخ')
 };
 for(const kind of ['question','answer']){
  tabs[kind].type='button';tabs[kind].addEventListener('click',()=>{active=kind;document.getElementById(kind==='question'?'questionTab':'answerTab')?.click();show()});
  switcher.append(tabs[kind]);
 }
 const stage=make('div','studio-ocr-stage','مرحله ۱: آماده تشخیص');
 stage.setAttribute('role','status');stage.setAttribute('aria-live','polite');
 const actions=make('div','studio-ocr-actions');
 const first=make('button','','۱ · تشخیص متن');first.type='button';
 const second=make('button','','۲ · بازبینی فرمول‌ها');second.type='button';
 const approve=make('button','','۳ · تأیید اپراتور');approve.type='button';
 const clear=make('button','','پاک‌کردن متن');clear.type='button';
 actions.append(first,second,approve,clear);
 const editing=make('div','studio-ocr-editors');
 const textWrap=make('label','studio-ocr-field');
 textWrap.append(make('span','','متن قابل ویرایش'));
 const text=make('textarea');text.id='studioOcrText';text.rows=5;text.dir='auto';text.placeholder='متن استخراج‌شده را اصلاح کن؛ یا بدون سرویس OCR دستی بنویس.';
 textWrap.append(text);
 const latexWrap=make('label','studio-ocr-field');
 latexWrap.append(make('span','','فرمول‌های LaTeX (هر فرمول یک خط)'));
 const latex=make('textarea');latex.id='studioOcrLatex';latex.rows=3;latex.dir='ltr';latex.placeholder='\\frac{a}{b} = \\sqrt{x}';
 latexWrap.append(latex);
 const noteWrap=make('label','studio-ocr-field');
 noteWrap.append(make('span','','یادداشت ابهام‌ها (اختیاری)'));
 const notes=make('textarea');notes.id='studioOcrNotes';notes.rows=2;notes.dir='auto';notes.placeholder='عبارات ناخوانا را اینجا مشخص کن.';
 noteWrap.append(notes);
 editing.append(textWrap,latexWrap,noteWrap);
 const preview=make('div','studio-ocr-preview');
 const previewHeading=make('strong','','پیش‌نمایش زنده متن و فرمول');
 const previewText=make('div','studio-ocr-preview-text');previewText.dir='auto';
 const previewMath=make('div','studio-ocr-preview-math');previewMath.dir='ltr';
 const foot=make('p','studio-ocr-footer','درخواست OCR از سهمیه Cloudflare استفاده می‌کند. بررسی فرمول‌ها مرحلهٔ دوم و اختیاری است. تنها متن تأییدشده هنگام ثبت سؤال ذخیره می‌شود.');
 preview.append(previewHeading,previewText,previewMath);
 host.append(header,switcher,stage,actions,editing,preview,foot);
 readiness.insertAdjacentElement('beforebegin',host);

 let renderNumber=0;
 function signature(kind){return JSON.stringify([String(getIdentity?.()||''),getFingerprint?.(kind)||''])}
 function hasCrop(kind){return Boolean(getFingerprint?.(kind))}
 function stateNow(){return state[active]}
 function validReview(s){return Boolean(s.text.trim()||normalizeManualLatex(s.latex).length)}
 function updateStage(){
  const s=stateNow();
  const title=s.busy?('در حال پردازش مرحله '+s.stage+' …'):
   s.confirmed?'مرحله ۳/۳ · متن توسط اپراتور تأیید شد':
   !validReview(s)?'مرحله ۱/۳ · آماده تشخیص یا ورود دستی':
   s.passes===2?'مرحله ۲/۳ · فرمول‌ها بازبینی شدند؛ تأیید نهایی لازم است':
   s.passes===1?'مرحله ۱/۳ · تشخیص انجام شد؛ متن را بررسی و تأیید کن':
   'ورود دستی · برای ذخیره متن، تأیید اپراتور را بزن';
  stage.textContent=title;
  stage.dataset.state=s.busy?'busy':s.confirmed?'confirmed':'draft';
  tabs.question.setAttribute('aria-pressed',String(active==='question'));
  tabs.answer.setAttribute('aria-pressed',String(active==='answer'));
  first.disabled=s.busy||!hasCrop(active)||!isOperatorAuthenticated();
  second.disabled=s.busy||s.passes<1||!hasCrop(active)||!isOperatorAuthenticated();
  approve.disabled=s.busy||!validReview(s)||s.confirmed;
  clear.disabled=s.busy||!validReview(s)&&!s.confirmed;
  text.disabled=s.busy;latex.disabled=s.busy;notes.disabled=s.busy;
 }
 function show(){
  const s=stateNow();
  text.value=s.text;latex.value=s.latex;notes.value=s.notes;
  updateStage();renderPreview();
 }
 function renderPreview(){
  const s=stateNow();const version=++renderNumber;
  previewText.textContent=s.text.trim()||'متن استخراج‌شده اینجا نمایش داده می‌شود.';
  previewText.classList.toggle('is-placeholder',!s.text.trim());
  previewMath.replaceChildren();
  const formulas=normalizeManualLatex(s.latex);
  for(const formula of formulas){
   const node=make('div','studio-ocr-equation');
   const fallback=make('code','',formula);node.append(fallback);previewMath.append(node);
   if(globalThis.katex?.render){
    try{globalThis.katex.render(formula,node,{throwOnError:true,trust:false,maxExpand:100,strict:'warn',output:'htmlAndMathml'})}
    catch{node.replaceChildren(fallback);node.classList.add('studio-ocr-unrendered')}
   }
  }
  if(formulas.length&&!globalThis.katex?.render){
   void loadKatex().then(ready=>{if(ready&&!disposed&&version===renderNumber)renderPreview()});
  }
  updateStage();
 }
 function change(){
  const s=stateNow();s.text=text.value.slice(0,12000);s.latex=latex.value.slice(0,12000);s.notes=notes.value.slice(0,700);
  s.confirmed=false;
  renderPreview();
 }
 text.addEventListener('input',change);latex.addEventListener('input',change);notes.addEventListener('input',change);
 function invalidate(kind,next=signature(kind)){
  const old=state[kind];old.abort?.abort();
  state[kind]=emptyState(next);
  if(kind===active)show();
 }
 function syncContext(){
  if(contextPause>0)return;
  for(const kind of ['question','answer']){
   const s=state[kind];
   if(s.busy&&s.stage===-1)continue; // Internal crop stitching briefly switches pages.
   const next=signature(kind);
   if(next!==s.signature)invalidate(kind,next);
  }
  updateStage();
 }
 async function guardCapture(task){
  contextPause++;
  try{return await task()}
  finally{contextPause--;syncContext()}
 }
 async function runPass(pass){
  syncContext();
  const kind=active,s=state[kind];
  if(s.busy||!isOperatorAuthenticated()||!hasCrop(kind))return;
  if(pass===2&&s.passes<1)return;
  const stamp=signature(kind),sequence=++s.version;
  const controller=new AbortController();s.abort=controller;s.busy=true;s.stage=-1;
  updateStage();
  try{
   const captured=await guardCapture(()=>capture(kind));
   if(controller.signal.aborted||stamp!==signature(kind))throw Error('AbortError');
   const image=await prepareOcrImage(captured.blob);
   if(controller.signal.aborted||stamp!==signature(kind))throw Error('AbortError');
   s.stage=pass;updateStage();
   const draft=pass===2?{text:s.text,latex:normalizeManualLatex(s.latex)}:null;
   const result=await requestOcr({image,prompt:buildOcrPrompt({kind,pass,previous:draft}),signal:controller.signal});
   if(controller.signal.aborted||stamp!==signature(kind)||s.version!==sequence)return;
   s.text=result.text;s.latex=result.latex.join('\n');s.notes=result.notes;
   s.source='cloudflare-workers-ai';s.passes=Math.max(s.passes,pass);s.confirmed=false;
   if(result.format==='plain')onNotice('پاسخ OCR ساختار مشخصی نداشت؛ متن را دقیق‌تر بازبینی کن.');
   show();
  }catch(error){
   if(error?.name!=='AbortError'&&error?.message!=='AbortError')onNotice(formatOcrError(error));
  }finally{
   if(s.version===sequence){
    s.busy=false;s.stage=0;s.abort=null;
    if(kind===active)show();
   }
  }
 }
 first.addEventListener('click',()=>void runPass(1));
 second.addEventListener('click',()=>void runPass(2));
 approve.addEventListener('click',()=>{
  const s=stateNow();if(!validReview(s)||s.busy)return;
  s.confirmed=true;updateStage();onNotice('متن '+(active==='question'?'سؤال':'پاسخ')+' تأیید شد و همراه سؤال ذخیره می‌شود.');
 });
 clear.addEventListener('click',()=>{invalidate(active);onNotice('متن OCR پاک شد؛ PDF و صف برش تغییری نکردند.')});
 function reviewForSave(){
  syncContext();
  const result={schema_version:1};
  let count=0;
  for(const kind of ['question','answer']){
   const s=state[kind];
   if(!s.confirmed||s.busy||s.signature!==signature(kind))continue;
   const approved=safeOcrReview({...s,latex:normalizeManualLatex(s.latex)});
   if(approved){result[kind]=approved;count++}
  }
  return count?result:null;
 }
 function reset(){
  invalidate('question');invalidate('answer');active='question';show();
 }
 // Initialize signatures without requiring an already-loaded PDF.
 for(const kind of ['question','answer'])state[kind].signature=signature(kind);
 show();
 return {host,syncContext,invalidate,reset,reviewForSave,guardCapture,setActive:kind=>{if(['question','answer'].includes(kind)){active=kind;show()}},getState:kind=>({...state[kind],abort:undefined})};
}
