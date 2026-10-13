import {test,expect} from '@playwright/test';

async function openStudio(page){
 await page.goto('/studio/');
 await expect(page.locator('#studioOcrPanel')).toBeVisible();
 await expect(page.locator('body')).not.toHaveClass(/auth-locked/);
}
test.describe('ZH-75 operator OCR integration',()=>{
 test('recognizes nested Persian OCR output without ever interpreting HTML as markup',async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const core=await import('/studio/ocr-core.js');
   const data=core.normalizeOcrResponse({
    result:{response:JSON.stringify({text:'مقدار ۱۲x چیست؟\n<b>صرفاً متن</b>',latex:['x^{2}','\\frac{a}{b}'],notes:'کلمه آخر ناخواناست'})}
   });
   const unstructured=core.normalizeOcrResponse({result:{response:'متن OCR بدون JSON'}});
   const prompt=core.buildOcrPrompt({kind:'answer',pass:2,previous:data});
   return {data,plain:unstructured.format,prompt,
    empty:core.safeOcrReview({text:' ',latex:[]}),
    manual:core.safeOcrReview({text:'متن دستی',latex:[],source:'manual',passes:0})};
  });
  expect(result.data.text).toContain('۱۲x');
  expect(result.data.text).toContain('<b>صرفاً متن</b>');
  expect(result.data.latex).toEqual(['x^{2}','\\frac{a}{b}']);
  expect(result.plain).toBe('plain');
  expect(result.prompt).toContain('SECOND PASS');
  expect(result.prompt).toContain('UNTRUSTED');
  expect(result.empty).toBeNull();
  expect(result.manual.status).toBe('operator_confirmed');
 });

 test('protected same-origin request maps unauthorized, quota and unavailable errors',async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const {requestOcr}=await import('/studio/ocr-core.js');
   const observed=[];
   const good=await requestOcr({
    image:'data:image/webp;base64,AA==',prompt:'read',
    fetcher:async(url,opts)=>{
     observed.push({url,method:opts.method,credentials:opts.credentials,body:JSON.parse(opts.body)});
     return new Response(JSON.stringify({result:{response:JSON.stringify({text:'زیست ۱۴۰۵',latex:['x^2']})}}),{status:200});
    }
   });
   const codes=[];
   for(const status of [401,429,503]){
    try{await requestOcr({image:'invalid',prompt:'read',fetcher:async()=>new Response('{}',{status})})}
    catch(error){codes.push(error.message)}
   }
   return {observed,good,codes};
  });
  expect(result.observed[0].url).toBe('/api/ocr');
  expect(result.observed[0].method).toBe('POST');
  expect(result.observed[0].credentials).toBe('same-origin');
  expect(result.observed[0].body.prompt).toBe('read');
  expect(result.good.text).toContain('۱۴۰۵');
  expect(result.codes).toEqual(['OCR_UNAUTHORIZED','OCR_QUOTA','OCR_SERVICE_UNAVAILABLE']);
 });

 test('manual transcription remains optional and separate for question and answer',async({page})=>{
  await openStudio(page);
  const host=page.locator('#studioOcrPanel');
  const text=host.locator('#studioOcrText');
  await expect(host.locator('.studio-ocr-actions button').nth(0)).toBeDisabled();
  await expect(host.locator('.studio-ocr-actions button').nth(2)).toBeDisabled();
  await text.fill('متن <img onerror=alert(1)> و x^2');
  await expect(host.locator('.studio-ocr-preview-text')).toContainText('<img onerror=alert(1)>');
  expect(await host.locator('.studio-ocr-preview-text img').count()).toBe(0);
  await host.locator('.studio-ocr-actions button').nth(2).click();
  await expect(host.locator('.studio-ocr-stage')).toContainText('تأیید شد');
  await text.fill('متن تغییر یافته');
  await expect(host.locator('.studio-ocr-stage')).not.toContainText('تأیید شد');
  await host.getByRole('button',{name:'متن پاسخ'}).click();
  await expect(text).toHaveValue('');
  await text.fill('پاسخ تشریحی');
  await host.getByRole('button',{name:'متن سؤال'}).click();
  await expect(text).toHaveValue('متن تغییر یافته');
  await host.locator('.studio-ocr-actions button').nth(3).click();
  await expect(text).toHaveValue('');
 });

 test('two-pass OCR uses an explicit second action; approval is invalidated by new crop',async({page})=>{
  await openStudio(page);
  const requests=[];
  await page.route('**/api/ocr',async route=>{
   const body=route.request().postDataJSON();
   const second=body.prompt.includes('SECOND PASS');
   requests.push({second,image:body.image});
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({result:{response:JSON.stringify(second?
     {text:'مرحله دو: ۴',latex:['x^{3}'],notes:''}:
     {text:'مرحله یک: ۴',latex:['x^{2}'],notes:'نماد نامطمئن'})}})});
  });
  await page.evaluate(async()=>{
   const {installOcrWorkbench}=await import('/studio/ocr-panel.js');
   document.querySelector('#studioOcrPanel').remove();
   document.querySelector('#questionForm').remove();
   const form=document.createElement('form');form.id='questionForm';
   const ready=document.createElement('section');ready.className='readiness';form.append(ready);
   document.querySelector('.inspector').append(form);
   const canvas=document.createElement('canvas');canvas.width=340;canvas.height=140;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,340,140);
   ctx.fillStyle='#000';ctx.fillText('SAMPLE',20,40);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));
   window.__testOcrFingerprint='pdf:1:region:1';
   window.__testOcr=installOcrWorkbench({
    capture:async()=>({blob}),
    getFingerprint:()=>window.__testOcrFingerprint,
    getIdentity:()=>'exam:Q1'
   });
  });
  const host=page.locator('#studioOcrPanel');
  const buttons=host.locator('.studio-ocr-actions button');
  await expect(buttons.nth(0)).toBeEnabled();
  await expect(buttons.nth(1)).toBeDisabled();
  await buttons.nth(0).click();
  await expect(host.locator('#studioOcrText')).toHaveValue('مرحله یک: ۴');
  expect(requests).toHaveLength(1);
  await expect(buttons.nth(1)).toBeEnabled();
  await expect(buttons.nth(2)).toBeEnabled();
  await buttons.nth(1).click();
  await expect(host.locator('#studioOcrText')).toHaveValue('مرحله دو: ۴');
  expect(requests).toHaveLength(2);
  expect(requests.every(x=>x.image.startsWith('data:image/webp;base64,'))).toBe(true);
  // Scientific differences between the two passes require explicit operator checking.
  while(await host.locator('.studio-science-warning[data-severity="critical"] input:not(:checked)').count()){
   await host.locator('.studio-science-warning[data-severity="critical"] input:not(:checked)').first().check();
  }
  await buttons.nth(2).click();
  const approved=await page.evaluate(()=>window.__testOcr.reviewForSave());
  expect(approved.question.status).toBe('operator_confirmed');
  expect(approved.question.passes).toBe(2);
  expect(approved.question.text).toBe('مرحله دو: ۴');
  await page.evaluate(()=>{window.__testOcrFingerprint='pdf:2:region:5';window.__testOcr.syncContext()});
  await expect(host.locator('#studioOcrText')).toHaveValue('');
  expect(await page.evaluate(()=>window.__testOcr.reviewForSave())).toBeNull();
 });

 test('OCR error cannot delete manual text or force a question to be approved',async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const {requestOcr,safeOcrReview}=await import('/studio/ocr-core.js');
   let failure='';
   try{await requestOcr({image:'x',prompt:'p',fetcher:async()=>new Response('{"error":"quota"}',{status:429})})}
   catch(error){failure=error.message}
   return {failure,noAutoReview:safeOcrReview({text:'',latex:[]})===null};
  });
  expect(result).toEqual({failure:'OCR_QUOTA',noAutoReview:true});
 });
});