import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/_worker.js';

const origin='https://selection-studio-e1c.pages.dev';
const assets={ASSETS:{fetch:async()=>new Response('asset')}};
const configured={...assets,ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'unit-aud',OPERATOR_EMAILS:'operator@example.com'};

for(const [label,path,method,env,status] of [
 ['health response','/health','GET',assets,200],
 ['unknown API','/api/not-a-route','GET',assets,404],
 ['missing identity configuration','/api/session','GET',assets,503],
 ['unauthenticated session','/api/session','GET',configured,401],
 ['disallowed OCR method','/api/ocr','GET',configured,405]
]){
 test('private API cache and MIME headers: '+label,async()=>{
  const response=await worker.fetch(new Request(origin+path,{method}),env);
  assert.equal(response.status,status);
  assert.match(response.headers.get('Cache-Control')||'',/\\bno-store\\b/i);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(response.headers.get('Content-Type')||'',/application\\/json/i);
 });
}
