import {test,expect} from '@playwright/test';
const P='12345678-1234-1234-1234-123456789012',digest='d'.repeat(64);
async function mock(page){
 const posted=[];
 await page.route('**/api/v1/projects**',route=>{
  const req=route.request(),url=new URL(req.url());let status=200,data={};
  if(url.pathname==='/api/v1/projects')data={projects:[{id:P,name:'نمونه زیست'}]};
  else if(url.pathname==='/api/v1/projects/'+P+'/assets')data={assets:[{digest,role:'question_pdf',mime:'application/pdf',size:300}]};
  else if(url.pathname==='/api/v1/projects/'+P+'/questions'&&req.method()==='POST'){
   posted.push(req.postDataJSON());status=201;
   data={question:{id:'87654321-1234-1234-1234-123456789012',state:'draft',revision:1,content:req.postDataJSON().content}};
  }else status=404;
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 return posted;
}
test.describe('ZH-82 reviewed answer importer',()=>{
 test('matching is local and no question is saved until explicit checkbox and button',async({page})=>{
  const posted=await mock(page);
  await page.goto('/review-console/exam-importer.html');
  await expect(page.locator('#importProject')).toBeEnabled();
  await page.locator('#importSource').selectOption(digest);
  await page.locator('#rawQuestions').fill('۱) مقدار x چیست؟\n۲) پاسخ کدام گزینه است؟');
  await page.locator('#rawAnswers').fill('۱) x=۲\n۲) گزینه سه');
  await page.locator('#matchNow').click();
  expect(posted).toHaveLength(0);
  await expect(page.locator('[data-number]')).toHaveCount(2);
  await page.locator('[data-number="1"]').check();
  await page.locator('#importDrafts').click();
  await expect(page.locator('#importNotice')).toContainText('منتقل شد');
  expect(posted).toHaveLength(1);
  expect(posted[0].content.operatorConfirmed).toBe(false);
  expect(posted[0].content.sourceDigest).toBe(digest);
  expect(posted[0].content.sourceNumber).toBe(1);
 });
 test('mismatched numbers are never selectable and stale analysis is reset on edit',async({page})=>{
  const posted=await mock(page);
  await page.goto('/review-console/exam-importer.html');
  await page.locator('#importSource').selectOption(digest);
  await page.locator('#rawQuestions').fill('۱) سؤال اول\n۲) سؤال دوم');
  await page.locator('#rawAnswers').fill('۱) پاسخ اول\n۳) پاسخ بدون سؤال');
  await page.locator('#matchNow').click();
  await expect(page.locator('[data-number]')).toHaveCount(1);
  await expect(page.locator('#matchList')).toContainText('نیازمند اصلاح');
  await page.locator('[data-number="1"]').check();
  await page.locator('#rawAnswers').fill('۲) پاسخ تغییر کرد');
  await expect(page.locator('#importDrafts')).toBeDisabled();
  expect(posted).toHaveLength(0);
 });
 test('rapid repeated import clicks cannot create duplicate drafts',async({page})=>{
  await mock(page);
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  let requests=0;
  await page.route('**/api/v1/projects/'+P+'/questions',async route=>{
   requests++;
   await pending;
   await route.fulfill({status:201,contentType:'application/json',
    body:JSON.stringify({question:{id:'87654321-1234-1234-1234-123456789012',state:'draft'}})});
  });
  await page.goto('/review-console/exam-importer.html');
  await expect(page.locator('#importProject')).toBeEnabled();
  await page.locator('#importSource').selectOption(digest);
  await page.locator('#rawQuestions').fill('۱) سؤال نمونه');
  await page.locator('#rawAnswers').fill('۱) پاسخ نمونه');
  await page.locator('#matchNow').click();
  await page.locator('[data-number="1"]').check();
  await page.locator('#importDrafts').evaluate(button=>{
   button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
   button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  });
  try{
   await expect.poll(()=>requests).toBe(1);
   await expect(page.locator('#importDrafts')).toBeDisabled();
   await page.waitForTimeout(120);
   expect(requests).toBe(1);
  }finally{
   release();
  }
  await expect(page.locator('#importNotice')).toContainText('منتقل شد');
  expect(requests).toBe(1);
 });
 test('locks the import context while saving and restores controls afterward',async({page})=>{
  await mock(page);
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  let requests=0;
  await page.route('**/api/v1/projects/'+P+'/questions',async route=>{
   requests++;
   await pending;
   await route.fulfill({status:201,contentType:'application/json',
    body:JSON.stringify({question:{id:'87654321-1234-1234-1234-123456789012',state:'draft'}})});
  });
  await page.goto('/review-console/exam-importer.html');
  await expect(page.locator('#importProject')).toBeEnabled();
  await page.locator('#importSource').selectOption(digest);
  await page.locator('#rawQuestions').fill('۱) سؤال نمونه');
  await page.locator('#rawAnswers').fill('۱) پاسخ نمونه');
  await page.locator('#matchNow').click();
  await page.locator('[data-number="1"]').check();
  await page.locator('#importDrafts').click();
  const ids=['importProject','importSource','importLabel','rawQuestions','rawAnswers','matchNow'];
  try{
   await expect.poll(()=>requests).toBe(1);
   for(const id of ids)await expect(page.locator('#'+id)).toBeDisabled();
  }finally{
   release();
  }
  await expect(page.locator('#importNotice')).toContainText('منتقل شد');
  for(const id of ids)await expect(page.locator('#'+id)).toBeEnabled();
  expect(requests).toBe(1);
 });

 test('late PDF asset response from a previous project cannot pollute current options',async({page})=>{
  await mock(page);
  const other='87654321-8765-4321-8765-432187654321',otherDigest='e'.repeat(64);
  await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({projects:[{id:P,name:'زیست'},{id:other,name:'شیمی'}]})}));
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  let requested=0,delivered=0;
  await page.route('**/api/v1/projects/'+other+'/assets',async route=>{
   requested++;
   await pending;
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({assets:[{digest:otherDigest,role:'question_pdf'}]})});
   delivered++;
  });
  await page.goto('/review-console/exam-importer.html');
  await expect(page.locator('#importProject')).toBeEnabled();
  await page.locator('#importProject').selectOption(other);
  await expect.poll(()=>requested).toBe(1);
  try{
   await page.locator('#importProject').selectOption(P);
   await expect(page.locator('#importSource option[value="'+digest+'"]')).toHaveCount(1);
  }finally{
   release();
  }
  await expect.poll(()=>delivered).toBe(1);
  await page.waitForTimeout(100);
  await expect(page.locator('#importProject')).toHaveValue(P);
  await expect(page.locator('#importSource option')).toHaveCount(2);
  await expect(page.locator('#importSource option[value="'+otherDigest+'"]')).toHaveCount(0);
 });

 test('imported question numbers are scoped to project, PDF, and reviewed content',async({page})=>{
  const postedA=await mock(page);
  const other='87654321-8765-4321-8765-432187654321',digestB='e'.repeat(64);
  const postedB=[];
  await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({projects:[{id:P,name:'زیست'},{id:other,name:'شیمی'}]})}));
  await page.route('**/api/v1/projects/'+other+'/assets',route=>route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({assets:[{digest:digestB,role:'question_pdf'}]})}));
  await page.route('**/api/v1/projects/'+other+'/questions',route=>{
   postedB.push(route.request().postDataJSON());
   return route.fulfill({status:201,contentType:'application/json',
    body:JSON.stringify({question:{id:'87654321-1234-1234-1234-123456789012',state:'draft'}})});
  });
  await page.goto('/review-console/exam-importer.html');
  await expect(page.locator('#importProject')).toBeEnabled();
  const questions=page.locator('#rawQuestions'),answers=page.locator('#rawAnswers');
  await questions.fill('۱) سؤال مشترک');
  await answers.fill('۱) پاسخ مشترک');
  async function importOne(project,source){
   await page.locator('#importProject').selectOption(project);
   await expect(page.locator('#importSource')).toBeEnabled();
   await page.locator('#importSource').selectOption(source);
   await page.locator('#matchNow').click();
   await page.locator('[data-number="1"]').check();
   await expect(page.locator('#importDrafts')).toBeEnabled();
   await page.locator('#importDrafts').click();
   await expect(page.locator('#importNotice')).toContainText('منتقل شد');
  }
  await importOne(P,digest);
  expect(postedA).toHaveLength(1);
  await importOne(other,digestB);
  expect(postedB).toHaveLength(1);
  await page.locator('#importProject').selectOption(P);
  await expect(page.locator('#importSource')).toBeEnabled();
  await page.locator('#importSource').selectOption(digest);
  await page.locator('#matchNow').click();
  await page.locator('[data-number="1"]').check();
  await expect(page.locator('#importDrafts')).toBeDisabled();
  await questions.fill('۱) سؤال جدید با همان شماره');
  await page.locator('#matchNow').click();
  await page.locator('[data-number="1"]').check();
  await expect(page.locator('#importDrafts')).toBeEnabled();
  expect(postedA).toHaveLength(1);
  expect(postedB).toHaveLength(1);
 });

});
