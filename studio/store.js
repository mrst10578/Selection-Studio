export const RECORDS_KEY = "testbank-studio.records.v1";
export const STICKY_KEY = "testbank-studio.sticky.v1";
export const EXAM_DRAFT_KEY = "testbank-studio.exam-draft.v1";
export const INTAKE_SETTINGS_KEY = "testbank-studio.intake-settings.v1";
export const SUBMIT_KEY_SESSION = "testbank-studio.submit-key.v1";
export const LAST_BATCH_KEY = "testbank-studio.last-batch.v1";

export const DIFFICULTY_LEVELS = ["level_1","level_2","level_3","level_4","level_5"];

export function normalizeDifficulty(value){
  const legacy={easy:"level_2",medium:"level_3",hard:"level_4"};
  return legacy[value] || (DIFFICULTY_LEVELS.includes(value) ? value : null);
}
export function difficultyLabel(value){
  const v=normalizeDifficulty(value);
  return {level_1:"سطح ۱",level_2:"سطح ۲",level_3:"سطح ۳",level_4:"سطح ۴",level_5:"سطح ۵"}[v] || "ثبت نشده";
}
export function subjectLabel(code){
  return {BIO:"زیست‌شناسی",MATH:"ریاضی",PHY:"فیزیک",CHEM:"شیمی"}[code] || code;
}
export function gradeLabel(value){
  return {10:"دهم",11:"یازدهم",12:"دوازدهم"}[Number(value)] || String(value || "");
}
export function loadRecords(){
  try{
    const value=JSON.parse(localStorage.getItem(RECORDS_KEY)||"[]");
    if(!Array.isArray(value)) return [];
    return value.map(record=>{
      const difficulty=normalizeDifficulty(record?.difficulty);
      return difficulty && difficulty!==record.difficulty ? {...record,difficulty} : record;
    });
  }catch{return []}
}
export function saveRecords(records){
  localStorage.setItem(RECORDS_KEY,JSON.stringify(records));
  window.dispatchEvent(new CustomEvent("testbank-records-changed"));
}
export function loadSticky(){
  try{return JSON.parse(localStorage.getItem(STICKY_KEY)||"{}")}catch{return {}}
}
export function saveSticky(value){localStorage.setItem(STICKY_KEY,JSON.stringify(value||{}))}
export function loadExamDraft(){
  try{return JSON.parse(localStorage.getItem(EXAM_DRAFT_KEY)||"null")}catch{return null}
}
export function saveExamDraft(value){
  if(value) localStorage.setItem(EXAM_DRAFT_KEY,JSON.stringify(value));
  else localStorage.removeItem(EXAM_DRAFT_KEY);
}
export function loadIntakeSettings(){
  try{return JSON.parse(localStorage.getItem(INTAKE_SETTINGS_KEY)||"{}")}catch{return {}}
}
export function saveIntakeSettings(value){localStorage.setItem(INTAKE_SETTINGS_KEY,JSON.stringify(value||{}))}
export function getSessionKey(){return sessionStorage.getItem(SUBMIT_KEY_SESSION)||""}
export function setSessionKey(value){
  if(value) sessionStorage.setItem(SUBMIT_KEY_SESSION,value);
  else sessionStorage.removeItem(SUBMIT_KEY_SESSION);
}
export function buildQuestionId(examId,sourceQuestionNumber){
  const n=Number(sourceQuestionNumber);
  if(!examId||!Number.isInteger(n)||n<1) throw new Error("شناسه آزمون و شماره سؤال معتبر لازم است.");
  return `${examId}-Q${String(n).padStart(3,"0")}`;
}
export function createBatch(records,exam,submittedBy){
  const active=records.filter(x=>!x.trashed_at);
  if(!active.length) throw new Error("فهرست سؤال‌ها خالی است.");
  if(!exam?.id) throw new Error("شناسنامه آزمون موجود نیست.");
  const suffix=Date.now().toString(36).toUpperCase()+"-"+crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase();
  const now=new Date().toISOString();
  return {
    schema_version:3,
    id:`${exam.id}-BATCH-${suffix}`,
    status:"pending",
    created_at:now,
    updated_at:now,
    submitted_by:submittedBy||null,
    exam,
    questions:active.map((record,index)=>({
      ...record,
      submission_order:index+1,
      operator_status:record.status||"draft",
      status:"submitted",
      review_status:"pending",
      review_note:null,
      duplicate_candidates:record.duplicate_candidates||[],
      revision_history:record.revision_history||[]
    })),
    review:{reviewed_by:null,reviewed_at:null,note:null},
    revisions:[]
  };
}
export function rememberLastBatch(batch,fingerprint=""){
  localStorage.setItem(LAST_BATCH_KEY,JSON.stringify({id:batch.id,created_at:batch.created_at,sent_at:new Date().toISOString(),exam_id:batch.exam?.id||"",question_count:batch.questions?.length||0,fingerprint}));
}
export function loadLastBatch(){try{return JSON.parse(localStorage.getItem(LAST_BATCH_KEY)||"null")}catch{return null}}
export function downloadText(name,text,type="application/json"){
  const blob=new Blob([text],{type:type+";charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
