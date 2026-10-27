import {test,expect} from '@playwright/test';

const projectId='12345678-1234-1234-1234-123456789012';
const questionId='87654321-1234-1234-1234-123456789012';

test('slow compose response cannot export an obsolete title or answer policy',async({page})=>{
 const row={id:questionId,projectId,revision:2,questionText:'سؤال تأییدشده',answerText:'پاسخ درست',sourceNumber:1};
 const hash='a'.repeat(64);
 const requests=[];
 let releaseFirst;
 let downloads=0;
 page.on('download',()=>downloads++);
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:projectId,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:null})
 }));
 await page.route('**/api/v1/bank/exams/compose',async route=>{
  const payload=route.request().postDataJSON();
  requests.push(payload);
  if(requests.length===1)await new Promise(resolve=>{releaseFirst=resolve});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:hash,
   manifest:{title:payload.title.trim(),publishable:false,answersIncluded:payload.includeAnswers,
    items:[{index:1,id:questionId,revision:2,question:row.questionText,
     ...(payload.includeAnswers?{answer:row.answerText}:{})}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await page.locator('#approvedList button').click();
 const exportButton=page.locator('#exportJsonl');
 await exportButton.click();
 await expect.poll(()=>requests.length).toBe(1);
 await expect.poll(()=>typeof releaseFirst).toBe('function');
 await expect(exportButton).toBeDisabled();

 // The operator may still edit the draft while the previous validation is pending.
 await page.locator('#examTitle').fill('عنوان ویرایش‌شده');
 await page.locator('#includeExamAnswers').check();
 releaseFirst();
 await expect(page.locator('#composerNotice')).toContainText('آزمون هنگام ساخت خروجی تغییر کرد');
 await expect(page.locator('#examFingerprint')).toHaveText('شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.');
 await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(exportButton).toBeEnabled();
 expect(downloads).toBe(0);

 // An explicit retry must validate the latest title and answer setting.
 const downloadEvent=page.waitForEvent('download');
 await exportButton.click();
 const download=await downloadEvent;
 expect(download.suggestedFilename()).toBe('examforge-exam.jsonl');
 await expect(page.locator('#examFingerprint')).toContainText(hash);
 expect(requests.map(({title,includeAnswers})=>({title,includeAnswers}))).toEqual([
  {title:'آزمون جدید',includeAnswers:false},
  {title:'عنوان ویرایش‌شده',includeAnswers:true}
 ]);
 expect(downloads).toBe(1);
});
