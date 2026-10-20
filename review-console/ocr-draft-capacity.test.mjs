import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureDraftCapacity, MAX_DRAFT_QUESTIONS} from './ocr-draft-capacity.js';

test('single question is accepted through the 300-item boundary', () => {
  assert.equal(MAX_DRAFT_QUESTIONS, 300);
  assert.doesNotThrow(() => ensureDraftCapacity(0));
  assert.doesNotThrow(() => ensureDraftCapacity(299));
  assert.throws(() => ensureDraftCapacity(300), /۳۰۰/);
});

test('multi-page PDF import checks remaining capacity before rendering', () => {
  assert.doesNotThrow(() => ensureDraftCapacity(250, 50));
  assert.throws(() => ensureDraftCapacity(251, 50), /۳۰۰/);
});

test('invalid counts cannot bypass the guard', () => {
  for (const n of [-1, 1.5, NaN, Infinity]) assert.throws(() => ensureDraftCapacity(n));
  for (const n of [0, -1, 0.5]) assert.throws(() => ensureDraftCapacity(1, n));
});
