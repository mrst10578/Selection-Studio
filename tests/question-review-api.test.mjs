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
