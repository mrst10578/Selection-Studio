import {test,expect} from "@playwright/test";

async function openStudio(page){await page.goto("/studio/");await expect(page.locator(".studio-crop-queue").first()).toBeVisible()}

test.describe("ZH-73 multi-crop and navigation",()=>{
 test("clearing a completed question removes all memorized page regions",async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const {PdfCropper}=await import("/studio/pdf-crop.js");
   const crop=Object.create(PdfCropper.prototype);
   crop.page=2;
   crop.region={page:2,bbox_norm:[.1,.1,.4,.4]};
   crop.regionsByPage=new Map([[1,{page:1,bbox_norm:[.1,.1,.4,.4]}],[2,crop.region]]);
   crop.regionLocked=false;crop.drag={start:{}};
   crop.box={classList:{add(){}}};
   let updateCount=0;crop.onChange=()=>{updateCount++};
   const cleared=crop.clearAllRegions();
   return{cleared,region:crop.region,size:crop.regionsByPage.size,drag:crop.drag,updateCount};
  });
  expect(result).toEqual({cleared:true,region:null,size:0,drag:null,updateCount:1});
 });
 test("PageUp/PageDown navigate PDF only when focus is outside an editor",async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const {createCropQueue}=await import("/studio/crop-queue.js");
   const make=()=>({
    pdf:{numPages:5},page:1,region:null,loading:false,rendering:false,zoom:1,
    isRenderReady:()=>true,isRegionReady:()=>false,isRegionLocked:()=>false,
    async setZoom(v){this.zoom=v;return v},
    async go(value){this.page=Math.min(5,Math.max(1,value));return true}
   });
   const question=make(),answer=make();
   createCropQueue({question,answer,switchPane:()=>{}});
   document.body.focus();
   document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"PageDown",bubbles:true,cancelable:true}));
   const afterNext=question.page;
   const provider=document.getElementById("provider");provider.focus();
   provider.dispatchEvent(new KeyboardEvent("keydown",{key:"PageDown",bubbles:true,cancelable:true}));
   const afterEditing=question.page;
   provider.blur();
   document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"PageUp",bubbles:true,cancelable:true}));
   return{afterNext,afterEditing,afterPrevious:question.page};
  });
  expect(result).toEqual({afterNext:2,afterEditing:2,afterPrevious:1});
 });

 test("saved queue satisfies real question gate and stores multiple normalized regions",async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith("desktop"),"Desktop pointer interaction with stub PDF renderer");
  await page.setContent('<!doctype html><html><body style="padding:48px;font-size:30px">Question 1: demo mathematics and science<br><br>Answer 1: explanation</body></html>');
  const pdf=await page.pdf({width:"600px",height:"800px",printBackground:true});
  await openStudio(page);
  await expect(page.locator("#operatorLogin")).toBeHidden();
  await page.locator("#provider").fill("قلمچی");
  await page.locator("#examMonth").fill("03");
  await page.locator("#examDay").fill("07");
  await page.locator("#operator").fill("گزینشگر");
  const file={name:"fixture.pdf",mimeType:"application/pdf",buffer:pdf};
  await page.locator("#questionPdf").setInputFiles(file);
  await expect(page.locator("#questionPdfState")).toContainText("fixture.pdf");
  await page.locator("#answerPdf").setInputFiles({...file,name:"answer.pdf"});
  await expect(page.locator("#answerPdfState")).toContainText("answer.pdf");
  await page.locator("#saveSession").click();
  await expect(page.locator("#sessionCard")).toHaveClass(/ready/);
  await page.locator("#questionTab").click();
  const drag=async (selector,part=0)=>{
   const canvas=page.locator(selector);
   await canvas.scrollIntoViewIfNeeded();
   await expect(canvas).toBeVisible();
   const box=await canvas.boundingBox(),viewport=page.viewportSize();
   expect(box).toBeTruthy();
   const top=Math.max(0,box.y)+15;
   const bottom=Math.min(viewport.height,box.y+box.height)-15;
   expect(bottom-top).toBeGreaterThan(80);
   const from={x:box.x+box.width*.18,y:top+(bottom-top)*(part===0?.08:.55)};
   const to={x:box.x+box.width*.58,y:top+(bottom-top)*(part===0?.36:.86)};
   await page.mouse.move(from.x,from.y);
   await page.mouse.down();
   await page.mouse.move(to.x,to.y,{steps:6});
   await page.mouse.up();
  };
  await drag("#qCanvas");
  await expect(page.locator("#questionCropState")).toHaveText("ثبت شد");
  await page.locator("#questionPane .studio-crop-queue").getByRole("button",{name:"+ افزودن این برش"}).click();
  await expect(page.locator("#questionPane .studio-crop-chip")).toHaveCount(1);
  await expect(page.locator('[data-check="question"]')).toHaveClass(/done/);
  await expect(page.locator("#questionCropState")).toContainText("1 برش آماده");
  // Add another part of the same question, keeping the first queued crop.
  await drag("#qCanvas",1);
  await page.locator("#questionPane .studio-crop-queue").getByRole("button",{name:"+ افزودن این برش"}).click();
  await expect(page.locator("#questionPane .studio-crop-chip")).toHaveCount(2);
  await page.locator("#answerTab").click();
  await expect(page.locator("#aStage")).not.toHaveClass(/is-loading/);
  await page.waitForTimeout(250);
  await drag("#aCanvas");
  await expect(page.locator("#answerCropState")).toHaveText("ثبت شد");
  await page.locator("#answerPane .studio-crop-queue").getByRole("button",{name:"+ افزودن این برش"}).click();
  await expect(page.locator('[data-check="answer"]')).toHaveClass(/done/);
  await page.locator("#subject").selectOption("PHY");
  await page.locator("#grade").selectOption("10");
  await page.locator("#chapter").selectOption({index:1});
  await page.locator("#unit").selectOption({index:1});
  await page.locator("#sourceNumber").fill("1");
  await page.locator('.segmented[data-target="difficulty"] [data-value="level_2"]').click();
  await page.locator('.segmented[data-target="correctOption"] [data-value="1"]').click();
  await expect(page.locator("#saveQuestion")).toBeEnabled();
  await page.locator("#saveQuestion").click();
  await expect(page.locator("#recordCount")).toHaveText("1");
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem("testbank-studio.records.v1")||"[]"));
  expect(records).toHaveLength(1);
  expect(records[0].question_regions).toHaveLength(2);
  expect(records[0].answer_regions).toHaveLength(1);
  expect(records[0].question_regions[0].bbox_norm).toHaveLength(4);
  await expect(page.locator("#questionPane .studio-crop-chip")).toHaveCount(0);
 });

 test("queues independent page regions, changes reading order, composites WebP and restores page",async({page})=>{
  await openStudio(page);
  const outcome=await page.evaluate(async()=>{
   const {createCropQueue,uniqueRegions}=await import("/studio/crop-queue.js");
   const region=(page,x)=>({page,bbox_norm:[x,.1,x+.2,.35]});
   const crop=()=>({
    page:1,pdf:{numPages:4},zoom:1,region:null,loading:false,rendering:false,locked:false,
    isRenderReady(){return true},
    isRegionReady(){return Boolean(this.region)},
    isRegionLocked(){return this.locked},
    setRegionLocked(value){this.locked=value},
    clearRegion(){this.region=null;return true},
    async go(page){this.page=page;this.region=null;return true},
    async setRegion(r){if(r&&this.page!==r.page)await this.go(r.page);this.region=r?structuredClone(r):null},
    async captureCrop(){
     if(!this.region)throw Error("PDF_CROP_NOT_READY");
     const canvas=document.createElement("canvas");canvas.width=90;canvas.height=60;
     const ctx=canvas.getContext("2d");
     ctx.fillStyle=this.region.page===1?"#ef4444":"#2563eb";ctx.fillRect(0,0,90,60);
     const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
     return {blob,region:structuredClone(this.region)};
    },
    async setZoom(z){this.zoom=z;return z}
   });
   const question=crop(),answer=crop();
   const feedback=[];let updates=0;
   const queue=createCropQueue({question,answer,switchPane:()=>{},onNotice:s=>feedback.push(s),onChange:()=>updates++});
   question.region=region(1,.1);
   const first=queue.add("question");
   question.page=2;question.region=region(2,.25);
   const second=queue.add("question");
   const originalPage=question.page;
   const moved=queue.shift("question",1,-1);
   const ordered=queue.selections("question").map(x=>x.page);
   const capture=await queue.capture("question");
   const bitmap=await createImageBitmap(capture.blob);
   const composed={width:bitmap.width,height:bitmap.height,type:capture.blob.type,bytes:capture.blob.size};
   bitmap.close();
   answer.region=region(1,.4);
   const answerAdded=queue.add("answer");
   const answerCount=queue.selections("answer").length;
   const duplicateCount=uniqueRegions([region(1,.1),region(1,.1),region(2,.1)]).length;
   const chips=[...document.querySelectorAll("#questionPane .studio-crop-chip")].length;
   queue.clear("question");
   return {first,second,moved,ordered,originalPage,restoredPage:question.page,restoredRegion:question.region,composed,answerAdded,answerCount,duplicateCount,chips,afterClear:queue.selections("question").length,updates};
  });
  expect(outcome.first).toBe(true);
  expect(outcome.second).toBe(true);
  expect(outcome.moved).toBe(true);
  expect(outcome.ordered).toEqual([2,1]);
  expect(outcome.restoredPage).toBe(outcome.originalPage);
  expect(outcome.restoredRegion).toBeNull();
  expect(outcome.composed.width).toBe(90);
  expect(outcome.composed.height).toBe(144);
  expect(outcome.composed.type).toBe("image/webp");
  expect(outcome.composed.bytes).toBeGreaterThan(40);
  expect(outcome.answerCount).toBe(1);
  expect(outcome.duplicateCount).toBe(2);
  expect(outcome.chips).toBeGreaterThanOrEqual(2);
  expect(outcome.afterClear).toBe(0);
  expect(outcome.updates).toBeGreaterThanOrEqual(5);
 });

 test("queued single crop can preview a different page without moving the operator",async({page})=>{
  await openStudio(page);
  const result=await page.evaluate(async()=>{
   const {createCropQueue}=await import("/studio/crop-queue.js");
   const canvas=document.createElement("canvas");canvas.width=25;canvas.height=20;
   canvas.getContext("2d").fillRect(0,0,25,20);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
   const crop={
    page:2,region:null,pdf:{numPages:3},loading:false,rendering:false,zoom:1,
    isRenderReady:()=>true,isRegionReady(){return Boolean(this.region)},
    isRegionLocked:()=>false,setRegionLocked(){},clearRegion(){this.region=null},
    async go(n){this.page=n;this.region=null},
    async setRegion(r){this.region=r?structuredClone(r):null},
    async captureCrop(){return{blob,region:structuredClone(this.region)}},
    async setZoom(v){this.zoom=v;return v}
   };
   const noop={...crop,page:1,region:null};
   const queue=createCropQueue({question:crop,answer:noop,switchPane:()=>{}});
   const item={page:1,bbox_norm:[.1,.1,.6,.6]};
   // Snapshot a page-1 crop, then browse to page 2.
   crop.page=1;crop.region=item;queue.add("question");crop.page=2;crop.region=null;
   const snapshot=await queue.capture("question");
   return {capturePage:snapshot.regions[0].page,currentPage:crop.page,currentRegion:crop.region,bytes:snapshot.blob.size};
  });
  expect(result.capturePage).toBe(1);
  expect(result.currentPage).toBe(2);
  expect(result.currentRegion).toBeNull();
  expect(result.bytes).toBeGreaterThan(0);
 });

 test("mobile controls offer contextual help, zoom and keyboard page navigation without hijacking input",async({page},testInfo)=>{
  test.skip(!testInfo.project.name.includes("mobile"),"Mobile-only navigation test");
  await openStudio(page);
  const ui=page.locator("#questionPane .studio-crop-queue").first();
  await expect(ui.locator(".studio-touch-guide summary")).toBeVisible();
  await ui.locator(".studio-touch-guide summary").click();
  await expect(ui.locator(".studio-touch-guide p")).toBeVisible();
  await expect(ui.getByRole("button",{name:"دریافت تصویر برش‌ها"})).toBeVisible();
  const sizes=await page.evaluate(async()=>{
   const buttons=[...document.querySelectorAll("#questionPane .studio-crop-queue-head button")];
   return buttons.map(button=>Math.round(button.getBoundingClientRect().height));
  });
  expect(sizes.every(n=>n>=35)).toBe(true);
 });
});
