// Native Cloudflare Pages Worker. Fail closed if identity, quota or secret config is absent.
const OCR_ORIGIN="https://selection-studio-ocr-secure.zh-st-2.workers.dev/ocr";
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...extra}});
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=")),c=>c.charCodeAt(0));
let cachedKeys=null;
async function verifyAccess(request,env){
 const jwt=request.headers.get("Cf-Access-Jwt-Assertion");
 const domain=String(env.ACCESS_TEAM_DOMAIN||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
 const audience=env.ACCESS_AUD;
 if(!jwt||!domain.endsWith(".cloudflareaccess.com")||!audience)return null;
 const parts=jwt.split(".");
 if(parts.length!==3||parts.some(p=>p.length>16000))return null;
 let header,claims;
 try{header=JSON.parse(new TextDecoder().decode(bytes(parts[0])));claims=JSON.parse(new TextDecoder().decode(bytes(parts[1])))}catch{return null}
 if(header.alg!=="RS256"||typeof header.kid!=="string"||typeof claims.sub!=="string")return null;
 const issuer="https://"+domain;
 const now=Math.floor(Date.now()/1000);
 const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(claims.iss!==issuer||!audiences.includes(audience)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||(claims.nbf!=null&&claims.nbf>now+60))return null;
 try{
  if(!cachedKeys||cachedKeys.issuer!==issuer||cachedKeys.expires<Date.now()){
   const response=await fetch(issuer+"/cdn-cgi/access/certs");
   if(!response.ok)return null;
   const value=await response.json();
   if(!Array.isArray(value.keys))return null;
   cachedKeys={issuer,keys:value.keys,expires:Date.now()+300000};
  }
  const jwk=cachedKeys.keys.find(k=>k.kid===header.kid&&k.kty==="RSA");
  if(!jwk)return null;
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,bytes(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  return valid?claims:null;
 }catch{return null}
}
const allowed=(identity,env)=>{
 const mail=String(identity?.email||"").trim().toLowerCase();
 const list=String(env.OPERATOR_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 return mail&&list.includes(mail);
};
async function actorId(identity){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity.sub));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("").slice(0,32);
}
async function recordAudit(db,actor,action,result,detail=""){
 await db.prepare("INSERT INTO security_audit (actor,action,result,detail) VALUES (?1,?2,?3,?4)").bind(actor,action,result,detail).run();
}
async function consumeQuota(db,actor,env){
 const now=Date.now(),daily=Math.floor(now/86400000);
 const globalLimit=Math.min(100,Math.max(1,Number(env.OCR_GLOBAL_DAILY_LIMIT)||30));
 for(const [subject,window,bucket,maximum] of [
  [actor,"minute",Math.floor(now/60000),10],
  [actor,"day",daily,100],
  ["__global__","day",daily,globalLimit]
 ]){
  const row=await db.prepare("INSERT INTO ocr_usage (actor,window,bucket,used) VALUES (?1,?2,?3,1) ON CONFLICT(actor,window,bucket) DO UPDATE SET used=used+1 WHERE used < ?4 RETURNING used").bind(subject,window,bucket,maximum).first();
  if(!row)return false;
 }
 return true;
}
const DRAFT_FIELDS=new Set(["provider","examMonth","examDay","operator","sourceNumber","subject","grade","chapter","unit","difficulty","correctOption"]);
async function handleDraft(request,env,identity,url){
 if(!env.SECURITY_DB)return json({error:"Draft storage unavailable"},503);
 const project=url.searchParams.get("project")||"workspace";
 if(!/^[a-z0-9_-]{1,64}$/.test(project))return json({error:"Invalid project identifier"},400);
 const actor=await actorId(identity);
 const db=env.SECURITY_DB;
 const select=()=>db.prepare("SELECT revision, fields_json, updated_at FROM studio_drafts WHERE actor=?1 AND project=?2").bind(actor,project).first();
 try{
  if(request.method==="GET"){
   const row=await select();
   if(url.searchParams.get("history")==="1"){
    const items=await db.prepare("SELECT revision, fields_json, updated_at FROM studio_draft_revisions WHERE actor=?1 AND project=?2 ORDER BY revision DESC LIMIT 12").bind(actor,project).all();
    return json({project,revision:row?.revision||0,versions:(items.results||[]).map(item=>({revision:item.revision,updatedAt:item.updated_at,fields:JSON.parse(item.fields_json)}))});
   }
   return json({project,revision:row?.revision||0,updatedAt:row?.updated_at||null,fields:row?JSON.parse(row.fields_json):null});
  }
  if(request.method!=="PUT")return json({error:"Method not allowed"},405,{"Allow":"GET, PUT"});
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return json({error:"JSON required"},415);
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>8192||!Number.isFinite(declared))return json({error:"Draft too large"},413);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>8192)return json({error:"Draft too large"},413);
  let input;try{input=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
  if(!input||typeof input!=="object"||Array.isArray(input)||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<0||!input.fields||typeof input.fields!=="object"||Array.isArray(input.fields))return json({error:"Invalid draft"},400);
  const keys=Object.keys(input.fields);
  if(keys.length>DRAFT_FIELDS.size||keys.some(k=>!DRAFT_FIELDS.has(k)||typeof input.fields[k]!=="string"||input.fields[k].length>200))return json({error:"Invalid fields"},400);
  const fields_json=JSON.stringify(Object.fromEntries(keys.map(k=>[k,input.fields[k]])));
  // Atomic compare-and-swap: INSERT when absent, otherwise only update matching revision.
  if(input.baseRevision>0&&!(await select()))return json({error:"Revision conflict",project,revision:0,fields:null},409);
  const write=await db.prepare("INSERT INTO studio_drafts (actor,project,revision,fields_json,updated_at) VALUES (?1,?2,1,?3,CURRENT_TIMESTAMP) ON CONFLICT(actor,project) DO UPDATE SET revision=studio_drafts.revision+1,fields_json=excluded.fields_json,updated_at=CURRENT_TIMESTAMP WHERE studio_drafts.revision=?4 RETURNING revision,updated_at").bind(actor,project,fields_json,input.baseRevision).first();
  if(!write){const current=await select();return json({error:"Revision conflict",project,revision:current?.revision||0,fields:current?JSON.parse(current.fields_json):null},409)}
  // Best-effort version history: the current draft is already safely stored.
  try{
   await db.prepare("INSERT INTO studio_draft_revisions (actor,project,revision,fields_json,updated_at) VALUES (?1,?2,?3,?4,?5)").bind(actor,project,write.revision,fields_json,write.updated_at).run();
   await db.prepare("DELETE FROM studio_draft_revisions WHERE actor=?1 AND project=?2 AND revision NOT IN (SELECT revision FROM studio_draft_revisions WHERE actor=?1 AND project=?2 ORDER BY revision DESC LIMIT 12)").bind(actor,project).run();
  }catch{}
  return json({project,revision:write.revision,updatedAt:write.updated_at,saved:true});
 }catch{return json({error:"Draft database unavailable"},503)}
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health")return json({ok:true,service:"selection-studio",hosting:"Cloudflare Pages",assets:"native"});
  if(url.pathname==="/api/session"||url.pathname==="/api/ocr"||url.pathname==="/api/draft"){
   const isOcr=url.pathname==="/api/ocr";
   const isDraft=url.pathname==="/api/draft";
   const method=isDraft?"GET, PUT":isOcr?"POST":"GET";
   if(isDraft&&!["GET","PUT"].includes(request.method)||!isDraft&&request.method!==method)return json({error:"Method not allowed"},405,{"Allow":method});
   if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.OPERATOR_EMAILS)return json({error:"Identity not configured"},503);
   const identity=await verifyAccess(request,env);
   if(!identity)return json({error:"Unauthorized"},401);
   if(!allowed(identity,env))return json({error:"Forbidden"},403);
   if(isDraft)return handleDraft(request,env,identity,url);
   if(!isOcr)return json({authenticated:true,role:"operator",email:identity.email});
   if(!env.OCR_SERVICE_TOKEN||!env.SECURITY_DB)return json({error:"OCR is not configured"},503);
   const actor=await actorId(identity);
   try{
    const permitted=await consumeQuota(env.SECURITY_DB,actor,env);
    if(!permitted){
     await recordAudit(env.SECURITY_DB,actor,"ocr","rate_limited");
     return json({error:"Rate limit exceeded"},429,{"Retry-After":"60"});
    }
   }catch{return json({error:"Rate limit service unavailable"},503)}
   if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return json({error:"JSON required"},415);
   const declared=Number(request.headers.get("content-length")||0);
   if(!Number.isFinite(declared)||declared>8*1024*1024)return json({error:"Payload too large"},413);
   const body=await request.arrayBuffer();
   if(body.byteLength>8*1024*1024)return json({error:"Payload too large"},413);
   try{await recordAudit(env.SECURITY_DB,actor,"ocr","started")}catch{return json({error:"Audit service unavailable"},503)}
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),90000);
   try{
    const upstream=await fetch(OCR_ORIGIN,{method:"POST",headers:{"Authorization":"Bearer "+env.OCR_SERVICE_TOKEN,"Content-Type":"application/json"},body,signal:controller.signal,redirect:"error"});
    try{await recordAudit(env.SECURITY_DB,actor,"ocr",upstream.ok?"completed":"upstream_error",String(upstream.status))}catch{}
    return new Response(upstream.body,{status:upstream.status,headers:{"Content-Type":upstream.headers.get("content-type")||"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
   }catch{
    try{await recordAudit(env.SECURITY_DB,actor,"ocr","failed")}catch{}
    return json({error:"OCR upstream unavailable"},502);
   }finally{clearTimeout(timeout)}
  }
  if(url.pathname.startsWith("/api/"))return json({error:"Unknown API endpoint"},404);
  if(url.pathname==="/ocr")return Response.redirect(url.origin+"/review-console/ocr-studio.html",302);
  if(!env.ASSETS)return json({error:"Asset binding unavailable"},503);
  const path=url.pathname==="/"?"/index.html":url.pathname;
  return env.ASSETS.fetch(new Request(new URL(path+url.search,url.origin),request));
 }
};
