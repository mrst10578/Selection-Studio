import {test,expect} from '@playwright/test';

const projectId='12345678-1234-1234-1234-123456789012';
const questionId='87654321-1234-1234-1234-123456789012';
const question={id:questionId,projectId,revision:1,questionText:'سؤال محرمانه پروژه',sourceNumber:1};

// The backend remains the authorization authority. This only checks that
// the browser discards already-rendered bank data after a server-side denial.
for(const denialBody of ['json','html']){
 test('bank 403 ('+denialBody+') clears stale rows and selections until access is rechecked',async({page})=>{
  let bankCalls=0,projectCalls=0;
  await page.route('**/api/v1/projects',route=>{
   projectCalls++;
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({projects:[{id:projectId,name:'زیست'}]})});
  });
  await page.route('**/api/v1/bank/questions**',route=>{
   bankCalls++;
   if(bankCalls===2)return route.fulfill({
    status:403,contentType:denialBody==='html'?'text/html':'application/json',
    body:denialBody==='html'?'<html>Access denied</html>':'{"error":"FORBIDDEN"}'
   });
   return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({questions:[question],nextCursor:null})});
  });

  await page.goto('/review-console/composer-studio.html');
  const bank=page.locator('#approvedList button');
  const selected=page.locator('#selectedList .composer-selection');
  const retry=page.locator('#retryComposerBootstrap');
  await expect(bank).toHaveCount(1);
  await bank.first().click();
  await expect(selected).toHaveCount(1);
  await expect(page.locator('#exportJsonl')).toBeEnabled();

  // Simulate permission revocation after a previously authorized response.
  await page.locator('#loadBank').click();
  await expect(page.locator('#composerNotice')).toContainText('نتایج و انتخاب‌ها پاک شدند');
  await expect(bank).toHaveCount(0);
  await expect(selected).toHaveCount(0);
  await expect(page.locator('#composerProject')).toBeDisabled();
  await expect(page.locator('#composerProject option')).toHaveCount(1);
  await expect(page.locator('#loadBank')).toBeDisabled();
  await expect(page.locator('#exportJsonl')).toBeDisabled();
  await expect(page.locator('#approvedList')).toHaveAttribute('aria-busy','false');
  await expect(retry).toBeVisible();
  expect(bankCalls).toBe(2);

  // Rechecking requires a fresh session/projects/bank round-trip. No old
  // selection is silently restored, even if the operator regains access.
  await retry.click();
  await expect(bank).toHaveCount(1);
  await expect(page.locator('#composerProject')).toBeEnabled();
  await expect(retry).toBeHidden();
  await expect(selected).toHaveCount(0);
  await expect(page.locator('#exportJsonl')).toBeDisabled();
  expect(projectCalls).toBe(2);
  expect(bankCalls).toBe(3);
 });
}
