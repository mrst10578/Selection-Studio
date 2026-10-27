import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {handleReviewApi} from '../cloudflare/question-review-api.js';
const paths=['schema-security.sql','schema-question-bank-v1.sql','schema-private-assets-v1.sql','schema-review-v1.sql'];
const schemas=await Promise.all(paths.map(path=>readFile(new URL('../cloudflare/'+path,import.meta.url),'utf8')));
const operator='a'.repeat(32),reviewer='b'.repeat(32),outsider='c'.repeat(32);
const projectId='12345678-1234-1234-1234-123456789012',questionId='87654321-1234-1234-1234-123456789012';
const sourceDigest='d'.repeat(64);
const checklist={sourceVerified:true,transcriptionVerified:true,answerVerified:true,taxonomyVerified:true,figuresVerified:true,warningsResolved:true};
function fixture(){
 const db0=new DatabaseSync(':memory:');db0.exec('PRAGMA foreign_keys=ON;');for(const schema of schemas)db0.exec(schema);
 db0.prepare('INSERT INTO bank_projects(id,actor,name) VALUES(?,?,?)').run(projectId,operator,'Test preview');
 const content={questionText:'گزینه نادرست را مشخص کنید',operatorConfirmed:true,scientificPending:0,sourceDigest};
 db0.prepare('INSERT INTO bank_questions(id,project_id,actor,content_json) VALUES(?,?,?,?)').run(questionId,projectId,operator,JSON.stringify(content));
 const database={prepare(query){return {bind(...args){const stmt=db0.prepare(query);return {
  async first(){return stmt.get(...args)??null},async all(){return {results:stmt.all(...args)}},async run(){return stmt.run(...args)}
 }}}}};
 const env={SECURITY_DB:database,OPERATOR_EMAILS:'owner@example.test',REVIEWER_EMAILS:'reviewer@example.test'};
 const run=async({actor=reviewer,email='reviewer@example.test',path='/assigned',method='GET',data}={})=>{
  const u=new URL('https://preview.example/api/v1/reviews'+path);
  const request=new Request(u,{method,headers:data?{'Content-Type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});
  const response=await handleReviewApi(request,env,{email},actor,u);return {status:response.status,body:await response.json()};
 };
 return {db0,env,run};
}
test('only project owner assigns whitelisted, distinct reviewers',async()=>{
 const f=fixture();
 const endpoint='/assignments';
 assert.equal((await f.run({actor:operator,email:'owner@example.test',path:endpoint,method:'POST',data:{projectId,reviewerEmail:'outside@example.test'}})).status,400);
 assert.equal((await f.run({actor:operator,email:'owner@example.test',path:endpoint,method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}})).status,201);
 assert.equal((await f.run({actor:reviewer,email:'reviewer@example.test',path:endpoint,method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}})).status,403);
 const assigned=await f.run();assert.deepEqual(assigned.body.projects.map(p=>p.id),[projectId]);
 assert.equal((await f.run({actor:outsider,email:'outside@example.test'})).status,403);
 f.db0.close();
});
test('source PDF and operator confirmation are required before independent scientific approval',async()=>{
 const f=fixture(),assign='/assignments',path='/projects/'+projectId+'/questions/'+questionId;
 await f.run({actor:operator,email:'owner@example.test',path:assign,method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}});
 const data={baseRevision:1,decision:'approve',checks:checklist};
 assert.equal((await f.run({path,method:'POST',data})).body.error,'MISSING_PRIVATE_SOURCE_PDF');
 f.db0.prepare("INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)").run(projectId,operator,sourceDigest,'application/pdf','question_pdf','private-assets/'+operator+'/'+sourceDigest+'.pdf',90);
 assert.equal((await f.run({path,method:'POST',data:{...data,checks:{...checklist,warningsResolved:false}}})).status,422);
 const accepted=await f.run({path,method:'POST',data});assert.equal(accepted.status,201);assert.equal(accepted.body.autoPublish,false);
 assert.equal((await f.run({path,method:'POST',data:{...data,baseRevision:2}})).status,409);
 const review=await f.run({path});assert.equal(review.body.decisions[0].decision,'approve');
 assert.equal(f.db0.prepare("SELECT count(*) AS n FROM security_audit WHERE action='question_review_attempt'").get().n,1);
 f.db0.close();
});
test('reviewers cannot approve their own projects, unassigned projects or stale revisions',async()=>{
 const f=fixture(),path='/projects/'+projectId+'/questions/'+questionId;
 assert.equal((await f.run({path,method:'POST',data:{baseRevision:1,decision:'approve',checks:checklist}})).status,404);
 await f.run({actor:operator,email:'owner@example.test',path:'/assignments',method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}});
 assert.equal((await f.run({actor:operator,email:'owner@example.test',path,method:'POST',data:{baseRevision:1,decision:'approve',checks:checklist}})).status,403);
 f.db0.prepare('UPDATE bank_questions SET revision=revision+1 WHERE id=?').run(questionId);
 assert.equal((await f.run({path,method:'POST',data:{baseRevision:1,decision:'approve',checks:checklist}})).status,409);
 // A rejection is allowed without a source PDF and never authorizes publication.
 assert.equal((await f.run({path,method:'POST',data:{baseRevision:2,decision:'reject',checks:{}}})).status,201);
 f.db0.close();
});

test('revoking a reviewer blocks reads and fresh approvals and is audited',async()=>{
 const f=fixture();
 const grant={actor:operator,email:'owner@example.test',path:'/assignments',method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}};
 assert.equal((await f.run(grant)).status,201);
 assert.deepEqual((await f.run()).body.projects.map(p=>p.id),[projectId]);
 const revoked=await f.run({...grant,method:'DELETE'});
 assert.equal(revoked.status,200);
 assert.equal(revoked.body.revoked,true);
 assert.equal(revoked.body.previousApprovalsInvalidated,true);
 assert.deepEqual((await f.run()).body.projects,[]);
 const path='/projects/'+projectId+'/questions/'+questionId;
 assert.equal((await f.run({path,method:'POST',data:{baseRevision:1,decision:'approve',checks:checklist}})).status,404);
 const events=f.db0.prepare("SELECT action FROM security_audit WHERE action='reviewer_revoke'").all();
 assert.equal(events.length,1);
 f.db0.close();
});

test('a reviewer re-grant gets a new immutable generation; decisions cannot reuse the old grant',async()=>{
 const f=fixture();
 const args={actor:operator,email:'owner@example.test',path:'/assignments',method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}};
 assert.equal((await f.run(args)).status,201);
 const first=f.db0.prepare('SELECT grant_id FROM bank_project_reviewers WHERE project_id=?').get(projectId)?.grant_id;
 assert.match(first,/^[a-f0-9-]{36}$/i);
 assert.equal((await f.run({...args,method:'DELETE'})).status,200);
 assert.equal((await f.run(args)).status,201);
 const second=f.db0.prepare('SELECT grant_id FROM bank_project_reviewers WHERE project_id=?').get(projectId)?.grant_id;
 assert.match(second,/^[a-f0-9-]{36}$/i);
 assert.notEqual(first,second);
 const reviewed=await f.run({path:'/projects/'+projectId+'/questions/'+questionId,method:'POST',data:{baseRevision:1,decision:'reject',checks:{}}});
 assert.equal(reviewed.status,201);
 assert.equal(f.db0.prepare('SELECT grant_id FROM bank_review_events WHERE question_id=?').get(questionId).grant_id,second);
 f.db0.close();
});

test('approval rejects malformed scientificPending values before writing review events',async()=>{
 const f=fixture(),path='/projects/'+projectId+'/questions/'+questionId;
 const assignment={actor:operator,email:'owner@example.test',path:'/assignments',method:'POST',data:{projectId,reviewerEmail:'reviewer@example.test'}};
 assert.equal((await f.run(assignment)).status,201);
 f.db0.prepare("INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)")
  .run(projectId,operator,sourceDigest,'application/pdf','question_pdf','private-assets/'+operator+'/'+sourceDigest+'.pdf',90);
 const update=f.db0.prepare('UPDATE bank_questions SET content_json=? WHERE id=?');
 const base={questionText:'Test question',operatorConfirmed:true,sourceDigest};
 const cases=[
  ['missing',undefined],['null',null],['string zero','0'],['negative',-1],
  ['boolean false',false],['fractional',0.5],['array',[]]
 ];
 for(const [label,value] of cases){
  const content={...base};
  if(value!==undefined)content.scientificPending=value;
  update.run(JSON.stringify(content),questionId);
  const response=await f.run({path,method:'POST',data:{baseRevision:1,decision:'approve',checks:checklist}});
  assert.equal(response.status,422,label);
  assert.equal(response.body.error,'OPERATOR_OR_SOURCE_NOT_VERIFIED',label);
 }
 assert.equal(f.db0.prepare('SELECT count(*) AS n FROM bank_review_events').get().n,0);
 update.run(JSON.stringify({...base,scientificPending:0}),questionId);
 const valid=await f.run({path,method:'POST',data:{baseRevision:1,decision:'approve',checks:checklist}});
 assert.equal(valid.status,201);
 assert.equal(valid.body.autoPublish,false);
 assert.equal(f.db0.prepare('SELECT count(*) AS n FROM bank_review_events').get().n,1);
 f.db0.close();
});

test('bounded reviewer assignment JSON rejects oversized bodies before audit writes',async()=>{
 const f=fixture(),u=new URL('https://preview.example/api/v1/reviews/assignments');
 const payload=JSON.stringify({projectId,reviewerEmail:'reviewer@example.test'});
 const call=async(body,extraHeaders={},duplex=false)=>{
  const req=new Request(u,{method:'POST',headers:{'Content-Type':'application/json',...extraHeaders},
   body,...(duplex?{duplex:'half'}:{})});
  const res=await handleReviewApi(req,f.env,{email:'owner@example.test'},operator,u);
  return {status:res.status,data:await res.json()};
 };
 const valid=await call(payload.padEnd(512,' '));
 assert.equal(valid.status,201);
 assert.equal((await call(payload.padEnd(513,' '))).status,413);
 assert.equal((await call(payload,{'Content-Length':'513'})).status,413);
 assert.equal((await call(payload,{'Content-Length':'not-a-number'})).status,413);
 const streamed=new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(500)))},
  pull(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(20)));controller.close()}
 });
 const streamedResult=await call(streamed,{},true);
 assert.equal(streamedResult.status,413);
 assert.equal(streamedResult.data.error,'BODY_TOO_LARGE');
 assert.equal(f.db0.prepare("SELECT count(*) AS n FROM security_audit WHERE action='reviewer_assign'").get().n,1);
 f.db0.close();
});

test('bounded review decision JSON accepts 4096 bytes but rejects overflow without a review event',async()=>{
 const f=fixture();
 const grant=await f.run({actor:operator,email:'owner@example.test',path:'/assignments',method:'POST',
  data:{projectId,reviewerEmail:'reviewer@example.test'}});
 assert.equal(grant.status,201);
 const u=new URL('https://preview.example/api/v1/reviews/projects/'+projectId+'/questions/'+questionId);
 const payload=JSON.stringify({baseRevision:1,decision:'reject',checks:{}});
 const call=async(body,extraHeaders={})=>{
  const req=new Request(u,{method:'POST',headers:{'Content-Type':'application/json',...extraHeaders},body});
  const res=await handleReviewApi(req,f.env,{email:'reviewer@example.test'},reviewer,u);
  return {status:res.status,data:await res.json()};
 };
 assert.equal((await call(payload.padEnd(4096,' '))).status,201);
 const tooLarge=await call(payload.padEnd(4097,' '));
 assert.equal(tooLarge.status,413);
 assert.equal(tooLarge.data.error,'BODY_TOO_LARGE');
 assert.equal((await call(payload,{'Content-Length':'4097'})).status,413);
 assert.equal((await call('{')).status,400);
 assert.equal(f.db0.prepare('SELECT count(*) AS n FROM bank_review_events').get().n,1);
 assert.equal(f.db0.prepare("SELECT count(*) AS n FROM security_audit WHERE action='question_review_attempt'").get().n,1);
 f.db0.close();
});
