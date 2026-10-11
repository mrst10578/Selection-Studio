import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {generateKeyPairSync,sign} from "node:crypto";
import worker from "../cloudflare/_worker.js";

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
