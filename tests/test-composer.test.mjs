import test from 'node:test';
import assert from 'node:assert/strict';
import {composeApprovedExam,exportExamJSONL,exportExamHTML} from '../engine/test-composer.js';
const approved=(id,question='سؤال ۱')=>({id,revision:2,state:'reviewed',reviewStatus:'approved',scientificPending:0,questionText:question,answerText:'گزینه ۲'});
test('approved questions preserve explicit selection order and clean JSONL',()=>{
 const exam=composeApprovedExam([approved('q2'),approved('q1')],{title:'آزمون زیست',includeAnswers:true});
 assert.deepEqual(exam.items.map(x=>x.id),['q2','q1']);
 assert.deepEqual(exportExamJSONL(exam).trim().split('\n').map(x=>JSON.parse(x).number),[1,2]);
 assert.equal(exam.publishable,false);
});
test('draft, unapproved, duplicated and critical-warning questions cannot be composed',()=>{
 assert.throws(()=>composeApprovedExam([approved('x'),approved('x')]),/DUPLICATE_OR_MISSING_ID/);
 assert.throws(()=>composeApprovedExam([{...approved('x'),state:'draft'}]),/QUESTION_NOT_APPROVED/);
 assert.throws(()=>composeApprovedExam([{...approved('x'),scientificPending:1}]),/QUESTION_NOT_APPROVED/);
});
test('print-ready right-to-left HTML escapes malicious transcription content',()=>{
 const html=exportExamHTML(composeApprovedExam([approved('x','<img src=x onerror=alert(1)>')],{title:'عنوان'}));
 assert.ok(html.includes('dir="rtl"'));assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('<img src=x'));
});
