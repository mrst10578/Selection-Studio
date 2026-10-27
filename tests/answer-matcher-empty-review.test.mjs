import test from 'node:test';
import assert from 'node:assert/strict';
import {matchExamAnswers,explicitMatchReview} from '../engine/answer-matcher.js';

const options={actor:'operator_123',sourceFingerprint:'pdf_aaaaaaaaaaaaaaaa'};

test('operator cannot record a review with zero accepted pairs',()=>{
 const matched=matchExamAnswers([{number:1,text:'سؤال'}],[{number:1,text:'پاسخ'}]);
 assert.throws(()=>explicitMatchReview(matched,{...options,acceptedNumbers:[]}),/INVALID_REVIEW/);
});
test('operator cannot mark an empty import as reviewed',()=>{
 assert.throws(()=>explicitMatchReview(matchExamAnswers([],[]),{...options,acceptedNumbers:[]}),/INVALID_REVIEW/);
});
test('a valid selected pair remains explicitly reviewable without auto-publish',()=>{
 const matched=matchExamAnswers([{number:1,text:'سؤال'}],[{number:1,text:'پاسخ'}]);
 const result=explicitMatchReview(matched,{...options,acceptedNumbers:[1]});
 assert.deepEqual(result.accepted,[1]);assert.equal(result.autoPublish,false);
});
