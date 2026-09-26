import {TAXONOMY} from "./taxonomy-data.js";
export const BIO_GRADES=[10,11,12];
const BIO_CFG=TAXONOMY.subjects.BIO;

const code=v=>{const s=String(v??"").trim();return s&&/^\d+$/.test(s)?s.padStart(2,"0"):s||null};
export function normalizeBioCombination(value){
  if(!value||typeof value!=="object"||typeof value.is_combined!=="boolean")return null;
  const topics=Array.isArray(value.topics)?value.topics.map(t=>({grade:Number(t?.grade)||null,chapter:code(t?.chapter),unit:code(t?.unit)})):[];
  return {is_combined:value.is_combined,topics:value.is_combined?topics:[]};
}
function key(t){return `${Number(t?.grade)||""}:${code(t?.chapter)||""}:${code(t?.unit)||""}`}
function valid(t){
  const grade=Number(t?.grade),chapter=code(t?.chapter),unit=code(t?.unit);
  return BIO_GRADES.includes(grade)&&Boolean(BIO_CFG.grades?.[String(grade)]?.chapters?.[chapter]?.units?.[unit]);
}
export function biologyIssues({subject,combination,primaryGrade,primaryChapter,primaryUnit}){
  if(subject!=="BIO")return [];
  const c=normalizeBioCombination(combination);
  if(!c)return ["مشخص کن سوال زیست ترکیبی هست یا نه"];
  if(!c.is_combined)return [];
  if(!c.topics.length)return ["برای سوال ترکیبی حداقل یک مبحث جدید اضافه کن"];
  const primary=key({grade:primaryGrade,chapter:primaryChapter,unit:primaryUnit});
  const seen=new Set(),issues=[];
  c.topics.forEach((t,i)=>{
    if(!valid(t)){issues.push(`مبحث ترکیبی ${i+1} ناقص است`);return}
    const k=key(t);
    if(k===primary)issues.push(`مبحث ترکیبی ${i+1} با طبقه‌بندی اصلی یکسان است`);
    if(seen.has(k))issues.push(`مبحث ترکیبی ${i+1} تکراری است`);
    seen.add(k);
  });
  return issues;
}
export function mountBiologyCombinationEditor({host,subjectEl,gradeEl,chapterEl,unitEl,onChange=()=>{},onGateChange=()=>{}}){
  let value=null;
  const chapterOpts=(grade,selected)=>'<option value="">انتخاب</option>'+Object.entries(BIO_CFG.grades?.[String(grade)]?.chapters||{}).map(([id,item])=>`<option value="${id}" ${id===selected?"selected":""}>${Number(id)} — ${item.name_fa}</option>`).join("");
  const unitOpts=(grade,chapter,selected)=>'<option value="">انتخاب</option>'+Object.entries(BIO_CFG.grades?.[String(grade)]?.chapters?.[chapter]?.units||{}).map(([id,item])=>`<option value="${id}" ${id===selected?"selected":""}>${Number(id)} — ${item.name_fa}</option>`).join("");
  function issues(){return biologyIssues({subject:subjectEl.value,combination:value,primaryGrade:gradeEl.value,primaryChapter:chapterEl.value,primaryUnit:unitEl.value})}
  function set(next,emit=true){value=normalizeBioCombination(next);render();if(emit)onChange(structuredClone(value))}
  function render(){
    const bio=subjectEl.value==="BIO"; host.hidden=!bio; host.classList.toggle("hidden",!bio);
    if(!bio){onGateChange({ready:true,issues:[]});return}
    const errs=issues(),ready=!errs.length,decided=value!==null,combined=value?.is_combined===true;
    host.innerHTML=`<div class="bio-head"><div><span class="eyebrow">BIOLOGY UX CHECK</span><strong>سوال ترکیبی زیست</strong><small>ترکیبی بودن را مشخص کن؛ در حالت ترکیبی همه مباحث اضافه باید کامل باشند.</small></div><span class="gate-badge ${ready?"ready":"blocked"}">${ready?"آماده":"قفل"}</span></div>
    <div class="bio-toggle" role="group" aria-label="ترکیبی بودن سوال"><button type="button" data-combined="false" class="${decided&&!combined?"active":""}">غیرترکیبی</button><button type="button" data-combined="true" class="${combined?"active":""}">ترکیبی</button></div>
    ${combined?`<div class="bio-topics">${(value.topics||[]).map((t,i)=>`<article class="bio-topic" data-index="${i}"><div class="bio-topic-head"><strong>مبحث ترکیبی ${i+1}</strong><button type="button" class="danger-ghost" data-remove="${i}">حذف</button></div>
      <label>پایه<select data-field="grade" data-index="${i}"><option value="">انتخاب</option><option value="10" ${Number(t.grade)===10?"selected":""}>دهم</option><option value="11" ${Number(t.grade)===11?"selected":""}>یازدهم</option><option value="12" ${Number(t.grade)===12?"selected":""}>دوازدهم</option></select></label>
      <label>فصل<select data-field="chapter" data-index="${i}">${chapterOpts(t.grade,t.chapter)}</select></label>
      <label>گفتار<select data-field="unit" data-index="${i}">${unitOpts(t.grade,t.chapter,t.unit)}</select></label></article>`).join("")}</div><button type="button" class="add-topic" data-add>+ اضافه کردن مبحث جدید</button>`:""}
    <div class="bio-gate ${ready?"ready":""}"><strong>${ready?(combined?`ترکیبی با ${value.topics.length} مبحث`:"غیرترکیبی ثبت شد"):"UX Check ناقص است"}</strong><span>${ready?"اطلاعات زیست آماده ثبت است.":errs.join(" • ")}</span></div>`;
    host.querySelectorAll("[data-combined]").forEach(b=>b.onclick=()=>set({is_combined:b.dataset.combined==="true",topics:b.dataset.combined==="true"?(value?.topics||[]):[]}));
    host.querySelector("[data-add]")?.addEventListener("click",()=>set({is_combined:true,topics:[...(value?.topics||[]),{grade:null,chapter:null,unit:null}]}));
    host.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{const topics=[...(value?.topics||[])];topics.splice(Number(b.dataset.remove),1);set({is_combined:true,topics})});
    host.querySelectorAll("[data-field]").forEach(el=>el.onchange=()=>{
      const i=Number(el.dataset.index),topics=[...(value?.topics||[])],t={...(topics[i]||{})};
      t[el.dataset.field]=el.dataset.field==="grade"?(el.value?Number(el.value):null):(el.value||null);
      if(el.dataset.field==="grade"){t.chapter=null;t.unit=null}
      if(el.dataset.field==="chapter")t.unit=null;
      topics[i]=t;set({is_combined:true,topics});
    });
    onGateChange({ready,issues:errs});
  }
  [subjectEl,gradeEl,chapterEl,unitEl].forEach(el=>el.addEventListener("change",render));
  render();
  return {getValue:()=>structuredClone(value),setValue:set,getIssues:issues,isReady:()=>issues().length===0,reset:()=>set(null,false)};
}
