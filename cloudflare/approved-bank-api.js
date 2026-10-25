/* ZH-85/ZH-86 | D1-verified read-only approved bank and bounded exam manifests.
 * A browser-supplied "approved" property is NEVER sufficient. Every record
 * must have the latest valid, independent, revision-pinned reviewer event. */
const id=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash32=/^[a-f0-9]{32}$/i;
const j=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const dbq=(db,stmt,...args)=>db.prepare(stmt).bind(...args);
const normalize=s=>String(s||'').normalize('NFKC').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[\u0640\u064b-\u065f\u0670]/g,'').replace(/[يى]/g,'ی').replace(/ك/g,'ک').trim().toLowerCase();
// Cursor is a read-only position, not an authorization token. Every page still
// rechecks ownership, source evidence and current independent reviewer approval.
const cursorEncode=(row,scope)=>btoa(JSON.stringify([row.updated_at,row.id,scope])).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
// Bind continuation positions to the normalized search context. A cursor is not an auth token.
async function cursorScope(projectId,q,subject){
 const data=new TextEncoder().encode(JSON.stringify([projectId,q,subject]));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
 return Array.from(digest.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
}
function cursorDecode(raw,scope){
 if(!/^[A-Za-z0-9_-]{1,180}$/.test(raw||''))return null;
 try{
  const text=atob(raw.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-raw.length%4)%4));
  const value=JSON.parse(text);
  // D1 CURRENT_TIMESTAMP uses canonical UTC YYYY-MM-DD HH:MM:SS. Reject
  // impossible or noncanonical dates instead of silently returning empty pages.
  if(!Array.isArray(value)||value.length!==3||value[2]!==scope||typeof value[0]!=='string'||
   !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value[0])||typeof value[1]!=='string'||!id.test(value[1]))return null;
  const timestamp=new Date(value[0].replace(' ','T')+'Z');
  if(!Number.isFinite(timestamp.getTime())||timestamp.toISOString().slice(0,19).replace('T',' ')!==value[0])return null;
  return value;
 }catch{return null}
}
async function validApproved(db,actor,scope,questionIds=null,search=null){
 const where=scope?' AND q.project_id=?':'';
 // Explicit composition is pinned to at most 100 IDs, never to a search window.
 const byIds=questionIds?.length?' AND q.id IN ('+questionIds.map(()=>'?').join(',')+')':'';
 const after=search?.cursor?' AND (q.updated_at<? OR (q.updated_at=? AND q.id<?))':'';
 const query="SELECT q.id,q.updated_at,q.revision,q.actor,q.project_id,q.content_json,r.reviewer_actor FROM bank_questions q JOIN bank_projects p ON p.id=q.project_id JOIN bank_review_events r ON r.question_id=q.id AND r.source_revision=q.revision AND r.rowid=(SELECT max(re.rowid) FROM bank_review_events re WHERE re.question_id=q.id AND re.source_revision=q.revision) WHERE p.actor=? AND p.deleted_at IS NULL AND q.deleted_at IS NULL AND r.decision='approve' AND r.reviewer_actor!=q.actor AND r.source_digest=(CASE WHEN json_valid(q.content_json) THEN json_extract(q.content_json,'$.sourceDigest') END) AND json_valid(r.checklist_json) AND json_extract(r.checklist_json,'$.sourceVerified')=1 AND json_extract(r.checklist_json,'$.transcriptionVerified')=1 AND json_extract(r.checklist_json,'$.answerVerified')=1 AND json_extract(r.checklist_json,'$.taxonomyVerified')=1 AND json_extract(r.checklist_json,'$.figuresVerified')=1 AND json_extract(r.checklist_json,'$.warningsResolved')=1 AND EXISTS (SELECT 1 FROM bank_project_reviewers m WHERE m.project_id=q.project_id AND m.reviewer_email_hash=r.reviewer_email_hash AND m.assigned_by=p.actor AND m.grant_id=r.grant_id AND m.grant_id!='') AND EXISTS (SELECT 1 FROM bank_assets a WHERE a.project_id=q.project_id AND a.actor=q.actor AND a.digest=(CASE WHEN json_valid(q.content_json) THEN json_extract(q.content_json,'$.sourceDigest') END) AND a.role='question_pdf' AND a.deleted_at IS NULL)"+where+byIds+after+" ORDER BY q.updated_at DESC,q.id DESC LIMIT "+(search?'301':'300');
 const rows=await dbq(db,query,actor,...(scope?[scope]:[]),...(questionIds||[]),...(search?.cursor?[search.cursor[0],search.cursor[0],search.cursor[1]]:[])).all();
 const result=[],matches=[];let inspected=0,lastScanned=null;
 for(const row of rows.results||[]){
  if(search&&inspected>=300)break;
  inspected++;lastScanned=row;
  const content=JSON.parse(row.content_json);
  if(content.operatorConfirmed!==true||content.scientificPending!==0||!/^[a-f0-9]{64}$/i.test(content.sourceDigest||''))continue;
  const item={id:row.id,projectId:row.project_id,revision:row.revision,state:'reviewed',reviewStatus:'approved',scientificPending:0,softDeleted:false,
   questionText:String(content.questionText||'').slice(0,16000),answerText:String(content.answerText||'').slice(0,16000),
   subject:String(content.taxonomyId||''),sourceNumber:content.sourceNumber||null,sourceDigest:content.sourceDigest,
   reviewEvidence:{reviewer:row.reviewer_actor,operator:row.actor,sourceRevision:row.revision,decision:'approve'}};
  result.push(item);
  if(search&&(!search.subject||normalize(item.subject)===search.subject)&&
   (!search.q||normalize(item.questionText).includes(search.q)||normalize(item.answerText).includes(search.q)))matches.push({item,row});
 }
 if(!search)return result;
 // When >100 results match inside a 300-row scan, resume immediately after the
 // 100th match rather than skipping the remaining matches in that same window.
 const more=matches.length>100||(rows.results||[]).length>300;
 const last=matches.length>100?matches[99].row:lastScanned;
 return {questions:matches.slice(0,100).map(x=>x.item),scanned:result.length,limited:more,
  nextCursor:more&&last?cursorEncode(last,search.scope):null};
}
async function input(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('JSON_REQUIRED');
 const max=12000,declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max))throw Error('BODY_TOO_LARGE');
 if(!request.body)throw Error('INVALID_JSON');
 const reader=request.body.getReader(),parts=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>max)throw Error('BODY_TOO_LARGE');
   parts.push(value);
  }
 }finally{
  if(total>max)await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
 const bytes=new Uint8Array(total);let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw Error('INVALID_JSON')}
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
   const rawCursor=url.searchParams.get('cursor');
   const scope=await cursorScope(pid,q,subject);
   const cursor=rawCursor===null?null:cursorDecode(rawCursor,scope);
   if(rawCursor!==null&&!cursor)return j({error:'INVALID_CURSOR'},400);
   return j(await validApproved(env.SECURITY_DB,actor,pid||null,null,{q,subject,cursor,scope}));
  }
  if(path==='/api/v1/bank/exams/compose'&&method==='POST'){
   const data=await input(request);
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['title','questionIds','sourceRevisions','includeAnswers'].includes(k))||
    typeof data.title!=='string'||!data.title.trim()||data.title.length>140||/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(data.title)||
    !Array.isArray(data.questionIds)||!data.questionIds.length||data.questionIds.length>100||
    data.questionIds.some(v=>!id.test(v))||new Set(data.questionIds).size!==data.questionIds.length||!Array.isArray(data.sourceRevisions)||data.sourceRevisions.length!==data.questionIds.length||data.sourceRevisions.some(v=>!Number.isSafeInteger(v)||v<1)||
    typeof data.includeAnswers!=='boolean')return j({error:'INVALID_EXAM_REQUEST'},400);
   const available=await validApproved(env.SECURITY_DB,actor,null,data.questionIds),map=new Map(available.map(x=>[x.id,x]));
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
