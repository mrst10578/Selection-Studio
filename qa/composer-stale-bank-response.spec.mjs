import {test,expect} from '@playwright/test';

const projectId='12345678-1234-1234-1234-123456789012';
const oldId='87654321-1234-1234-1234-123456789012';
const newId='87654321-1234-1234-1234-123456789013';
const row=(id,text)=>({id,projectId,revision:1,questionText:text,sourceNumber:1});

test('a late bank response cannot replace a newer search or selected questions',async({page})=>{
 let releaseOldSearch;
 const requests=[];
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:projectId,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',async route=>{
  const query=new URL(route.request().url()).searchParams.get('q');
  requests.push(query);
  if(query==='قدیمی')await new Promise(resolve=>{releaseOldSearch=resolve});
  const data=query==='قدیمی'
   ?{questions:[row(oldId,'پاسخ قدیمی')],nextCursor:'obsolete-page'}
   :query==='جدید'
    ?{questions:[row(newId,'پاسخ جدید')],nextCursor:null}
    :{questions:[row(oldId,'سؤال انتخاب‌شده')],nextCursor:null};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);

 // The old search is deliberately held while a new query succeeds.
 await page.locator('#composerQuery').fill('قدیمی');
 await page.locator('#loadBank').click();
 await expect.poll(()=>typeof releaseOldSearch).toBe('function');
 await page.locator('#composerQuery').fill('جدید');
 await page.locator('#loadBank').click();
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('پاسخ جدید');
 await expect(page.locator('#loadMoreBank')).toBeHidden();
 const currentNotice=await page.locator('#composerNotice').innerText();

 const oldResponse=page.waitForResponse(response=>
  new URL(response.url()).pathname.endsWith('/api/v1/bank/questions')&&
  new URL(response.url()).searchParams.get('q')==='قدیمی');
 releaseOldSearch();
 await oldResponse;
 await page.waitForLoadState('networkidle');
 // A stale response must not replace results, revive its cursor, or rewrite guidance.
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('پاسخ جدید');
 await expect(page.locator('#approvedList')).not.toContainText('پاسخ قدیمی');
 await expect(page.locator('#loadMoreBank')).toBeHidden();
 await expect(page.locator('#composerNotice')).toHaveText(currentNotice);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(page.locator('#selectedList')).toContainText('سؤال انتخاب‌شده');
 expect(requests).toEqual([null,'قدیمی','جدید']);
});

test('late pagination response cannot resurrect old-filter rows or cursor',async({page})=>{
 let releaseOldPage;
 const requests=[];
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:projectId,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',async route=>{
  const params=new URL(route.request().url()).searchParams;
  const query=params.get('q'),cursor=params.get('cursor');
  requests.push({query,cursor});
  if(cursor==='old-page')await new Promise(resolve=>{releaseOldPage=resolve});
  const data=cursor==='old-page'
   ?{questions:[row(oldId,'سؤال صفحه منقضی')],nextCursor:'ghost-page'}
   :query==='جدید'
    ?{questions:[row(newId,'سؤال جدید')],nextCursor:null}
    :{questions:[row(oldId,'سؤال انتخاب‌شده')],nextCursor:'old-page'};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),more=page.locator('#loadMoreBank');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await expect(more).toBeVisible();

 // Hold a continuation response while the operator switches to a new filter.
 await more.click();
 await expect.poll(()=>typeof releaseOldPage).toBe('function');
 await page.locator('#composerQuery').fill('جدید');
 await expect(more).toBeHidden();
 await page.locator('#loadBank').click();
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال جدید');
 const currentNotice=await page.locator('#composerNotice').innerText();

 const staleResponse=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname.endsWith('/api/v1/bank/questions')&&
   url.searchParams.get('cursor')==='old-page';
 });
 releaseOldPage();
 await staleResponse;
 await page.waitForLoadState('networkidle');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال جدید');
 await expect(page.locator('#approvedList')).not.toContainText('سؤال صفحه منقضی');
 await expect(more).toBeHidden();
 await expect(page.locator('#composerNotice')).toHaveText(currentNotice);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(page.locator('#selectedList')).toContainText('سؤال انتخاب‌شده');
 expect(requests).toEqual([
  {query:null,cursor:null},
  {query:null,cursor:'old-page'},
  {query:'جدید',cursor:null}
 ]);
});
