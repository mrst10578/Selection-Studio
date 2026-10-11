// Cloudflare Pages advanced-mode Worker. Cloudflare Access JWT required for protected API.
const OCR_ORIGIN="https://examforge-free-ocr.zh-st-2.workers.dev/ocr";
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...extra}});
const encode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
async function verifyAccess(request,env){
  const token=request.headers.get("Cf-Access-Jwt-Assertion");
  const domain=env.ACCESS_TEAM_DOMAIN, audience=env.ACCESS_AUD;
  if(!token||!domain||!audience)return null;
  const parts=token.split(".");if(parts.length!==3)return null;
  let header,payload;
  try{header=JSON.parse(new TextDecoder().decode(encode(parts[0])));payload=JSON.parse(new TextDecoder().decode(encode(parts[1])))}catch{return null}
  if(header.alg!=="RS256"||!header.kid||!payload.sub)return null;
  const issuer="https://"+domain.replace(/^https?:\/\//,"").replace(/\/$/,"");
  if(payload.iss!==issuer||!Array.isArray(payload.aud)||!payload.aud.includes(audience)||!Number.isFinite(payload.exp)||payload.exp<=Date.now()/1000||!Number.isFinite(payload.iat)||payload.iat>Date.now()/1000+60)return null;
  const keysUrl=issuer+"/cdn-cgi/access/certs";
  let keys;try{const response=await fetch(keysUrl);if(!response.ok)return null;keys=await response.json()}catch{return null}
  const jwk=keys.keys?.find(k=>k.kid===header.kid&&k.kty==="RSA");if(!jwk)return null;
  try{const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,encode(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));return valid?payload:null}catch{return null}
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/health")return json({ok:true,service:"selection-studio",hosting:"Cloudflare Pages",assets:"native"});
  if(url.pathname==="/api/ocr"){
   if(request.method!=="POST")return json({error:"Method not allowed"},405,{"Allow":"POST"});
   if(!env.OCR_SERVICE_TOKEN||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return json({error:"OCR service not configured"},503);
   const identity=await verifyAccess(request,env);if(!identity)return json({error:"Unauthorized"},401);
   const role=identity.custom?.role||identity.role||"operator";
   if(!["admin","operator"].includes(role))return json({error:"Forbidden"},403);
   const size=Number(request.headers.get("content-length")||0);
   if(size>8*1024*1024)return json({error:"Payload too large"},413);
   if(env.OCR_RATE_LIMITER){const limit=await env.OCR_RATE_LIMITER.limit({key:identity.sub});if(!limit.success)return json({error:"Rate limit exceeded"},429,{"Retry-After":"60"})}
   const body=await request.arrayBuffer();if(body.byteLength>8*1024*1024)return json({error:"Payload too large"},413);
   const upstream=new AbortController();const timer=setTimeout(()=>upstream.abort(),30000);
   try{const response=await fetch(OCR_ORIGIN,{method:"POST",headers:{"Authorization":"Bearer "+env.OCR_SERVICE_TOKEN,"Content-Type":request.headers.get("content-type")||"application/octet-stream"},body,signal:upstream.signal,redirect:"error"});return new Response(response.body,{status:response.status,headers:{"Content-Type":response.headers.get("content-type")||"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
   catch{return json({error:"OCR upstream unavailable"},502)}
   finally{clearTimeout(timer)}
  }
  if(url.pathname.startsWith("/api/"))return json({error:"Unknown API endpoint"},404);
  if(url.pathname==="/ocr")return Response.redirect(url.origin+"/admin/ocr-studio.html",302);
  if(!env.ASSETS)return json({error:"Asset binding unavailable"},503);
  const path=url.pathname==="/"?"/index.html":url.pathname;
  return env.ASSETS.fetch(new Request(new URL(path+url.search,url.origin),request));
 }
};
