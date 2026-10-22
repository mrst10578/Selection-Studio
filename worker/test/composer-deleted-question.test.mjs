import test from 'node:test';
import assert from 'node:assert/strict';
import {composeApprovedExam} from '../../engine/test-composer.js';

const approved = (overrides = {}) => ({
  id: 'question-1',
  revision: 1,
  reviewStatus: 'approved',
  scientificPending: 0,
  state: 'approved',
  questionText: 'متن سؤال',
  answerText: 'پاسخ صحیح',
  ...overrides,
});

test('composer rejects deleted records using the bank deleted flag', () => {
  assert.throws(() => composeApprovedExam([approved({deleted: true})]), /QUESTION_NOT_APPROVED/);
});

test('composer continues to reject soft-deleted records', () => {
  assert.throws(() => composeApprovedExam([approved({softDeleted: true})]), /QUESTION_NOT_APPROVED/);
});

test('composer accepts reviewed active records with either absent or false deletion flags', () => {
  assert.equal(composeApprovedExam([approved()]).items.length, 1);
  assert.equal(composeApprovedExam([approved({deleted: false, softDeleted: false})]).items.length, 1);
});
