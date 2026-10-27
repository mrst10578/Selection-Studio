import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectQuestion,confirmQuestionInspection} from '../engine/question-inspector.js';
const record={id:'q1',state:'draft',revision:3,content:{questionText:'کدام جمله نادرست است؟'}};
const evidence={source_verified:true,transcription_checked:true,answer_checked:true,taxonomy_checked:true,sourceRevision:3,scientificWarnings:[],duplicateCandidatesPending:0};
test('unreviewed scientific warnings and stale revisions block confirmation',()=>{
 const a=inspectQuestion(record,{...evidence,scientificWarnings:[{id:'minus_changed',severity:'critical'}]});
 assert.ok(a.blockers.includes('unresolved_critical_warning'));assert.equal(a.publishable,false);
 const b=inspectQuestion(record,{...evidence,sourceRevision:2});
 assert.ok(b.blockers.includes('stale_revision'));
});
test('missing source, review and possible duplicate candidates fail closed',()=>{
 const a=inspectQuestion(record,{...evidence,source_verified:false,duplicateCandidatesPending:1});
 assert.ok(a.blockers.includes('missing_source_verified'));
 assert.ok(a.blockers.includes('unreviewed_duplicate_candidates'));
 assert.equal(a.pass,false);
});
test('separate explicit reviewer can sign off without publishing',()=>{
 const result=inspectQuestion(record,evidence);assert.equal(result.pass,true);
 assert.throws(()=>confirmQuestionInspection(record,evidence,{reviewer:'same_id',operator:'same_id',decision:'approve'}),/SEPARATE_REVIEWER_REQUIRED/);
 const a=confirmQuestionInspection(record,evidence,{reviewer:'reviewer_1',operator:'operator_2',decision:'approve'});
 assert.equal(a.canPublish,false);assert.equal(a.sourceRevision,3);
 assert.throws(()=>confirmQuestionInspection(record,evidence,{reviewer:'reviewer_1',operator:'operator_2'}),/EXPLICIT_REVIEW_DECISION_REQUIRED/);
});
