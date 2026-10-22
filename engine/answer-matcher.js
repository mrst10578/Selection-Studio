/* ZH-82 | Deterministic, non-publishing exam/answer alignment helpers.
 * Expects text already reviewed by an operator. No PDF processing or inference here. */
const digits='۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
export const asciiDigits=s=>String(s??'').replace(/[۰-۹٠-٩]/g,c=>String(digits.indexOf(c)%10));
const safe=s=>typeof s==='string'?s.slice(0,200000):'';
export function parseNumberedBlocks(text,{kind='question',max=500}={}){
 if(!['question','answer'].includes(kind))throw Error('INVALID_BLOCK_KIND');
 if(!Number.isSafeInteger(max)||max<1||max>1000)throw Error('INVALID_BLOCK_LIMIT');
 const lines=safe(text).replace(/\r\n?/g,'\n').split('\n');
 const parts=[],warnings=[];
 const re=/^\s*(?:س[ؤو]ال|پاسخ|Question|Answer|Q)?\s*[#№]?\s*[\(（]?\s*([0-9۰-۹٠-٩]{1,4})\s*[\)）.:：–-]\s*[\.:‌-–]?\s*(.*)$/iu;
 let current=null;
 const finish=()=>{
  if(!current)return;
  current.text=current.text.join('\n').trim();
  if(!current.text)warnings.push({type:'empty_block',number:current.number});
  if(parts.some(x=>x.number===current.number))warnings.push({type:'duplicate_number',number:current.number});
  parts.push(current);
 };
 for(const line of lines){
  const match=re.exec(line);
  const num=match?Number(asciiDigits(match[1])):NaN;
  if(match&&Number.isSafeInteger(num)&&num>0&&num<=9999){
   finish();
   if(parts.length>=max){warnings.push({type:'too_many_blocks'});return {blocks:parts,warnings};}
   current={number:num,text:[match[2]]};
  }else if(current){current.text.push(line)}
  else if(line.trim()){warnings.push({type:'unassigned_prefix'})}
 }
 finish();
 return {blocks:parts,warnings};
}
export function matchExamAnswers(questions,answers){
 if(!Array.isArray(questions)||!Array.isArray(answers))throw Error('INVALID_MATCH_INPUT');
 if(questions.length>1000||answers.length>1000)throw Error('TOO_MANY_MATCH_INPUTS');
 const group=arr=>{const map=new Map();for(const item of arr){
  if(!item||!Number.isSafeInteger(item.number)||item.number<1||item.number>9999||typeof item.text!=='string')throw Error('INVALID_MATCH_RECORD');
  if(!map.has(item.number))map.set(item.number,[]);
  map.get(item.number).push({number:item.number,text:item.text.slice(0,16000)});
 }return map;};
 const q=group(questions),a=group(answers),all=[...new Set([...q.keys(),...a.keys()])].sort((x,y)=>x-y);
 const matches=all.map(number=>{
  const qs=q.get(number)||[],as=a.get(number)||[];
  const problems=[];
  if(qs.length===0)problems.push('question_missing');
  if(as.length===0)problems.push('answer_missing');
  if(qs.length>1)problems.push('duplicate_questions');
  if(as.length>1)problems.push('duplicate_answers');
  return {number,question:qs.length===1?qs[0].text:null,answer:as.length===1?as[0].text:null,
   problems,status:problems.length?'needs_correction':'awaiting_operator_review'};
 });
 return {matches,stats:{questionCount:questions.length,answerCount:answers.length,
  paired:matches.filter(x=>x.status==='awaiting_operator_review').length,
  mismatched:matches.filter(x=>x.problems.length>0).length},verified:false,publishable:false};
}
export function explicitMatchReview(result,{actor,acceptedNumbers,sourceFingerprint}={}){
 if(!result||!Array.isArray(result.matches)||!Array.isArray(acceptedNumbers)||acceptedNumbers.length===0)throw Error('INVALID_REVIEW');
 if(typeof actor!=='string'||!actor.trim()||actor.length>128)throw Error('OPERATOR_REQUIRED');
 if(!/^[a-zA-Z0-9_-]{12,128}$/.test(sourceFingerprint||''))throw Error('SOURCE_REQUIRED');
 const numbers=new Set(acceptedNumbers);
 if(numbers.size!==acceptedNumbers.length||![...numbers].every(n=>Number.isInteger(n)&&n>0))throw Error('INVALID_REVIEW');
 const candidates=result.matches.filter(m=>numbers.has(m.number));
 if(candidates.length!==numbers.size||candidates.some(m=>m.problems.length||m.status!=='awaiting_operator_review'))throw Error('MATCH_MISMATCH');
 return {actor,sourceFingerprint,accepted:[...candidates].sort((a,b)=>a.number-b.number).map(x=>x.number),reviewedAt:new Date().toISOString(),
  status:'operator_reviewed',autoPublish:false};
}
