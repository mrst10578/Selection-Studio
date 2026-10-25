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
