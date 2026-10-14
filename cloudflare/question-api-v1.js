/* ZH-80 | Versioned, draft-only D1 API. Access JWT and allowlist checked by Pages.
 * No OCR output is ever automatically approved or published. */
const respond=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const error=(code,status=400)=>respond({error:code},status);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sql=(db,query,...args)=>db.prepare(query).bind(...args);
const safe=v=>typeof v==='string'?v.trim():'';
const audit=(db,actor,action,detail)=>sql(db,'INSERT INTO security_audit(actor,action,result,detail) VALUES(?,?,?,?)',actor,action,'attempt',detail).run();
function validateContent(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_CONTENT');
 const fields=['questionText','answerText','latex','taxonomyId','sourceLabel','sourceNumber','operatorConfirmed','scientificPending','sourceDigest'];
 if(Object.keys(data).some(k=>!fields.includes(k)))throw Error('INVALID_CONTENT');
 if(typeof data.questionText!=='string'||data.questionText.trim().length<1||data.questionText.length>16000)throw Error('INVALID_CONTENT');
 if(data.answerText!==undefined&&(typeof data.answerText!=='string'||data.answerText.length>16000))throw Error('INVALID_CONTENT');
 if(data.sourceLabel!==undefined&&(typeof data.sourceLabel!=='string'||data.sourceLabel.length>160))throw Error('INVALID_CONTENT');
 if(data.taxonomyId!==undefined&&(typeof data.taxonomyId!=='string'||!/^([a-z0-9_-]{1,80})$/i.test(data.taxonomyId)))throw Error('INVALID_CONTENT');
 if(data.latex!==undefined&&(!Array.isArray(data.latex)||data.latex.length>18||data.latex.some(s=>typeof s!=='string'||s.length>1200)))throw Error('INVALID_CONTENT');
 if(data.sourceNumber!==undefined&&(!Number.isSafeInteger(data.sourceNumber)||data.sourceNumber<1||data.sourceNumber>9999))throw Error('INVALID_CONTENT');
 if(data.operatorConfirmed!==undefined&&typeof data.operatorConfirmed!=='boolean')throw Error('INVALID_CONTENT');
 if(data.scientificPending!==undefined&&(!Number.isSafeInteger(data.scientificPending)||data.scientificPending<0||data.scientificPending>100))throw Error('INVALID_CONTENT');
 if(data.sourceDigest!==undefined&&data.sourceDigest!==''&&!/^[a-f0-9]{64}$/i.test(data.sourceDigest))throw Error('INVALID_CONTENT');
 return JSON.stringify({questionText:data.questionText,answerText:data.answerText||'',latex:data.latex||[],taxonomyId:data.taxonomyId||'',sourceLabel:data.sourceLabel||'',sourceNumber:data.sourceNumber||null,operatorConfirmed:data.operatorConfirmed===true,scientificPending:data.scientificPending||0,sourceDigest:data.sourceDigest||''});
}
async function parseJson(request,max=42000){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('JSON_REQUIRED');
 if(Number(request.headers.get('content-length')||0)>max)throw Error('PAYLOAD_TOO_LARGE');
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>max)throw Error('PAYLOAD_TOO_LARGE');
 try{return JSON.parse(raw)}catch{throw Error('INVALID_JSON')}
}
async function project(db,actor,id){return sql(db,'SELECT * FROM bank_projects WHERE id=? AND actor=? AND deleted_at IS NULL',id,actor).first()}
async function registeredSource(db,actor,pid,content){
 const data=JSON.parse(content);
 if(!data.operatorConfirmed)return true;
 if(!/^[a-f0-9]{64}$/i.test(data.sourceDigest||''))return false;
 return !!(await sql(db,"SELECT 1 AS ok FROM bank_assets WHERE project_id=? AND actor=? AND digest=? AND role='question_pdf' AND mime='application/pdf' AND deleted_at IS NULL",pid,actor,data.sourceDigest).first());
}
async function question(db,actor,pid,id){return sql(db,'SELECT q.* FROM bank_questions q JOIN bank_projects p ON p.id=q.project_id WHERE q.id=? AND q.project_id=? AND q.actor=? AND p.actor=? AND p.deleted_at IS NULL AND q.deleted_at IS NULL',id,pid,actor,actor).first()}
const projectView=row=>({id:row.id,name:row.name,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});
const questionView=row=>({id:row.id,projectId:row.project_id,revision:row.revision,state:row.state,content:JSON.parse(row.content_json),updatedAt:row.updated_at});
export async function handleQuestionApi(request,env,actor,url){
 if(!env.SECURITY_DB?.prepare)return error('D1_NOT_CONFIGURED',503);
 if(!/^[a-f0-9]{32}$/i.test(actor||''))return error('UNAUTHORIZED',401);
 const db=env.SECURITY_DB,path=url.pathname,method=request.method;
 const prefix='/api/v1/projects';
 if(!path.startsWith(prefix))return error('NOT_FOUND',404);
 const parts=path.slice(prefix.length).split('/').filter(Boolean);
 if(parts.length>3||parts.some((part,i)=>i!==1&&!uuid.test(part)))return error('NOT_FOUND',404);
 if(parts.length>=2&&parts[1]!=='questions')return error('NOT_FOUND',404);
 const pid=parts[0],qid=parts[2];
 try{
  if(parts.length===0){
   if(method==='GET'){
    const result=await sql(db,'SELECT * FROM bank_projects WHERE actor=? AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 50',actor).all();
    return respond({projects:(result.results||[]).map(projectView)});
   }
   if(method==='POST'){
    const body=await parseJson(request,1024),name=safe(body?.name);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(x=>x!=='name')||!name||name.length>120)return error('INVALID_PROJECT');
    const id=crypto.randomUUID();
    await audit(db,actor,'bank_project_create',id);
    await sql(db,'INSERT INTO bank_projects(id,actor,name) VALUES(?,?,?)',id,actor,name).run();
    return respond(projectView(await project(db,actor,id)),201);
   }
   return error('METHOD_NOT_ALLOWED',405);
  }
  const p=await project(db,actor,pid);
  if(!p)return error('PROJECT_NOT_FOUND',404);
  if(parts.length===1){
   if(method==='GET')return respond({project:projectView(p)});
   if(method==='PATCH'){
    const body=await parseJson(request,1024),name=safe(body?.name);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(x=>!['name','baseRevision'].includes(x))||!name||name.length>120||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<1)return error('INVALID_PROJECT');
    await audit(db,actor,'bank_project_update',pid);
    const updated=await sql(db,'UPDATE bank_projects SET name=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND actor=? AND revision=? AND deleted_at IS NULL RETURNING *',name,pid,actor,body.baseRevision).first();
    return updated?respond({project:projectView(updated)}):error('REVISION_CONFLICT',409);
   }
   if(method==='DELETE'){
    const body=await parseJson(request,128);
    if(!Number.isSafeInteger(body?.baseRevision)||body.baseRevision<1)return error('REVISION_REQUIRED');
    await audit(db,actor,'bank_project_delete',pid);
    const updated=await sql(db,'UPDATE bank_projects SET deleted_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND actor=? AND revision=? AND deleted_at IS NULL RETURNING id',pid,actor,body.baseRevision).first();
    return updated?respond({deleted:true}):error('REVISION_CONFLICT',409);
   }
   return error('METHOD_NOT_ALLOWED',405);
  }
  if(parts.length===2){
   if(method==='GET'){
    const result=await sql(db,'SELECT * FROM bank_questions WHERE project_id=? AND actor=? AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 50',pid,actor).all();
    return respond({questions:(result.results||[]).map(questionView)});
   }
   if(method==='POST'){
    const body=await parseJson(request),content=validateContent(body?.content);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='content'))return error('INVALID_CONTENT');
    const id=crypto.randomUUID();
    if(!(await registeredSource(db,actor,pid,content)))return error('SOURCE_PDF_NOT_REGISTERED',422);
    await audit(db,actor,'bank_question_create',id);
    // Compare the attachment's active state in the exact D1 write. A concurrent
    // tombstone cannot slip between validation and insertion.
    const inserted=await sql(db,`INSERT INTO bank_questions(id,project_id,actor,content_json)
     SELECT ?,?,?,? WHERE json_extract(?,'$.operatorConfirmed')=0
       OR EXISTS(SELECT 1 FROM bank_assets WHERE project_id=? AND actor=?
         AND digest=json_extract(?,'$.sourceDigest') AND role='question_pdf'
         AND mime='application/pdf' AND deleted_at IS NULL) RETURNING id`,
     id,pid,actor,content,content,pid,actor,content).first();
    if(!inserted)return error('SOURCE_PDF_NOT_REGISTERED',422);
    return respond({question:questionView(await question(db,actor,pid,id))},201);
   }
   return error('METHOD_NOT_ALLOWED',405);
  }
  const q=await question(db,actor,pid,qid);
  if(!q)return error('QUESTION_NOT_FOUND',404);
  if(method==='GET'){
   if(url.searchParams.get('history')==='1'){
    const history=await sql(db,'SELECT revision,content_json,state,deleted_at,happened_at FROM bank_question_revisions WHERE question_id=? AND actor=? ORDER BY revision DESC LIMIT 30',qid,actor).all();
    return respond({history:(history.results||[]).map(x=>({revision:x.revision,content:JSON.parse(x.content_json),state:x.state,deleted:x.deleted_at!==null,happenedAt:x.happened_at}))});
   }
   return respond({question:questionView(q)});
  }
  if(method==='PATCH'){
   const body=await parseJson(request),content=validateContent(body?.content);
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['content','baseRevision'].includes(k))||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<1)return error('INVALID_CONTENT');
   if(!(await registeredSource(db,actor,pid,content)))return error('SOURCE_PDF_NOT_REGISTERED',422);
   await audit(db,actor,'bank_question_update',qid);
   const updated=await sql(db,`UPDATE bank_questions SET content_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND project_id=? AND actor=? AND revision=? AND deleted_at IS NULL
      AND (json_extract(?,'$.operatorConfirmed')=0 OR EXISTS(
       SELECT 1 FROM bank_assets WHERE project_id=? AND actor=? AND digest=json_extract(?,'$.sourceDigest')
         AND role='question_pdf' AND mime='application/pdf' AND deleted_at IS NULL))
    RETURNING *`,content,qid,pid,actor,body.baseRevision,content,pid,actor,content).first();
   if(!updated&&!(await registeredSource(db,actor,pid,content)))return error('SOURCE_PDF_NOT_REGISTERED',422);
   return updated?respond({question:questionView(updated)}):error('REVISION_CONFLICT',409);
  }
  if(method==='DELETE'){
   const body=await parseJson(request,128);
   if(!Number.isSafeInteger(body?.baseRevision)||body.baseRevision<1)return error('REVISION_REQUIRED');
   await audit(db,actor,'bank_question_delete',qid);
   const updated=await sql(db,'UPDATE bank_questions SET deleted_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=? AND actor=? AND revision=? AND deleted_at IS NULL RETURNING id',qid,pid,actor,body.baseRevision).first();
   return updated?respond({deleted:true}):error('REVISION_CONFLICT',409);
  }
  return error('METHOD_NOT_ALLOWED',405);
 }catch(e){
  if(['JSON_REQUIRED','PAYLOAD_TOO_LARGE','INVALID_JSON','INVALID_CONTENT'].includes(e.message))return error(e.message,e.message==='PAYLOAD_TOO_LARGE'?413:400);
  return error('QUESTION_API_UNAVAILABLE',503);
 }
}
