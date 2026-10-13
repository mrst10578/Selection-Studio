/* ZH-79 | Operator-only, offline-safe question intelligence.
 * Scores and taxonomy labels are suggestions, never publication decisions.
 * No network, paid model calls or canonical data writes happen here. */
const digitMap = '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
const maxText = (value, length = 16000) => typeof value === 'string' ? value.slice(0, length) : '';
export function normalizeQuestionText(value) {
  return maxText(value).normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g, char => String(digitMap.indexOf(char) % 10))
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u064B-\u065F\u0670\u200c\u200e\u200f]/g, '')
    .replace(/[−‐‑‒–—]/g, '-')
    .replace(/[٫]/g, '.').replace(/[،؛؟!؛:؛،\u002c]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const tokens = s => normalizeQuestionText(s).match(/[\p{L}\p{N}]+(?:[.\-^][\p{L}\p{N}]+)*/gu) || [];
function grams(value) {
  const str = normalizeQuestionText(value).replace(/\s+/g, ' ');
  const out = new Set();
  for (let i = 0; i <= str.length - 3; i++) out.add(str.slice(i, i + 3));
  return out;
}
function setDice(a, b) {
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return 2 * intersection / (a.size + b.size);
}
const criticalNumbers = str => (normalizeQuestionText(str).match(/(?<![\p{L}\p{N}])[-+]?\d+(?:[.]\d+)?(?:\s*\^\s*[-+]?\d+)?/gu) || []).sort();
const negations = str => (normalizeQuestionText(str).match(/(?:\bnot\b|\bexcept\b|نیست|نادرست|غلط|نمی|نباید|بجز|به جز|مگر)/gu) || []).sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function questionSimilarity(first, second) {
  const a = normalizeQuestionText(first), b = normalizeQuestionText(second);
  if (!a || !b) return {score:0, identical:false, flags:['missing_text'], reviewRequired:true};
  const word = setDice(new Set(tokens(a)), new Set(tokens(b)));
  const char = setDice(grams(a), grams(b));
  const identical = a === b;
  const flags = [];
  if (!same(criticalNumbers(a),criticalNumbers(b))) flags.push('numerical_difference');
  if (!same(negations(a),negations(b))) flags.push('negation_difference');
  // Numeric or negation differences can flip the correct answer despite strong lexical similarity.
  const score = identical ? 1 : Math.min(0.999,Math.max(0,(0.6 * char + 0.4 * word)));
  return {score:Number(score.toFixed(4)),identical,flags,reviewRequired:true};
}
export function findDuplicateCandidates(question, records, {limit=12, threshold=0.56, scope=null}={}) {
  if (!Array.isArray(records)) return [];
  const cap = Number.isInteger(limit) ? Math.max(1,Math.min(limit,30)) : 12;
  const floor = Number.isFinite(threshold) ? Math.max(0.4,Math.min(threshold,1)) : 0.56;
  const results = [];
  for (const record of records.slice(0,5000)) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id || record.deleted || record.status === 'deleted') continue;
    if (scope !== null && record.projectId !== scope) continue;
    if (question?.id && question.id === record.id) continue;
    const match = questionSimilarity(question?.text,record.text);
    if (match.score >= floor) results.push({id:record.id,score:match.score,identical:match.identical,flags:match.flags,status:'suggested_for_operator_review'});
  }
  return results.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,cap);
}
export function suggestTaxonomy(text, catalog, {limit=5}={}) {
  if (!Array.isArray(catalog)) return [];
  const corpus = ' ' + normalizeQuestionText(text) + ' ';
  if (corpus.length < 8) return [];
  const results=[];
  for(const entry of catalog.slice(0,2000)) {
    if(!entry || typeof entry.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id)) continue;
    const words = [entry.name,...(Array.isArray(entry.keywords)?entry.keywords:[])].filter(s=>typeof s==='string').slice(0,25);
    const matched = [];
    for(const raw of words) {
      const normalized=normalizeQuestionText(raw);
      if(normalized.length<3 || normalized.length>90) continue;
      if(corpus.includes(' '+normalized+' ') && !matched.includes(normalized)) matched.push(normalized);
    }
    if(matched.length) results.push({id:entry.id,label:maxText(entry.name,90),matched:matched.slice(0,8),strength:Math.min(1,matched.length/3),status:'suggested_for_operator_review'});
  }
  return results.sort((a,b)=>b.strength-a.strength||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(12,Number.isInteger(limit)?limit:5)));
}
export function compareModelDrafts(left,right) {
  const a=left&&typeof left==='object'?left:{}, b=right&&typeof right==='object'?right:{};
  const text=questionSimilarity(a.text,b.text);
  const latexA=(Array.isArray(a.latex)?a.latex:[]).filter(x=>typeof x==='string').slice(0,18).map(normalizeQuestionText);
  const latexB=(Array.isArray(b.latex)?b.latex:[]).filter(x=>typeof x==='string').slice(0,18).map(normalizeQuestionText);
  const differences=[...text.flags];
  if(!same(latexA,latexB))differences.push('formula_difference');
  if(!text.identical)differences.push('transcription_difference');
  return {textScore:text.score,identical:text.identical&&same(latexA,latexB),differences,reviewRequired:true,status:'awaiting_operator_decision'};
}
export function operatorReviewProposal(proposal,{actor,decision,reason='',sourceRevision}={}) {
  if (!proposal || proposal.status!=='suggested_for_operator_review' && proposal.status!=='awaiting_operator_decision') throw Error('INVALID_PROPOSAL');
  if (typeof actor!=='string'||!actor.trim()||actor.length>128) throw Error('OPERATOR_REQUIRED');
  if(!['accept','reject'].includes(decision)) throw Error('EXPLICIT_DECISION_REQUIRED');
  if(!Number.isSafeInteger(sourceRevision)||sourceRevision<1)throw Error('REVISION_REQUIRED');
  return {proposal:{...proposal},actor,decision,reason:maxText(reason,600),sourceRevision,
    reviewedAt:new Date().toISOString(),status:'operator_decision_recorded',autoPublish:false};
}
