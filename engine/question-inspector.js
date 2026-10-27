/* ZH-83 | Fail-closed science/role review gate. No DB or publish side effects. */
const required=['source_verified','transcription_checked','answer_checked','taxonomy_checked'];
export function inspectQuestion(record,evidence={}){
 const blockers=[];
 if(!record||typeof record!=='object'||record.state!=='draft'||!Number.isSafeInteger(record.revision)||record.revision<1)blockers.push('invalid_draft');
 if(typeof record?.content?.questionText!=='string'||!record.content.questionText.trim())blockers.push('missing_question_text');
 for(const field of required)if(evidence[field]!==true)blockers.push('missing_'+field);
 if(record?.figures?.length&&evidence.figures_checked!==true)blockers.push('unreviewed_figures');
 const warnings=Array.isArray(evidence.scientificWarnings)?evidence.scientificWarnings.slice(0,100):[];
 const acknowledged=new Set(Array.isArray(evidence.acknowledgedWarnings)?evidence.acknowledgedWarnings:[]);
 if(warnings.some(w=>w?.severity==='critical'&&!acknowledged.has(w.id)))blockers.push('unresolved_critical_warning');
 if(evidence.duplicateCandidatesPending>0)blockers.push('unreviewed_duplicate_candidates');
 if(evidence.sourceRevision!==record?.revision)blockers.push('stale_revision');
 return {pass:blockers.length===0,blockers:[...new Set(blockers)],next:'human_reviewer_signoff_required',publishable:false};
}
export function confirmQuestionInspection(record,evidence,{reviewer,operator,decision,reason=''}={}){
 const result=inspectQuestion(record,evidence);
 if(!result.pass)throw Error('REVIEW_BLOCKED:'+result.blockers.join(','));
 if(!/^[a-zA-Z0-9_-]{6,128}$/.test(reviewer||'')||!/^[a-zA-Z0-9_-]{6,128}$/.test(operator||''))throw Error('REVIEW_IDENTITIES_REQUIRED');
 if(reviewer===operator)throw Error('SEPARATE_REVIEWER_REQUIRED');
 if(!['approve','reject'].includes(decision))throw Error('EXPLICIT_REVIEW_DECISION_REQUIRED');
 return {questionId:record.id,sourceRevision:record.revision,reviewer,operator,decision,
  reason:typeof reason==='string'?reason.slice(0,500):'',signedAt:new Date().toISOString(),
  status:'review_decision_recorded',canPublish:false};
}
