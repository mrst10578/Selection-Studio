import test from 'node:test';
import assert from 'node:assert/strict';
import {searchApprovedBank,preparePublicationIntent} from '../engine/bank-search-publish.js';
const r={id:'Q-3',revision:3,reviewStatus:'approved',state:'reviewed',scientificPending:0,subject:'ریاضی',questionText:'مقدار ۲ چیست؟',reviewEvidence:{reviewer:'rev1',operator:'op1',sourceRevision:3,decision:'approve'}};
test('approved searchable bank filters query and hides draft or soft-deleted rows',()=>{
 const items=[r,{...r,id:'Q-4',deleted:true},{...r,id:'Q-5',state:'draft'}];
 assert.deepEqual(searchApprovedBank(items,{query:'2',subject:'ریاضی'}).map(x=>x.id),['Q-3']);
});
test('publication intent rejects unapproved content, stale reviewers and missing explicit confirmation',()=>{
 assert.throws(()=>preparePublicationIntent([r],{target:'telegram',actor:'operatorA'}),/EXPLICIT_CONFIRMATION_REQUIRED/);
 assert.throws(()=>preparePublicationIntent([{...r,reviewEvidence:{...r.reviewEvidence,sourceRevision:2}}],{target:'loprax',actor:'operatorA',confirmation:'CONFIRM_PUBLICATION_PREVIEW'}),/INVALID_REVIEW_EVIDENCE/);
 assert.throws(()=>preparePublicationIntent([{...r,state:'draft'}],{target:'telegram',actor:'operatorA',confirmation:'CONFIRM_PUBLICATION_PREVIEW'}),/UNAPPROVED_QUESTION/);
});
test('accepted preview is not an external publication action',()=>{
 const out=preparePublicationIntent([r],{target:'telegram',actor:'operatorA',confirmation:'CONFIRM_PUBLICATION_PREVIEW'});
 assert.equal(out.dispatched,false);assert.equal(out.items[0].revision,3);
 assert.equal(Object.hasOwn(out,'token'),false);
});

test('bank search hides records with missing or malformed scientific pending counters',()=>{
 for(const value of [undefined,null,'0',NaN,-1,1]){
  const row={...r,scientificPending:value};
  assert.deepEqual(searchApprovedBank([row]),[],`pending=${String(value)} must not be searchable`);
 }
 assert.deepEqual(searchApprovedBank([r]).map(row=>row.id),['Q-3']);
});
test('publication preview rejects malformed scientific pending counters',()=>{
 const options={target:'telegram',actor:'operatorA',confirmation:'CONFIRM_PUBLICATION_PREVIEW'};
 for(const value of [undefined,null,'0',NaN,-1,1]){
  assert.throws(
   ()=>preparePublicationIntent([{...r,scientificPending:value}],options),
   /UNAPPROVED_QUESTION/,
   `pending=${String(value)} must not pass review gate`,
  );
 }
 const out=preparePublicationIntent([r],options);
 assert.equal(out.dispatched,false);
});

test('approved search omits records with unusable question IDs or revisions',()=>{
 const bad=[
  {...r,id:undefined}, {...r,id:''}, {...r,id:'  '}, {...r,id:123},
  {...r,revision:undefined}, {...r,revision:0}, {...r,revision:-1},
  {...r,revision:1.5}, {...r,revision:'3'}, {...r,revision:NaN},
 ];
 assert.deepEqual(searchApprovedBank([...bad,r]).map(x=>x.id),['Q-3']);
});

test('bank search ignores Arabic tashkeel and tatweel on either side of the query',()=>{
 const vocalized={...r,id:'Q-AR-1',subject:'عَرَبِيّ',questionText:'تَحْلِیل قــانون چیست؟'};
 const plain={...r,id:'Q-AR-2',subject:'عربی',questionText:'تحلیل قانون چیست؟'};
 const unapproved={...vocalized,id:'Q-AR-3',reviewStatus:'pending'};
 assert.deepEqual(
  searchApprovedBank([vocalized,unapproved],{query:'تحلیل قانون',subject:'عربی'}).map(x=>x.id),
  ['Q-AR-1'],
 );
 assert.deepEqual(
  searchApprovedBank([plain],{query:'تَحْلِیل قــانون',subject:'عَرَبِيّ'}).map(x=>x.id),
  ['Q-AR-2'],
 );
 assert.deepEqual(
  searchApprovedBank([plain],{query:'تحلیل زیست',subject:'عربی'}),
  [],
 );
});
