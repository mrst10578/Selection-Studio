/* ZH-81 | Authenticated, fail-closed project asset proxy. No public bucket URLs. */
import {putPrivateAsset,readPrivateAsset} from './private-assets.js';
const id=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const actorPattern=/^[a-f0-9]{32}$/i;
const mimeSet=new Set(['application/pdf','image/png','image/jpeg','image/webp','application/json']);
const roleSet=new Set(['question_pdf','answer_pdf','figure','export']);
const maxBytes=8*1024*1024;
// Hard caps are per-actor and per-project; the atomic D1 insert rechecks them under concurrent requests.
const PROJECT_MAX_FILES=24,PROJECT_MAX_BYTES=64*1024*1024;
const ACTOR_MAX_FILES=96,ACTOR_MAX_BYTES=256*1024*1024;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const query=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function handleAssetApi(request,env,actor,url){
 if(!env.SECURITY_DB?.prepare||!env.QUESTION_ASSETS?.get||!env.QUESTION_ASSETS?.put||!env.QUESTION_ASSETS?.head)return json({error:'ASSET_STORAGE_NOT_CONFIGURED'},503);
 if(!actorPattern.test(actor||''))return json({error:'UNAUTHORIZED'},401);
 const match=/^\/api\/v1\/projects\/([^/]+)\/assets(?:\/([a-f0-9]{64}))?$/i.exec(url.pathname);
 if(!match||!id.test(match[1]))return json({error:'NOT_FOUND'},404);
 const [,projectId,digest]=match,db=env.SECURITY_DB;
 const owner=await query(db,'SELECT id FROM bank_projects WHERE id=? AND actor=? AND deleted_at IS NULL',projectId,actor).first().catch(()=>null);
 if(!owner)return json({error:'NOT_FOUND'},404);
 try{
  if(request.method==='GET'&&!digest){
   const results=await query(db,'SELECT digest,mime,role,byte_size,created_at FROM bank_assets WHERE project_id=? AND actor=? AND deleted_at IS NULL ORDER BY created_at DESC,digest LIMIT 50',projectId,actor).all();
   return json({assets:(results.results||[]).map(x=>({digest:x.digest,mime:x.mime,role:x.role,size:x.byte_size,createdAt:x.created_at}))});
  }
  if(request.method==='GET'&&digest){
   const role=url.searchParams.get('role');
   if(!roleSet.has(role))return json({error:'INVALID_ASSET_ROLE'},400);
   const row=await query(db,'SELECT digest,mime,role FROM bank_assets WHERE project_id=? AND actor=? AND digest=? AND role=? AND deleted_at IS NULL',projectId,actor,digest,role).first();
   if(!row)return json({error:'ASSET_NOT_FOUND'},404);
   const result=await readPrivateAsset(env,actor,{digest:row.digest,mime:row.mime});
   if(!result)return json({error:'ASSET_MISSING_IN_STORAGE'},503);
   const ext={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/json':'json'}[row.mime];
   return new Response(result.object.body,{status:200,headers:{
    'Content-Type':row.mime,'Content-Disposition':'attachment; filename="asset-'+digest.slice(0,16)+'.'+ext+'"',
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; sandbox"
   }});
  }
  if(request.method==='DELETE'&&digest){
   const role=url.searchParams.get('role');
   if(!roleSet.has(role))return json({error:'INVALID_ASSET_ROLE'},400);
   const stored=await query(db,'SELECT digest FROM bank_assets WHERE project_id=? AND actor=? AND digest=? AND role=? AND deleted_at IS NULL',projectId,actor,digest,role).first();
   if(!stored)return json({error:'ASSET_NOT_FOUND'},404);
   if(role==='question_pdf'){
    // A source PDF must stay accessible as evidence for every historical revision.
    const linked=await query(db,"SELECT 1 AS used FROM bank_question_revisions r JOIN bank_questions q ON q.id=r.question_id WHERE q.project_id=? AND q.actor=? AND json_extract(r.content_json,'$.sourceDigest')=? LIMIT 1",projectId,actor,digest).first();
    if(linked)return json({error:'SOURCE_PDF_REFERENCED_BY_QUESTION'},409);
   }
   const deleted=await query(db,'UPDATE bank_assets SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=? AND actor=? AND digest=? AND role=? AND deleted_at IS NULL RETURNING digest',projectId,actor,digest,role).first();
   // R2 object is deliberately not deleted synchronously: dedup shares actor-scoped
   // blobs across projects, and concurrent uploads may still reference this key.
   return json({deleted:!!deleted,metadataTombstoned:true,physicalCleanupPending:true});
  }
  if(request.method==='POST'&&!digest){
   const mime=request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
   const role=request.headers.get('x-asset-role');
   if(!mimeSet.has(mime)||!roleSet.has(role))return json({error:'INVALID_ASSET_METADATA'},400);
   if(['question_pdf','answer_pdf'].includes(role)&&mime!=='application/pdf')return json({error:'PDF_REQUIRED'},400);
   if(role==='figure'&&!mime.startsWith('image/'))return json({error:'IMAGE_REQUIRED'},400);
   const declared=request.headers.get('content-length');
   if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))return json({error:'ASSET_TOO_LARGE'},413);
   let size=0;const chunks=[];
   if(!request.body)return json({error:'EMPTY_ASSET'},400);
   const reader=request.body.getReader();
   try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
     if(size>maxBytes){await reader.cancel().catch(()=>{});return json({error:'ASSET_TOO_LARGE'},413)}
     chunks.push(value);
    }
   }finally{reader.releaseLock()}
   if(size<16)return json({error:'EMPTY_ASSET'},400);
   const bytes=new Uint8Array(size);let offset=0;
   for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   const quota=await query(db,`SELECT
    (SELECT COUNT(*) FROM bank_assets WHERE project_id=? AND actor=? AND deleted_at IS NULL) AS project_count,
    (SELECT COALESCE(SUM(byte_size),0) FROM bank_assets WHERE project_id=? AND actor=? AND deleted_at IS NULL) AS project_bytes,
    (SELECT COUNT(*) FROM bank_assets WHERE actor=? AND deleted_at IS NULL) AS actor_count,
    (SELECT COALESCE(SUM(byte_size),0) FROM bank_assets WHERE actor=? AND deleted_at IS NULL) AS actor_bytes`,
    projectId,actor,projectId,actor,actor,actor).first();
   if(quota.project_count>=PROJECT_MAX_FILES||quota.project_bytes+size>PROJECT_MAX_BYTES||
      quota.actor_count>=ACTOR_MAX_FILES||quota.actor_bytes+size>ACTOR_MAX_BYTES)
    return json({error:'ASSET_QUOTA_EXCEEDED',maxProjectFiles:PROJECT_MAX_FILES,maxProjectBytes:PROJECT_MAX_BYTES},429);
   const asset=await putPrivateAsset(env,actor,bytes,{mime});
   // Recheck quota in the same SQLite statement as the insert so simultaneous
   // requests cannot bypass the cap by racing the preflight query.
   const inserted=await query(db,`INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size)
    SELECT ?,?,?,?,?,?,?
    WHERE (SELECT COUNT(*) FROM bank_assets WHERE project_id=? AND actor=? AND deleted_at IS NULL) < ?
      AND (SELECT COALESCE(SUM(byte_size),0) FROM bank_assets WHERE project_id=? AND actor=? AND deleted_at IS NULL)+? <= ?
      AND (SELECT COUNT(*) FROM bank_assets WHERE actor=? AND deleted_at IS NULL) < ?
      AND (SELECT COALESCE(SUM(byte_size),0) FROM bank_assets WHERE actor=? AND deleted_at IS NULL)+? <= ?
    ON CONFLICT(project_id,digest,role) DO UPDATE SET deleted_at=NULL
      WHERE bank_assets.actor=excluded.actor AND bank_assets.object_key=excluded.object_key
    RETURNING digest`,
    projectId,actor,asset.digest,mime,role,asset.key,asset.bytes,
    projectId,actor,PROJECT_MAX_FILES,projectId,actor,asset.bytes,PROJECT_MAX_BYTES,
    actor,ACTOR_MAX_FILES,actor,asset.bytes,ACTOR_MAX_BYTES).first();
   if(!inserted)return json({error:'ASSET_QUOTA_EXCEEDED'},429);
   return json({digest:asset.digest,mime,role,size:asset.bytes,existing:asset.existing},201);
  }
  return json({error:'METHOD_NOT_ALLOWED'},405);
 }catch(error){
  if(error?.message==='INVALID_ASSET_TYPE')return json({error:'INVALID_ASSET_TYPE'},415);
  if(error?.message==='INVALID_ASSET_SIZE')return json({error:'ASSET_TOO_LARGE'},413);
  return json({error:'ASSET_STORAGE_UNAVAILABLE'},503);
 }
}
