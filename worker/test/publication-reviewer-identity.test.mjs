import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePublicationIntent} from '../../engine/bank-search-publish.js';

const confirmation = 'CONFIRM_PUBLICATION_PREVIEW';
const options = {target: 'telegram', actor: 'publisher@example.com', confirmation};
const reviewed = (reviewer, operator) => ({
 id: 'q-reviewer-identity', revision: 2, state: 'reviewed',
 reviewStatus: 'approved', scientificPending: 0,
 reviewEvidence: {reviewer, operator, sourceRevision: 2, decision: 'approve'},
});

test('case variants of one reviewer/operator email cannot count as independent approval', () => {
 assert.throws(
  () => preparePublicationIntent([reviewed('Reviewer@Example.com', 'reviewer@example.COM')], options),
  /INVALID_REVIEW_EVIDENCE/,
 );
});

test('identity check trims surrounding whitespace before comparing', () => {
 assert.throws(
  () => preparePublicationIntent([reviewed(' REVIEWER@example.com ', 'reviewer@EXAMPLE.com')], options),
  /INVALID_REVIEW_EVIDENCE/,
 );
});

test('distinct reviewers still produce a non-dispatching preview intent', () => {
 const result = preparePublicationIntent(
  [reviewed('reviewer@example.com', 'operator@example.com')], options,
 );
 assert.equal(result.dispatched, false);
 assert.equal(result.items.length, 1);
 assert.equal(result.status, 'pending_server_reauthorization_and_final_dispatch_approval');
});


test('zero-width or bidi control characters cannot disguise reviewer identity', () => {
 for (const disguised of ['reviewer\u200b@example.com', 'reviewer\u202e@example.com']) {
  assert.throws(() => preparePublicationIntent([reviewed(disguised, 'reviewer@example.com')], options), /INVALID_REVIEW_EVIDENCE/);
 }
});

test('fullwidth Unicode email cannot count as a separate reviewer', () => {
 assert.throws(() => preparePublicationIntent([reviewed('ｒｅｖｉｅｗｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ', 'reviewer@example.com')], options), /INVALID_REVIEW_EVIDENCE/);
});
