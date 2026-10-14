import {test,expect} from '@playwright/test';
const P='12345678-1234-1234-1234-123456789012',Q='87654321-1234-1234-1234-123456789012';
async function mockData(page){
 const writes=[];let record=null;
 await page.route('**/api/v1/projects**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const method=request.method(),isQuestions=url.pathname==='/api/v1/projects/'+P+'/questions';
  const isQuestion=url.pathname==='/api/v1/projects/'+P+'/questions/'+Q;
  let status=200,data={error:'NOT_FOUND'};
  if(url.pathname==='/api/v1/projects'&&method==='GET')data={projects:[{id:P,name:'آزمون تجربی',revision:1}]};
  else if(isQuestions&&method==='GET')data={questions:record?[record]:[]};
  else if(isQuestions&&method==='POST'){
   writes.push(request.postDataJSON());record={id:Q,projectId:P,revision:1,state:'draft',content:request.postDataJSON().content};
   data={question:record};status=201;
  }else if(isQuestion&&method==='PATCH'){
   writes.push(request.postDataJSON());status=409;data={error:'REVISION_CONFLICT'};
  }else if(isQuestion&&method==='GET')data={history:[{revision:1,content:record.content,happenedAt:'2026-10-13'}]};
  else status=404;
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 return {writes};
}
test.describe('ZH-79 / ZH-80 operator draft bank',()=>{
 test('manual save keeps draft state and never auto-publishes or triggers OCR',async({page})=>{
  const fixture=await mockData(page);const ocr=[];
  await page.route('**/api/ocr',route=>{ocr.push(1);return route.fulfill({status:500})});
  await page.goto('/review-console/bank-studio.html');
  await expect(page.locator('#questionText')).toBeEnabled();
  await page.locator('#questionText').fill('مقدار ۲ در سلول چیست؟');
  await page.locator('#saveDraft').click();
  await expect(page.locator('#notice')).toContainText('پیش‌نویس در D1');
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0].content.questionText).toContain('سلول');
  expect(Object.hasOwn(fixture.writes[0],'approved')).toBe(false);
  expect(ocr).toHaveLength(0);
  await page.locator('#showHistory').click();
  await expect(page.locator('#historyPanel')).toBeVisible();
 });
 test('CAS conflict preserves local edits for manual reconciliation',async({page})=>{
  const fixture=await mockData(page);
  await page.goto('/review-console/bank-studio.html');
  await page.locator('#questionText').fill('پاسخ نیازمند بازبینی است');
  await page.locator('#saveDraft').click();
  await page.locator('#questionText').fill('متن ویرایش‌شده، هنوز ذخیره نشده');
  await page.locator('#saveDraft').click();
  await expect(page.locator('#notice')).toContainText('تداخل نسخه');
  await expect(page.locator('#questionText')).toHaveValue('متن ویرایش‌شده، هنوز ذخیره نشده');
  expect(fixture.writes.at(-1).baseRevision).toBe(1);
 });
 test('suggestions are explicit and inert until operator acts',async({page})=>{
  await mockData(page);await page.goto('/review-console/bank-studio.html');
  await page.locator('#questionText').fill('نقش میتوکندری در سلول چیست؟');
  await page.locator('#suggestCategories').click();
  await expect(page.locator('#categoryList')).toContainText('زیست‌شناسی');
  await page.locator('#secondDraft').fill('نقش میتوکندری در سلول نیست؟');
  await page.locator('#compareDrafts').click();
  await expect(page.locator('#compareResult')).toContainText('تأیید انسانی');
  await page.locator('#findDuplicates').click();
  await expect(page.locator('#duplicateList')).toContainText('تضمین نبودن تکرار نیست');
 });
});


test('revoking a reviewer works before invitations and never registers duplicate listeners',async({page})=>{
 await mockData(page);
 const verbs=[];
 await page.route('**/api/v1/reviews/assignments',async route=>{
  const method=route.request().method();
  verbs.push({method,payload:route.request().postDataJSON()});
  await route.fulfill({status:method==='POST'?201:200,contentType:'application/json',
   body:JSON.stringify(method==='POST'?{assigned:true}:{revoked:true,previousApprovalsInvalidated:true})});
 });
 page.on('dialog',dialog=>dialog.accept());
 await page.goto('/review-console/bank-studio.html');
 await expect(page.locator('#revokeReviewer')).toBeEnabled();
 await page.locator('#reviewerEmail').fill('reviewer@example.test');
 await page.locator('#revokeReviewer').click();
 await expect(page.locator('#notice')).toContainText('لغو شد');
 expect(verbs.map(x=>x.method)).toEqual(['DELETE']);
 await page.locator('#assignReviewer').click();
 await expect(page.locator('#notice')).toContainText('دسترسی بازبین مستقل');
 await page.locator('#reviewerEmail').fill('reviewer@example.test');
 await page.locator('#assignReviewer').click();
 await expect(page.locator('#notice')).toContainText('دسترسی بازبین مستقل');
 await page.locator('#reviewerEmail').fill('reviewer@example.test');
 await page.locator('#revokeReviewer').click();
 await expect(page.locator('#notice')).toContainText('لغو شد');
 expect(verbs.map(x=>x.method)).toEqual(['DELETE','POST','POST','DELETE']);
 expect(verbs.every(x=>x.payload.projectId===P&&x.payload.reviewerEmail==='reviewer@example.test')).toBe(true);
});


test('stale project fetch cannot replace the active project editor or question list',async({page})=>{
 const other='99999999-1111-2222-3333-444444444444';
 let releaseOld,oldStarted;
 const oldArrived=new Promise(resolve=>{oldStarted=resolve});
 await page.route('**/api/v1/projects**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  let body,status=200;
  if(path==='/api/v1/projects')body={projects:[{id:P,name:'پروژه یک',revision:1},{id:other,name:'پروژه دو',revision:1}]};
  else if(path==='/api/v1/projects/'+P+'/questions'){
   oldStarted();await new Promise(resolve=>{releaseOld=resolve});
   body={questions:[{id:Q,projectId:P,revision:1,content:{questionText:'سؤال پروژه قدیمی'}}]};
  }else if(path==='/api/v1/projects/'+other+'/questions')
   body={questions:[{id:'aaaaaaaa-1111-2222-3333-444444444444',projectId:other,revision:1,content:{questionText:'سؤال پروژه فعال'}}]};
  else if(path==='/api/v1/projects/'+other+'/assets')body={assets:[]};
  else if(path==='/api/v1/projects/'+P+'/assets')body={assets:[]};
  else{status=404;body={error:'NOT_FOUND'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/review-console/bank-studio.html');
 await oldArrived;
 await page.locator('#projectSelect').selectOption(other);
 await expect(page.locator('#questionList')).toContainText('سؤال پروژه فعال');
 releaseOld();
 await expect(page.locator('#questionList')).not.toContainText('سؤال پروژه قدیمی');
 await expect(page.locator('#projectSelect')).toHaveValue(other);
 await expect(page.locator('#revision')).toContainText('جدید');
});
test('late private-file responses never leak the previous project into the new project',async({page})=>{
 const other='99999999-1111-2222-3333-444444444444';
 let releaseOld,oldStarted;
 const oldArrived=new Promise(resolve=>{oldStarted=resolve});
 await page.route('**/api/v1/projects**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body,status=200;
  if(path==='/api/v1/projects')body={projects:[{id:P,name:'پروژه یک',revision:1},{id:other,name:'پروژه دو',revision:1}]};
  else if(path.endsWith('/questions'))body={questions:[]};
  else if(path==='/api/v1/projects/'+P+'/assets'){
   oldStarted();await new Promise(resolve=>{releaseOld=resolve});
   body={assets:[{digest:'a'.repeat(64),role:'question_pdf',mime:'application/pdf',size:250}]};
  }else if(path==='/api/v1/projects/'+other+'/assets')
   body={assets:[{digest:'b'.repeat(64),role:'question_pdf',mime:'application/pdf',size:128}]};
  else{status=404;body={error:'NOT_FOUND'}}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/review-console/bank-studio.html');
 await oldArrived;
 await page.locator('#projectSelect').selectOption(other);
 await expect(page.locator('#assetList')).toContainText('دفترچه سؤال');
 await expect(page.locator('#assetList a').first()).toHaveAttribute('href',new RegExp(other));
 releaseOld();
 await expect(page.locator('#sourceDigest option')).toHaveCount(2);
 await expect(page.locator('#sourceDigest option').last()).toHaveAttribute('value','b'.repeat(64));
 await expect(page.locator('#assetList a').first()).toHaveAttribute('href',new RegExp(other));
});
