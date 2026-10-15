import {test,expect} from '@playwright/test';
const P='12345678-1234-1234-1234-123456789012',q1='87654321-1234-1234-1234-123456789012',q2='87654321-1234-1234-1234-123456789013';
async function mock(page,{stale=false}={}){
 const calls=[],rows=[{id:q1,projectId:P,revision:2,questionText:'مقدار ۲ چند است؟',answerText:'دو',sourceNumber:1},
  {id:q2,projectId:P,revision:1,questionText:'نتیجه x^2 چیست؟',answerText:'مجذور x',sourceNumber:2}];
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/**',route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.pathname.endsWith('/questions'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:rows})});
  if(u.pathname.endsWith('/exams/compose')){
   const payload=req.postDataJSON();calls.push(payload);
   if(stale)return route.fulfill({status:409,contentType:'application/json',body:'{"error":"UNAPPROVED_OR_STALE_QUESTION"}'});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'draft_export_only',manifest:{
    title:payload.title,publishable:false,answersIncluded:payload.includeAnswers,
    items:payload.questionIds.map((id,i)=>({index:i+1,id,revision:payload.sourceRevisions[i],question:rows.find(x=>x.id===id).questionText,...(payload.includeAnswers?{answer:rows.find(x=>x.id===id).answerText}:{})}))
   }})});
  }return route.fulfill({status:404});
 });
 return calls;
}
test.describe('ZH-86 reviewed-only exam composer',()=>{
 test('explicit ordered selection downloads safe JSONL and pins revisions',async({page})=>{
  const calls=await mock(page);
  await page.goto('/review-console/composer-studio.html');
  await expect(page.locator('#approvedList button')).toHaveCount(2);
  await page.locator('#approvedList button').nth(1).click();
  await page.locator('#approvedList button').nth(0).click();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#exportJsonl').click();
  const download=await downloadEvent;
  expect(download.suggestedFilename()).toBe('examforge-exam.jsonl');
  expect(calls[0].questionIds).toEqual([q2,q1]);
  expect(calls[0].sourceRevisions).toEqual([1,2]);
  await expect(page.locator('#composerNotice')).toContainText('هیچ انتشار خارجی');
 });
 test('stale signed revisions are rejected and never create an export',async({page})=>{
  await mock(page,{stale:true});
  await page.goto('/review-console/composer-studio.html');
  await page.locator('#approvedList button').first().click();
  await page.locator('#previewExam').click();
  await expect(page.locator('#composerNotice')).toContainText('تأییدشان منقضی شده');
  await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 });
});
