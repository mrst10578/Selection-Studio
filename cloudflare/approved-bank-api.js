/* ZH-85/ZH-86 | D1-verified read-only approved bank and bounded exam manifests.
 * A browser-supplied "approved" property is NEVER sufficient. Every record
 * must have the latest valid, independent, revision-pinned reviewer event. */
const id=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash32=/^[a-f0-9]{32}$/i;
const j=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const dbq=(db,stmt,...args)=>db.prepare(stmt).bind(...args);
const normalize=s=>String(s||'').normalize('NFKC').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[يى]/g,'ی').replace(/ك/g,'ک').trim().toLowerCase();
async function validApproved(db,actor,scope){
 const where=scope?' AND q.project_id=?':'';
 const query="SELECT q.id,q.revision,q.actor,q.project_id,q.content_json,r.reviewer_actor FROM bank_questions q JOIN bank_projects p ON p.id=q.project_id JOIN bank_review_events r ON r.question_id=q.id AND r.source_revision=q.revision AND r.rowid=(SELECT max(re.rowid) FROM bank_review_events re WHERE re.question_id=q.id AND re.source_revision=q.revision) WHERE p.actor=? AND p.deleted_at IS NULL AND q.deleted_at IS NULL AND r.decision='approve' AND r.reviewer_actor!=q.actor AND r.source_digest=json_extract(q.content_json,'$.sourceDigest') AND json_valid(r.checklist_json) AND json_extract(r.checklist_json,'$.sourceVerified')=1 AND json_extract(r.checklist_json,'$.transcriptionVerified')=1 AND json_extract(r.checklist_json,'$.answerVerified')=1 AND json_extract(r.checklist_json,'$.taxonomyVerified')=1 AND json_extract(r.checklist_json,'$.figuresVerified')=1 AND json_extract(r.checklist_json,'$.warningsResolved')=1 AND EXISTS (SELECT 1 FROM bank_project_reviewers m WHERE m.project_id=q.project_id AND m.reviewer_email_hash=r.reviewer_email_hash AND m.assigned_by=p.actor AND m.grant_id=r.grant_id AND m.grant_id!='') AND EXISTS (SELECT 1 FROM bank_assets a WHERE a.project_id=q.project_id AND a.actor=q.actor AND a.digest=json_extract(q.content_json,'$.sourceDigest') AND a.role='question_pdf' AND a.deleted_at IS NULL)"+where+" ORDER BY q.updated_at DESC,q.id DESC LIMIT 300";
 const rows=await dbq(db,query,...(scope?[actor,scope]:[actor])).all();
 const result=[];
 for(const row of rows.results||[]){
  const content=JSON.parse(row.content_json);
  if(content.operatorConfirmed!==true||content.scientificPending!==0||!/^[a-f0-9]{64}$/i.test(content.sourceDigest||''))continue;
  result.push({id:row.id,projectId:row.project_id,revision:row.revision,state:'reviewed',reviewStatus:'approved',scientificPending:0,softDeleted:false,
   questionText:String(content.questionText||'').slice(0,16000),answerText:String(content.answerText||'').slice(0,16000),
   subject:String(content.taxonomyId||''),sourceNumber:content.sourceNumber||null,sourceDigest:content.sourceDigest,
   reviewEvidence:{reviewer:row.reviewer_actor,operator:row.actor,sourceRevision:row.revision,decision:'approve'}});
 }
 return result;
}
async function input(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('JSON_REQUIRED');
 const bytes=await request.text();if(new TextEncoder().encode(bytes).length>12000)throw Error('BODY_TOO_LARGE');
 try{return JSON.parse(bytes)}catch{throw Error('INVALID_JSON')}
}
export async function handleApprovedBankApi(request,env,actor,url){
 if(!env.SECURITY_DB?.prepare||!hash32.test(actor||''))return j({error:'BANK_UNAVAILABLE'},503);
 const path=url.pathname,method=request.method;
 try{
  if(path==='/api/v1/bank/questions'&&method==='GET'){
   const pid=url.searchParams.get('projectId')||'';
   if(pid&&!id.test(pid))return j({error:'INVALID_PROJECT'},400);
   const q=normalize(url.searchParams.get('q')||'').slice(0,100);
   const subject=normalize(url.searchParams.get('subject')||'').slice(0,80);
   const all=await validApproved(env.SECURITY_DB,actor,pid||null);
   const filtered=all.filter(x=>(!subject||normalize(x.subject)===subject)&&(!q||normalize(x.questionText).includes(q)));
   return j({questions:filtered.slice(0,100),scanned:all.length,limited:all.length===300});
  }
  if(path==='/api/v1/bank/exams/compose'&&method==='POST'){
   const data=await input(request);
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['title','questionIds','sourceRevisions','includeAnswers'].includes(k))||
    typeof data.title!=='string'||!data.title.trim()||data.title.length>140||
    !Array.isArray(data.questionIds)||!data.questionIds.length||data.questionIds.length>100||
    data.questionIds.some(v=>!id.test(v))||new Set(data.questionIds).size!==data.questionIds.length||!Array.isArray(data.sourceRevisions)||data.sourceRevisions.length!==data.questionIds.length||data.sourceRevisions.some(v=>!Number.isSafeInteger(v)||v<1)||
    typeof data.includeAnswers!=='boolean')return j({error:'INVALID_EXAM_REQUEST'},400);
   const available=await validApproved(env.SECURITY_DB,actor,null),map=new Map(available.map(x=>[x.id,x]));
   const selected=data.questionIds.map(q=>map.get(q));
   if(selected.some((q,i)=>!q||q.revision!==data.sourceRevisions[i]))return j({error:'UNAPPROVED_OR_STALE_QUESTION'},409);
   if(data.includeAnswers&&selected.some(q=>!q.answerText.trim()))return j({error:'ANSWER_MISSING'},422);
   const manifest={title:data.title.trim(),answersIncluded:data.includeAnswers,publishable:false,
    items:selected.map((q,i)=>({index:i+1,id:q.id,revision:q.revision,question:q.questionText,
     ...(data.includeAnswers?{answer:q.answerText}:{})}))};
   // A deterministic provenance marker is not an approval signature. Fail closed
   // if the audit insert fails; never export an unaudited set of source revisions.
   const checksum=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(manifest)));
   const manifestHash=Array.from(new Uint8Array(checksum),x=>x.toString(16).padStart(2,'0')).join('');
   await dbq(env.SECURITY_DB,
    'INSERT INTO security_audit(actor,action,result,detail) VALUES(?,?,?,?)',
    actor,'exam_draft_compose','created',manifestHash.slice(0,24)+':'+manifest.items.length).run();
   return j({manifest,manifestHash,status:'draft_export_only',finalOperatorApprovalRequired:true});
  }
  return j({error:'METHOD_NOT_ALLOWED'},405);
 }catch(e){
  if(['INVALID_JSON','JSON_REQUIRED','BODY_TOO_LARGE'].includes(e?.message))return j({error:e.message},e.message==='BODY_TOO_LARGE'?413:400);
  return j({error:'BANK_UNAVAILABLE'},503);
 }
}
