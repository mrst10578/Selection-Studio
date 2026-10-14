import {readPrivateAsset} from './private-assets.js';
/* ZH-83 | Independent reviewer gate. Called after Pages Access signature validation.
 * Review evidence is revision-pinned, stored in D1, and never triggers publish. */
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash32=/^[a-f0-9]{32}$/i,hash64=/^[a-f0-9]{64}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sql=(db,s,...a)=>db.prepare(s).bind(...a);
const email=v=>typeof v==='string'?v.trim().toLowerCase():'';
const listed=(mail,value)=>String(value||'').split(',').map(email).filter(Boolean).includes(mail);
async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function input(req,max=4096){
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('JSON_REQUIRED');
 const s=await req.text();if(new TextEncoder().encode(s).length>max)throw Error('BODY_TOO_LARGE');
 try{return JSON.parse(s)}catch{throw Error('INVALID_JSON')}
}
const fields=['sourceVerified','transcriptionVerified','answerVerified','taxonomyVerified','figuresVerified','warningsResolved'];
function checksOf(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k)))throw Error('INVALID_CHECKLIST');
 return Object.fromEntries(fields.map(k=>[k,value[k]===true]));
}
export async function handleReviewApi(request,env,identity,actor,url){
 if(!env?.SECURITY_DB?.prepare||!hash32.test(actor||''))return json({error:'REVIEW_SERVICE_UNAVAILABLE'},503);
 const db=env.SECURITY_DB,mail=email(identity?.email);
 const ownerRole=!!mail&&listed(mail,env.OPERATOR_EMAILS),reviewerRole=!!mail&&listed(mail,env.REVIEWER_EMAILS);
 if(!ownerRole&&!reviewerRole)return json({error:'FORBIDDEN'},403);
 const path=url.pathname,method=request.method;
  // Assigned reviewers can download source documents, never raw bucket keys or public URLs.
  const assetRoute=/^\/api\/v1\/reviews\/projects\/([^/]+)\/assets\/([a-f0-9]{64})$/i.exec(path);
  if(assetRoute){
   if(method!=='GET'||!reviewerRole||!uuid.test(assetRoute[1]))return json({error:'NOT_FOUND'},404);
   const [_,pid,digestId]=assetRoute,project=await sql(db,'SELECT id,actor FROM bank_projects WHERE id=? AND deleted_at IS NULL',pid).first();
   if(!project||project.actor===actor)return json({error:'NOT_FOUND'},404);
   const member=await sql(db,"SELECT project_id FROM bank_project_reviewers WHERE project_id=? AND reviewer_email_hash=? AND grant_id!=''",pid,await digest(mail)).first();
   if(!member)return json({error:'NOT_FOUND'},404);
   const asset=await sql(db,"SELECT mime,role FROM bank_assets WHERE project_id=? AND actor=? AND digest=? AND role IN ('question_pdf','answer_pdf') AND deleted_at IS NULL",pid,project.actor,digestId).first();
   if(!asset)return json({error:'ASSET_NOT_FOUND'},404);
   if(!env.QUESTION_ASSETS?.get)return json({error:'SOURCE_STORAGE_NOT_CONFIGURED'},503);
   const file=await readPrivateAsset(env,project.actor,{digest:digestId,mime:asset.mime});
   if(!file)return json({error:'SOURCE_NOT_FOUND'},503);
   return new Response(file.object.body,{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="review-source-'+digestId.slice(0,12)+'.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
 try{
  if(path==='/api/v1/reviews/assignments'&&(method==='POST'||method==='DELETE')){
   if(!ownerRole)return json({error:'OPERATOR_REQUIRED'},403);
   if(!env.REVIEWER_EMAILS)return json({error:'REVIEWERS_NOT_CONFIGURED'},503);
   const data=await input(request,512),reviewer=email(data?.reviewerEmail);
   if(!uuid.test(data?.projectId||'')||!reviewer||!listed(reviewer,env.REVIEWER_EMAILS))return json({error:'INVALID_ASSIGNMENT'},400);
   if(reviewer===mail)return json({error:'SELF_REVIEW_FORBIDDEN'},409);
   const own=await sql(db,'SELECT id FROM bank_projects WHERE id=? AND actor=? AND deleted_at IS NULL',data.projectId,actor).first();
   if(!own)return json({error:'PROJECT_NOT_FOUND'},404);
   const reviewerDigest=await digest(reviewer);
   // Audit precedes permission changes. Missing audit storage denies both grant and revoke.
   await sql(db,'INSERT INTO security_audit(actor,action,result,detail) VALUES(?,?,?,?)',
    actor,method==='POST'?'reviewer_assign':'reviewer_revoke','attempt',data.projectId).run();
   if(method==='DELETE'){
    const removed=await sql(db,'DELETE FROM bank_project_reviewers WHERE project_id=? AND reviewer_email_hash=? AND assigned_by=? RETURNING project_id',data.projectId,reviewerDigest,actor).first();
    return json({revoked:!!removed,projectId:data.projectId,previousApprovalsInvalidated:!!removed});
   }
   await sql(db,"INSERT INTO bank_project_reviewers(project_id,reviewer_email_hash,assigned_by,grant_id) VALUES(?,?,?,?) ON CONFLICT(project_id,reviewer_email_hash) DO UPDATE SET grant_id=excluded.grant_id WHERE bank_project_reviewers.grant_id=''",data.projectId,reviewerDigest,actor,crypto.randomUUID()).run();
   return json({assigned:true,projectId:data.projectId},201);
  }
  if(path==='/api/v1/reviews/assigned'&&method==='GET'){
   if(!reviewerRole)return json({error:'REVIEWER_REQUIRED'},403);
   const rows=await sql(db,"SELECT p.id,p.name FROM bank_project_reviewers r JOIN bank_projects p ON p.id=r.project_id WHERE r.reviewer_email_hash=? AND r.grant_id!='' AND p.deleted_at IS NULL AND p.actor!=? ORDER BY p.updated_at DESC LIMIT 50",await digest(mail),actor).all();
   return json({projects:(rows.results||[]).map(p=>({id:p.id,name:p.name}))});
  }
  const route=/^\/api\/v1\/reviews\/projects\/([^/]+)\/questions(?:\/([^/]+))?$/.exec(path);
  if(!route||!uuid.test(route[1])||(route[2]&&!uuid.test(route[2])))return json({error:'NOT_FOUND'},404);
  const [,pid,qid]=route;
  const project=await sql(db,'SELECT * FROM bank_projects WHERE id=? AND deleted_at IS NULL',pid).first();
  if(!project)return json({error:'PROJECT_NOT_FOUND'},404);
  const own=ownerRole&&project.actor===actor;
  const reviewerHash=await digest(mail);
  const grant=reviewerRole&&project.actor!==actor?await sql(db,'SELECT grant_id FROM bank_project_reviewers WHERE project_id=? AND reviewer_email_hash=?',pid,reviewerHash).first():null;
  const assigned=!!grant&&uuid.test(grant.grant_id||'');
  if(!own&&!assigned)return json({error:'PROJECT_NOT_FOUND'},404);
  if(!qid&&method==='GET'){
   const rows=await sql(db,'SELECT id,revision,state,content_json,updated_at FROM bank_questions WHERE project_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50',pid).all();
   return json({questions:(rows.results||[]).map(q=>({id:q.id,revision:q.revision,state:q.state,content:JSON.parse(q.content_json),updatedAt:q.updated_at}))});
  }
  if(!qid)return json({error:'METHOD_NOT_ALLOWED'},405);
  const question=await sql(db,'SELECT * FROM bank_questions WHERE id=? AND project_id=? AND deleted_at IS NULL',qid,pid).first();
  if(!question)return json({error:'QUESTION_NOT_FOUND'},404);
  if(method==='GET'){
   const rows=await sql(db,'SELECT source_revision,decision,reviewer_actor,created_at FROM bank_review_events WHERE question_id=? AND project_id=? ORDER BY rowid DESC LIMIT 20',qid,pid).all();
   return json({question:{id:qid,revision:question.revision,content:JSON.parse(question.content_json)},decisions:(rows.results||[]).map(r=>({revision:r.source_revision,decision:r.decision,reviewerId:r.reviewer_actor,createdAt:r.created_at}))});
  }
  if(method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!assigned)return json({error:'ASSIGNED_REVIEWER_REQUIRED'},403);
  const data=await input(request);
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['baseRevision','decision','checks'].includes(k))||!Number.isSafeInteger(data.baseRevision)||data.baseRevision<1||!['approve','reject'].includes(data.decision))return json({error:'INVALID_DECISION'},400);
  const checks=checksOf(data.checks);
  if(question.revision!==data.baseRevision)return json({error:'REVISION_CONFLICT',revision:question.revision},409);
  const content=JSON.parse(question.content_json);
  const sourceDigest=hash64.test(content.sourceDigest||'')?content.sourceDigest:'0'.repeat(64);
  if(data.decision==='approve'){
   if(!fields.every(k=>checks[k]))return json({error:'INCOMPLETE_SCIENTIFIC_REVIEW'},422);
   if(content.operatorConfirmed!==true||sourceDigest==='0'.repeat(64)||Number(content.scientificPending||0)>0)return json({error:'OPERATOR_OR_SOURCE_NOT_VERIFIED'},422);
   const source=await sql(db,"SELECT digest FROM bank_assets WHERE project_id=? AND actor=? AND digest=? AND role='question_pdf' AND deleted_at IS NULL",pid,project.actor,sourceDigest).first();
   if(!source)return json({error:'MISSING_PRIVATE_SOURCE_PDF'},422);
  }
  // Audit before mutation: any audit outage prevents new approval decisions.
  await sql(db,'INSERT INTO security_audit(actor,action,result,detail) VALUES(?,?,?,?)',actor,'question_review_attempt',data.decision,qid).run();
  const eventId=crypto.randomUUID();
  const query='INSERT INTO bank_review_events(id,project_id,question_id,source_revision,reviewer_actor,reviewer_email_hash,grant_id,decision,checklist_json,source_digest) SELECT ?,?,?,?,?,?,?,?,?,? FROM bank_questions WHERE id=? AND project_id=? AND revision=? AND deleted_at IS NULL RETURNING id';
  const row=await sql(db,query,eventId,pid,qid,question.revision,actor,reviewerHash,grant.grant_id,data.decision,JSON.stringify(checks),sourceDigest,qid,pid,question.revision).first();
  if(!row)return json({error:'REVISION_CONFLICT'},409);
  return json({reviewed:true,decision:data.decision,questionId:qid,sourceRevision:question.revision,autoPublish:false},201);
 }catch(e){
  if(['JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON','INVALID_CHECKLIST'].includes(e?.message))return json({error:e.message},e.message==='BODY_TOO_LARGE'?413:400);
  return json({error:'REVIEW_STORAGE_UNAVAILABLE'},503);
 }
}
