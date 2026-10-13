import test from 'node:test';import assert from 'node:assert/strict';
import {createOfflineEditQueue,summarizeRevisionTimeline} from '../studio/offline-revisions.js';
const draft=()=>({projectId:'project_1',questionId:'question_1',baseRevision:3,content:{questionText:'عدد -۲'},sourceFingerprint:'source_abc'});
test('staging is local-only, bounded and defensive against external mutation',()=>{
 const q=createOfflineEditQueue({max:1}),x=q.stage(draft());
 assert.equal(x.status,'local_only');assert.throws(()=>q.stage(draft()),/OFFLINE_QUEUE_FULL/);
 const copy=q.pending();copy[0].content.questionText='tamper';assert.equal(q.pending()[0].content.questionText,'عدد -۲');
});
test('optimistic revision conflict prevents silent overwrite of remote edits',()=>{
 const q=createOfflineEditQueue(),a=q.stage(draft());
 assert.equal(q.reconcile({editId:a.editId,serverRevision:4,serverFingerprint:'source_abc'}).status,'conflict');
 assert.equal(q.reconcile({editId:a.editId,serverRevision:3,serverFingerprint:'changed_pdf'}).requiresManualMerge,true);
 assert.equal(q.reconcile({editId:a.editId,serverRevision:3,serverFingerprint:'source_abc'}).status,'safe_to_submit');
 assert.equal(q.remove(a.editId),true);assert.deepEqual(q.pending(),[]);
});
test('timeline lists revisions without leaking content or pretending to sync',()=>{
 const records=summarizeRevisionTimeline([{revision:1,content:'secret'},{revision:3,deleted:true},{revision:2}]);
 assert.deepEqual(records.map(x=>x.revision),[3,2,1]);assert.equal(Object.hasOwn(records[2],'content'),false);
});
