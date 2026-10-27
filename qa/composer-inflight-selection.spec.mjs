import {test,expect} from '@playwright/test';

const projectId='12345678-1234-1234-1234-123456789012';
const firstId='87654321-1234-1234-1234-123456789012';
const secondId='87654321-1234-1234-1234-123456789013';

test('reorder and removal during slow compose never export obsolete selections',async({page})=>{
 const rows=[
  {id:firstId,projectId,revision:2,questionText:'سؤال اول تأییدشده',answerText:'پاسخ اول',sourceNumber:1},
  {id:secondId,projectId,revision:3,questionText:'سؤال دوم تأییدشده',answerText:'پاسخ دوم',sourceNumber:2}
 ];
 const byId=new Map(rows.map(row=>[row.id,row]));
 const hash='b'.repeat(64);
 const requests=[];
 let releaseFirst,releaseSecond,downloads=0;
 page.on('download',()=>downloads++);
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:projectId,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({questions:rows,nextCursor:null})
 }));
 await page.route('**/api/v1/bank/exams/compose',async route=>{
  const payload=route.request().postDataJSON();
  requests.push(payload);
  if(requests.length===1)await new Promise(resolve=>{releaseFirst=resolve});
  if(requests.length===2)await new Promise(resolve=>{releaseSecond=resolve});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:hash,
   manifest:{title:payload.title.trim(),publishable:false,answersIncluded:payload.includeAnswers,
    items:payload.questionIds.map((id,index)=>({
     index:index+1,id,revision:payload.sourceRevisions[index],question:byId.get(id).questionText,
     ...(payload.includeAnswers?{answer:byId.get(id).answerText}:{})
    }))}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await expect(page.locator('#approvedList button')).toHaveCount(2);
 await page.locator('#approvedList button').nth(0).click();
 await page.locator('#approvedList button').nth(1).click();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(2);
 const exportButton=page.locator('#exportJsonl');
 const fingerprint=page.locator('#examFingerprint');
 const placeholder='شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.';

 // The first server response is valid for [first, second], but the operator reverses them.
 await exportButton.click();
 await expect.poll(()=>requests.length).toBe(1);
 await expect.poll(()=>typeof releaseFirst).toBe('function');
 await expect(exportButton).toBeDisabled();
 await page.locator('#selectedList .composer-selection').first()
  .getByRole('button',{name:/پایین/}).click();
 await expect(page.locator('#selectedList .composer-selection').first()).toContainText('سؤال دوم');
 releaseFirst();
 await expect(page.locator('#composerNotice')).toContainText('آزمون هنگام ساخت خروجی تغییر کرد');
 await expect(fingerprint).toHaveText(placeholder);
 await expect(exportButton).toBeEnabled();
 expect(downloads).toBe(0);

 // The second response is valid for [second, first], but the operator removes second.
 await exportButton.click();
 await expect.poll(()=>requests.length).toBe(2);
 await expect.poll(()=>typeof releaseSecond).toBe('function');
 await page.locator('#selectedList .composer-selection').first()
  .getByRole('button',{name:/حذف/}).click();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 releaseSecond();
 await expect(page.locator('#composerNotice')).toContainText('آزمون هنگام ساخت خروجی تغییر کرد');
 await expect(fingerprint).toHaveText(placeholder);
 await expect(exportButton).toBeEnabled();
 expect(downloads).toBe(0);

 // A deliberate retry exports only the remaining selected question.
 const downloadEvent=page.waitForEvent('download');
 await exportButton.click();
 const download=await downloadEvent;
 expect(download.suggestedFilename()).toBe('examforge-exam.jsonl');
 await expect(fingerprint).toContainText(hash);
 expect(requests.map(payload=>payload.questionIds)).toEqual([
  [firstId,secondId],[secondId,firstId],[firstId]
 ]);
 expect(requests.map(payload=>payload.sourceRevisions)).toEqual([
  [2,3],[3,2],[2]
 ]);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(downloads).toBe(1);
});
