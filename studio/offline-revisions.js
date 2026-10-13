/* ZH-84 | Bounded offline edit staging, conflict detection; no automatic sync. */
const text=v=>typeof v==='string'?v.slice(0,16000):'';
const key=/^[A-Za-z0-9_-]{1,80}$/;
export function createOfflineEditQueue({max=20}={}){
 const pending=[];
 const cap=Number.isSafeInteger(max)?Math.max(1,Math.min(max,30)):20;
 return {
  stage({projectId,questionId,baseRevision,content,sourceFingerprint}={}){
   if(!key.test(projectId||'')||!key.test(questionId||'')||!key.test(sourceFingerprint||''))throw Error('INVALID_EDIT_SCOPE');
   if(!Number.isSafeInteger(baseRevision)||baseRevision<1||!content||typeof content!=='object'||Array.isArray(content)||typeof content.questionText!=='string')throw Error('INVALID_EDIT');
   if(pending.length>=cap)throw Error('OFFLINE_QUEUE_FULL');
   const item={editId:crypto.randomUUID(),projectId,questionId,baseRevision,
    content:{questionText:text(content.questionText)},sourceFingerprint,queuedAt:new Date().toISOString(),status:'local_only'};
   pending.push(item);return {...item};
  },
  pending:()=>pending.map(x=>({...x,content:{...x.content}})),
  reconcile({editId,serverRevision,serverFingerprint}={}){
   const item=pending.find(x=>x.editId===editId);if(!item)throw Error('EDIT_NOT_FOUND');
   if(!Number.isSafeInteger(serverRevision)||serverRevision<1)throw Error('INVALID_SERVER_REVISION');
   if(serverRevision!==item.baseRevision||serverFingerprint!==item.sourceFingerprint)return {status:'conflict',editId,clientRevision:item.baseRevision,serverRevision,requiresManualMerge:true};
   return {status:'safe_to_submit',editId,baseRevision:item.baseRevision,requiresManualMerge:false};
  },
  remove:(editId)=>{const index=pending.findIndex(x=>x.editId===editId);if(index<0)return false;pending.splice(index,1);return true;}
 };
}
export function summarizeRevisionTimeline(revisions){
 if(!Array.isArray(revisions))return [];
 return revisions.filter(x=>x&&Number.isSafeInteger(x.revision)&&x.revision>0)
  .slice(0,100).sort((a,b)=>b.revision-a.revision)
  .map(x=>({revision:x.revision,changedAt:typeof x.happenedAt==='string'?x.happenedAt:'',deleted:!!x.deleted}));
}
