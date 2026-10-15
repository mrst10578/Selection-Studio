/* ZH-83 | Read-only reviewer workspace until explicit signed D1 decision. */
const $=id=>document.getElementById(id);
const state={project:'',questions:[],question:null};
const msg=(value,error=false)=>{$('reviewNotice').textContent=value;$('reviewNotice').dataset.state=error?'error':'ok'};
const tag=(name,value)=>{const e=document.createElement(name);e.textContent=value||'';return e};
const checks=['sourceVerified','transcriptionVerified','answerVerified','taxonomyVerified','figuresVerified','warningsResolved'];
async function call(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 let data;try{data=await res.json()}catch{throw Error('پاسخ API معتبر نیست')}
 if(!res.ok){const e=Error(data?.error||'خطا در سرویس بازبینی');e.status=res.status;throw e}
 return data;
}
async function action(fn){try{await fn()}catch(e){msg(e.status===401?'نیاز به ورود از مسیر Cloudflare Access است':e.message||'خطا در بازبینی',true)}}
function selectQuestion(question){
 state.question=question;
 $('reviewQuestion').value=question?.content?.questionText||'';
 $('reviewAnswer').value=question?.content?.answerText||'';
 $('reviewRevision').textContent='نسخه: '+(question?.revision||'-');
 $('reviewChecks').disabled=!question;
 $('approveReview').disabled=!question;
 $('rejectReview').disabled=!question;
 for(const input of document.querySelectorAll('[data-review-check]'))input.checked=false;
 const host=$('reviewSource');host.replaceChildren();
 if(!question)return;
 const source=question.content?.sourceDigest;
 if(/^[a-f0-9]{64}$/i.test(source||'')){
  const link=tag('a','دریافت PDF مرجع خصوصی');
  link.href='/api/v1/reviews/projects/'+encodeURIComponent(state.project)+'/assets/'+encodeURIComponent(source);
  link.className='bank-download';link.rel='nofollow';host.append(link);
 }else{host.append(tag('p','PDF مرجع به این سؤال متصل نیست. تأیید علمی تا افزودن منبع مسدود است.'))}
 const row=tag('p',question.content?.operatorConfirmed?'اپراتور متن را تأیید کرده است.':'هنوز تأیید تطبیق متن توسط اپراتور ثبت نشده است.');
 host.append(row);
 $('reviewHistory').replaceChildren();
 void loadHistory().catch(e=>msg(e.message,true));
}
async function loadHistory(){
 if(!state.question)return;
 const {decisions}=await call('/api/v1/reviews/projects/'+state.project+'/questions/'+state.question.id);
 const host=$('reviewHistory');host.replaceChildren();
 if(!decisions.length)host.append(tag('p','هنوز تصمیمی ثبت نشده است.'));
 for(const item of decisions){
  const el=tag('div','نسخه '+item.revision+' · '+(item.decision==='approve'?'تأیید':'رد')+' · '+item.createdAt);
  el.className='bank-result';host.append(el);
 }
}
async function listQuestions(){
 state.question=null;selectQuestion(null);state.questions=[];
 if(!state.project)return;
 const data=await call('/api/v1/reviews/projects/'+state.project+'/questions');
 state.questions=data.questions||[];
 const host=$('reviewQueue');host.replaceChildren();
 if(!state.questions.length)host.append(tag('p','سؤالی برای بازبینی وجود ندارد.'));
 for(const question of state.questions){
  const btn=tag('button','نسخه '+question.revision+' · '+(question.content?.questionText||'').slice(0,70));
  btn.type='button';btn.addEventListener('click',()=>selectQuestion(question));host.append(btn);
 }
}
async function submit(decision){
 const item=state.question;if(!item)return;
 const obj=Object.fromEntries(checks.map(k=>[k,document.querySelector('[data-review-check="'+k+'"]').checked]));
 if(decision==='approve'&&!checks.every(k=>obj[k])){msg('برای تأیید علمی، تمام بندهای چک‌لیست باید بررسی شده باشند.',true);return}
 if(decision==='reject'&&!window.confirm('این سؤال برای اصلاح به اپراتور بازگردد؟'))return;
 const base='/api/v1/reviews/projects/'+state.project+'/questions/'+item.id;
 const response=await call(base,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({baseRevision:item.revision,decision,checks:obj})});
 msg(response.decision==='approve'?'تأیید علمی برای همین نسخه ثبت شد؛ هنوز منتشر نشده است.':'رد سؤال برای این نسخه ثبت شد.');
 await loadHistory();
}
$('assignedProjects').addEventListener('change',e=>void action(async()=>{state.project=e.target.value;await listQuestions()}));
$('approveReview').addEventListener('click',()=>void action(()=>submit('approve')));
$('rejectReview').addEventListener('click',()=>void action(()=>submit('reject')));
void action(async()=>{
 const session=await call('/api/session');
 if(!session.authenticated||session.role!=='reviewer')throw Error('ورود با حساب بازبین مستقل لازم است؛ حساب اپراتور نمی‌تواند خودش تأیید نهایی انجام دهد.');
 const data=await call('/api/v1/reviews/assigned');
 const select=$('assignedProjects');select.replaceChildren(new Option('انتخاب پروژه',''));
 for(const project of data.projects||[])select.add(new Option(project.name,project.id));
 select.disabled=false;
 state.project=data.projects?.[0]?.id||'';select.value=state.project;
 if(state.project)await listQuestions();else msg('هنوز پروژه‌ای به حساب شما ارجاع نشده است.');
 if(state.project)msg('فقط پس از بررسی مستندات و ثبت چک‌لیست، تصمیم علمی را اعلام کن.');
});
