import {test,expect} from '@playwright/test';

async function install(page){
 await page.goto('/studio/');
 await expect(page.locator('#operatorLogin')).toBeHidden();
 await page.evaluate(async()=>{
  const {installOcrWorkbench}=await import('/studio/ocr-panel.js');
  document.querySelector('#studioOcrPanel')?.remove();
  window.__bboxVersion='exam-pdf-crop-1';
  window.__bboxNotices=[];
  window.__bboxWorkbench=installOcrWorkbench({
   getIdentity:()=>'test-exam:Q001',
   getFingerprint:()=>window.__bboxVersion,
   onNotice:message=>window.__bboxNotices.push(message),
   capture:async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=500;canvas.height=280;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,500,280);
    ctx.fillStyle='#111';ctx.font='24px sans-serif';ctx.fillText('OCR sample 12',55,100);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.85));
    return {blob,regions:[{page:3,bbox_norm:[.2,.15,.85,.75]}]};
   }
  });
 });
 return page.locator('#studioOcrPanel');
}
async function mapText(page,panel,from,to,x1=.1,y1=.1,x2=.5,y2=.45){
 const textarea=panel.locator('#studioOcrText');
 await textarea.evaluate((el,[a,b])=>{el.focus();el.setSelectionRange(a,b)},[from,to]);
 await panel.locator('#studioOcrMapLink').click();
 const overlay=panel.locator('.studio-ocr-map-overlay');
 const rect=await overlay.boundingBox();
 expect(rect).not.toBeNull();
 await page.mouse.move(rect.x+rect.width*x1,rect.y+rect.height*y1);
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width*x2,rect.y+rect.height*y2,{steps:6});
 await page.mouse.up();
 await expect(panel.locator('.studio-ocr-map-region')).toHaveCount(1);
}
test.describe('ZH-76 OCR text–image mapping and selective OCR',()=>{
 test('normalizes only verified coordinates and rejects missing/ambiguous characters',async({page})=>{
  await install(page);
  const value=await page.evaluate(async()=>{
   const core=await import('/studio/ocr-bbox.js');
   const text='سلام x² پاسخ گزینه ۲';
   const valid=core.normalizeOcrLinks([
    {start:0,end:4,text:'سلام',bbox_norm:[.1,.2,.6,.3]},
    {start:5,end:7,text:'x²',bbox_norm:[.1,.3,.6,.4]},
    {start:2,end:7,bbox_norm:['0',.1,.5,.8]},
    {text:'گزینه ۲',bbox_norm:[.2,.6,.8,.9]},
    {text:'سلام',bbox_norm:[.9,.5,.4,.6]},
    {start:15,end:16,bbox_norm:[-.1,.1,.4,.5]}
   ],text);
   const updated=core.addOcrLink(valid,text,8,12,[.05,.5,.3,.7]);
   let overlap=false;try{core.addOcrLink(updated,text,9,15,[.1,.1,.6,.8])}catch{overlap=true}
   const changed=core.replaceLinkedSpan(text,updated,0,'درود');
   const bad=[null,[],[0,0,0,1],[0,0,1,2],['0',0,1,1]].map(core.validOcrBox);
   return {valid,updated,overlap,changed,bad,empty:core.safeOcrMap({text,links:[],regions:[]})};
  });
  expect(value.valid).toHaveLength(3);
  expect(value.valid[0]).toMatchObject({start:0,end:4,bbox_norm:[.1,.2,.6,.3]});
  expect(value.valid[1]).toMatchObject({start:5,end:7});
  expect(value.valid[2].source).toBe('model');
  expect(value.updated).toHaveLength(4);
  expect(value.overlap).toBe(true);
  expect(value.changed.text).toMatch(/^درود x²/);
  expect(value.bad).toEqual([false,false,false,false,false]);
  expect(value.empty).toBeNull();
 });

 test('image loads locally without OCR, manual selection connects both directions, and provenance saves only on approval',async({page})=>{
  const panel=await install(page);
  let calls=0;
  await page.route('**/api/ocr',route=>{calls++;return route.abort()});
  const textarea=panel.locator('#studioOcrText');
  await textarea.fill('مقدار ۱۲ گزینه درست');
  await panel.locator('#studioOcrMapLoad').click();
  await expect(panel.locator('.studio-ocr-map-image')).toHaveJSProperty('complete',true);
  await expect(panel.locator('.studio-ocr-map-frame')).toBeVisible();
  expect(calls).toBe(0);
  await mapText(page,panel,0,5);
  await expect(panel.locator('.studio-ocr-map-chip')).toHaveCount(1);
  const link=await page.evaluate(()=>window.__bboxWorkbench.getState('question').links[0]);
  expect(link).toMatchObject({start:0,end:5,source:'operator'});
  expect(link.bbox_norm[2]).toBeGreaterThan(.45);
  await panel.locator('.studio-ocr-map-chip').click();
  const selected=await textarea.evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,chosen:el.value.slice(el.selectionStart,el.selectionEnd)}));
  expect(selected).toEqual({start:0,end:5,chosen:'مقدار'});
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  const approved=await page.evaluate(()=>window.__bboxWorkbench.reviewForSave());
  expect(approved.question.image_map).toMatchObject({
   coordinate_space:'ocr_composite_image',source_regions:[{page:3,bbox_norm:[.2,.15,.85,.75]}],
   links:[{start:0,end:5,source:'operator'}],events:[{type:'linked_manually'}]
  });
  await textarea.fill('متن جدید');
  await expect(panel.locator('.studio-ocr-map-region')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__bboxWorkbench.reviewForSave())).toBeNull();
 });

 test('selected-region re-OCR shows editable proposal, reject is safe, accept patches only the linked text',async({page})=>{
  const panel=await install(page);
  const requests=[];
  await page.route('**/api/ocr',async route=>{
   const body=route.request().postDataJSON();requests.push(body);
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result:{response:JSON.stringify({text:'مقدار دقیق',latex:['x^2']})}})});
  });
  const textarea=panel.locator('#studioOcrText');
  await textarea.fill('مقدار ۱۲ گزینه درست');
  await panel.locator('#studioOcrMapLoad').click();
  await mapText(page,panel,0,5);
  await panel.locator('#studioOcrMapRetry').click();
  await expect(panel.locator('#studioOcrMapProposal')).toHaveValue('مقدار دقیق');
  expect(requests).toHaveLength(1);
  expect(requests[0].prompt).toContain('SELECTIVE REGION RE-OCR ONLY');
  expect(requests[0].image).toMatch(/^data:image\/webp;base64,/);
  await expect(textarea).toHaveValue('مقدار ۱۲ گزینه درست');
  await panel.locator('#studioOcrMapReject').click();
  await expect(panel.locator('.studio-ocr-map-candidate')).toBeHidden();
  await expect(textarea).toHaveValue('مقدار ۱۲ گزینه درست');
  await panel.locator('#studioOcrMapRetry').click();
  await expect(panel.locator('#studioOcrMapProposal')).toHaveValue('مقدار دقیق');
  await panel.locator('#studioOcrMapProposal').fill('مقدار بازبینی‌شده');
  await panel.locator('#studioOcrMapAccept').click();
  await expect(textarea).toHaveValue('مقدار بازبینی‌شده ۱۲ گزینه درست');
  expect(requests).toHaveLength(2);
  expect(await page.evaluate(()=>window.__bboxWorkbench.reviewForSave())).toBeNull();
  await panel.getByRole('button',{name:'۳ · تأیید اپراتور'}).click();
  const approved=await page.evaluate(()=>window.__bboxWorkbench.reviewForSave());
  expect(approved.question.text).toBe('مقدار بازبینی‌شده ۱۲ گزینه درست');
  expect(approved.question.image_map.links[0]).toMatchObject({source:'region_reocr',start:0,end:'مقدار بازبینی‌شده'.length});
  expect(approved.question.image_map.events.some(x=>x.type==='selective_reocr_applied')).toBe(true);
 });

 test('stale document invalidates image, model candidate and consent before a late result arrives',async({page})=>{
  const panel=await install(page);
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  let started=0;
  await page.route('**/api/ocr',async route=>{
   started++;await pending;
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result:{response:JSON.stringify({text:'متن قدیمی از صفحه قبل'})}})});
  });
  await panel.locator('#studioOcrText').fill('متن قبلی');
  await panel.locator('#studioOcrMapLoad').click();
  await mapText(page,panel,0,3);
  await panel.locator('#studioOcrMapRetry').click();
  await expect.poll(()=>started).toBe(1);
  await page.evaluate(()=>{window.__bboxVersion='new-pdf';window.__bboxWorkbench.syncContext()});
  release();
  await expect(panel.locator('#studioOcrText')).toHaveValue('');
  await expect(panel.locator('.studio-ocr-map-frame')).toBeHidden();
  await expect(panel.locator('.studio-ocr-map-candidate')).toBeHidden();
  expect(await page.evaluate(()=>window.__bboxWorkbench.reviewForSave())).toBeNull();
 });

 test('malformed OCR boxes stay unlinked rather than producing fake highlights',async({page})=>{
  const panel=await install(page);
  await page.route('**/api/ocr',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result:{response:JSON.stringify({
   text:'کدام گزینه نیست؟',latex:[],segments:[
    {start:0,end:4,text:'درست',bbox_norm:[.1,.1,.4,.2]},
    {start:1,end:5,bbox_norm:[0,0,2,1]}
   ]
  })}})}));
  await panel.getByRole('button',{name:'۱ · تشخیص متن'}).click();
  await expect(panel.locator('#studioOcrText')).toHaveValue('کدام گزینه نیست؟');
  await expect(panel.locator('.studio-ocr-map-region')).toHaveCount(0);
 });

 test('mobile view does not overflow and region controls remain usable',async({page},info)=>{
  test.skip(!info.project.name.includes('mobile'),'mobile-only geometry');
  const panel=await install(page);
  await panel.locator('#studioOcrText').fill('متن قابل اتصال');
  await panel.locator('#studioOcrMapLoad').click();
  const bounds=await panel.locator('#studioOcrImageMap').boundingBox();
  const width=await page.evaluate(()=>document.documentElement.clientWidth);
  expect(bounds.width).toBeLessThanOrEqual(width);
  expect(await panel.locator('#studioOcrMapLink').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(42);
 });
});
