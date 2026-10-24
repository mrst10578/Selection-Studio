import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNumberedBlocks,matchExamAnswers,explicitMatchReview} from '../engine/answer-matcher.js';
test('Persian and English numbered blocks are extracted without rewriting text',()=>{
 const text='سؤال ۱) کدام گزینه درست است؟\nالف) ۲\nسؤال ۲) مقدار x² را بنویس';
 assert.deepEqual(parseNumberedBlocks(text).blocks.map(x=>x.number),[1,2]);
 assert.ok(parseNumberedBlocks(text).blocks[0].text.includes('الف) ۲'));
 const ans=parseNumberedBlocks('Answer 1) گزینه ب\nAnswer 2) x^2',{kind:'answer'});
 assert.deepEqual(ans.blocks.map(x=>x.number),[1,2]);
});
test('duplicate questions, missing answers and orphan answer numbers remain unresolved',()=>{
 const q=[{number:1,text:'Q1'},{number:1,text:'duplicate Q1'},{number:2,text:'Q2'}];
 const a=[{number:1,text:'A1'},{number:3,text:'A3'}];
 const x=matchExamAnswers(q,a);
 assert.deepEqual(x.matches.map(r=>r.number),[1,2,3]);
 assert.ok(x.matches[0].problems.includes('duplicate_questions'));
 assert.ok(x.matches[1].problems.includes('answer_missing'));
 assert.ok(x.matches[2].problems.includes('question_missing'));
 assert.equal(x.stats.paired,0);assert.equal(x.publishable,false);
});
test('fully paired questions still require explicit per-question operator confirmation',()=>{
 const x=matchExamAnswers([{number:8,text:'مقدار -۲'}],[{number:8,text:'-۲'}]);
 assert.equal(x.matches[0].status,'awaiting_operator_review');assert.equal(x.verified,false);
 assert.throws(()=>explicitMatchReview(x,{actor:'operator',acceptedNumbers:[8],sourceFingerprint:'bad'}),/SOURCE_REQUIRED/);
 const reviewed=explicitMatchReview(x,{actor:'operator',acceptedNumbers:[8],sourceFingerprint:'pdf_aaaaaaaaaaaaaaaa'});
 assert.deepEqual(reviewed.accepted,[8]);assert.equal(reviewed.autoPublish,false);
});
test('cannot confirm unmatched or duplicate numbered entries',()=>{
 const x=matchExamAnswers([{number:1,text:'question'}],[]);
 assert.throws(()=>explicitMatchReview(x,{actor:'operator',acceptedNumbers:[1],sourceFingerprint:'pdf_aaaaaaaaaaaaaaaa'}),/MATCH_MISMATCH/);
 assert.ok(parseNumberedBlocks('1. alpha\n1. beta').warnings.some(x=>x.type==='duplicate_number'));
});
