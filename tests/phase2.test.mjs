import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import worker from '../cloudflare/_worker.js';
import {uniqueRegions} from '../studio/crop-queue.js';
import {sameFields,DRAFT_FIELDS} from '../studio/cloud-draft.js';

test('multi-crop keeps distinct page and box regions, removing invalid and duplicate geometry',()=>{
 const a={page:2,bbox_norm:[0.1,0.2,0.4,0.5]};
 const b={page:3,bbox_norm:[0.1,0.2,0.4,0.5]};
 const result=uniqueRegions([a,a,null,{page:2,bbox_norm:[-1,0,1,1]},b]);
 assert.equal(result.length,2);
 a.bbox_norm[0]=0.8;
 assert.equal(result[0].bbox_norm[0],0.1);
 assert.equal(result[1].page,3);
});
test('metadata comparison and server allowlist exclude PDF payloads',()=>{
 assert.ok(DRAFT_FIELDS.includes('examMonth'));
 assert.ok(!DRAFT_FIELDS.includes('questionPdf'));
 assert.ok(!DRAFT_FIELDS.includes('password'));
 assert.equal(sameFields({subject:'BIO'},{subject:'BIO'}),true);
 assert.equal(sameFields({subject:'BIO'},{subject:'PHY'}),false);
});

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'draft-qa-key'};
const jwt=()=>{
 const now=Math.floor(Date.now()/1000);
 const first=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
 const second=Buffer.from(JSON.stringify({iss:'https://draft-test.cloudflareaccess.com',aud:['test-audience'],sub:'signed-operator-1',email:'owner@test.example',iat:now,exp:now+1200})).toString('base64url');
 const unsigned=first+'.'+second;
 return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
};
function fakeDB(){
 let row=null;
 const revisions=[];
 return {prepare(sql){return {bind(...params){return {
  async first(){
   if(sql.startsWith('SELECT revision'))return row;
   if(sql.startsWith('INSERT INTO studio_drafts')){
    const [actor,project,fields,base]=params;
    if(!row){if(base!==0)return null;row={revision:1,updated_at:'2026-10-11',fields_json:fields};return row}
    if(row.revision!==base)return null;
    row={revision:row.revision+1,updated_at:'2026-10-11',fields_json:fields};return row;
   }
   throw Error('Unexpected statement: '+sql);
  },
  async run(){
   if(sql.startsWith('INSERT INTO studio_draft_revisions'))revisions.push({revision:params[2],fields_json:params[3],updated_at:params[4]});
   if(sql.startsWith('DELETE FROM'))while(revisions.length>12)revisions.shift();
   return {success:true};
  },
  async all(){return {results:[...revisions].reverse()}}
 }}}},get row(){return row}};
}
test('draft API performs versioned writes, detects stale revision and rejects untrusted fields',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'Content-Type':'application/json'}});
 const database=fakeDB();
 const env={ACCESS_TEAM_DOMAIN:'draft-test.cloudflareaccess.com',ACCESS_AUD:'test-audience',OPERATOR_EMAILS:'owner@test.example',SECURITY_DB:database};
 const signed=jwt();
 const req=(method='GET',payload=null,route='/api/draft?project=workspace')=>new Request('https://host.example'+route,{method,headers:{'Cf-Access-Jwt-Assertion':signed,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
 try{
  const empty=await worker.fetch(req(),env);assert.equal(empty.status,200);assert.equal((await empty.json()).revision,0);
  const first=await worker.fetch(req('PUT',{baseRevision:0,fields:{provider:'قلمچی',subject:'BIO'}}),env);
  assert.equal(first.status,200);assert.equal((await first.json()).revision,1);
  const second=await worker.fetch(req('PUT',{baseRevision:1,fields:{provider:'آزمون',subject:'PHY'}}),env);
  assert.equal(second.status,200);assert.equal((await second.json()).revision,2);
  const stale=await worker.fetch(req('PUT',{baseRevision:1,fields:{subject:'CHEM'}}),env);
  assert.equal(stale.status,409);assert.equal((await stale.json()).revision,2);
  const current=await worker.fetch(req(),env);assert.equal((await current.json()).fields.subject,'PHY');
  const secret=await worker.fetch(req('PUT',{baseRevision:2,fields:{pdfBase64:'secret'}}),env);
  assert.equal(secret.status,400);
  const huge=await worker.fetch(req('PUT',{baseRevision:2,fields:{provider:'x'.repeat(201)}}),env);
  assert.equal(huge.status,400);
  const malformed=await worker.fetch(req('PUT',{baseRevision:-1,fields:{subject:'BIO'}}),env);
  assert.equal(malformed.status,400);
  const badProject=await worker.fetch(req('GET',null,'/api/draft?project=../secret'),env);
  assert.equal(badProject.status,400);
  const historical=await worker.fetch(req('GET',null,'/api/draft?project=workspace&history=1'),env);
  const h=await historical.json();assert.equal(h.versions.length,2);
 }finally{globalThis.fetch=original}
});
test('draft endpoint requires authenticated identity and storage',async()=>{
 const prior=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200});
 try{
  const env={ACCESS_TEAM_DOMAIN:'draft-test.cloudflareaccess.com',ACCESS_AUD:'test-audience',OPERATOR_EMAILS:'owner@test.example'};
  const request=new Request('https://host.example/api/draft',{headers:{'Cf-Access-Jwt-Assertion':jwt()}});
  assert.equal((await worker.fetch(request,env)).status,503);
  assert.equal((await worker.fetch(new Request('https://host.example/api/draft'),env)).status,401);
 }finally{globalThis.fetch=prior}
});
