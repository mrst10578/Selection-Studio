import {test,expect} from '@playwright/test';
const IMAGE='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP8//8/AymAiSTVoxpGNQwpDQBVbQMdPVIhQwAAAABJRU5ErkJggg==';
async function open(page){
 await page.goto('/review-console/ocr-studio.html');
 await expect(page.locator('#extractBtn')).toBeVisible();
}
function fixture(stem='کدام گزینه نادرست است؟ $x^2 + ۳$',number='۱۲'){
 return {questions:[{number,stem,options:[{label:'۱',text:'۲٫۵'},{label:'۲',text:'گزینه دوم'},{label:'۳',text:'گزینه سوم'},{label:'۴',text:'گزینه چهارم'}],extras:[],figure_required:false,uncertainties:[],confidence:'high'}],page_notes:''};
}
async function inputImage(page){
 await page.locator('#images').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(IMAGE,'base64')});
 await expect(page.locator('#questionList .ocr-list-row')).toHaveCount(1);
}
test.describe('ZH-75: structured OCR and safe live math',()=>{
 test('strict structured parser preserves Persian, Latin numerals, negation and LaTeX without guessing',async({page})=>{
  await open(page);
  const result=await page.evaluate(async()=>{
   const pipeline=await import('/review-console/ocr-pipeline.js');
   const object={questions:[{number:'۱۲',stem:'کدام گزینه نیست؟ $\\frac{۳}{x^2}$',options:[{label:'الف',text:'12.5'},{label:'ب',text:'x_2'}],extras:[],uncertainties:[],confidence:'medium',figure_required:false}],page_notes:''};
   const document=pipeline.parseOcrResponse({result:{choices:[{message:{content:JSON.stringify(object)}}]}});
   const text=pipeline.formatOcrQuestion(document.questions[0]);
   const tokens=pipeline.tokenizeMath(text);
   const warnings=pipeline.inspectOcrQuestion(document.questions[0]);
   let bad=false;try{pipeline.parseOcrResponse({result:{response:'no json'}})}catch{bad=true}
   return {text,tokens,warnings,invalidRejected:bad,verifyPrompt:pipeline.buildOcrPrompt('verify',text),diff:pipeline.inspectCriticalChanges('نیست ۱۲','هست ۱۳')};
  });
  expect(result.text).toContain('نیست');
  expect(result.text).toContain('12.5');
  expect(result.tokens.some(x=>x.type==='math'&&x.value.includes('frac'))).toBe(true);
  expect(result.warnings.some(x=>x.includes('تعداد گزینه'))).toBe(true);
  expect(result.warnings.some(x=>x.includes('نفی'))).toBe(true);
  expect(result.invalidRejected).toBe(true);
  expect(result.verifyPrompt).toContain('UNTRUSTED');
  expect(result.diff.some(x=>x.includes('اعداد'))).toBe(true);
 });
 test('live text preview never executes model HTML, and KaTeX receives trust:false',async({page})=>{
  await open(page);
  const result=await page.evaluate(async()=>{
   const {renderLiveMath}=await import('/review-console/ocr-live-math.js');
   const host=document.createElement('div');document.body.append(host);
   const observations=[];
   window.katex={render:(formula,node,opts)=>{observations.push({formula,trust:opts.trust});node.textContent='Rendered:'+formula}};
   await renderLiveMath(host,'متن <img src=x onerror=alert(1)> و $x^2$');
   return {htmlImage:host.querySelector('img')!==null,text:host.textContent,observations};
  });
  expect(result.htmlImage).toBe(false);
  expect(result.text).toContain('<img src=x onerror=alert(1)>');
  expect(result.text).toContain('Rendered:x^2');
  expect(result.observations).toEqual([{formula:'x^2',trust:false}]);
 });
 test('OCR verify and formula passes need explicit approval: reject preserves prior text',async({page})=>{
  await open(page);
  await inputImage(page);
  const modes=[];
  await page.route('**/api/ocr',async route=>{
   const body=route.request().postDataJSON();
   modes.push(body.mode);
   expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
   expect(route.request().headers()['authorization']).toBeUndefined();
   const stage=body.mode;
   const value=stage==='extract'?fixture():stage==='verify'?fixture('کدام گزینه صحیح است؟ $x^2 + ۴$'):fixture('کدام گزینه نادرست است؟ $x^3 + ۳$');
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result:{choices:[{message:{content:JSON.stringify(value)}}]}})});
  });
  await page.locator('#extractBtn').click();
  await expect(page.locator('#questionText')).toHaveValue(/نادرست/);
  await expect(page.locator('#ocrStructurePanel')).toBeVisible();
  await expect(page.locator('#ocrStructureList')).toContainText('گزینه چهارم');
  await expect(page.locator('#liveMathPreview .ocr-math-source')).toHaveCount(1);
  const original=await page.locator('#questionText').inputValue();
  await page.locator('#verifyBtn').click();
  await expect(page.locator('#ocrCandidatePanel')).toBeVisible();
  await expect(page.locator('#ocrCandidateText')).toHaveValue(/صحیح/);
  await expect(page.locator('#ocrDiffWarnings')).toContainText('تغییر');
  expect(await page.locator('#questionText').inputValue()).toBe(original);
  await page.locator('#rejectOcrCandidate').click();
  await expect(page.locator('#ocrCandidatePanel')).toBeHidden();
  expect(await page.locator('#questionText').inputValue()).toBe(original);
  await page.locator('#formulaBtn').click();
  await expect(page.locator('#ocrCandidateText')).toHaveValue(/x\^3/);
  expect(await page.locator('#questionText').inputValue()).toBe(original);
  await page.locator('#acceptOcrCandidate').click();
  await expect(page.locator('#questionText')).toHaveValue(/x\^3/);
  await expect(page.locator('#reviewed')).not.toBeChecked();
  expect(modes).toEqual(['extract','verify','formula']);
 });
 test('manual fallback previews mathematical source and saves review state without AI calls',async({page})=>{
  await open(page);
  let requests=0;
  await page.route('**/api/ocr',async route=>{requests++;await route.abort()});
  await page.locator('#newQuestion').click();
  await page.locator('#questionText').fill('متن دستی: $x^2$ و ⟦نامشخص⟧');
  await expect(page.locator('#ocrStructurePanel')).toBeHidden();
  await expect(page.locator('#liveMathPreview .ocr-math-source')).toHaveCount(1);
  expect(requests).toBe(0);
  await page.locator('#reviewed').check();
  await expect(page.locator('#reviewed')).toBeChecked();
  await page.reload();
  await expect(page.locator('#questionText')).toHaveValue(/متن دستی/);
  await expect(page.locator('#reviewed')).toBeChecked();
 });
 test('OCR errors preserve typed text and project source metadata',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('testbank-studio.records.v1',JSON.stringify([{id:'canonical',source_question_number:42}])));
  await open(page);
  await inputImage(page);
  await page.locator('#questionText').fill('پیش‌نویس دستی');
  await page.route('**/api/ocr',route=>route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Rate limit exceeded'})}));
  await page.locator('#verifyBtn').click();
  await expect(page.locator('#ocrStatus')).toContainText('سهمیه');
  await expect(page.locator('#questionText')).toHaveValue('پیش‌نویس دستی');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('testbank-studio.records.v1')))).toEqual([{id:'canonical',source_question_number:42}]);
 });
});
