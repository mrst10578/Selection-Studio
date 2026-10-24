import {test,expect} from '@playwright/test';

async function studio(page){
 await page.goto('/studio/');
 await expect(page.locator('#studioOcrPanel')).toBeVisible();
 await expect(page.locator('#operatorLogin')).toBeHidden();
}
async function fixture(page){
 await studio(page);
 await page.evaluate(async()=>{
  const {installOcrWorkbench}=await import('/studio/ocr-panel.js');
  document.querySelector('#studioOcrPanel')?.remove();
  window.__scienceFingerprint='pdf-v1';
  window.__scienceWorkbench=installOcrWorkbench({
   getIdentity:()=>'exam-test:question-1',
   getFingerprint:()=>window.__scienceFingerprint,
   onNotice:msg=>{(window.__scienceNotices??=[]).push(msg)},
   capture:async()=>{
    const canvas=document.createElement('canvas');canvas.width=560;canvas.height=360;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,560,360);
    ctx.fillStyle='#222';ctx.font='26px Arial';
    ctx.fillText('Question: -2.5 x^2',30,65);
    ctx.fillStyle='#0a6380';ctx.fillRect(170,130,240,140);
    ctx.fillStyle='#fff';ctx.fillRect(225,180,140,4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.92));
    return {blob,regions:[{page:4,bbox_norm:[.1,.2,.9,.85]}]};
   }
  });
 });
 return page.locator('#studioOcrPanel').last();
}
const modelResult=obj=>({result:{response:JSON.stringify(obj)}});
async function drawFigure(page,panel){
 const box=panel.locator('.studio-science-figure-overlay');
 await panel.locator('#studioFigureMark').click();
 const rect=await box.boundingBox();
 expect(rect?.width).toBeGreaterThan(100);
 await page.mouse.move(rect.x+rect.width*.25,rect.y+rect.height*.35);
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width*.68,rect.y+rect.height*.76,{steps:6});
 await page.mouse.up();
 await expect(panel.locator('.studio-science-figure-item')).toHaveCount(1);
}
test.describe('ZH-77 critical scientific OCR QA and confirmed figure extraction',()=>{
 test('compares negative signs, negations, decimal values, superscripts and missing options without fake confidence',async({page})=>{
  await studio(page);
  const result=await page.evaluate(async()=>{
   const {scientificWarnings,modelConfidence,safeScientificReview}=await import('/studio/ocr-science.js');
   const first={text:'کدام گزاره نیست؟\n۱) -۲٫۵x²\n۲) ۳\n۳) ۴\n۴) ۵',latex:['x^{2}']};
   const changed=scientificWarnings({
    text:'کدام گزاره است؟\n۱) ۲۵x³\n۲) ۳\n۳) ۴',latex:['x^{3}'],
    kind:'question',previous:first,confidence:.46,
    modelFlags:[{kind:'minus',detail:'علامت منفی ناخواناست'}]
   });
   return {
    warnings:changed,
    review:safeScientificReview(changed,['minus_changed','options_incomplete','unknown-id'],.46),
    confidence:[modelConfidence(.4),modelConfidence(1.5),modelConfidence('0.8'),modelConfidence(null)],
    unaffected:scientificWarnings({text:'پاسخ تشریحی روشن',kind:'answer'})
   };
  });
  const codes=result.warnings.map(x=>x.id);
  expect(codes).toEqual(expect.arrayContaining([
   'negation_changed','minus_changed','decimal_changed','exponent_changed',
   'numbers_changed','options_incomplete','options_lost','low_model_confidence','model_minus_0'
  ]));
  expect(result.review.acknowledged_ids).toEqual(['minus_changed','options_incomplete']);
  expect(result.review.pending_count).toBeGreaterThan(0);
  expect(result.review.model_reported_confidence).toBe(.46);
  expect(result.review.confidence_calibrated).toBe(false);
  expect(result.confidence).toEqual([.4,null,null,null]);
  expect(result.unaffected).toEqual([]);
 });

 test('rejects fake/unsafe figure regions, stores only human-approved figure metadata',async({page})=>{
  await studio(page);
  const result=await page.evaluate(async()=>{
   const {normalizeFigureCandidates,confirmedFigures,manualFigure}=await import('/studio/ocr-science.js');
   const candidates=normalizeFigureCandidates([
    {bbox_norm:[.1,.15,.5,.55],type:'graph',label:'منحنی رشد',confidence:.72},
    {bbox_norm:[.1,.15,.5,.55],type:'graph',label:'تکراری'},
    {bbox_norm:[0,.1,1.2,.9],label:'خارج از صفحه'},
    {bbox_norm:[.7,.7,.701,.701],label:'ریز'},
    {bbox_norm:[.2,.4,.6,.9],type:'diagram',label:'<img src=x onerror=alert(1)>'}
   ]);
   candidates[0].status='operator_confirmed';
   const approved=confirmedFigures(candidates);
   let bad=false;try{manualFigure([0,0,0,0])}catch{bad=true}
   return {candidates,approved,bad};
  });
  expect(result.candidates).toHaveLength(2);
  expect(result.approved).toHaveLength(1);
  expect(result.approved[0]).toMatchObject({type:'graph',status:'operator_confirmed',model_confidence:.72});
  expect(result.bad).toBe(true);
 });

 test('critical missing option warning blocks OCR approval until operator checks it',async({page})=>{
  const panel=await fixture(page);
  await panel.locator('#studioOcrText').fill('کدام مورد درست است؟\n۱) پاسخ الف\n۲) پاسخ ب\n۳) پاسخ ج');
  await expect(panel.locator('.studio-science-warning[data-severity="critical"]')).toHaveCount(1);
  await expect(panel.getByRole('button',{name:'۳ · تأیید اپراتور'})).toBeDisabled();
  await expect(panel.locator('.studio-ocr-stage')).toContainText('هشدار علمی حساس');
  expect(await page.evaluate(()=>window.__scienceWorkbench.reviewForSave())).toBeNull();
  await panel.locator('.studio-science-warning[data-severity="critical"] input').check();
  await expect(panel.getByRole('button',{name:'۳ · تأیید اپراتور'})).toBeEnabled();
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  const record=await page.evaluate(()=>window.__scienceWorkbench.reviewForSave());
  expect(record.question.scientific_review).toMatchObject({
   status:'operator_checked',pending_count:0,acknowledged_ids:['options_incomplete']
  });
  await panel.locator('#studioOcrText').fill('کدام مورد درست است؟\n۱) الف\n۲) ب');
  await expect(panel.getByRole('button',{name:'۳ · تأیید اپراتور'})).toBeDisabled();
  expect(await page.evaluate(()=>window.__scienceWorkbench.reviewForSave())).toBeNull();
 });

 test('two model passes surface changes for explicit acknowledgement; original can be restored',async({page})=>{
  const panel=await fixture(page);
  let count=0;
  await page.route('**/api/ocr',route=>{
   count++;
   const first=count===1;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(modelResult(first?
    {text:'کدام صحیح نیست؟\n۱) -۲٫۵\n۲) ۳\n۳) ۴\n۴) ۵',latex:['x^{2}'],confidence:.81}:
    {text:'کدام صحیح است؟\n۱) ۲۵\n۲) ۳\n۳) ۴',latex:['x^{3}'],confidence:.59,review_flags:[{kind:'missing_option',detail:'گزینه د واضح نیست'}]}
   ))});
  });
  await panel.getByRole('button',{name:'۱ · تشخیص متن'}).click();
  await expect(panel.locator('#studioOcrText')).toHaveValue(/صحیح نیست/);
  await panel.getByRole('button',{name:'۲ · بازبینی فرمول‌ها'}).click();
  await expect(panel.locator('#studioOcrText')).toHaveValue(/صحیح است/);
  const critical=panel.locator('.studio-science-warning[data-severity="critical"] input');
  await expect(critical.first()).toBeVisible();
  expect(await critical.count()).toBeGreaterThanOrEqual(4);
  await expect(panel.getByRole('button',{name:'۳ · تأیید اپراتور'})).toBeDisabled();
  await expect(panel.locator('.studio-science-status')).toContainText('اختلاف حساس');
  await panel.locator('.studio-science-restore').click();
  await expect(panel.locator('#studioOcrText')).toHaveValue(/صحیح نیست/);
  await expect(panel.locator('.studio-science-restore')).toBeHidden();
  expect(count).toBe(2);
 });

 test('manual figure drawing creates an image-only crop with explicit approval and safe provenance',async({page})=>{
  const panel=await fixture(page);
  await panel.locator('#studioOcrText').fill('سؤال همراه نمودار');
  await panel.locator('#studioOcrMapLoad').click();
  await expect(panel.locator('.studio-science-figure-frame')).toBeVisible();
  await drawFigure(page,panel);
  await panel.locator('.studio-science-figure-item button').first().click();
  const thumb=panel.locator('.studio-science-figure-preview');
  await expect(thumb).toBeVisible();
  await expect(thumb.locator('img')).toHaveJSProperty('complete',true);
  await expect(thumb.locator('a')).toHaveAttribute('href',/^blob:/);
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  let saved=await page.evaluate(()=>window.__scienceWorkbench.reviewForSave());
  expect(saved.question.figures).toBeUndefined();
  await panel.getByRole('button',{name:'تأیید شکل'}).click();
  expect(await page.evaluate(()=>window.__scienceWorkbench.reviewForSave())).toBeNull();
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  saved=await page.evaluate(()=>window.__scienceWorkbench.reviewForSave());
  expect(saved.question.figures).toMatchObject({
   coordinate_space:'ocr_composite_image',items:[{source:'operator',status:'operator_confirmed',type:'diagram'}]
  });
  expect(saved.question.figures.items[0].bbox_norm[2]).toBeGreaterThan(.65);
 });

 test('model-proposed figures stay pending and HTML in labels renders as inert text',async({page})=>{
  const panel=await fixture(page);
  await page.route('**/api/ocr',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(modelResult({
   text:'نمودار کدام است؟',latex:[],confidence:.71,
   figures:[{bbox_norm:[.1,.2,.9,.8],type:'graph',label:'<img src=x onerror=alert(1)>',confidence:.71},
    {bbox_norm:[.3,.2,4,.6],type:'image',label:'نامعتبر'}]
  }))}));
  await panel.getByRole('button',{name:'۱ · تشخیص متن'}).click();
  await expect(panel.locator('.studio-science-figure-item')).toHaveCount(1);
  expect(await panel.locator('.studio-science-figure-item img').count()).toBe(0);
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  const before=await page.evaluate(()=>window.__scienceWorkbench.reviewForSave());
  expect(before.question.figures).toBeUndefined();
  await panel.getByRole('button',{name:'تأیید شکل'}).click();
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  const after=await page.evaluate(()=>window.__scienceWorkbench.reviewForSave());
  expect(after.question.figures.items).toHaveLength(1);
  expect(after.question.figures.items[0].label).toContain('<img');
 });

 test('new PDF invalidates pending science review and figure approvals',async({page})=>{
  const panel=await fixture(page);
  await panel.locator('#studioOcrText').fill('متن با نمودار');
  await panel.locator('#studioOcrMapLoad').click();
  await drawFigure(page,panel);
  await panel.getByRole('button',{name:'تأیید شکل'}).click();
  await page.evaluate(()=>{window.__scienceFingerprint='new-pdf-file';window.__scienceWorkbench.syncContext()});
  await expect(panel.locator('#studioOcrText')).toHaveValue('');
  await expect(panel.locator('.studio-science-figure-item')).toHaveCount(0);
  await expect(panel.locator('.studio-science-figure-frame')).toBeHidden();
  expect(await page.evaluate(()=>window.__scienceWorkbench.reviewForSave())).toBeNull();
 });

 test('touch/mobile panel remains inside viewport and offers 42px controls',async({page},info)=>{
  test.skip(!info.project.name.includes('mobile'),'mobile layout only');
  const panel=await fixture(page);
  await panel.locator('#studioOcrText').fill('متن با نمودار');
  await panel.locator('#studioOcrMapLoad').click();
  const {width,viewport,markHeight}=await panel.locator('#studioScienceReview').evaluate(el=>({
   width:el.getBoundingClientRect().width,viewport:document.documentElement.clientWidth,
   markHeight:el.querySelector('#studioFigureMark').getBoundingClientRect().height
  }));
  expect(width).toBeLessThanOrEqual(viewport);
  expect(markHeight).toBeGreaterThanOrEqual(42);
 });
});
