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

test('A4 export keeps questions first and prints answer key on its own page',()=>{
 const exam=composeApprovedExam([approved('q2','سؤال دوم'),approved('q1','سؤال اول')],{title:'آزمون < امن',includeAnswers:true});
 const html=exportExamHTML(exam);
 assert.ok(html.includes('@page{size:A4'));
 assert.ok(html.includes('class="answer-key"'));
 assert.ok(html.includes('break-before:page'));
 assert.ok(html.indexOf('سؤال 2')<html.indexOf('پاسخ 1'));
 assert.ok(html.indexOf('پاسخ 1')<html.indexOf('پاسخ 2'));
 assert.ok(html.includes('آزمون &lt; امن'));
 assert.equal(html.match(/class="answer"/g).length,2);
 const noAnswers=exportExamHTML(composeApprovedExam([approved('q1')],{includeAnswers:false}));
 assert.ok(!noAnswers.includes('class="answer-key"'));
});

test('A4 HTML wraps long unbroken tokens without changing question, answer or title',()=>{
 const token='A'.repeat(500);
 const exam=composeApprovedExam([{...approved('long',token),answerText:token}],{title:token.slice(0,100),includeAnswers:true});
 const html=exportExamHTML(exam);
 assert.match(html,/body\{[^}]*overflow-wrap:anywhere/);
 assert.ok(html.includes('<h1>'+token.slice(0,100)+'</h1>'));
 assert.ok(html.includes('<div>'+token+'</div>'));
 assert.equal((html.match(new RegExp(token,'g'))||[]).length,2);
});
