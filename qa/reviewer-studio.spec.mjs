import {test,expect} from '@playwright/test';
const project='12345678-1234-1234-1234-123456789012';
const question='87654321-1234-1234-1234-123456789012';
async function mock(page,{role='reviewer',assigned=true}={}){
 const submitted=[];
 await page.route('**/api/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,role,email:'reviewer@example.test'})}));
 await page.route('**/api/v1/reviews/**',route=>{
  const req=route.request(),url=new URL(req.url());
  let data={error:'NOT_FOUND'},status=200;
  if(url.pathname==='/api/v1/reviews/assigned')data={projects:assigned?[{id:project,name:'دفترچه آزمایشی'}]:[]};
  else if(url.pathname==='/api/v1/reviews/projects/'+project+'/questions')data={questions:[{id:question,revision:2,state:'draft',content:{questionText:'کدام گزینه نادرست است؟',answerText:'گزینه دو',operatorConfirmed:true,sourceDigest:'c'.repeat(64)}}]};
  else if(url.pathname==='/api/v1/reviews/projects/'+project+'/questions/'+question){
   if(req.method()==='POST'){submitted.push(req.postDataJSON());status=201;data={reviewed:true,decision:req.postDataJSON().decision,sourceRevision:2,autoPublish:false}}
   else data={decisions:[]};
  }else status=404;
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 return submitted;
}
test.describe('ZH-83 independent reviewer console',()=>{
 test('reviewer must explicitly inspect all checks before version-pinned signoff',async({page})=>{
  const submitted=await mock(page);
  await page.goto('/review-console/reviewer-studio.html');
  await expect(page.locator('#assignedProjects')).toBeEnabled();
  await page.locator('#reviewQueue button').first().click();
  await expect(page.locator('#reviewQuestion')).toHaveValue('کدام گزینه نادرست است؟');
  await page.locator('#approveReview').click();
  await expect(page.locator('#reviewNotice')).toContainText('تمام بندهای چک‌لیست');
  expect(submitted).toHaveLength(0);
  for(const row of await page.locator('[data-review-check]').all())await row.check();
  await page.locator('#approveReview').click();
  await expect(page.locator('#reviewNotice')).toContainText('هنوز منتشر نشده');
  expect(submitted[0].baseRevision).toBe(2);
  expect(submitted[0].checks.sourceVerified).toBe(true);
 });
 test('non-reviewer cannot approve anything through console UI',async({page})=>{
  const submitted=await mock(page,{role:'operator'});
  await page.goto('/review-console/reviewer-studio.html');
  await expect(page.locator('#reviewNotice')).toContainText('حساب اپراتور');
  await expect(page.locator('#approveReview')).toBeDisabled();
  expect(submitted).toHaveLength(0);
 });
 test('no assigned projects means reviewer has no accessible queue',async({page})=>{
  await mock(page,{assigned:false});
  await page.goto('/review-console/reviewer-studio.html');
  await expect(page.locator('#reviewNotice')).toContainText('ارجاع نشده');
  await expect(page.locator('#reviewQueue button')).toHaveCount(0);
 });
});
