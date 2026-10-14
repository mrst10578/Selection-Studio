import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handleApprovedBankApi} from '../cloudflare/approved-bank-api.js';
const schemas=await Promise.all(['schema-security.sql','schema-question-bank-v1.sql','schema-private-assets-v1.sql','schema-review-v1.sql'].map(x=>readFile(new URL('../cloudflare/'+x,import.meta.url),'utf8')));
const pid='12345678-1234-1234-1234-123456789012',qid='87654321-1234-1234-1234-123456789012',actor='a'.repeat(32),reviewer='b'.repeat(32),digest='c'.repeat(64);
function f(){
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON;');for(const s of schemas)d.exec(s);
 d.prepare('INSERT INTO bank_projects(id,actor,name) VALUES(?,?,?)').run(pid,actor,'bank');
 const data={questionText:'سؤال تأیید شده ۲؟',answerText:'گزینه ۲',sourceDigest:digest,operatorConfirmed:true,scientificPending:0,sourceNumber:2,taxonomyId:'bio'};
 d.prepare('INSERT INTO bank_questions(id,project_id,actor,content_json) VALUES(?,?,?,?)').run(qid,pid,actor,JSON.stringify(data));
 d.prepare("INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)").run(pid,actor,digest,'application/pdf','question_pdf','private-assets/'+actor+'/'+digest+'.pdf',60);
 d.prepare('INSERT INTO bank_project_reviewers(project_id,reviewer_email_hash,assigned_by) VALUES(?,?,?)').run(pid,'d'.repeat(64),actor);
 const evidence=JSON.stringify({sourceVerified:true,transcriptionVerified:true,answerVerified:true,taxonomyVerified:true,figuresVerified:true,warningsResolved:true});
 d.prepare('INSERT INTO bank_review_events(id,project_id,question_id,source_revision,reviewer_actor,reviewer_email_hash,decision,checklist_json,source_digest) VALUES(?,?,?,?,?,?,?,?,?)').run('11111111-1111-1111-1111-111111111111',pid,qid,1,reviewer,'d'.repeat(64),'approve',evidence,digest);
 const env={SECURITY_DB:{prepare(s){return{bind(...args){const st=d.prepare(s);return{async all(){return {results:st.all(...args)}},async first(){return st.get(...args)??null},async run(){return st.run(...args)}}}}}}};
 const call=async(path,method='GET',body,as=actor)=>{
  const u=new URL('https://preview.example/api/v1/bank'+path);
  const r=await handleApprovedBankApi(new Request(u,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),env,as,u);
  return {status:r.status,data:await r.json()};
 };
 return {d,call};
}
test('only actor-owned and independently reviewed current records are searchable',async()=>{
 const x=f();
 const a=await x.call('/questions?projectId='+pid+'&q=۲');
 assert.equal(a.status,200);assert.deepEqual(a.data.questions.map(z=>z.id),[qid]);
 assert.equal(a.data.questions[0].reviewStatus,'approved');
 assert.deepEqual((await x.call('/questions','GET',undefined,'b'.repeat(32))).data.questions,[]);
 x.d.close();
});
test('operator can only compose version-pinned approved questions as unpublishable manifest',async()=>{
 const x=f();
 const result=await x.call('/exams/compose','POST',{title:'زیست',questionIds:[qid],sourceRevisions:[1],includeAnswers:true});
 assert.equal(result.status,200);assert.equal(result.data.manifest.publishable,false);
 assert.match(result.data.manifestHash,/^[a-f0-9]{64}$/);
 const event=x.d.prepare("SELECT result,detail FROM security_audit WHERE action='exam_draft_compose'").get();
 assert.equal(event.result,'created');assert.ok(event.detail.startsWith(result.data.manifestHash.slice(0,24)));
 assert.equal(result.data.manifest.items[0].answer,'گزینه ۲');
 assert.equal((await x.call('/exams/compose','POST',{title:'آزمون',questionIds:[qid],sourceRevisions:[2],includeAnswers:false})).status,409);
 assert.equal((await x.call('/exams/compose','POST',{title:'آزمون',questionIds:[qid,qid],sourceRevisions:[1,1],includeAnswers:false})).status,400);
 x.d.close();
});
test('a changed revision or later rejection invalidates former approval',async()=>{
 const x=f();
 x.d.prepare("INSERT INTO bank_review_events(id,project_id,question_id,source_revision,reviewer_actor,reviewer_email_hash,decision,checklist_json,source_digest) VALUES(?,?,?,?,?,?,?,?,?)").run('22222222-2222-2222-2222-222222222222',pid,qid,1,reviewer,'d'.repeat(64),'reject','{}',digest);
 assert.equal((await x.call('/questions')).data.questions.length,0);
 x.d.prepare('UPDATE bank_questions SET revision=2 WHERE id=?').run(qid);
 assert.equal((await x.call('/questions')).data.questions.length,0);
 x.d.close();
});

test('unassigned review and incomplete checklist never qualify for exam export',async()=>{
 const x=f();
 x.d.prepare("DELETE FROM bank_project_reviewers WHERE project_id=?").run(pid);
 assert.equal((await x.call('/questions')).data.questions.length,0);
 assert.equal((await x.call('/exams/compose','POST',{title:'باید مسدود شود',questionIds:[qid],sourceRevisions:[1],includeAnswers:false})).status,409);
 x.d.prepare('INSERT INTO bank_project_reviewers(project_id,reviewer_email_hash,assigned_by) VALUES(?,?,?)').run(pid,'d'.repeat(64),actor);
 x.d.prepare("UPDATE bank_review_events SET checklist_json=? WHERE id=?").run(JSON.stringify({sourceVerified:true}), '11111111-1111-1111-1111-111111111111');
 assert.equal((await x.call('/questions')).data.questions.length,0);
 x.d.close();
});
test('tampered reviewer source digest or unconfirmed source cannot be exported',async()=>{
 const x=f();
 x.d.prepare("UPDATE bank_review_events SET source_digest=? WHERE id=?").run('e'.repeat(64),'11111111-1111-1111-1111-111111111111');
 assert.equal((await x.call('/questions')).data.questions.length,0);
 x.d.prepare("UPDATE bank_review_events SET source_digest=? WHERE id=?").run(digest,'11111111-1111-1111-1111-111111111111');
 x.d.prepare('UPDATE bank_questions SET content_json=json_set(content_json, ?, false) WHERE id=?').run('$.operatorConfirmed',qid);
 assert.equal((await x.call('/questions')).data.questions.length,0);
 x.d.close();
});

test('draft exam manifest hash is deterministic and each request leaves an audit trail',async()=>{
 const x=f(),body={title:'زیست',questionIds:[qid],sourceRevisions:[1],includeAnswers:false};
 const first=await x.call('/exams/compose','POST',body),second=await x.call('/exams/compose','POST',body);
 assert.equal(first.status,200);assert.equal(second.status,200);
 assert.equal(first.data.manifestHash,second.data.manifestHash);
 assert.equal(x.d.prepare("SELECT count(*) AS n FROM security_audit WHERE action='exam_draft_compose'").get().n,2);
 x.d.close();
});
