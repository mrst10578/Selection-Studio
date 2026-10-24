import test from 'node:test';
import assert from 'node:assert/strict';
import {searchApprovedBank} from '../../engine/bank-search-publish.js';
const approved={id:'q1',revision:1,reviewStatus:'approved',scientificPending:0,state:'reviewed',subject:'زیست‌شناسی',questionText:'چه زمانی می‌شود تقسیم سلولی را دید؟'};

test('Persian bank search matches spaces and half-spaces in both directions',()=>{
 assert.deepEqual(searchApprovedBank([approved],{query:'می شود'}).map(q=>q.id),['q1']);
 assert.deepEqual(searchApprovedBank([{...approved,questionText:'چه زمانی می شود تقسیم سلولی را دید؟'}],{query:'می‌شود'}).map(q=>q.id),['q1']);
});
test('normalization does not bypass approval and deletion filters',()=>{
 const rows=[{...approved,id:'draft',state:'draft'},{...approved,id:'deleted',deleted:true},approved];
 assert.deepEqual(searchApprovedBank(rows,{query:'می شود'}).map(q=>q.id),['q1']);
});
test('Persian and Arabic digits remain searchable',()=>{
 assert.deepEqual(searchApprovedBank([{...approved,questionText:'سؤال ۱۲'}],{query:'سؤال ١٢'}).map(q=>q.id),['q1']);
});
