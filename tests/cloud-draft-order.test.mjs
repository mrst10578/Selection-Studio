import test from 'node:test';
import assert from 'node:assert/strict';
import {sameFields} from '../studio/cloud-draft.js';

test('equivalent draft fields are equal regardless of insertion order', () => {
  const local = {subject:'BIO',grade:'11',difficulty:'level_3'};
  const remote = {difficulty:'level_3',subject:'BIO',grade:'11'};
  assert.equal(sameFields(local,remote),true);
});

test('changed values and missing fields still trigger a conflict', () => {
  assert.equal(sameFields({subject:'BIO'},{subject:'PHY'}),false);
  assert.equal(sameFields({subject:'BIO',grade:'11'},{subject:'BIO'}),false);
});

test('empty drafts remain equivalent and undefined values are omitted', () => {
  assert.equal(sameFields(null,{}),true);
  assert.equal(sameFields({subject:undefined},{}),true);
});
