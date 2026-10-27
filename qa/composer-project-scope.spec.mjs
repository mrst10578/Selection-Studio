import {test,expect} from '@playwright/test';

const authorizedProject='12345678-1234-1234-1234-123456789012';
const foreignProject='12345678-1234-1234-1234-123456789099';
const authorizedId='87654321-1234-1234-1234-123456789012';
const foreignId='87654321-1234-1234-1234-123456789099';
const row=(id,projectId,questionText)=>({id,projectId,revision:1,questionText,sourceNumber:1});

test('all-project search fails closed on rows outside the operator project list',async({page})=>{
 let sendForeign=false;
 const requests=[];
 await page.route('**/api/v1/projects',route=>route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({projects:[{id:authorizedProject,name:'زیست مجاز'}]})
 }));
 await page.route('**/api/v1/bank/questions**',route=>{
  const query=new URL(route.request().url()).searchParams.get('q');
  requests.push(query);
  const questions=sendForeign
   ?[row(foreignId,foreignProject,'سؤال پروژه خارج از فهرست')]
   :[row(authorizedId,authorizedProject,'سؤال پروژه مجاز')];
  return route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({questions,nextCursor:null})});
 });
 await page.goto('/review-console/composer-studio.html');
 const bank=page.locator('#approvedList button');
 const notice=page.locator('#composerNotice');
 const selected=page.locator('#selectedList .composer-selection');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال پروژه مجاز');
 await bank.first().click();
 await expect(selected).toHaveCount(1);

 // A malformed 200 response during same-filter refresh must preserve
 // the last trusted bank and the operator's selected draft.
 sendForeign=true;
 await page.locator('#loadBank').click();
 await expect(notice).toContainText('پروژه خارج از دسترسی');
 await expect(notice).toHaveAttribute('data-state','error');
 await expect(bank).toHaveCount(1);
 await expect(bank.first()).toContainText('سؤال پروژه مجاز');
 await expect(page.locator('#approvedList')).not.toContainText('سؤال پروژه خارج از فهرست');
 await expect(selected).toHaveCount(1);
 await expect(page.locator('#loadBank')).toBeEnabled();

 // A new filter has no trusted previous results to restore. Never show
 // the foreign row, and never discard the existing selected question.
 await page.locator('#composerQuery').fill('نامعتبر');
 await page.locator('#loadBank').click();
 await expect(notice).toContainText('پروژه خارج از دسترسی');
 await expect(bank).toHaveCount(0);
 await expect(page.locator('#approvedList')).not.toContainText('سؤال پروژه خارج از فهرست');
 await expect(selected).toHaveCount(1);
 await expect(selected.first()).toContainText('سؤال پروژه مجاز');
 expect(requests).toEqual([null,null,'نامعتبر']);
});
