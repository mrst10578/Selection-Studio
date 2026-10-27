import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuestionText,questionSimilarity,findDuplicateCandidates,suggestTaxonomy,compareModelDrafts,operatorReviewProposal} from '../studio/question-intelligence.js';
test('Persian/Arabic digits and letter variants normalize without changing scientific signs',()=>{
 assert.equal(normalizeQuestionText('كدام يک: ۲−۳٫۵ ؟'),'کدام یک 2-3.5');
 assert.equal(questionSimilarity('کدام فلز دارای عدد ۲ است؟','كدام فلز داراي عدد ٢ است؟').identical,true);
 assert.ok(questionSimilarity('عدد -۲','عدد ۲').flags.includes('numerical_difference'));
});
test('strong lexical overlap cannot override changes to negation, answers or exponents',()=>{
 const a=questionSimilarity('کدام مورد درست است؟','کدام مورد درست نیست؟');
 assert.ok(a.flags.includes('negation_difference'));
 assert.equal(a.reviewRequired,true);
 const b=compareModelDrafts({text:'۲+۲',latex:['x^2']},{text:'۲+۳',latex:['x^3']});
 assert.ok(b.differences.includes('numerical_difference'));
 assert.ok(b.differences.includes('formula_difference'));
 assert.equal(b.status,'awaiting_operator_decision');
});
test('duplicate finder is scoped, bounded, deterministic and excludes soft-deleted records',()=>{
 const records=[{id:'q1',projectId:'p1',text:'عدد ۲ چقدر است؟'},
  {id:'q2',projectId:'p2',text:'عدد ۲ چقدر است؟'},
  {id:'q3',projectId:'p1',text:'عدد ۲ چقدر است؟',deleted:true},
  {id:'q4',projectId:'p1',text:'عدد ۳ چقدر است؟'}];
 const candidates=findDuplicateCandidates({id:'new',text:'عدد ۲ چقدر است؟'},records,{scope:'p1',threshold:.7});
 assert.deepEqual(candidates.map(x=>x.id),['q1','q4']);
 assert.ok(candidates[1].flags.includes('numerical_difference'));
 assert.equal(candidates[0].status,'suggested_for_operator_review');
});
test('taxonomy proposals come only from supplied whitelist, and operator must explicitly decide',()=>{
 const catalog=[{id:'bio-01',name:'زیست شناسی',keywords:['میتوکندری','سلول']},
  {id:'chem-02',name:'شیمی',keywords:['پیوند یونی']}];
 const matches=suggestTaxonomy('میتوکندری در سلول چه نقشی دارد؟',catalog);
 assert.deepEqual(matches.map(x=>x.id),['bio-01']);
 assert.throws(()=>operatorReviewProposal(matches[0],{actor:'operator',sourceRevision:2}),/EXPLICIT_DECISION_REQUIRED/);
 const evidence=operatorReviewProposal(matches[0],{actor:'operator',decision:'accept',sourceRevision:2});
 assert.equal(evidence.autoPublish,false);
 assert.equal(evidence.status,'operator_decision_recorded');
});
