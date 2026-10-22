import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNumberedBlocks, matchExamAnswers } from '../../engine/answer-matcher.js';

test('parses Persian question numbers followed by a colon', () => {
  const {blocks, warnings} = parseNumberedBlocks('سؤال ۱: کدام گزینه درست است؟\nسؤال ۲: پاسخ را بنویسید');
  assert.deepEqual(blocks.map(({number,text}) => ({number,text})), [
    {number:1,text:'کدام گزینه درست است؟'},
    {number:2,text:'پاسخ را بنویسید'},
  ]);
  assert.deepEqual(warnings, []);
});

test('parses numbered lines separated by a dash without losing continuation lines', () => {
  const {blocks,warnings} = parseNumberedBlocks('۱- متن سؤال\nادامه سؤال\n۲– سؤال بعدی');
  assert.deepEqual(blocks.map(({number,text}) => ({number,text})), [
    {number:1,text:'متن سؤال\nادامه سؤال'},
    {number:2,text:'سؤال بعدی'},
  ]);
  assert.deepEqual(warnings, []);
});

test('accepts English labels and Arabic-Indic digits with colon separators', () => {
  const {blocks} = parseNumberedBlocks('Question ١: first\nAnswer ٢: second', {kind:'answer'});
  assert.deepEqual(blocks.map(({number,text}) => ({number,text})), [
    {number:1,text:'first'},
    {number:2,text:'second'},
  ]);
});

test('preserves existing dotted and parenthesized numbering', () => {
  const {blocks,warnings} = parseNumberedBlocks('۱. قدیمی\n(۲) دوم');
  assert.deepEqual(blocks.map(x=>x.number), [1,2]);
  assert.deepEqual(warnings, []);
});

test('keeps duplicate-number warnings and prevents automatic publication', () => {
  const {blocks,warnings} = parseNumberedBlocks('۱: اول\n۱: تکراری');
  assert.deepEqual(blocks.map(x=>x.number), [1,1]);
  assert.ok(warnings.some(w=>w.type==='duplicate_number'&&w.number===1));
  const result=matchExamAnswers(blocks,[{number:1,text:'پاسخ'}]);
  assert.equal(result.publishable,false);
  assert.equal(result.verified,false);
  assert.equal(result.matches[0].status,'needs_correction');
});
