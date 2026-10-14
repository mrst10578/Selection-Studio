import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {handleQuestionApi} from '../cloudflare/question-api-v1.js';
const schema=await readFile(new URL('../cloudflare/schema-question-bank-v1.sql',import.meta.url),'utf8');
const security=await readFile(new URL('../cloudflare/schema-security.sql',import.meta.url),'utf8');
const assetSchema=await readFile(new URL('../cloudflare/schema-private-assets-v1.sql',import.meta.url),'utf8');
const actorA='a'.repeat(32),actorB='b'.repeat(32);
function fixture(){
 const local=new DatabaseSync(':memory:');local.exec('PRAGMA foreign_keys=ON;');local.exec(security);local.exec(schema);local.exec(assetSchema);
 const db={prepare(query){return {bind(...args){const s=local.prepare(query);return {
  async first(){return s.get(...args)??null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}
 }}}}};
 const env={SECURITY_DB:db};
 const request=async(actor,path,method='GET',body)=>{
  const url=new URL('https://preview.example/api/v1/projects'+path);
  const req=new Request(url,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
  const res=await handleQuestionApi(req,env,actor,url);return {status:res.status,body:await res.json()};
 };
 return {local,request};
}
test('versioned API fails closed when D1 or authenticated actor is missing',async()=>{
 const r=new Request('https://example.com/api/v1/projects');
 const url=new URL(r.url);
 assert.equal((await handleQuestionApi(r,{},actorA,url)).status,503);
 const f=fixture();assert.equal((await f.request('untrusted','')).status,401);f.local.close();
});
test('D1 projects and questions are isolated to one actor and accept drafts only',async()=>{
 const f=fixture();const project=await f.request(actorA,'','POST',{name:'کنکور'});
 assert.equal(project.status,201);
 const pid=project.body.id;
 assert.equal((await f.request(actorB,'/'+pid)).status,404);
 const created=await f.request(actorA,'/'+pid+'/questions','POST',{content:{questionText:'کدام گزینه نادرست است؟',latex:['x^2']}});
 assert.equal(created.status,201);const qid=created.body.question.id;
 assert.equal(created.body.question.state,'draft');
 assert.equal((await f.request(actorB,'/'+pid+'/questions/'+qid)).status,404);
 const tampered=await f.request(actorA,'/'+pid+'/questions','POST',{content:{questionText:'OCR',review_status:'approved'}});
 assert.equal(tampered.status,400);
 assert.equal((await f.request(actorA,'/'+pid+'/questions/'+qid,'PATCH',{baseRevision:1,content:{questionText:'بعد از ویرایش',published:true}})).status,400);
 f.local.close();
});
test('optimistic revision CAS persists immutable history and soft-deletion',async()=>{
 const f=fixture();const pid=(await f.request(actorA,'','POST',{name:'آزمون'})).body.id;
 const q=(await f.request(actorA,'/'+pid+'/questions','POST',{content:{questionText:'متن اول'}})).body.question;
 const path='/'+pid+'/questions/'+q.id;
 const amended=await f.request(actorA,path,'PATCH',{baseRevision:1,content:{questionText:'متن دوم'}});
 assert.equal(amended.status,200);assert.equal(amended.body.question.revision,2);
 assert.equal((await f.request(actorA,path,'PATCH',{baseRevision:1,content:{questionText:'بازنویسی همزمان'}})).status,409);
 const history=await f.request(actorA,path+'?history=1');
 assert.deepEqual(history.body.history.map(x=>x.revision),[2,1]);
 assert.equal(history.body.history[1].content.questionText,'متن اول');
 assert.equal((await f.request(actorA,path,'DELETE',{baseRevision:1})).status,409);
 assert.equal((await f.request(actorA,path,'DELETE',{baseRevision:2})).status,200);
 assert.equal((await f.request(actorA,path)).status,404);
 assert.deepEqual((await f.request(actorA,'/'+pid+'/questions')).body.questions,[]);
 f.local.close();
});

test('attesting a question requires a registered active owner-scoped source PDF',async()=>{
 const f=fixture(),pid=(await f.request(actorA,'','POST',{name:'source evidence'})).body.id;
 const digest='c'.repeat(64),endpoint='/'+pid+'/questions';
 const content={questionText:'سؤال اول',sourceDigest:digest,operatorConfirmed:true};
 const missing=await f.request(actorA,endpoint,'POST',{content});
 assert.equal(missing.status,422);
 assert.equal(missing.body.error,'SOURCE_PDF_NOT_REGISTERED');
 const entry=f.local.prepare('INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)');
 entry.run(pid,actorA,digest,'application/pdf','answer_pdf','private/'+digest,40);
 assert.equal((await f.request(actorA,endpoint,'POST',{content})).status,422);
 f.local.prepare('UPDATE bank_assets SET role=? WHERE project_id=? AND digest=?').run('question_pdf',pid,digest);
 const created=await f.request(actorA,endpoint,'POST',{content});
 assert.equal(created.status,201);
 assert.equal(created.body.question.content.operatorConfirmed,true);
 const qid=created.body.question.id;
 f.local.prepare('UPDATE bank_assets SET deleted_at=CURRENT_TIMESTAMP WHERE project_id=? AND digest=?').run(pid,digest);
 const amendment=await f.request(actorA,endpoint+'/'+qid,'PATCH',{baseRevision:1,content:{...content,questionText:'نسخه دوم'}});
 assert.equal(amendment.status,422);
 assert.equal(amendment.body.error,'SOURCE_PDF_NOT_REGISTERED');
 assert.equal((await f.request(actorA,endpoint+'/'+qid,'PATCH',{baseRevision:1,content:{...content,operatorConfirmed:false}})).status,200);
 f.local.close();
});
