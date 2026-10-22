import test from 'node:test';
import assert from 'node:assert/strict';
import {matchExamAnswers} from '../../engine/answer-matcher.js';

const validQuestion = {number:1,text:'سؤال یک'};
const validAnswer = {number:1,text:'گزینه ب'};

test('rejects malformed question entries instead of silently dropping them', () => {
  for (const bad of [null,{}, {number:0,text:'bad'}, {number:'2',text:'bad'}, {number:10000,text:'bad'}, {number:2,text:null}]) {
    assert.throws(() => matchExamAnswers([validQuestion,bad],[validAnswer]), /INVALID_MATCH_RECORD/);
  }
});

test('rejects malformed answer entries instead of reporting misleading missing answers', () => {
  assert.throws(() => matchExamAnswers([validQuestion],[validAnswer,{number:2,text:undefined}]), /INVALID_MATCH_RECORD/);
});

test('keeps valid duplicate-number warnings and review gates unchanged', () => {
  const result=matchExamAnswers([validQuestion,{...validQuestion,text:'دوباره'}],[validAnswer]);
  assert.equal(result.matches[0].status,'needs_correction');
  assert.deepEqual(result.matches[0].problems,['duplicate_questions']);
  assert.equal(result.publishable,false);
});

test('keeps the 1000-entry boundary and refuses larger arrays', () => {
  const items=Array.from({length:1000},(_,i)=>({number:i+1,text:'q'}));
  assert.equal(matchExamAnswers(items,[]).matches.length,1000);
  assert.throws(()=>matchExamAnswers([...items,{number:1001,text:'q'}],[]),/TOO_MANY_MATCH_INPUTS/);
});
