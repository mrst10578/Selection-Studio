import {test,expect} from '@playwright/test';
const P='12345678-1234-1234-1234-123456789012',q1='87654321-1234-1234-1234-123456789012',q2='87654321-1234-1234-1234-123456789013';
async function mock(page,{stale=false,identicalText=false,sourceNumbers=[1,2]}={}){
 const calls=[],rows=[{id:q1,projectId:P,revision:2,questionText:'مقدار ۲ چند است؟',answerText:'دو',sourceNumber:sourceNumbers[0]},
  {id:q2,projectId:P,revision:1,questionText:identicalText?'مقدار ۲ چند است؟':'نتیجه x^2 چیست؟',answerText:'مجذور x',sourceNumber:sourceNumbers[1]}];
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

test('all-project bank labels each question with its project and keeps filtered rows concise',async({page})=>{
 const P2='12345678-1234-1234-1234-123456789099';
 const rows=[
  {id:q1,projectId:P,revision:1,questionText:'سؤال زیست',sourceNumber:1},
  {id:q2,projectId:P2,revision:1,questionText:'سؤال فیزیک',sourceNumber:1}
 ];
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:P,name:'زیست'},{id:P2,name:'فیزیک'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>{
  const projectId=new URL(route.request().url()).searchParams.get('projectId');
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   questions:projectId?rows.filter(row=>row.projectId===projectId):rows,nextCursor:null
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await expect(bank.nth(0)).toContainText('پروژه: زیست');
 await expect(bank.nth(1)).toContainText('پروژه: فیزیک');
 // Equal source numbers in different projects must be distinguishable.
 await bank.nth(1).click();
 const selected=page.locator('#selectedList .composer-selection');
 await expect(selected).toHaveCount(1);
 await expect(selected.first()).toContainText('پروژه: فیزیک');
 await expect(selected.first()).toContainText('سؤال فیزیک');
 await bank.nth(0).click();
 await expect(selected).toHaveCount(2);
 await expect(selected.nth(1)).toContainText('پروژه: زیست');
 // Reordering must keep the project name attached to its question.
 await selected.nth(1).getByRole('button',{name:'بالا'}).click();
 await expect(selected.nth(0)).toContainText('پروژه: زیست');
 await expect(selected.nth(1)).toContainText('پروژه: فیزیک');
 await page.locator('#composerProject').selectOption(P2);
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال فیزیک');
 await expect(bank.first()).not.toContainText('پروژه:');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(0);
 await page.locator('#composerProject').selectOption('');
 await expect(bank).toHaveCount(2);
 await expect(bank.nth(1)).toContainText('پروژه: فیزیک');
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

test('transient same-filter refresh failure keeps the last bank and open validated preview',async({page})=>{
 let requests=0;
 const hash='a'.repeat(64);
 const row={id:q1,projectId:P,revision:2,questionText:'سؤال تأییدشده',answerText:'پاسخ',sourceNumber:1};
 await mock(page);
 await page.route('**/api/v1/bank/questions**',route=>{
  requests++;
  return route.fulfill(requests===1?
   {status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:null})}:
   {status:503,contentType:'application/json',body:'{"error":"SERVICE_UNAVAILABLE"}'});
 });
 await page.route('**/api/v1/bank/exams/compose',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:hash,
   manifest:{title:'آزمون',publishable:false,answersIncluded:false,
    items:[{index:1,id:q1,revision:2,question:'سؤال تأییدشده'}]}
  })
 }));
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),selected=page.locator('#selectedList .composer-selection');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 await page.locator('#previewExam').click();
 await expect(page.locator('#examPreviewDialog')).toBeVisible();
 await expect(page.locator('#examFingerprint')).toContainText(hash);
 // Refresh from the open modal without changing the draft or closing its snapshot.
 await page.evaluate(()=>document.getElementById('loadBank').click());
 await expect.poll(()=>requests).toBe(2);
 await expect(page.locator('#composerNotice')).toHaveText(
  'بازخوانی بانک موقتاً ناموفق بود؛ نتایج قبلی و سؤال‌های انتخاب‌شده حفظ شدند. دوباره تلاش کن.');
 await expect(page.locator('#composerNotice')).toHaveAttribute('data-state','error');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال تأییدشده');
 await expect(selected).toHaveCount(1);
 await expect(page.locator('#composerSelectionCount')).toHaveText('۱ سؤال انتخاب شده است.');
 await expect(page.locator('#examPreviewDialog')).toBeVisible();
 await expect(page.locator('#examFingerprint')).toContainText(hash);
 await expect(page.locator('#loadBank')).toBeEnabled();
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

test('selected-question mobile actions provide 44px touch targets without overflow',async({page})=>{
 await mock(page);
 await page.setViewportSize({width:320,height:720});
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 const actions=page.locator('#selectedList .composer-selection .bank-actions');
 await expect(actions.locator('button')).toHaveCount(3);
 for(const width of [320,375]){
  await page.setViewportSize({width,height:720});
  const metrics=await actions.evaluate(el=>{
   const parent=el.getBoundingClientRect();
   return {
    clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,
    buttons:[...el.querySelectorAll('button')].map(button=>{
     const rect=button.getBoundingClientRect();
     return {width:rect.width,height:rect.height,left:rect.left,right:rect.right,
      withinRow:rect.left>=parent.left-1&&rect.right<=parent.right+1};
    })
   };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth+1);
  expect(metrics.buttons).toHaveLength(3);
  for(const button of metrics.buttons){
   expect(button.width).toBeGreaterThanOrEqual(44);
   expect(button.height).toBeGreaterThanOrEqual(44);
   expect(button.withinRow).toBe(true);
  }
 }
});

test('long Persian selected-question labels wrap at narrow widths and simulated 200% zoom',async({page})=>{
 const projectName='پروژه'.repeat(50);
 const questionText='سؤال'.repeat(45);
 const row={id:q1,projectId:P,revision:1,questionText,sourceNumber:1};
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:P,name:projectName}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({questions:[row],nextCursor:null})
 }));
 await page.setViewportSize({width:320,height:720});
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 const selected=page.locator('#selectedList .composer-selection');
 await expect(selected).toHaveCount(1);
 await expect(selected).toContainText(projectName);
 for(const width of [320,375]){
  await page.setViewportSize({width,height:720});
  for(const zoom of [1,2]){
   // CSS zoom approximates the reduced layout space at 200% browser zoom.
   await page.evaluate(value=>{document.documentElement.style.zoom=String(value)},zoom);
   const metrics=await selected.evaluate(el=>{
    const label=el.querySelector('span');
    const actions=el.querySelector('.bank-actions');
    const list=el.parentElement;
    return {
     wrapping:getComputedStyle(label).overflowWrap,
     rowWidth:el.clientWidth,rowScrollWidth:el.scrollWidth,
     labelWidth:label.clientWidth,labelScrollWidth:label.scrollWidth,
     actionsWidth:actions.clientWidth,actionsScrollWidth:actions.scrollWidth,
     listWidth:list.clientWidth,listScrollWidth:list.scrollWidth
    };
   });
   expect(metrics.wrapping).toBe('anywhere');
   expect(metrics.rowScrollWidth).toBeLessThanOrEqual(metrics.rowWidth+1);
   expect(metrics.labelScrollWidth).toBeLessThanOrEqual(metrics.labelWidth+1);
   expect(metrics.actionsScrollWidth).toBeLessThanOrEqual(metrics.actionsWidth+1);
   expect(metrics.listScrollWidth).toBeLessThanOrEqual(metrics.listWidth+1);
  }
 }
});

test('selected-question actions identify their target to screen readers after reordering',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),selected=page.locator('#selectedList .composer-selection');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 await expect(selected).toHaveCount(2);
 // The visible labels remain short, but accessible names identify each target.
 const firstRemove=selected.nth(0).getByRole('button',{name:/^حذف، سؤال 1/});
 const secondRemove=selected.nth(1).getByRole('button',{name:/^حذف، سؤال 2/});
 await expect(firstRemove).toHaveAccessibleName(/پروژه زیست، مقدار ۲ چند است/);
 await expect(secondRemove).toHaveAccessibleName(/پروژه زیست، نتیجه x\^2 چیست/);
 await expect(firstRemove).toHaveText('حذف');
 const moveUp=selected.nth(1).getByRole('button',{name:/^بالا، سؤال 2/});
 await expect(moveUp).toHaveAccessibleName(/نتیجه x\^2 چیست/);
 await moveUp.focus();
 await page.keyboard.press('Enter');
 await expect(selected.nth(0)).toContainText('نتیجه x^2 چیست');
 await expect(selected.nth(0).getByRole('button',{name:/^حذف، سؤال 1/})).toHaveAccessibleName(/نتیجه x\^2 چیست/);
 await expect(selected.nth(1).getByRole('button',{name:/^حذف، سؤال 2/})).toHaveAccessibleName(/مقدار ۲ چند است/);
});

test('selected-question list retains semantic and keyboard order when action buttons wrap',async({page})=>{
 await mock(page);
 await page.setViewportSize({width:320,height:720});
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 const list=page.getByRole('list',{name:'ترتیب سؤالات انتخاب‌شده'});
 await expect(list).toHaveJSProperty('tagName','UL');
 const rows=list.getByRole('listitem');
 await expect(rows.first()).toHaveJSProperty('tagName','LI');
 await expect(rows).toHaveCount(2);
 await expect(rows.nth(0)).toContainText('مقدار ۲ چند است');
 await expect(rows.nth(1)).toContainText('نتیجه x^2 چیست');
 // Force a multi-row action group at simulated high zoom; visual wrapping
 // must not reorder the DOM or keyboard tab sequence.
 await page.evaluate(()=>{document.documentElement.style.zoom='2'});
 const actions=rows.nth(0).locator('.bank-actions');
 await actions.evaluate(el=>{el.style.maxWidth='110px'});
 const tops=await actions.locator('button').evaluateAll(buttons=>
  buttons.map(button=>Math.round(button.getBoundingClientRect().top)));
 expect(new Set(tops).size).toBeGreaterThan(1);
 await rows.nth(0).getByRole('button',{name:/^پایین، سؤال 1/}).focus();
 await page.keyboard.press('Tab');
 await expect(rows.nth(0).getByRole('button',{name:/^حذف، سؤال 1/})).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/})).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(rows.nth(1).getByRole('button',{name:/^حذف، سؤال 2/})).toBeFocused();
 // Reordering via keyboard must update list reading order and retain focus.
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).focus();
 await page.keyboard.press('Enter');
 await expect(rows.nth(0)).toContainText('نتیجه x^2 چیست');
 await expect(rows.nth(0).getByRole('button',{name:/^پایین، سؤال 1/})).toBeFocused();
});


test('keyboard reordering announces the moved question and its new position',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 const rows=page.getByRole('list',{name:'ترتیب سؤالات انتخاب‌شده'}).getByRole('listitem');
 await expect(rows).toHaveCount(2);
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).focus();
 await page.keyboard.press('Enter');
 const notice=page.locator('#composerNotice');
 await expect(notice).toHaveAttribute('role','status');
 await expect(notice).toHaveAttribute('aria-live','polite');
 await expect(notice).toHaveText('سؤال «نتیجه x^2 چیست؟» (شماره منبع ۲) به جایگاه ۱ منتقل شد.');
 await expect(rows.nth(0)).toContainText('نتیجه x^2 چیست');
 await expect(page.locator('#composerSelectionCount')).toHaveText('۲ سؤال انتخاب شده است.');
 await rows.nth(0).getByRole('button',{name:/^پایین، سؤال 1/}).focus();
 await page.keyboard.press('Enter');
 await expect(notice).toHaveText('سؤال «نتیجه x^2 چیست؟» (شماره منبع ۲) به جایگاه ۲ منتقل شد.');
 await expect(rows.nth(1)).toContainText('نتیجه x^2 چیست');
});

test('selected-question removal announces the removed question and preserves keyboard focus',async({page})=>{
 await mock(page);
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await bank.first().click();
 await bank.nth(1).click();
 const rows=page.locator('#selectedList .composer-selection');
 await expect(rows).toHaveCount(2);
 await rows.nth(0).getByRole('button',{name:/^حذف، سؤال 1/}).focus();
 await page.keyboard.press('Enter');
 const notice=page.locator('#composerNotice');
 await expect(notice).toHaveAttribute('aria-live','polite');
 await expect(notice).toHaveText('سؤال «مقدار ۲ چند است؟» از آزمون حذف شد. ۱ سؤال باقی ماند.');
 await expect(rows).toHaveCount(1);
 await expect(page.locator('#composerSelectionCount')).toHaveText('۱ سؤال انتخاب شده است.');
 await expect(rows.first().getByRole('button',{name:/^حذف، سؤال 1/})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(notice).toHaveText('سؤال «نتیجه x^2 چیست؟» از آزمون حذف شد. ۰ سؤال باقی ماند.');
 await expect(rows).toHaveCount(0);
 await expect(page.locator('#composerSelectionCount')).toHaveText('۰ سؤال انتخاب شده است.');
 await expect(bank.nth(1)).toBeFocused();
});


test('rapid removal of identically worded questions keeps each announcement distinct',async({page})=>{
 await mock(page,{identicalText:true});
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 const rows=page.locator('#selectedList .composer-selection');
 const notice=page.locator('#composerNotice');
 await rows.first().getByRole('button',{name:/^حذف، سؤال 1/}).focus();
 await page.keyboard.press('Enter');
 await expect(notice).toHaveText('سؤال «مقدار ۲ چند است؟» از آزمون حذف شد. ۱ سؤال باقی ماند.');
 await expect(rows).toHaveCount(1);
 await expect(rows.first().getByRole('button',{name:/^حذف، سؤال 1/})).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(notice).toHaveText('سؤال «مقدار ۲ چند است؟» از آزمون حذف شد. ۰ سؤال باقی ماند.');
 await expect(rows).toHaveCount(0);
 await expect(page.locator('#composerSelectionCount')).toHaveText('۰ سؤال انتخاب شده است.');
 await expect(bank.nth(1)).toBeFocused();
});

test('rapid reordering of identical questions announces their distinct source numbers',async({page})=>{
 await mock(page,{identicalText:true});
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 const rows=page.locator('#selectedList .composer-selection');
 const notice=page.locator('#composerNotice');
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).focus();
 await page.keyboard.press('Enter');
 const firstAnnouncement=await notice.textContent();
 expect(firstAnnouncement).toBe('سؤال «مقدار ۲ چند است؟» (شماره منبع ۲) به جایگاه ۱ منتقل شد.');
 await expect(rows.nth(0)).toContainText('مقدار ۲ چند است؟');
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).focus();
 await page.keyboard.press('Enter');
 const secondAnnouncement=await notice.textContent();
 expect(secondAnnouncement).toBe('سؤال «مقدار ۲ چند است؟» (شماره منبع ۱) به جایگاه ۱ منتقل شد.');
 expect(secondAnnouncement).not.toBe(firstAnnouncement);
 await expect(rows.nth(0)).toContainText('مقدار ۲ چند است؟');
 await expect(rows.nth(0).getByRole('button',{name:/^پایین، سؤال 1/})).toBeFocused();
 await expect(page.locator('#composerSelectionCount')).toHaveText('۲ سؤال انتخاب شده است.');
});

for(const [caseName,sourceNumbers] of [['duplicate',[1,1]],['missing',[null,null]]]){
 test('rapid reordering with '+caseName+' source numbers announces stable selection order',async({page})=>{
  await mock(page,{identicalText:true,sourceNumbers});
  await page.goto('/review-console/composer-studio.html');
  const bank=page.locator('#approvedList button');
  await expect(bank).toHaveCount(2);
  await bank.nth(0).click();
  await bank.nth(1).click();
  const rows=page.locator('#selectedList .composer-selection');
  const notice=page.locator('#composerNotice');
  await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).focus();
  await page.keyboard.press('Enter');
  const firstAnnouncement=await notice.textContent();
  expect(firstAnnouncement).toBe('سؤال «مقدار ۲ چند است؟» (انتخاب شماره ۲) به جایگاه ۱ منتقل شد.');
  await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).focus();
  await page.keyboard.press('Enter');
  const secondAnnouncement=await notice.textContent();
  expect(secondAnnouncement).toBe('سؤال «مقدار ۲ چند است؟» (انتخاب شماره ۱) به جایگاه ۱ منتقل شد.');
  expect(secondAnnouncement).not.toBe(firstAnnouncement);
  await expect(rows.nth(0).getByRole('button',{name:/^پایین، سؤال 1/})).toBeFocused();
  await expect(page.locator('#composerSelectionCount')).toHaveText('۲ سؤال انتخاب شده است.');
 });
}

test('selection order survives refresh and changes only after reselect',async({page})=>{
 // The refreshed bank contains new JS objects for the same IDs, while selected
 // questions keep their original objects until explicitly deselected.
 await mock(page,{identicalText:true,sourceNumbers:[null,null]});
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 const rows=page.locator('#selectedList .composer-selection');
 const notice=page.locator('#composerNotice');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 await page.locator('#loadBank').click();
 await expect(bank).toHaveCount(2);
 await expect(rows).toHaveCount(2);
 await expect(bank.nth(0)).toHaveAttribute('aria-pressed','true');
 // Refresh alone must not reassign the original selection ordinal.
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).click();
 await expect(notice).toHaveText('سؤال «مقدار ۲ چند است؟» (انتخاب شماره ۲) به جایگاه ۱ منتقل شد.');
 // Deselect through the refreshed bank, then reselect: this is a new selection.
 await bank.nth(0).click();
 await expect(rows).toHaveCount(1);
 await expect(bank.nth(0)).toHaveAttribute('aria-pressed','false');
 await bank.nth(0).click();
 await expect(rows).toHaveCount(2);
 await expect(bank.nth(0)).toHaveAttribute('aria-pressed','true');
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).click();
 await expect(notice).toHaveText('سؤال «مقدار ۲ چند است؟» (انتخاب شماره ۳) به جایگاه ۱ منتقل شد.');
 // The other question must retain its ordinal even after the refresh and toggle.
 await rows.nth(1).getByRole('button',{name:/^بالا، سؤال 2/}).click();
 await expect(notice).toHaveText('سؤال «مقدار ۲ چند است؟» (انتخاب شماره ۲) به جایگاه ۱ منتقل شد.');
 await expect(rows).toHaveCount(2);
 await expect(page.locator('#composerSelectionCount')).toHaveText('۲ سؤال انتخاب شده است.');
 await expect(rows.nth(0).getByRole('button',{name:/^پایین، سؤال 1/})).toBeFocused();
});

test('refresh warns about stale selected revisions and requires deliberate reselect',async({page})=>{
 let revision=2;
 const composeRequests=[];
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({questions:[{
   id:q1,projectId:P,revision,questionText:'سؤال با نسخه جدید',answerText:'پاسخ',sourceNumber:1
  }],nextCursor:null})
 }));
 await page.route('**/api/v1/bank/exams/compose',route=>{
  const payload=route.request().postDataJSON();
  composeRequests.push(payload);
  if(payload.sourceRevisions[0]!==revision)return route.fulfill({
   status:409,contentType:'application/json',body:'{"error":"UNAPPROVED_OR_STALE_QUESTION"}'
  });
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',
   manifest:{title:payload.title,publishable:false,items:[{index:1,question:'سؤال با نسخه جدید'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),notice=page.locator('#composerNotice');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 revision=3;
 await page.locator('#loadBank').click();
 await expect(notice).toHaveText('۱ سؤال انتخاب‌شده نسخه متفاوتی در بانک دارد؛ برای انتخاب نسخه جدید، آن را حذف و دوباره انتخاب کن.');
 await expect(notice).toHaveAttribute('data-state','error');
 await expect(bank.first()).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#composerSelectionCount')).toHaveText('۱ سؤال انتخاب شده است.');
 // A refresh must not silently overwrite the selected revision or bypass server validation.
 await page.locator('#previewExam').click();
 await expect(notice).toContainText('بانک را بازخوانی کن و سؤال‌های تغییرکرده را حذف و دوباره انتخاب کن.');
 await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 expect(composeRequests[0].sourceRevisions).toEqual([2]);
 // Refresh again, then explicitly deselect/reselect the current approved revision.
 await page.locator('#loadBank').click();
 await expect(notice).toContainText('نسخه متفاوتی در بانک دارد');
 await bank.first().click();
 await expect(notice).toHaveText('انتخاب سؤال‌ها با نسخه فعلی بانک هماهنگ شد.');
 await bank.first().click();
 await expect(page.locator('#composerSelectionCount')).toHaveText('۱ سؤال انتخاب شده است.');
 await page.locator('#previewExam').click();
 await expect(page.locator('#examPreviewDialog')).toBeVisible();
 expect(composeRequests[1].sourceRevisions).toEqual([3]);
});

test('bank refresh distinguishes unchecked selected questions from known stale revisions across pages',async({page})=>{
 let phase=0;
 const row=(id,revision,label)=>({id,projectId:P,revision,questionText:label,sourceNumber:1});
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>{
  const cursor=new URL(route.request().url()).searchParams.get('cursor');
  const data=phase===0?{questions:[row(q1,2,'سؤال اول'),row(q2,1,'سؤال دوم')],nextCursor:null}:
   cursor?{questions:[row(q2,phase===1?1:2,'سؤال دوم')],nextCursor:null}:
   {questions:[row(q1,phase===1?2:3,'سؤال اول')],nextCursor:'page-2'};
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button'),notice=page.locator('#composerNotice');
 await expect(bank).toHaveCount(2);
 await bank.nth(0).click();
 await bank.nth(1).click();
 phase=1;
 await page.locator('#loadBank').click();
 await expect(bank).toHaveCount(1);
 await expect(notice).toContainText('۱ سؤال انتخاب‌شده در نتایج فعلی نیست و نسخه آن در این بازخوانی بررسی نشد.');
 await expect(notice).not.toContainText('نسخه متفاوتی در بانک دارد');
 await expect(notice).toHaveAttribute('data-state','ok');
 await expect(page.locator('#composerSelectionCount')).toHaveText('۲ سؤال انتخاب شده است.');
 await page.locator('#loadMoreBank').click();
 await expect(bank).toHaveCount(2);
 await expect(notice).not.toContainText('در نتایج فعلی نیست');
 await expect(notice).not.toContainText('نسخه متفاوتی در بانک دارد');

 phase=2;
 await page.locator('#loadBank').click();
 await expect(bank).toHaveCount(1);
 await expect(notice).toContainText('۱ سؤال انتخاب‌شده نسخه متفاوتی در بانک دارد');
 await expect(notice).toContainText('۱ سؤال انتخاب‌شده در نتایج فعلی نیست');
 await expect(notice).toHaveAttribute('data-state','error');
 await expect(bank.first()).toHaveAttribute('aria-pressed','true');
 await page.locator('#loadMoreBank').click();
 await expect(bank).toHaveCount(2);
 await expect(notice).toContainText('۲ سؤال انتخاب‌شده نسخه متفاوتی در بانک دارد');
 await expect(notice).not.toContainText('در نتایج فعلی نیست');
 await expect(page.locator('#composerSelectionCount')).toHaveText('۲ سؤال انتخاب شده است.');
});

test('revoked or deleted selected question gives safe recovery guidance after server 409',async({page})=>{
 let approved=true,composeAttempts=0;
 const row={id:q1,projectId:P,revision:1,questionText:'سؤال حذف‌شده',sourceNumber:1};
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({questions:approved?[row]:[],nextCursor:null})
 }));
 await page.route('**/api/v1/bank/exams/compose',route=>{
  composeAttempts++;
  return route.fulfill({status:409,contentType:'application/json',body:'{"error":"UNAPPROVED_OR_STALE_QUESTION"}'});
 });
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 approved=false;
 await page.locator('#loadBank').click();
 await expect(page.locator('#approvedList button')).toHaveCount(0);
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 // Missing from the current result alone is not proof of deletion.
 await expect(page.locator('#composerNotice')).toContainText('نسخه آن در این بازخوانی بررسی نشد');
 await expect(page.locator('#composerNotice')).not.toContainText('تأییدش لغو شده');
 await page.locator('#previewExam').click();
 const notice=page.locator('#composerNotice');
 await expect(notice).toContainText('اگر سؤالی از بانک حذف شده یا تأییدش لغو شده است');
 await expect(notice).toContainText('آن را از آزمون حذف کن');
 await expect(notice).toHaveAttribute('data-state','error');
 await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 expect(composeAttempts).toBe(1);
 await page.locator('#selectedList .composer-selection').getByRole('button',{name:/^حذف/}).click();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(0);
 await expect(page.locator('#previewExam')).toBeDisabled();
});

test('stale fingerprint is cleared before rejected revalidation',async({page})=>{
 await mock(page);
 const fingerprint='a'.repeat(64);
 let requests=0;
 await page.route('**/api/v1/bank/exams/compose',route=>{
  requests++;
  if(requests>1)return route.fulfill({
   status:409,contentType:'application/json',body:'{"error":"UNAPPROVED_OR_STALE_QUESTION"}'
  });
  const payload=route.request().postDataJSON();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:fingerprint,
   manifest:{title:payload.title,publishable:false,answersIncluded:false,
    items:[{index:1,id:q1,revision:2,question:'مقدار ۲ چند است؟'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 await page.locator('#previewExam').click();
 await expect(page.locator('#examPreviewDialog')).toBeVisible();
 await expect(page.locator('#examFingerprint')).toContainText(fingerprint);
 await page.locator('#closeExamPreview').click();
 await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 // Keyboard activation avoids mobile viewport hit-target overlap after dialog close.
 await page.locator('#previewExam').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('#composerNotice')).toContainText('تأییدشان منقضی شده');
 await expect(page.locator('#examFingerprint')).toHaveText('شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.');
 await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 expect(requests).toBe(2);
});


test('export fingerprint clears immediately when title, answers, order or selection changes',async({page})=>{
 await mock(page);
 const fingerprint='c'.repeat(64);
 await page.route('**/api/v1/bank/exams/compose',route=>{
  const payload=route.request().postDataJSON();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:fingerprint,
   manifest:{title:payload.title,publishable:false,answersIncluded:payload.includeAnswers,
    items:payload.questionIds.map((id,i)=>({index:i+1,id,revision:payload.sourceRevisions[i],question:'سؤال نمونه'}))}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await bank.first().click();
 await bank.nth(1).click();
 const fingerprintLabel=page.locator('#examFingerprint');
 const placeholder='شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.';
 const preview=async()=>{
  await page.locator('#previewExam').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#examPreviewDialog')).toBeVisible();
  await expect(fingerprintLabel).toContainText(fingerprint);
  await page.locator('#closeExamPreview').click();
  await expect(page.locator('#examPreviewDialog')).not.toBeVisible();
 };
 await preview();
 await page.locator('#examTitle').fill('آزمون ویرایش‌شده');
 await expect(fingerprintLabel).toHaveText(placeholder);
 await preview();
 await page.locator('#includeExamAnswers').check();
 await expect(fingerprintLabel).toHaveText(placeholder);
 await preview();
 const selected=page.locator('#selectedList .composer-selection');
 await selected.nth(1).getByRole('button',{name:/^بالا/}).click();
 await expect(fingerprintLabel).toHaveText(placeholder);
 await preview();
 await selected.first().getByRole('button',{name:/^حذف/}).click();
 await expect(fingerprintLabel).toHaveText(placeholder);
 await expect(selected).toHaveCount(1);
});

test('editing a draft during server validation rejects the superseded response',async({page})=>{
 await mock(page);
 const fingerprint='d'.repeat(64);
 let releaseResponse,requests=0;
 await page.route('**/api/v1/bank/exams/compose',async route=>{
  requests++;
  if(requests===2)await new Promise(resolve=>{releaseResponse=resolve;});
  const payload=route.request().postDataJSON();
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:fingerprint,
   manifest:{title:payload.title,publishable:false,answersIncluded:false,
    items:[{index:1,id:q1,revision:2,question:'مقدار ۲ چند است؟'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 await page.locator('#approvedList button').first().click();
 const previewButton=page.locator('#previewExam'),dialog=page.locator('#examPreviewDialog');
 await previewButton.focus();
 await page.keyboard.press('Enter');
 await expect(dialog).toBeVisible();
 await expect(page.locator('#examFingerprint')).toContainText(fingerprint);
 await page.locator('#closeExamPreview').click();
 await page.locator('#examTitle').fill('نسخه دوم');
 await previewButton.focus();
 await page.keyboard.press('Enter');
 await expect.poll(()=>typeof releaseResponse).toBe('function');
 await page.locator('#examTitle').fill('نسخه سوم');
 releaseResponse();
 await expect(page.locator('#composerNotice')).toContainText('آزمون هنگام ساخت خروجی تغییر کرد');
 await expect(page.locator('#examFingerprint')).toHaveText('شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.');
 await expect(dialog).not.toBeVisible();
 await expect(previewButton).toBeEnabled();
 expect(requests).toBe(2);
});


test('bank revision change invalidates an already-open preview and fingerprint',async({page})=>{
 let revision=2,bankRequests=0,releaseRefresh;
 const fingerprint='e'.repeat(64);
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify({projects:[{id:P,name:'زیست'}]})
 }));
 await page.route('**/api/v1/bank/questions**',async route=>{
  bankRequests++;
  if(bankRequests===2)await new Promise(resolve=>{releaseRefresh=resolve;});
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   questions:[{id:q1,projectId:P,revision,questionText:'سؤال نسخه‌دار',sourceNumber:1}],nextCursor:null
  })});
 });
 await page.route('**/api/v1/bank/exams/compose',route=>{
  const payload=route.request().postDataJSON();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   status:'draft_export_only',manifestHash:fingerprint,
   manifest:{title:payload.title,publishable:false,answersIncluded:false,
    items:[{index:1,id:q1,revision:payload.sourceRevisions[0],question:'سؤال نسخه‌دار'}]}
  })});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 await expect(bank).toHaveCount(1);
 await bank.first().click();
 // The refresh is pending while the operator opens a preview of the old revision.
 await page.locator('#loadBank').click();
 await expect.poll(()=>typeof releaseRefresh).toBe('function');
 await page.locator('#previewExam').focus();
 await page.keyboard.press('Enter');
 const dialog=page.locator('#examPreviewDialog'),fingerprintLabel=page.locator('#examFingerprint');
 await expect(dialog).toBeVisible();
 await expect(fingerprintLabel).toContainText(fingerprint);
 revision=3;
 releaseRefresh();
 await expect(dialog).not.toBeVisible();
 await expect(fingerprintLabel).toHaveText('شناسه نسخه خروجی پس از ساخت نمایش داده می‌شود.');
 await expect(page.locator('#composerNotice')).toContainText('پیش‌نمایش قبلی بسته شد چون نسخه سؤال تغییر کرده است.');
 await expect(page.locator('#composerNotice')).toHaveAttribute('data-state','error');
 await expect(page.locator('#selectedList .composer-selection')).toHaveCount(1);
 await expect(bank.first()).toHaveAttribute('aria-pressed','true');
});
