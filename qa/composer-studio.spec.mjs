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

test('approved bank pagination keeps selection, deduplicates rows, and resets cursor on filter edits',async({page})=>{
 const seen=[];
 const row=(id,text)=>({id,projectId:P,revision:1,questionText:text,answerText:'پاسخ',sourceNumber:1});
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const url=new URL(route.request().url()),cursor=url.searchParams.get('cursor'),query=url.searchParams.get('q');
  seen.push({query,cursor});
  const data=query==='دیگر'?{questions:[row(q2,'سؤال دیگر')],nextCursor:null}:
   cursor==='page-2'?{questions:[row(q1,'سؤال تکراری'),row(q2,'سؤال قدیمی')],nextCursor:null}:
   {questions:[row(q1,'سؤال جدید')],nextCursor:'page-2'};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/review-console/composer-studio.html');
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await expect(page.locator('#loadMoreBank')).toBeVisible();
 await page.locator('#approvedList button').first().click();
 await page.locator('#loadMoreBank').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#approvedList button')).toHaveCount(2);
 await expect(page.locator('#approvedList button').nth(1)).toBeFocused();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(page.locator('#loadMoreBank')).toBeHidden();
 expect(seen[1]).toEqual({query:null,cursor:'page-2'});
 await page.locator('#composerQuery').fill('دیگر');
 await expect(page.locator('#approvedList button')).toHaveCount(0);
 await expect(page.locator('#loadMoreBank')).toBeHidden();
 await page.locator('#loadBank').click();
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(seen.at(-1)).toEqual({query:'دیگر',cursor:null});
});

test('duplicate question IDs inside each API page appear only once in the bank',async({page})=>{
 const row=(id,text)=>({id,projectId:P,revision:1,questionText:text,answerText:'پاسخ',sourceNumber:1});
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const append=new URL(route.request().url()).searchParams.has('cursor');
  const data=append?
   {questions:[row(q2,'سؤال دوم'),row(q2,'نسخه تکراری سؤال دوم')],nextCursor:null}:
   {questions:[row(q1,'سؤال اول'),row(q1,'نسخه تکراری سؤال اول')],nextCursor:'page-2'};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(1);
 await expect(page.locator('#approvedList')).not.toContainText('نسخه تکراری');
 await bank.first().click();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await page.locator('#loadMoreBank').click();
 await expect(bank).toHaveCount(2);
 await expect(bank.nth(1)).toContainText('سؤال دوم');
 await expect(page.locator('#approvedList')).not.toContainText('نسخه تکراری');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
});

test('repeated pagination cursors stop safely, preserve selection, and reset on search',async({page})=>{
 const row=(id,text)=>({id,projectId:P,revision:1,questionText:text,answerText:'پاسخ',sourceNumber:1});
 const requests=[];
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const params=new URL(route.request().url()).searchParams;
  const cursor=params.get('cursor'),immediate=params.get('q')==='فوری';
  requests.push({cursor,immediate});
  const data=!cursor?{questions:[row(q1,'سؤال اول')],nextCursor:'cursor-a'}:
   cursor==='cursor-a'?{questions:[row(q2,'سؤال دوم')],nextCursor:immediate?'cursor-a':'cursor-b'}:
   {questions:[row('87654321-1234-1234-1234-123456789014','سؤال سوم')],nextCursor:'cursor-a'};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),more=page.locator('#loadMoreBank');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await more.click();
 await expect(bank).toHaveCount(2);
 await more.click();
 await expect(bank).toHaveCount(3);
 await expect(more).toBeHidden();
 await expect(page.locator('#composerNotice')).toContainText('نشانگر صفحه‌بندی تکراری');
 await expect(page.locator('#composerNotice')).toHaveAttribute('data-state','error');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(requests.map(x=>x.cursor)).toEqual([null,'cursor-a','cursor-b']);
 // A fresh search resets the cursor history, and an immediately repeated cursor is also rejected.
 await page.locator('#composerQuery').fill('فوری');
 await page.locator('#loadBank').click();
 await expect(bank).toHaveCount(1);
 await expect(more).toBeVisible();
 await more.click();
 await expect(bank).toHaveCount(2);
 await expect(more).toBeHidden();
 await expect(page.locator('#composerNotice')).toContainText('نشانگر صفحه‌بندی تکراری');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(requests).toEqual([
  {cursor:null,immediate:false},{cursor:'cursor-a',immediate:false},
  {cursor:'cursor-b',immediate:false},{cursor:null,immediate:true},
  {cursor:'cursor-a',immediate:true}
 ]);
});

test('keyboard selection toggle retains focus after the bank list re-renders',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const first=page.locator('#approvedList button').first();
 await expect(first).toBeVisible();
 await first.focus();
 await page.keyboard.press('Enter');
 await expect(first).toBeFocused();
 await expect(first).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await page.keyboard.press('Enter');
 await expect(first).toBeFocused();
 await expect(first).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(0);
});


test('keyboard reordering follows the moved question across disabled edge controls',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 const rows=page.locator('#selectedList .composer-selection');
 await expect(rows).toHaveCount(2);
 await expect(rows.nth(0)).toContainText('مقدار ۲');
 await expect(rows.nth(1)).toContainText('نتیجه x');
 // Move the second question to the top using only the keyboard.
 await rows.nth(1).getByRole('button',{name:'بالا'}).focus();
 await page.keyboard.press('Enter');
 await expect(rows.nth(0)).toContainText('نتیجه x');
 await expect(rows.nth(0).getByRole('button',{name:'بالا'})).toBeDisabled();
 await expect(rows.nth(0).getByRole('button',{name:'پایین'})).toBeFocused();
 // Focus should follow that question back down, switching controls at the bottom.
 await page.keyboard.press('Enter');
 await expect(rows.nth(1)).toContainText('نتیجه x');
 await expect(rows.nth(1).getByRole('button',{name:'پایین'})).toBeDisabled();
 await expect(rows.nth(1).getByRole('button',{name:'بالا'})).toBeFocused();
});

test('keyboard removal focuses the next, previous, or original bank control',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 const rows=page.locator('#selectedList .composer-selection');
 await rows.nth(0).getByRole('button',{name:'حذف'}).focus();
 await page.keyboard.press('Enter');
 await expect(rows).toHaveCount(1);
 await expect(rows.first()).toContainText('نتیجه x');
 await expect(rows.first().getByRole('button',{name:'حذف'})).toBeFocused();
 // Removing the final selection returns focus to that question in the bank.
 await page.keyboard.press('Enter');
 await expect(rows).toHaveCount(0);
 await expect(bank.nth(1)).toBeFocused();
 // Removing the last row from a nonempty list focuses the previous row.
 await bank.nth(0).click();
 await bank.nth(1).click();
 await rows.nth(1).getByRole('button',{name:'حذف'}).focus();
 await page.keyboard.press('Enter');
 await expect(rows).toHaveCount(1);
 await expect(rows.first()).toContainText('مقدار ۲');
 await expect(rows.first().getByRole('button',{name:'حذف'})).toBeFocused();
});

test('selected question count is announced without repeating on reorder',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const count=page.locator('#composerSelectionCount');
 await expect(count).toHaveAttribute('role','status');
 await expect(count).toHaveAttribute('aria-live','polite');
 await expect(count).toHaveAttribute('aria-atomic','true');
 await expect(count).toHaveText('۰ سؤال انتخاب شده است.');
 const bank=page.locator('#approvedList button');
 await bank.nth(0).click();
 await expect(count).toHaveText('۱ سؤال انتخاب شده است.');
 await bank.nth(1).click();
 await expect(count).toHaveText('۲ سؤال انتخاب شده است.');
 await count.evaluate(el=>{
  window.__countAnnouncements=0;
  new MutationObserver(()=>window.__countAnnouncements++).observe(el,{subtree:true,childList:true,characterData:true});
 });
 await page.locator('#selectedList .composer-selection').nth(1).getByRole('button',{name:'بالا'}).click();
 await expect(count).toHaveText('۲ سؤال انتخاب شده است.');
 expect(await page.evaluate(()=>window.__countAnnouncements)).toBe(0);
 await bank.nth(0).click();
 await expect(count).toHaveText('۱ سؤال انتخاب شده است.');
 await page.locator('#selectedList .composer-selection').first().getByRole('button',{name:'حذف'}).click();
 await expect(count).toHaveText('۰ سؤال انتخاب شده است.');
});


test('pagination restores focus to search when the next page has no new questions',async({page})=>{
 const row={id:q1,projectId:P,revision:1,questionText:'سؤال تکراری',answerText:'پاسخ',sourceNumber:1};
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const next=new URL(route.request().url()).searchParams.has('cursor');
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:next?null:'page-2'})});
 });
 await page.goto('/review-console/composer-studio.html');
 const more=page.locator('#loadMoreBank');
 await expect(more).toBeVisible();
 await more.focus();
 await page.keyboard.press('Enter');
 await expect(more).toBeHidden();
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await expect(page.locator('#loadBank')).toBeFocused();
});

test('keyboard bank refresh restores focus to first result or the search button when empty',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const search=page.locator('#loadBank');
 await page.locator('#composerQuery').fill('پاسخ');
 await search.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#approvedList button').first()).toBeFocused();

 // A second search with no matches must not leave keyboard users on the document body.
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"questions":[],"nextCursor":null}'}));
 await page.locator('#composerQuery').fill('ناموجود');
 await search.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#approvedList button')).toHaveCount(0);
 await expect(search).toBeFocused();
});

test('bank loading uses one concise live status and never announces the whole question list',async({page})=>{
 let finishRequest;
 const row={id:q1,projectId:P,revision:1,questionText:'سؤال نمونه',answerText:'پاسخ',sourceNumber:1};
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{finishRequest=()=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:null})});});
 await page.goto('/review-console/composer-studio.html');
 const status=page.locator('#composerNotice'),list=page.locator('#approvedList');
 await expect(status).toHaveAttribute('role','status');
 await expect(status).toHaveAttribute('aria-live','polite');
 await expect(status).toHaveAttribute('aria-atomic','true');
 await expect(list).not.toHaveAttribute('aria-live');
 await expect(status).toHaveText('در حال جست‌وجوی سؤال‌های تأییدشده…');
 await expect(list).toHaveAttribute('aria-busy','true');
 await expect(list).toContainText('در حال دریافت سؤال‌ها…');
 await expect(list).not.toContainText('پیدا نشد');
 await expect.poll(()=>typeof finishRequest).toBe('function');
 await finishRequest();
 await expect(list).toHaveAttribute('aria-busy','false');
 await expect(list.getByRole('button')).toHaveCount(1);
 await expect(status).toContainText('1 سؤال تأییدشده');
});

test('rapid bank-query edits announce the search hint only once',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const status=page.locator('#composerNotice');
 await expect(status).toContainText('سؤال تأییدشده');
 await expect(status).toHaveAttribute('aria-live','polite');
 const observed=await page.evaluate(async()=>{
  const notice=document.getElementById('composerNotice');
  const input=document.getElementById('composerQuery');
  const updates=[];
  const observer=new MutationObserver(records=>{
   for(const record of records){
    if(record.type==='childList'||record.type==='characterData')updates.push(notice.textContent);
   }
  });
  observer.observe(notice,{childList:true,subtree:true,characterData:true});
  for(const value of ['س','سو','سؤال']){
   input.value=value;
   input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  await Promise.resolve();
  observer.disconnect();
  return {updates,finalText:notice.textContent};
 });
 expect(observed.updates).toHaveLength(1);
 expect(observed.finalText).toContain('عبارت جست‌وجو تغییر کرد');
 await expect(status).toHaveAttribute('data-state','ok');
});

test('same-filter bank refresh keeps old results visible until the replacement arrives',async({page})=>{
 const row=(id,label)=>({id,projectId:P,revision:1,questionText:label,answerText:'پاسخ',sourceNumber:1});
 let requests=0,finishRefresh;
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  requests++;
  if(requests===1)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row(q1,'سؤال قبلی')],nextCursor:'old-page'})});
  finishRefresh=()=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row(q2,'سؤال تازه')],nextCursor:null})});
 });
 await page.goto('/review-console/composer-studio.html');
 const list=page.locator('#approvedList'),bank=list.locator('button');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await page.locator('#loadBank').click();
 await expect.poll(()=>requests).toBe(2);
 await expect(list).toHaveAttribute('aria-busy','true');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال قبلی');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(page.locator('#loadMoreBank')).toBeHidden();
 await finishRefresh();
 await expect(list).toHaveAttribute('aria-busy','false');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال تازه');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
});

test('failed bank request returns keyboard focus to the search control',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 await expect(page.locator('#approvedList button')).toHaveCount(2);
 await page.locator('#composerQuery').fill('خطا');
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"SERVICE_UNAVAILABLE"}'}));
 const search=page.locator('#loadBank');
 await search.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#composerNotice')).toContainText('SERVICE_UNAVAILABLE');
  await expect(page.locator('#composerNotice')).toHaveAttribute('role','status');
  await expect(page.locator('#composerNotice')).toHaveAttribute('aria-atomic','true');
 await expect(search).toBeEnabled();
 await expect(search).toBeFocused();
});

test('failed pagination keeps existing questions and restores keyboard focus',async({page})=>{
 const row={id:q1,projectId:P,revision:1,questionText:'سؤال موجود',answerText:'پاسخ',sourceNumber:1};
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const append=new URL(route.request().url()).searchParams.has('cursor');
  return route.fulfill(append?{status:503,contentType:'application/json',body:'{"error":"PAGE_UNAVAILABLE"}'}:
   {status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:'page-2'})});
 });
 await page.goto('/review-console/composer-studio.html');
 const more=page.locator('#loadMoreBank');
 await expect(more).toBeVisible();
 await more.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#composerNotice')).toContainText('PAGE_UNAVAILABLE');
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await expect(more).toBeEnabled();
 await expect(more).toBeFocused();
});

test('invalid server cursor stops pagination, keeps selection, and allows a fresh search',async({page})=>{
 const row=(id,label)=>({id,projectId:P,revision:1,questionText:label,answerText:'پاسخ',sourceNumber:1});
 let rejected=0,firstPages=0;
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const cursor=new URL(route.request().url()).searchParams.get('cursor');
  if(!cursor){
   firstPages++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row(q1,'سؤال اول')],nextCursor:'stale-cursor'})});
  }
  if(rejected++===0)return route.fulfill({status:400,contentType:'application/json',body:'{"error":"INVALID_CURSOR"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row(q2,'سؤال دوم')],nextCursor:null})});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),more=page.locator('#loadMoreBank'),search=page.locator('#loadBank');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await more.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#composerNotice')).toContainText('نشانگر صفحه‌بندی نامعتبر یا منقضی');
 await expect(page.locator('#composerNotice')).toHaveAttribute('data-state','error');
 await expect(bank).toHaveCount(1);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(more).toBeHidden();
 await expect(search).toBeFocused();
 expect(rejected).toBe(1);
 // Refresh starts from page one; the existing selection is not silently discarded.
 await search.click();
 await expect(more).toBeVisible();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(firstPages).toBe(2);
 await more.click();
 await expect(bank).toHaveCount(2);
 await expect(more).toBeHidden();
 expect(rejected).toBe(2);
});

test('compose export is single-flight while the server validates, then restores keyboard focus',async({page})=>{
 await mock(page);
 let releaseRequest,requests=0;
 await page.route('**/api/v1/bank/exams/compose',async route=>{
  requests++;
  await new Promise(resolve=>{releaseRequest=resolve});
  const payload=route.request().postDataJSON();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifest:{title:payload.title,publishable:false,
    answersIncluded:payload.includeAnswers,items:[{index:1,id:q1,revision:2,question:'مقدار ۲ چند است؟'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 const exportButton=page.locator('#exportJsonl');
 await exportButton.focus();
 await page.keyboard.press('Enter');
 await expect.poll(()=>requests).toBe(1);
 for(const id of ['previewExam','exportJsonl','exportHtml','printExam'])
  await expect(page.locator('#'+id)).toBeDisabled();
 // A synthetic click cannot bypass the in-flight guard even when the button is disabled.
 await page.evaluate(()=>document.getElementById('exportJsonl').dispatchEvent(new MouseEvent('click',{bubbles:true})));
 expect(requests).toBe(1);
 const downloadPromise=page.waitForEvent('download');
 releaseRequest();
 expect((await downloadPromise).suggestedFilename()).toBe('examforge-exam.jsonl');
 await expect(exportButton).toBeEnabled();
 await expect(exportButton).toBeFocused();
 expect(requests).toBe(1);
});

test('failed compose validation re-enables export actions for retry',async({page})=>{
 await mock(page);
 await page.route('**/api/v1/bank/exams/compose',route=>route.fulfill({
  status:503,contentType:'application/json',body:'{"error":"COMPOSE_TEMPORARILY_UNAVAILABLE"}'
 }));
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 const exportButton=page.locator('#exportJsonl');
 await exportButton.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#composerNotice')).toContainText('COMPOSE_TEMPORARILY_UNAVAILABLE');
 await expect(exportButton).toBeEnabled();
 await expect(exportButton).toBeFocused();
});

test('print requests only one dialog after a slow compose response, even with load and fallback',async({page})=>{
 await mock(page);
 let releaseRequest,requests=0;
 await page.route('**/api/v1/bank/exams/compose',async route=>{
  requests++;
  await new Promise(resolve=>{releaseRequest=resolve});
  const payload=route.request().postDataJSON();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifest:{title:payload.title,publishable:false,
    answersIncluded:payload.includeAnswers,items:[{index:1,id:q1,revision:2,question:'مقدار ۲ چند است؟'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 await page.evaluate(()=>{
  window.__printSpy={opened:0,calls:0,html:''};
  window.open=()=>{
   window.__printSpy.opened++;
   return {closed:false,focus(){},close(){},
    document:{open(){},write(html){window.__printSpy.html=html},close(){}},
    addEventListener(type,callback){if(type==='load')setTimeout(callback,0)},
    print(){window.__printSpy.calls++}
   };
  };
 });
 await page.locator('#printExam').click();
 await expect.poll(()=>requests).toBe(1);
 expect(await page.evaluate(()=>window.__printSpy)).toMatchObject({opened:1,calls:0});
 releaseRequest();
 await expect.poll(()=>page.evaluate(()=>window.__printSpy.calls)).toBe(1);
 await page.waitForTimeout(650); // The 500ms fallback must not print a second time.
 const spy=await page.evaluate(()=>window.__printSpy);
 expect(spy).toMatchObject({opened:1,calls:1});
 expect(spy.html).toContain('مقدار ۲');
 await expect(page.locator('#printExam')).toBeEnabled();
});

test('failed print validation closes its popup, restores keyboard focus, and allows retry',async({page})=>{
 await mock(page);
 let attempts=0;
 await page.route('**/api/v1/bank/exams/compose',route=>{
  attempts++;
  if(attempts===1)return route.fulfill({
   status:503,contentType:'application/json',body:'{"error":"PRINT_VALIDATION_UNAVAILABLE"}'
  });
  const payload=route.request().postDataJSON();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifest:{title:payload.title,publishable:false,
    answersIncluded:payload.includeAnswers,items:[{index:1,id:q1,revision:2,question:'مقدار ۲ چند است؟'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 await page.evaluate(()=>{
  window.__printRetrySpy={opened:0,closed:0,printed:0};
  window.open=()=>{
   window.__printRetrySpy.opened++;
   // A popup can move focus off the originating document before validation fails.
   document.activeElement?.blur();
   return {closed:false,focus(){},close(){this.closed=true;window.__printRetrySpy.closed++},
    document:{open(){},write(){},close(){}},
    addEventListener(type,callback){if(type==='load')setTimeout(callback,0)},
    print(){window.__printRetrySpy.printed++}};
  };
 });
 const button=page.locator('#printExam');
 await button.focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#composerNotice')).toContainText('PRINT_VALIDATION_UNAVAILABLE');
 await expect.poll(()=>page.evaluate(()=>window.__printRetrySpy)).toMatchObject({opened:1,closed:1,printed:0});
 await expect(button).toBeEnabled();
 await expect(button).toBeFocused();
 // A transient validation failure must not strand the operator or prevent another attempt.
 await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.__printRetrySpy)).toMatchObject({opened:2,closed:1,printed:1});
 expect(attempts).toBe(2);
 await expect(button).toBeEnabled();
});

test('failed same-filter refresh preserves bank rows, selection, and pagination for retry',async({page})=>{
 const row=(id,label)=>({id,projectId:P,revision:1,questionText:label,answerText:'پاسخ',sourceNumber:1});
 let firstPageCalls=0,continuations=0;
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const cursor=new URL(route.request().url()).searchParams.get('cursor');
  if(cursor==='page-2'){
   continuations++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row(q2,'سؤال دوم')],nextCursor:null})});
  }
  firstPageCalls++;
  if(firstPageCalls===2)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"BANK_REFRESH_UNAVAILABLE"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row(q1,'سؤال اول')],nextCursor:'page-2'})});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),more=page.locator('#loadMoreBank');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await expect(more).toBeVisible();
 await page.locator('#loadBank').click();
 await expect(page.locator('#composerNotice')).toContainText('BANK_REFRESH_UNAVAILABLE');
 await expect(bank).toHaveCount(1);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(more).toBeVisible();
 await more.click();
 await expect(bank).toHaveCount(2);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(firstPageCalls).toBe(2);
 expect(continuations).toBe(1);
});

test('malformed successful bank response keeps previous rows and cursor usable',async({page})=>{
 const valid=(id,label)=>({id,projectId:P,revision:1,questionText:label,answerText:'پاسخ',sourceNumber:1});
 let firstPageCalls=0,continuations=0;
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  const cursor=new URL(route.request().url()).searchParams.get('cursor');
  if(cursor==='page-2'){
   continuations++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[valid(q2,'سؤال دوم')],nextCursor:null})});
  }
  firstPageCalls++;
  // HTTP 200 is not enough: a row without questionText must not poison the UI.
  if(firstPageCalls===2)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[{id:q2,projectId:P,revision:1}],nextCursor:null})});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[valid(q1,'سؤال اول')],nextCursor:'page-2'})});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),more=page.locator('#loadMoreBank');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await page.locator('#loadBank').click();
 await expect(page.locator('#composerNotice')).toContainText('پاسخ بانک سؤال نامعتبر است');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال اول');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(more).toBeVisible();
 await more.click();
 await expect(bank).toHaveCount(2);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(firstPageCalls).toBe(2);
 expect(continuations).toBe(1);
});


test('initial bank failures show retry guidance instead of a false empty result',async({page})=>{
 const row={id:q1,projectId:P,revision:1,questionText:'سؤال بازیابی‌شده',answerText:'پاسخ',sourceNumber:1};
 let requests=0;
 await page.route('**/api/v1/projects',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})}));
 await page.route('**/api/v1/bank/questions**',route=>{
  requests++;
  if(requests===1)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"SERVICE_UNAVAILABLE"}'});
  if(requests===2)return route.fulfill({status:200,contentType:'application/json',body:'{"questions":[{"id":"broken"}]}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:null})});
 });
 await page.goto('/review-console/composer-studio.html');
 const list=page.locator('#approvedList'),search=page.locator('#loadBank');
 await expect(page.locator('#composerNotice')).toContainText('SERVICE_UNAVAILABLE');
 await expect(list).toContainText('دریافت سؤال‌ها ناموفق بود');
 await expect(list).not.toContainText('سؤال تأییدشده‌ای با این جست‌وجو پیدا نشد');
 await expect(search).toBeEnabled();
 await search.click();
 await expect(page.locator('#composerNotice')).toContainText('پاسخ بانک سؤال نامعتبر است');
 await expect(list).toContainText('دریافت سؤال‌ها ناموفق بود');
 await expect(search).toBeEnabled();
 await search.click();
 await expect(list.getByRole('button')).toHaveCount(1);
 await expect(list).toContainText('سؤال بازیابی‌شده');
 await expect(list).not.toContainText('دریافت سؤال‌ها ناموفق بود');
 expect(requests).toBe(3);
});

test('bank search accepts Enter without submitting IME composition',async({page})=>{
 let requests=0;
 const queries=[];
 const row={id:q1,projectId:P,revision:1,questionText:'سؤال آزمون',sourceNumber:1};
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>{
  requests++;
  const q=new URL(route.request().url()).searchParams.get('q');
  queries.push(q);
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   questions:q==='آزمون'?[row]:[],nextCursor:null
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await expect(page.locator('#loadBank')).toBeEnabled();
 await expect.poll(()=>requests).toBe(1);
 const search=page.locator('#composerQuery');
 const hint=page.locator('#composerSearchHint');
 await expect(search).toHaveAttribute('aria-describedby','composerSearchHint');
 await expect(hint).toBeVisible();
 await expect(hint).toContainText('Enter');
 // The static help text must not trigger duplicate live announcements while typing.
 await expect(hint).not.toHaveAttribute('role','status');
 await expect(hint).not.toHaveAttribute('aria-live','polite');
 await search.fill('آزمون');
 await expect(page.locator('#approvedList button')).toHaveCount(0);
 // Enter used to select an IME candidate must not send a premature search.
 await search.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});
 expect(requests).toBe(1);
 await search.press('Enter');
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await expect(page.locator('#approvedList')).toContainText('سؤال آزمون');
 await expect(search).toBeFocused();
 expect(requests).toBe(2);
 expect(queries).toEqual([null,'آزمون']);
});

test('typing repeatedly after a filter edit does not rebuild unchanged bank or selected rows',async({page})=>{
 let requests=0;
 page.on('request',request=>{
  if(new URL(request.url()).pathname==='/api/v1/bank/questions')requests++;
 });
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),selected=page.locator('#selectedList .composer-selection');
 await expect(bank).toHaveCount(2);
 await bank.first().click();
 await expect(selected).toHaveCount(1);
 const search=page.locator('#composerQuery');
 // The first edit must invalidate the old results and pagination.
 await search.fill('الف');
 await expect(bank).toHaveCount(0);
 await expect(selected).toHaveCount(1);
 await page.evaluate(()=>{
  const approved=document.getElementById('approvedList');
  const selectedList=document.getElementById('selectedList');
  const snapshot={
   selectedRow:selectedList.querySelector('.composer-selection'),
   emptyRow:approved.firstChild,
   mutations:0
  };
  const observer=new MutationObserver(records=>{snapshot.mutations+=records.length});
  for(const node of [approved,selectedList])
   observer.observe(node,{childList:true,subtree:true,characterData:true});
  window.__bankDomSnapshot={snapshot,observer};
 });
 // No bank data changed since the first edit. These inputs must not recreate
 // the selected question's controls or the empty-result placeholder.
 await search.fill('الفب');
 await search.fill('الفبا');
 const observed=await page.evaluate(()=>{
  const {snapshot,observer}=window.__bankDomSnapshot;
  const mutations=snapshot.mutations+observer.takeRecords().length;
  observer.disconnect();
  delete window.__bankDomSnapshot;
  return {
   mutations,
   selectionPreserved:snapshot.selectedRow===document.querySelector('#selectedList .composer-selection'),
   placeholderPreserved:snapshot.emptyRow===document.getElementById('approvedList').firstChild
  };
 });
 expect(observed).toEqual({mutations:0,selectionPreserved:true,placeholderPreserved:true});
 expect(requests).toBe(1); // Typing alone must not fetch.
 await search.press('Enter');
 await expect(bank).toHaveCount(2);
 await expect(selected).toHaveCount(1);
 expect(requests).toBe(2);
});

test('selected question controls retain DOM identity and focus across same-filter bank refresh',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 const row=page.locator('#selectedList .composer-selection').first();
 const remove=row.getByRole('button',{name:'حذف'});
 await remove.focus();
 await expect(remove).toBeFocused();
 await row.evaluate(el=>{window.__selectedRowBeforeRefresh=el;});
 // Programmatic activation avoids moving focus to the search button.
 // A bank-only refresh must not replace the selected question's controls.
 const response=page.waitForResponse(r=>r.url().includes('/api/v1/bank/questions')&&r.status()===200);
 await page.evaluate(()=>document.getElementById('loadBank').click());
 await response;
 await expect(page.locator('#loadBank')).toBeEnabled();
 expect(await row.evaluate(el=>el===window.__selectedRowBeforeRefresh)).toBe(true);
 await expect(remove).toBeFocused();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
});


test('bank refresh preserves keyboard focus on the same question after row reordering',async({page})=>{
 let loads=0;
 const rows=[
  {id:q1,projectId:P,revision:1,questionText:'سؤال اول',sourceNumber:1},
  {id:q2,projectId:P,revision:1,questionText:'سؤال دوم',sourceNumber:2}
 ];
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>{
  const questions=loads++===0?rows:[...rows].reverse();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({questions})});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.first().focus();
 await expect(bank.first()).toBeFocused();
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/bank/questions'&&r.status()===200);
 // Trigger refresh without changing focus to the search button.
 await page.evaluate(()=>document.getElementById('loadBank').click());
 await response;
 await expect(bank.first()).toContainText('سؤال دوم');
 await expect(bank.nth(1)).toHaveAttribute('data-question-id',q1);
 await expect(bank.nth(1)).toBeFocused();
 expect(loads).toBe(2);
});

test('filtered bank rejects a cross-project API row without replacing valid results',async({page})=>{
 const foreignProject='12345678-1234-1234-1234-123456789099';
 const own={id:q1,projectId:P,revision:1,questionText:'سؤال پروژه خودم',sourceNumber:1};
 const foreign={id:q2,projectId:foreignProject,revision:1,questionText:'سؤال پروژه دیگر',sourceNumber:2};
 let filteredRequests=0;
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>{
  const selectedProject=new URL(route.request().url()).searchParams.get('projectId');
  if(selectedProject===P)filteredRequests++;
  const questions=selectedProject===P&&filteredRequests===2?[own,foreign]:[own];
  return route.fulfill({
   status:200,contentType:'application/json',
   body:JSON.stringify({questions,nextCursor:null})
  });
 });
 await page.goto('/review-console/composer-studio.html');
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await page.locator('#composerProject').selectOption(P);
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await page.locator('#approvedList button').first().click();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await page.locator('#loadBank').click();
 await expect(page.locator('#composerNotice')).toContainText('با پروژه انتخاب‌شده مطابقت ندارد');
 await expect(page.locator('#composerNotice')).toHaveAttribute('data-state','error');
 await expect(page.locator('#approvedList button')).toHaveCount(1);
 await expect(page.locator('#approvedList')).toContainText('سؤال پروژه خودم');
 await expect(page.locator('#approvedList')).not.toContainText('سؤال پروژه دیگر');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(filteredRequests).toBe(2);
});
