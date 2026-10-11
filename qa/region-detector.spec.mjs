import {test,expect} from '@playwright/test';

async function openStudio(page){
 await page.goto('/studio/');
 await expect(page.locator('#questionPane .studio-crop-queue')).toBeVisible();
}
const createFixture=async page=>page.evaluate(async()=>{
 const {createDetectionSnapshot}=await import('/studio/region-detector.js');
 const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,800);
 // Two lines of question text, followed by four right-aligned option rows.
 ctx.fillStyle='#151515';
 for(const [x,y,width] of [[80,100,440],[92,121,428],[190,142,330],[210,163,310],[200,184,320],[175,205,345]]){
  ctx.fillRect(x,y,width,10);
 }
 return createDetectionSnapshot(canvas,3).candidates;
});
test.describe('ZH-74 deterministic segmentation and operator review',()=>{
 test('splits four likely options only with stable right alignment and preserves normalized page geometry',async({page})=>{
  await openStudio(page);
  const result=await createFixture(page);
  expect(result).toHaveLength(5);
  expect(result.map(x=>x.kind)).toEqual(['question','option','option','option','option']);
  expect(result.map(x=>x.page)).toEqual([3,3,3,3,3]);
  for(const proposal of result){
   const [x1,y1,x2,y2]=proposal.bbox_norm;
   expect(x1).toBeGreaterThanOrEqual(0);
   expect(y1).toBeGreaterThanOrEqual(0);
   expect(x2).toBeLessThanOrEqual(1);
   expect(y2).toBeLessThanOrEqual(1);
   expect(x2).toBeGreaterThan(x1);
   expect(y2).toBeGreaterThan(y1);
  }
 });
 test('does not invent options from blank pages or rows without option alignment',async({page})=>{
  await openStudio(page);
  const actual=await page.evaluate(async()=>{
   const {detectQuestionLayout}=await import('/studio/region-detector.js');
   const empty=new Uint8ClampedArray(300*300*4).fill(255);
   const blank=detectQuestionLayout(empty,300,300);
   const width=600,height=800;
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#000';
   [100,121,142,163,184,205].forEach((y,i)=>ctx.fillRect(30+i*25,y,280,10));
   const {data}=ctx.getImageData(0,0,width,height);
   const unaligned=detectQuestionLayout(data,width,height);
   return {blank,unaligned,wrongInput:detectQuestionLayout(new Uint8Array(6),width,height)};
  });
  expect(actual.blank).toEqual([]);
  expect(actual.wrongInput).toEqual([]);
  expect(actual.unaligned.every(x=>x.kind!=='option')).toBe(true);
 });
 test('recognizes a conservative right-to-left two-column option grid',async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const {detectQuestionLayout}=await import('/studio/region-detector.js');
   const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,800);ctx.fillStyle='#151515';
   // Two right-aligned question lines, followed by two rows with two separated option cells.
   [[85,100,430],[90,121,425],[50,142,135],[390,142,135],[52,163,134],[388,163,137]]
    .forEach(([x,y,w])=>ctx.fillRect(x,y,w,10));
   const {data}=ctx.getImageData(0,0,600,800);
   return detectQuestionLayout(data,600,800);
  });
  expect(result.map(x=>x.kind)).toEqual(['question','option','option','option','option']);
  expect(result[1].bbox_norm[0]).toBeGreaterThan(result[2].bbox_norm[0]);
  expect(result[3].bbox_norm[0]).toBeGreaterThan(result[4].bbox_norm[0]);
 });
 test('manual coordinates are validated, options remain unchecked until operator approval',async({page})=>{
  await openStudio(page);
  const candidates=await createFixture(page);
  expect(candidates).toHaveLength(5);
  await page.evaluate(async()=>{
   const {createDetectionSnapshot}=await import('/studio/region-detector.js');
   const {openRegionReview}=await import('/studio/region-review.js');
   const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,800);ctx.fillStyle='#111';
   [[80,100,440],[92,121,428],[190,142,330],[210,163,310],[200,184,320],[175,205,345]].forEach(([x,y,w])=>ctx.fillRect(x,y,w,10));
   window.__reviewResult={};
   openRegionReview({snapshot:createDetectionSnapshot(canvas,3),onAccept:r=>{window.__reviewResult.accepted=r;return true},onReview:r=>{window.__reviewResult.reviewed=r}});
  });
  const dialog=page.getByRole('dialog',{name:'بررسی و اصلاح کادرهای پیشنهادی'});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.studio-region-overlay-box')).toHaveCount(5);
  await expect(dialog.getByRole('button',{name:'افزودن کادرهای تأییدشده'})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:'انتخاب گزینه احتمالی ۱'}).check();
  await expect(dialog.getByRole('button',{name:'افزودن کادرهای تأییدشده'})).toBeEnabled();
  const coords=dialog.locator('.studio-region-editor-row').nth(1).locator('input[type="number"]');
  await coords.nth(0).fill('90');
  await coords.nth(2).fill('20');
  await dialog.getByRole('button',{name:'افزودن کادرهای تأییدشده'}).click();
  await expect(dialog).toBeVisible();
  await expect(coords.nth(2)).toHaveAttribute('aria-invalid','true');
  await coords.nth(0).fill('25');
  await coords.nth(2).fill('80');
  await dialog.getByRole('button',{name:'افزودن کادرهای تأییدشده'}).click();
  await expect(dialog).toBeHidden();
  const accepted=await page.evaluate(()=>window.__reviewResult.accepted);
  expect(accepted).toHaveLength(1);
  expect(accepted[0].page).toBe(3);
  expect(accepted[0].bbox_norm[0]).toBeCloseTo(.25);
  expect(accepted[0].bbox_norm[2]).toBeCloseTo(.8);
 });
 test('preview review returns manually adjustable region without adding it',async({page})=>{
  await openStudio(page);
  await page.evaluate(async()=>{
   const {openRegionReview}=await import('/studio/region-review.js');
   const canvas=document.createElement('canvas');canvas.width=250;canvas.height=300;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,250,300);
   window.__reviewResult={};
   openRegionReview({snapshot:{thumbnail:canvas,candidates:[{page:2,kind:'question',label:'متن سؤال',bbox_norm:[.1,.1,.6,.5]}]},onAccept:r=>{window.__reviewResult.accepted=r},onReview:r=>{window.__reviewResult.reviewed=r}});
  });
  const dialog=page.getByRole('dialog',{name:'بررسی و اصلاح کادرهای پیشنهادی'});
  await dialog.getByRole('button',{name:'بازبینی روی PDF'}).click();
  await expect(dialog).toBeHidden();
  const result=await page.evaluate(()=>window.__reviewResult);
  expect(result.accepted).toBeUndefined();
  expect(result.reviewed).toEqual({page:2,bbox_norm:[.1,.1,.6,.5]});
 });
 test('real queue only receives explicitly approved boxes and rejects stale PDF suggestions',async({page})=>{
  await openStudio(page);
  await page.evaluate(async()=>{
   const {createCropQueue}=await import('/studio/crop-queue.js');
   const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,800);ctx.fillStyle='#111';
   [[80,100,440],[92,121,428],[190,142,330],[210,163,310],[200,184,320],[175,205,345]]
    .forEach(([x,y,w])=>ctx.fillRect(x,y,w,10));
   const fake=()=>({
    canvas,page:1,documentGeneration:1,readyFrame:{renderSeq:5},
    region:null,pdf:{numPages:3},zoom:1,loading:false,rendering:false,
    isRenderReady(){return true},
    isRegionReady(){return !!this.region},
    isRegionLocked(){return false},
    setRegionLocked(){},
    clearRegion(){this.region=null},
    async setRegion(r){this.region=r?structuredClone(r):null},
    async go(n){this.page=n;return true},
    async setZoom(z){this.zoom=z;return z}
   });
   const question=fake(),answer=fake();
   const queue=createCropQueue({question,answer,switchPane:()=>{},onNotice:()=>{},onChange:()=>{}});
   window.__regionQueue={question,answer,queue};
  });
  // New queue is inserted immediately after the toolbar, before the original app queue.
  const cropUi=page.locator('#questionPane .studio-crop-queue').first();
  await cropUi.getByRole('button',{name:'پیشنهاد کادرها'}).click();
  const dialog=page.locator('.studio-region-review');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>window.__regionQueue.queue.selections('question').length)).toBe(0);
  await dialog.getByRole('checkbox',{name:'انتخاب متن احتمالی سؤال'}).check();
  await dialog.getByRole('checkbox',{name:'انتخاب گزینه احتمالی ۱'}).check();
  await dialog.getByRole('button',{name:'افزودن کادرهای تأییدشده'}).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(()=>window.__regionQueue.queue.selections('question').length)).toBe(2);
  await cropUi.getByRole('button',{name:'پیشنهاد کادرها'}).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox',{name:'انتخاب گزینه احتمالی ۲'}).check();
  await page.evaluate(()=>{window.__regionQueue.question.documentGeneration=2});
  await dialog.getByRole('button',{name:'افزودن کادرهای تأییدشده'}).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>window.__regionQueue.queue.selections('question').length)).toBe(2);
  await dialog.getByRole('button',{name:'انصراف'}).click();
 });
 test('mobile review stays within viewport with touch-reachable actions',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.includes('mobile'),'Mobile geometry');
  await openStudio(page);
  await page.evaluate(async()=>{
   const {openRegionReview}=await import('/studio/region-review.js');
   const canvas=document.createElement('canvas');canvas.width=300;canvas.height=500;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,300,500);
   openRegionReview({snapshot:{thumbnail:canvas,candidates:[{page:1,kind:'block',label:'کادر پیشنهادشده',bbox_norm:[.1,.1,.85,.35]}]},onAccept:()=>true});
  });
  const dialog=page.locator('.studio-region-review');
  await expect(dialog).toBeVisible();
  const info=await page.evaluate(()=>{
   const dialog=document.querySelector('.studio-region-review');
   const rect=dialog.getBoundingClientRect();
   return {width:rect.width,viewport:innerWidth,actions:[...dialog.querySelectorAll('.studio-crop-proposal-actions button')].map(b=>b.getBoundingClientRect().height)};
  });
  expect(info.width).toBeLessThanOrEqual(info.viewport);
  expect(info.actions.every(h=>h>=40)).toBe(true);
 });
});
