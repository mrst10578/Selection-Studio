/* ZH-85 | Search/query and publication intent only. NEVER sends network requests. */
const digits='۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
// Invisible formatting controls must never be accepted in reviewer identities.
const unsafeIdentityControls=/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const identityKey=value=>value.normalize('NFKC').trim().toLowerCase();
const normalize=s=>String(s??'').normalize('NFKC').replace(/[۰-۹٠-٩]/g,c=>String(digits.indexOf(c)%10)).replace(/[\u0640\u064b-\u065f\u0670]/g,'').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[\s\u200c]+/g,' ').trim().toLowerCase();
export function searchApprovedBank(records,{query='',subject='',projectId='',limit=40}={}){
 if(!Array.isArray(records))return [];
 const q=normalize(query),s=normalize(subject),cap=Number.isInteger(limit)?Math.max(1,Math.min(limit,100)):40;
 const results=[];
 for(const row of records.slice(0,10000)){
  if(!row||row.deleted||row.softDeleted||row.reviewStatus!=='approved'||row.scientificPending!==0||row.state==='draft'||typeof row.id!=='string'||!row.id.trim()||!Number.isSafeInteger(row.revision)||row.revision<1)continue;
  if(projectId&&row.projectId!==projectId)continue;
  if(s&&normalize(row.subject)!==s)continue;
  if(q&&!normalize(row.questionText).includes(q))continue;
  results.push({id:row.id,revision:row.revision,subject:row.subject||'',questionText:String(row.questionText||'').slice(0,16000)});
  if(results.length>=cap)break;
 }
 return results;
}
export function preparePublicationIntent(records,{target,actor,confirmation}={}){
 if(!Array.isArray(records)||!records.length||records.length>50)throw Error('INVALID_PUBLICATION_COUNT');
 if(!['loprax','telegram'].includes(target))throw Error('INVALID_PUBLICATION_TARGET');
 if(typeof actor!=='string'||actor.trim().length<6||actor.length>128)throw Error('INVALID_ACTOR');
 if(confirmation!=='CONFIRM_PUBLICATION_PREVIEW')throw Error('EXPLICIT_CONFIRMATION_REQUIRED');
 const ids=new Set(),selections=[];
 for(const r of records){
  if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('INVALID_QUESTION_IDS');
  if(r.reviewStatus!=='approved'||r.state==='draft'||r.deleted||r.softDeleted||r.scientificPending!==0||!Number.isSafeInteger(r.revision)||r.revision<1)throw Error('UNAPPROVED_QUESTION');
  const evidence=r.reviewEvidence;
  if(!evidence||typeof evidence.reviewer!=='string'||!evidence.reviewer.trim()||typeof evidence.operator!=='string'||!evidence.operator.trim()||unsafeIdentityControls.test(evidence.reviewer)||unsafeIdentityControls.test(evidence.operator)||identityKey(evidence.reviewer)===identityKey(evidence.operator)||evidence.sourceRevision!==r.revision||evidence.decision!=='approve')throw Error('INVALID_REVIEW_EVIDENCE');
  ids.add(r.id);selections.push({id:r.id,revision:r.revision});
 }
 return {target,actor,items:selections,createdAt:new Date().toISOString(),status:'pending_server_reauthorization_and_final_dispatch_approval',dispatched:false};
}
