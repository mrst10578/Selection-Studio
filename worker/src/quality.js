export const DIFFICULTIES=["level_1","level_2","level_3","level_4","level_5"];
export const SUBJECTS=["BIO","MATH","PHY","CHEM"];

export function validRegion(region){
  if(!region||!Number.isInteger(Number(region.page))||Number(region.page)<1)return false;
  if(!Array.isArray(region.bbox_norm)||region.bbox_norm.length!==4)return false;
  const box=region.bbox_norm.map(Number);
  if(!box.every(v=>Number.isFinite(v)&&v>=0&&v<=1))return false;
  return box[2]>box[0]&&box[3]>box[1];
}

export function biologyIssues(question){
  if(question?.subject!=="BIO")return [];
  const value=question?.biology_combination;
  if(!value||typeof value.is_combined!=="boolean")return ["وضعیت ترکیبی زیست مشخص نیست"];
  const topics=Array.isArray(value.topics)?value.topics:[];
  if(value.is_combined&&topics.length<1)return ["سوال ترکیبی حداقل یک مبحث اضافه لازم دارد"];
  if(!value.is_combined&&topics.length)return ["سوال غیرترکیبی نباید مبحث اضافه داشته باشد"];
  const primary=`${Number(question.grade)}|${question.chapter}|${question.unit}`;
  const seen=new Set();
  const issues=[];
  for(const topic of topics){
    const key=`${Number(topic?.grade)}|${topic?.chapter}|${topic?.unit}`;
    if(![10,11,12].includes(Number(topic?.grade))||!/^0[1-9]|1[0-2]$/.test(String(topic?.chapter||""))||!/^0[1-8]$/.test(String(topic?.unit||""))){
      issues.push("مبحث ترکیبی ناقص یا نامعتبر است");
      continue;
    }
    if(key===primary)issues.push("مبحث ترکیبی با طبقه‌بندی اصلی یکسان است");
    if(seen.has(key))issues.push("مبحث ترکیبی تکراری است");
    seen.add(key);
  }
  return [...new Set(issues)];
}

export function questionIssues(question){
  const issues=[];
  if(!question?.id)issues.push("شناسه سوال");
  if(!question?.exam_id)issues.push("شناسه آزمون");
  if(!Number.isInteger(Number(question?.source_question_number))||Number(question.source_question_number)<1)issues.push("شماره سوال");
  if(!SUBJECTS.includes(question?.subject))issues.push("درس");
  if(![10,11,12].includes(Number(question?.grade)))issues.push("پایه");
  if(!/^(0[1-9]|1[0-2])$/.test(String(question?.chapter||"")))issues.push("فصل");
  if(!/^0[1-8]$/.test(String(question?.unit||"")))issues.push(question?.subject==="BIO"?"گفتار":"مبحث");
  if(!DIFFICULTIES.includes(question?.difficulty))issues.push("Level");
  if(![1,2,3,4].includes(Number(question?.correct_option)))issues.push("کلید");
  if(!validRegion(question?.question_regions?.[0]))issues.push("Crop سوال");
  if(!validRegion(question?.answer_regions?.[0]))issues.push("Crop پاسخ");
  issues.push(...biologyIssues(question).map(x=>"زیست: "+x));
  return issues;
}

export function batchIssues(batch){
  const issues=[];
  if(!batch||typeof batch!=="object")return ["Batch نامعتبر است"];
  if(!batch.id)issues.push("شناسه Batch");
  if(!batch.exam?.id)issues.push("شناسنامه آزمون");
  if(!Array.isArray(batch.questions)||!batch.questions.length)issues.push("سوالی در Batch نیست");
  const ids=new Set();
  for(const question of batch.questions||[]){
    if(ids.has(question?.id))issues.push(`شناسه تکراری: ${question?.id||"-"}`);
    ids.add(question?.id);
    const qIssues=questionIssues(question);
    if(qIssues.length)issues.push(`${question?.id||"سوال"}: ${qIssues.join("، ")}`);
  }
  return issues;
}

export function publishableQuestions(batch){
  return (batch?.questions||[]).filter(q=>!q.trashed_at&&q.review_status==="approved"&&!q.published_at);
}

export function normalizePublishedQuestion(question,reviewer,now=new Date().toISOString()){
  return {
    ...structuredClone(question),
    status:"verified",
    review_status:"approved",
    reviewed_by:question.reviewed_by||reviewer||null,
    reviewed_at:question.reviewed_at||now,
    published_at:now,
    published_by:reviewer||null
  };
}
