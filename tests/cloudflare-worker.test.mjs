import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {generateKeyPairSync,sign} from "node:crypto";
import worker from "../cloudflare/_worker.js";
import secureOcr from "../cloudflare/ocr-secure.js";

const source=await readFile(new URL("../cloudflare/_worker.js",import.meta.url),"utf8");
const operator=await readFile(new URL("../studio/operator-auth.js",import.meta.url),"utf8");
const admin=await readFile(new URL("../review-console/app.js",import.meta.url),"utf8");
const ocr=await readFile(new URL("../review-console/ocr-studio.js",import.meta.url),"utf8");
const request=(path,method="GET",headers={})=>new Request("https://selection-studio-e1c.pages.dev"+path,{method,headers,body:method==="POST"?"{}":undefined});
const assets={ASSETS:{fetch:async()=>new Response("native asset")}};
test("native asset routing",async()=>assert.equal(await (await worker.fetch(request("/studio/"),assets)).text(),"native asset"));
test("health",async()=>assert.equal((await (await worker.fetch(request("/health"),assets)).json()).assets,"native"));
test("unknown API",async()=>assert.equal((await worker.fetch(request("/api/invalid"),assets)).status,404));
test("OCR rejects GET",async()=>assert.equal((await worker.fetch(request("/api/ocr"),assets)).status,405));
test("session rejects POST",async()=>assert.equal((await worker.fetch(request("/api/session","POST"),assets)).status,405));
test("session fails closed before configured",async()=>assert.equal((await worker.fetch(request("/api/session"),assets)).status,503));
test("unverified identity is rejected",async()=>assert.equal((await worker.fetch(request("/api/session"),{...assets,ACCESS_TEAM_DOMAIN:"unit-test.cloudflareaccess.com",ACCESS_AUD:"aud-123",OPERATOR_EMAILS:"test@example.com"})).status,401));
test("demo credentials and browser OCR token flow are absent",()=>{
 assert.ok(!operator.includes('const PASSWORD='));
 assert.ok(!admin.includes('ADMIN_PASSWORD='));
 assert.ok(!ocr.includes('accessToken'));
 assert.ok(!ocr.includes('workerEndpoint'));
 assert.ok(ocr.includes('const url="/api/ocr";'));
 assert.ok(source.includes("SECURITY_DB"));
});

const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"unit-test-key"};
const authEnv={...assets,ACCESS_TEAM_DOMAIN:"unit-test.cloudflareaccess.com",ACCESS_AUD:"aud-123",OPERATOR_EMAILS:"operator@example.com"};
const jwt=(email="operator@example.com",alter=false)=>{
 const now=Math.floor(Date.now()/1000);
 const header=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid})).toString("base64url");
 const payload=Buffer.from(JSON.stringify({iss:"https://unit-test.cloudflareaccess.com",aud:["aud-123"],sub:"user-unit-123",email,iat:now,exp:now+3600})).toString("base64url");
 const message=header+"."+payload;
 const signature=sign("RSA-SHA256",Buffer.from(message),privateKey).toString("base64url");
 return message+"."+(alter?"forged"+signature.slice(6):signature);
};
test("signed Access identity is required and email allowlist enforced",async()=>{
 const prior=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{"Content-Type":"application/json"}});
 try{
  const signed=request("/api/session","GET",{"Cf-Access-Jwt-Assertion":jwt()});
  const permitted=await worker.fetch(signed,authEnv);
  assert.equal(permitted.status,200);
  assert.equal((await permitted.json()).role,"operator");
  const outsider=await worker.fetch(request("/api/session","GET",{"Cf-Access-Jwt-Assertion":jwt("outsider@example.com")}),authEnv);
  assert.equal(outsider.status,403);
  const forged=await worker.fetch(request("/api/session","GET",{"Cf-Access-Jwt-Assertion":jwt("operator@example.com",true)}),authEnv);
  assert.equal(forged.status,401);
  const noSecret=await worker.fetch(request("/api/ocr","POST",{"Cf-Access-Jwt-Assertion":jwt(),"Content-Type":"application/json"}),authEnv);
  assert.equal(noSecret.status,503);
 }finally{globalThis.fetch=prior}
});
test("OCR requires D1 quota and audit binding",async()=>{
 const prior=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{"Content-Type":"application/json"}});
 try{
  const r=await worker.fetch(request("/api/ocr","POST",{"Cf-Access-Jwt-Assertion":jwt(),"Content-Type":"application/json"}),{...authEnv,OCR_SERVICE_TOKEN:"test-only"});
  assert.equal(r.status,503);
 }finally{globalThis.fetch=prior}
});

test("isolated OCR worker requires its own server token",async()=>{
 const noToken=await secureOcr.fetch(new Request("https://internal/ocr",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),{ACCESS_TOKEN:"server-only"});
 assert.equal(noToken.status,401);
 const noConfig=await secureOcr.fetch(new Request("https://internal/ocr",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),{});
 assert.equal(noConfig.status,401);
});
test("OCR worker sends constrained image prompt to Workers AI",async()=>{
 let call;
 const env={ACCESS_TOKEN:"server-only",AI:{run:async(model,options)=>{call={model,options};return {response:"شناسايی شد"}}}};
 const payload=JSON.stringify({image:"data:image/png;base64,AAAA",prompt:"تست OCR"});
 const response=await secureOcr.fetch(new Request("https://internal/ocr",{method:"POST",headers:{"Authorization":"Bearer server-only","Content-Type":"application/json"},body:payload}),env);
 assert.equal(response.status,200);
 assert.equal(call.model,"@cf/google/gemma-4-26b-a4b-it");
 assert.equal(call.options.messages[0].content[1].image_url.url,"data:image/png;base64,AAAA");
 const bad=await secureOcr.fetch(new Request("https://internal/ocr",{method:"POST",headers:{"Authorization":"Bearer server-only","Content-Type":"application/json"},body:JSON.stringify({image:"https://untrusted.example/"} )}),env);
 assert.equal(bad.status,400);
});

test("authenticated OCR enforces D1 quota and records audit before inference",async()=>{
 const prior=globalThis.fetch;
 let upstreamCalls=0;
 globalThis.fetch=async (url,options)=>{
  if(String(url).includes("cloudflareaccess.com"))return new Response(JSON.stringify({keys:[jwk]}),{status:200});
  upstreamCalls++;
  assert.equal(options.headers.Authorization,"Bearer server-secret");
  return new Response(JSON.stringify({result:{response:"ok"}}),{status:200,headers:{"Content-Type":"application/json"}});
 };
 const counters=new Map(),audit=[];
 const db={prepare(sql){return {bind(...params){return {
  async first(){const [actor,window,bucket,max]=params;const k=actor+":"+window+":"+bucket;const used=counters.get(k)||0;if(used>=max)return null;counters.set(k,used+1);return {used:used+1}},
  async run(){audit.push(params);return {success:true}}
 }}}}};
 try{
  const e={...authEnv,SECURITY_DB:db,OCR_SERVICE_TOKEN:"server-secret"};
  const signed=()=>request("/api/ocr","POST",{"Cf-Access-Jwt-Assertion":jwt(),"Content-Type":"application/json"});
  for(let i=0;i<10;i++)assert.equal((await worker.fetch(signed(),e)).status,200);
  const rejected=await worker.fetch(signed(),e);
  assert.equal(rejected.status,429);
  assert.equal(upstreamCalls,10);
  assert.equal(audit.filter(row=>row[2]==="started").length,10);
  assert.equal(audit.filter(row=>row[2]==="rate_limited").length,1);
  counters.clear();upstreamCalls=0;
  const tight={...e,OCR_GLOBAL_DAILY_LIMIT:"1"};
  assert.equal((await worker.fetch(signed(),tight)).status,200);
  assert.equal((await worker.fetch(signed(),tight)).status,429);
  assert.equal(upstreamCalls,1);
 }finally{globalThis.fetch=prior}
});

test("operator-only readiness reports preview dependency bindings without revealing credentials",async()=>{
 const prior=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200});
 try{
  const req=(mail="operator@example.com",method="GET")=>request("/api/readiness",method,{"Cf-Access-Jwt-Assertion":jwt(mail)});
  const unauth=await worker.fetch(request("/api/readiness"),authEnv);
  assert.equal(unauth.status,401);
  const current=await worker.fetch(req(),authEnv);
  assert.equal(current.status,200);
  const body=await current.json();
  assert.equal(body.readyForBatchProducer,false);
  assert.equal(body.readyForQuestionEvidence,false);
  assert.equal(body.dependencies.securityDb,false);
  assert.equal(body.dependencies.ocrUpstreamToken,false);
  assert.equal(JSON.stringify(body).includes("server-secret"),false);
  const seeded={...authEnv,SECURITY_DB:{prepare(){return{}}},QUESTION_ASSETS:{put(){},head(){},get(){}},
   OCR_JOB_ASSETS:{put(){},get(){}},OCR_QUEUE:{send(){}},OCR_SERVICE_TOKEN:"server-secret",OCR_BATCH_ENABLED:"true"};
  const ready=await(await worker.fetch(req(),seeded)).json();
  assert.equal(ready.dependencies.ocrBatchExplicitlyEnabled,true);
  const disabled=await(await worker.fetch(req(),{...seeded,OCR_BATCH_ENABLED:"false"})).json();
  assert.equal(disabled.readyForBatchProducer,false);
  assert.equal(disabled.dependencies.ocrBatchExplicitlyEnabled,false);
  assert.equal(ready.readyForBatchProducer,true);
  assert.equal(ready.readyForQuestionEvidence,true);
  assert.equal(ready.dependencies.ocrUpstreamToken,true);
  assert.equal(JSON.stringify(ready).includes("server-secret"),false);
  assert.equal((await worker.fetch(req("reviewer@example.com"),{...seeded,REVIEWER_EMAILS:"reviewer@example.com"})).status,403);
  assert.equal((await worker.fetch(req("operator@example.com","POST"),seeded)).status,405);
 }finally{globalThis.fetch=prior}
});
