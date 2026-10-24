import {test,expect} from '@playwright/test';

async function mount(page){
 await page.goto('/studio/');
 await expect(page.locator('#operatorLogin')).toBeHidden();
 await page.evaluate(async()=>{
  const {createBatchOcrPanel}=await import('/studio/ocr-batch-panel.js');
  const c=document.createElement('canvas');c.width=350;c.height=150;
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle='#111';ctx.font='22px sans-serif';ctx.fillText('OCR TEST 12',20,80);
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/webp',.85));
  window.__jobFingerprint='pdf1/crop1';
  window.__jobIdentity='exam:Q001';
  window.__jobNotices=[];window.__jobAdopted=[];
  window.__jobFixture=createBatchOcrPanel({
   capture:async()=>({blob}),
   getFingerprint:()=>window.__jobFingerprint,
   getIdentity:()=>window.__jobIdentity,
   onNotice:text=>window.__jobNotices.push(text),
   onUse:(...args)=>window.__jobAdopted.push(args)
  });
  document.querySelector('.inspector').append(window.__jobFixture.host);
 });
 return page.locator('.studio-batch-ocr').last();
}
test.describe('ZH-78 queue UI and operator control',()=>{
 test('local staging incurs no inference or API cost, failed POST retries with identical idempotency key',async({page})=>{
  const seen=[];let posts=0;
  await page.route('**/api/ocr/jobs',route=>{
   const method=route.request().method();
   if(method==='POST'){
    posts++;const body=route.request().postDataJSON();seen.push(body);
    if(posts===1)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"BATCH_STORAGE_UNAVAILABLE"}'});
    return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({
     id:'12345678-1234-1234-1234-123456789012',status:'running',percent:0,total:1,
     counts:{staged:0,queued:1,processing:0,done:0,failed:0,cancelled:0},
     items:[{id:'98765432-1234-1234-1234-123456789012',kind:'question',clientRef:body.items[0].clientRef,status:'queued',attempts:0}]
    })});
   }
   return route.fulfill({status:200,contentType:'application/json',body:'{"jobs":[]}'});
  });
  const panel=await mount(page);
  const add=panel.locator('#studioBatchAddQuestion');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(panel.locator('.studio-batch-row')).toHaveCount(1);
  expect(posts).toBe(0);
  await panel.locator('#studioBatchStart').click();
  await expect(panel.locator('.studio-batch-status')).toContainText('انجام نشد');
  await expect(panel.locator('.studio-batch-row')).toHaveCount(1);
  await panel.locator('#studioBatchStart').click();
  await expect(panel.locator('.studio-batch-job')).toHaveCount(1);
  expect(seen).toHaveLength(2);
  expect(seen[0].requestKey).toBe(seen[1].requestKey);
  expect(seen[0].items[0].image).toMatch(/^data:image\/webp;base64,/);
  expect(seen[0].items[0].prompt).toContain('OCR transcription engine');
  expect(seen[0].items[0].kind).toBe('question');
 });
 test('refresh retrieves persisted jobs; explicit adoption checks PDF fingerprint',async({page})=>{
  const jobId='12345678-1234-1234-1234-123456789012';
  let body=null;
  await page.route('**/api/ocr/jobs',route=>{
   if(route.request().method()==='POST'){
    body=route.request().postDataJSON();
    return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({
     id:jobId,status:'completed',percent:100,total:1,
     counts:{staged:0,queued:0,processing:0,done:1,failed:0,cancelled:0},
     items:[{id:'98765432-1234-1234-1234-123456789012',clientRef:body.items[0].clientRef,kind:'question',status:'done',attempts:1,
      result:{text:'سؤال ۱۲: x² + ۲',latex:['x^2'],notes:''}}]
    })});
   }
   return route.fulfill({status:200,contentType:'application/json',body:'{"jobs":[]}'});
  });
  const panel=await mount(page);
  await panel.locator('#studioBatchAddQuestion').click();
  await panel.locator('#studioBatchStart').click();
  await expect(panel.locator('.studio-batch-job')).toHaveCount(1);
  await panel.locator('.studio-batch-result summary').click();
  await expect(panel.locator('.studio-batch-transcription')).toContainText('سؤال ۱۲');
  page.once('dialog',dialog=>dialog.accept());
  await panel.getByRole('button',{name:'انتقال به ویرایشگر'}).click();
  let adopted=await page.evaluate(()=>window.__jobAdopted);
  expect(adopted).toHaveLength(1);
  expect(adopted[0][0]).toBe('question');
  await page.evaluate(()=>{window.__jobFingerprint='pdf-changed'});
  await panel.getByRole('button',{name:'انتقال به ویرایشگر'}).click();
  adopted=await page.evaluate(()=>window.__jobAdopted);
  expect(adopted).toHaveLength(1);
  expect(await page.evaluate(()=>window.__jobNotices.some(x=>x.includes('PDF')))).toBe(true);
 });
 test('job actions expose pause, retry and cancel without changing canonical data',async({page})=>{
  const requests=[];
  const base={id:'12345678-1234-1234-1234-123456789012',status:'running',percent:50,total:2,
   counts:{staged:0,queued:1,processing:0,done:0,failed:1,cancelled:0},
   items:[{id:'1',clientRef:'qa-question-item-001',kind:'question',status:'failed',error:'OCR_UPSTREAM_RETRY',attempts:3},
    {id:'2',clientRef:'qa-answer-item-001',kind:'answer',status:'queued',attempts:0}]};
  await page.route('**/api/ocr/jobs**',route=>{
   const address=route.request().url(),action=address.split('/').at(-1);
   if(route.request().method()==='POST'){
    requests.push(action);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
     ...base,status:action==='cancel'?'cancelled':action==='pause'?'paused':'running'
    })});
   }
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({jobs:[base]})});
  });
  const panel=await mount(page);
  await panel.locator('#studioBatchRefresh').click();
  await expect(panel.locator('.studio-batch-job')).toHaveCount(1);
  await panel.getByRole('button',{name:'توقف صف'}).click();
  await expect(panel.locator('.studio-batch-job')).toContainText('متوقف‌شده');
  await panel.getByRole('button',{name:'ادامه'}).click();
  await panel.getByRole('button',{name:'تلاش مجدد ناموفق‌ها'}).click();
  await panel.getByRole('button',{name:'لغو باقی‌مانده'}).click();
  expect(requests).toEqual(['pause','resume','retry','cancel']);
 });
 test('mobile batch panel stays in viewport and action buttons have touch targets',async({page},info)=>{
  test.skip(!info.project.name.includes('mobile'),'mobile geometry');
  const panel=await mount(page);
  await panel.scrollIntoViewIfNeeded();
  const shape=await panel.evaluate(el=>({
   width:el.getBoundingClientRect().width,available:document.documentElement.clientWidth,
   touch:[...el.querySelectorAll('.studio-batch-actions button')].map(x=>x.getBoundingClientRect().height)
  }));
  expect(shape.width).toBeLessThanOrEqual(shape.available);
  expect(shape.touch.every(h=>h>=42)).toBe(true);
 });
});
