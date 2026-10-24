import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handleApprovedBankApi} from '../cloudflare/approved-bank-api.js';
const schemas=await Promise.all(['schema-security.sql','schema-question-bank-v1.sql','schema-private-assets-v1.sql','schema-review-v1.sql'].map(x=>readFile(new URL('../cloudflare/'+x,import.meta.url),'utf8')));
const pid='12345678-1234-1234-1234-123456789012',qid='87654321-1234-1234-1234-123456789012',actor='a'.repeat(32),reviewer='b'.repeat(32),digest='c'.repeat(64),grant='11111111-2222-3333-4444-555555555555';
function f(){
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON;');for(const s of schemas)d.exec(s);
 d.prepare('INSERT INTO bank_projects(id,actor,name) VALUES(?,?,?)').run(pid,actor,'bank');
 const data={questionText:'سؤال تأیید شده ۲؟',answerText:'گزینه ۲',sourceDigest:digest,operatorConfirmed:true,scientificPending:0,sourceNumber:2,taxonomyId:'bio'};
 d.prepare('INSERT INTO bank_questions(id,project_id,actor,content_json) VALUES(?,?,?,?)').run(qid,pid,actor,JSON.stringify(data));
 d.prepare("INSERT INTO bank_assets(project_id,actor,digest,mime,role,object_key,byte_size) VALUES(?,?,?,?,?,?,?)").run(pid,actor,digest,'application/pdf','question_pdf','private-assets/'+actor+'/'+digest+'.pdf',60);
 d.prepare('INSERT INTO bank_project_reviewers(project_id,reviewer_email_hash,assigned_by,grant_id) VALUES(?,?,?,?)').run(pid,'d'.repeat(64),actor,grant);
 const evidence=JSON.stringify({sourceVerified:true,transcriptionVerified:true,answerVerified:true,taxonomyVerified:true,figuresVerified:true,warningsResolved:true});
 d.prepare('INSERT INTO bank_review_events(id,project_id,question_id,source_revision,reviewer_actor,reviewer_email_hash,grant_id,decision,checklist_json,source_digest) VALUES(?,?,?,?,?,?,?,?,?,?)').run('11111111-1111-1111-1111-111111111111',pid,qid,1,reviewer,'d'.repeat(64),grant,'approve',evidence,digest);
 const env={SECURITY_DB:{prepare(s){return{bind(...args){const st=d.prepare(s);return{async all(){return {results:st.all(...args)}},async first(){return st.get(...args)??null},async run(){return st.run(...args)}}}}}}};
 const call=async(path,method='GET',body,as=actor)=>{
  const u=new URL('https://preview.example/api/v1/bank'+path);
  const r=await handleApprovedBankApi(new Request(u,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),env,as,u);
  return {status:r.status,data:await r.json()};
 };
 return {d,call,env};
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
 x.d.prepare("INSERT INTO bank_review_events(id,project_id,question_id,source_revision,reviewer_actor,reviewer_email_hash,grant_id,decision,checklist_json,source_digest) VALUES(?,?,?,?,?,?,?,?,?,?)").run('22222222-2222-2222-2222-222222222222',pid,qid,1,reviewer,'d'.repeat(64),grant,'reject','{}',digest);
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
 x.d.prepare('INSERT INTO bank_project_reviewers(project_id,reviewer_email_hash,assigned_by,grant_id) VALUES(?,?,?,?)').run(pid,'d'.repeat(64),actor,grant);
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

test('revocation then regrant never resurrects approvals signed under an earlier grant',async()=>{
 const x=f();
 assert.equal((await x.call('/questions')).data.questions.length,1);
 x.d.prepare('DELETE FROM bank_project_reviewers WHERE project_id=?').run(pid);
 assert.equal((await x.call('/questions')).data.questions.length,0);
 const newGrant='bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
 x.d.prepare('INSERT INTO bank_project_reviewers(project_id,reviewer_email_hash,assigned_by,grant_id) VALUES(?,?,?,?)').run(pid,'d'.repeat(64),actor,newGrant);
 assert.equal((await x.call('/questions')).data.questions.length,0);
 assert.equal((await x.call('/exams/compose','POST',{title:'blocked',questionIds:[qid],sourceRevisions:[1],includeAnswers:false})).status,409);
 x.d.close();
});

test('bank search accepts Arabic-Indic and Latin digits in Persian questions',async()=>{
 const x=f();
 for(const digit of ['٢','2','۲']){
  const result=await x.call('/questions?projectId='+pid+'&q='+encodeURIComponent(digit));
  assert.equal(result.status,200);
  assert.deepEqual(result.data.questions.map(q=>q.id),[qid], 'search digit '+digit);
 }
 x.d.close();
});

test('server-approved bank rejects malformed scientific pending values for search and compose',async()=>{
 const x=f(),request={title:'زیست',questionIds:[qid],sourceRevisions:[1],includeAnswers:false};
 for(const value of [null,'0',-1,1,false,[]]){
  x.d.prepare("UPDATE bank_questions SET content_json=json_set(content_json,'$.scientificPending',json(?)) WHERE id=?").run(JSON.stringify(value),qid);
  const search=await x.call('/questions');
  assert.equal(search.status,200);
  assert.deepEqual(search.data.questions,[],`value=${JSON.stringify(value)} should be excluded`);
  const compose=await x.call('/exams/compose','POST',request);
  assert.equal(compose.status,409,`value=${JSON.stringify(value)} must not be exportable`);
 }
 x.d.prepare("UPDATE bank_questions SET content_json=json_remove(content_json,'$.scientificPending') WHERE id=?").run(qid);
 assert.deepEqual((await x.call('/questions')).data.questions,[],'missing pending counter must be excluded');
 assert.equal((await x.call('/exams/compose','POST',request)).status,409);
 x.d.prepare("UPDATE bank_questions SET content_json=json_set(content_json,'$.scientificPending',0) WHERE id=?").run(qid);
 assert.deepEqual((await x.call('/questions')).data.questions.map(q=>q.id),[qid]);
 assert.equal((await x.call('/exams/compose','POST',request)).status,200);
 x.d.close();
});

test('exam draft titles reject control and bidi override characters without an audit event',async()=>{
 const x=f(),base={questionIds:[qid],sourceRevisions:[1],includeAnswers:false};
 for(const title of ['آزمون\nنهایی','آزمون\tنهایی','آزمون\u0000نهایی','آزمون\u0085نهایی','آزمون\u2028نهایی','آزمون\u202eنهایی','آزمون\u2066نهایی']){
  const result=await x.call('/exams/compose','POST',{...base,title});
  assert.equal(result.status,400,JSON.stringify(title));
  assert.equal(result.data.error,'INVALID_EXAM_REQUEST');
 }
 assert.equal(x.d.prepare("SELECT count(*) AS n FROM security_audit WHERE action='exam_draft_compose'").get().n,0);
 const valid=await x.call('/exams/compose','POST',{...base,title:'\u200fآزمون زیست‌شناسی ۱۴۰۵'});
 assert.equal(valid.status,200,'legitimate Persian RTL marks and half-spaces must remain valid');
 assert.equal(x.d.prepare("SELECT count(*) AS n FROM security_audit WHERE action='exam_draft_compose'").get().n,1);
 x.d.close();
});

test('server search ignores Arabic diacritics and tatweel without altering approved content',async()=>{
 const x=f();
 const read=()=>JSON.parse(x.d.prepare('SELECT content_json FROM bank_questions WHERE id=?').get(qid).content_json);
 const update=content=>x.d.prepare('UPDATE bank_questions SET content_json=? WHERE id=?').run(JSON.stringify(content),qid);
 const original=read();
 const accented='تَحْلِیل و فـیزیک';
 update({...original,questionText:accented,taxonomyId:'زِيست'});
 for(const query of ['تحلیل','فیزیک','تَحْلِیل']){
  const result=await x.call('/questions?subject='+encodeURIComponent('زیست')+'&q='+encodeURIComponent(query));
  assert.equal(result.status,200,query);
  assert.deepEqual(result.data.questions.map(q=>q.id),[qid],query);
  assert.equal(result.data.questions[0].questionText,accented,'search must not rewrite stored text');
 }
 update({...original,questionText:'تحلیل و فیزیک',taxonomyId:'زیست'});
 assert.deepEqual((await x.call('/questions?q='+encodeURIComponent('تَحْلِیل'))).data.questions.map(q=>q.id),[qid]);
 x.d.prepare("UPDATE bank_review_events SET decision='reject' WHERE question_id=?").run(qid);
 assert.deepEqual((await x.call('/questions?q='+encodeURIComponent('تحلیل'))).data.questions,[],'search must still enforce independent approval');
 x.d.close();
});

test('compose enforces the 12KB byte limit before and during streaming without auditing rejected bodies',async()=>{
 const x=f(),url=new URL('https://preview.example/api/v1/bank/exams/compose');
 const base={title:'زیست',questionIds:[qid],sourceRevisions:[1],includeAnswers:false};
 const send=async request=>{
  const response=await handleApprovedBankApi(request,x.env,actor,url);
  return {status:response.status,data:await response.json()};
 };
 const make=(body,headers={})=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
 const declared=await send(make('{}',{'Content-Length':'12001'}));
 assert.equal(declared.status,413,'oversized declared length must be rejected before reading');
 assert.equal(declared.data.error,'BODY_TOO_LARGE');
 const oversized=await send(make(JSON.stringify(base)+' '.repeat(12001)));
 assert.equal(oversized.status,413,'large bodies without a declared length must also be rejected');
 const streamed=new ReadableStream({start(controller){
  controller.enqueue(new Uint8Array(7000));
  controller.enqueue(new Uint8Array(7000));
  controller.close();
 }});
 const streamedResult=await send(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:streamed,duplex:'half'}));
 assert.equal(streamedResult.status,413,'chunked bodies must be capped while reading');
 assert.equal(x.d.prepare("SELECT count(*) AS n FROM security_audit WHERE action='exam_draft_compose'").get().n,0);
 const raw=JSON.stringify(base);
 const exact=raw+' '.repeat(12000-Buffer.byteLength(raw,'utf8'));
 assert.equal(Buffer.byteLength(exact,'utf8'),12000);
 const accepted=await send(make(exact));
 assert.equal(accepted.status,200,'exactly 12KB of valid JSON should remain accepted');
 assert.equal(x.d.prepare("SELECT count(*) AS n FROM security_audit WHERE action='exam_draft_compose'").get().n,1);
 x.d.close();
});

test('malformed stored question JSON cannot take down healthy approved-bank search or compose',async()=>{
 const x=f(),badId='99999999-1234-1234-1234-123456789012';
 const original=x.d.prepare('SELECT content_json FROM bank_questions WHERE id=?').get(qid).content_json;
 x.d.prepare('INSERT INTO bank_questions(id,project_id,actor,content_json) SELECT ?,project_id,actor,content_json FROM bank_questions WHERE id=?').run(badId,qid);
 const checks=JSON.stringify({sourceVerified:true,transcriptionVerified:true,answerVerified:true,taxonomyVerified:true,figuresVerified:true,warningsResolved:true});
 x.d.prepare('INSERT INTO bank_review_events(id,project_id,question_id,source_revision,reviewer_actor,reviewer_email_hash,grant_id,decision,checklist_json,source_digest) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('99999999-1111-1111-1111-111111111111',pid,badId,1,reviewer,'d'.repeat(64),grant,'approve',checks,digest);
 assert.deepEqual((await x.call('/questions')).data.questions.map(q=>q.id).sort(),[qid,badId].sort());
 for(const malformed of ['{broken','null','[]','"string"']){
  x.d.prepare('UPDATE bank_questions SET content_json=? WHERE id=?').run(malformed,badId);
  const search=await x.call('/questions');
  assert.equal(search.status,200,'search should survive '+malformed);
  assert.deepEqual(search.data.questions.map(q=>q.id),[qid],'healthy question must remain visible');
  const rejected=await x.call('/exams/compose','POST',{title:'draft',questionIds:[badId],sourceRevisions:[1],includeAnswers:false});
  assert.equal(rejected.status,409,'malformed question must not be exported');
 }
 const valid=await x.call('/exams/compose','POST',{title:'draft',questionIds:[qid],sourceRevisions:[1],includeAnswers:false});
 assert.equal(valid.status,200,'unrelated approved question remains exportable');
 x.d.prepare('UPDATE bank_questions SET content_json=? WHERE id=?').run(original,badId);
 assert.deepEqual((await x.call('/questions')).data.questions.map(q=>q.id).sort(),[qid,badId].sort());
 x.d.close();
});

test('approved-bank search matches answer-only keywords while retaining independent review',async()=>{
 const x=f();
 for(const query of ['گزینه','گزينه']){
  const result=await x.call('/questions?projectId='+pid+'&q='+encodeURIComponent(query));
  assert.equal(result.status,200,query);
  assert.deepEqual(result.data.questions.map(q=>q.id),[qid], 'answer-only keyword '+query);
 }
 assert.deepEqual((await x.call('/questions?q='+encodeURIComponent('ناموجود'))).data.questions,[]);
 x.d.prepare("UPDATE bank_review_events SET decision='reject' WHERE question_id=?").run(qid);
 assert.deepEqual((await x.call('/questions?q='+encodeURIComponent('گزینه'))).data.questions,[],
  'matching an answer must not bypass the independent approval gate');
 x.d.close();
});
