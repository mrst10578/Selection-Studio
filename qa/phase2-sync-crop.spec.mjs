import {test,expect} from '@playwright/test';

test.describe('Studio Phase 2: cloud draft and multi-crop controls',()=>{
 test('shows separate question/answer queues, PDF zoom and non-destructive onboarding',async({page})=>{
  await page.goto('/studio/');
  await expect(page.locator('#operatorLogin')).toBeHidden({timeout:5000});
  const question=page.locator('#questionPane .studio-crop-queue');
  const answer=page.locator('#answerPane .studio-crop-queue');
  await expect(question).toHaveCount(1);
  await expect(answer).toHaveCount(1);
  await expect(question).toContainText('صف برش خالی است');
  await question.getByRole('button',{name:'بزرگ‌کردن PDF'}).click();
  await expect(question.locator('.studio-crop-zoom output')).toHaveText('125٪');
  await expect(page.locator('#qRegionLock')).toHaveAttribute('aria-pressed','false');
  await expect(question.locator('.studio-crop-guide')).toContainText('برش‌ها کنار هم');
 });
 test('never silently restores remote form and resolves cloud conflict by explicit user action',async({page})=>{
  await page.addInitScript(()=>{
   localStorage.setItem('selection-studio-form-draft-v3',JSON.stringify({version:3,savedAt:Date.now(),fields:{provider:'قلمچی'}}));
  });
  await page.route('**/api/draft?project=workspace',async route=>{
   if(route.request().method()==='GET')await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({revision:3,fields:{provider:'ماز'},updatedAt:'2026-10-11'})});
   else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true,revision:4})});
  });
  await page.goto('/studio/');
  await expect(page.locator('#operatorLogin')).toBeHidden({timeout:5000});
  await expect(page.locator('#provider')).not.toHaveValue('ماز');
  await page.locator('.studio-history-controls').getByRole('button',{name:'پروژه‌ها'}).click();
  const dialog=page.locator('#studioProjectDashboard');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.studio-cloud-warning')).toBeVisible();
  await dialog.getByRole('button',{name:'بازیابی از سرور'}).click();
  await expect(page.locator('#provider')).toHaveValue('ماز');
  await expect(dialog.locator('.studio-cloud-warning')).toHaveCount(0);
 });
 test('local draft remains available if cloud API is unavailable',async({page})=>{
  await page.route('**/api/draft?project=workspace',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto('/studio/');
  await expect(page.locator('#operatorLogin')).toBeHidden({timeout:5000});
  await page.locator('#provider').fill('قلمچی');
  await page.locator('.studio-history-controls').getByRole('button',{name:'پروژه‌ها'}).click();
  await expect(page.locator('#studioProjectDashboard .studio-cloud-sync')).toContainText('همگام‌سازی ابری در دسترس نیست');
  await page.waitForTimeout(900);
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('selection-studio-form-draft-v3')));
  expect(data.fields.provider).toBe('قلمچی');
 });
});
