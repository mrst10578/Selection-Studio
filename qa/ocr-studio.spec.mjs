import {test,expect} from "@playwright/test";

const SAMPLE="iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP8//8/AymAiSTVoxpGNQwpDQBVbQMdPVIhQwAAAABJRU5ErkJggg==";

test.describe("Admin typed test-bank editor",()=>{
  test("uses edge-managed authentication instead of browser tokens",async({page})=>{
    await page.goto("/review-console/ocr-studio.html");
    await expect(page.locator("#questionList")).toBeVisible();
    await expect(page.locator("#accessToken")).toHaveCount(0);
    await expect(page.locator("#workerEndpoint")).toHaveCount(0);
    await expect(page.locator("#extractBtn")).toBeVisible();
  });

  test("renders and exports reviewed questions while leaving metadata untouched",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-review-admin-user-v1","admin");
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([{id:"unchanged",source_question_number:11,question_regions:[{page:2,bbox_norm:[0.1,0.2,0.3,0.4]}]}]));
    });
    await page.goto("/review-console/ocr-studio.html");
    await page.locator("#newQuestion").click();
    await page.locator("#questionText").fill("کدام گزینه صحیح است؟\nالف) نمونه");
    await page.locator("#reviewed").check();
    await page.locator("#previewAll").click();
    await expect(page.locator("#previewDialog")).toBeVisible();
    await expect(page.locator("#previewContent")).toContainText("الف) نمونه");
    await page.locator("#closePreview").click();

    const records=await page.evaluate(()=>JSON.parse(localStorage.getItem("testbank-studio.records.v1")));
    expect(records).toEqual([{id:"unchanged",source_question_number:11,question_regions:[{page:2,bbox_norm:[0.1,0.2,0.3,0.4]}]}]);
    const downloadPromise=page.waitForEvent("download");
    await page.locator("#htmlExport").click();
    const download=await downloadPromise;
    expect(download.suggestedFilename()).toBe("TestBank_Typed.html");
  });

  test("performs same-origin OCR without embedding credentials",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-review-admin-user-v1","admin"));
    await page.goto("/review-console/ocr-studio.html");
    await page.locator("#images").setInputFiles({name:"source.png",mimeType:"image/png",buffer:Buffer.from(SAMPLE,"base64")});
    await expect(page.locator("#questionList .ocr-list-row")).toHaveCount(1);
    let browserSentNoSecret=false;
    await page.route("**/api/ocr",async route=>{
      const request=route.request();
      browserSentNoSecret=!request.headers()["authorization"];
      const body=request.postDataJSON();
      expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
      await route.fulfill({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify({result:{choices:[{message:{content:JSON.stringify({questions:[{number:"12",stem:"سؤال بازتایپ شده",options:[{label:"الف",text:"گزینه صحیح"}],extras:[],figure_required:false,uncertainties:[],confidence:"high"}],page_notes:""})}}]}})});
    });
    await page.locator("#extractBtn").click();
    await expect(page.locator("#questionText")).toHaveValue(/سؤال بازتایپ شده/);
    expect(browserSentNoSecret).toBe(true);
    await expect(page.locator("#reviewed")).not.toBeChecked();
  });

  test("accepts a staged admin crop via IndexedDB without modifying it",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-review-admin-user-v1","admin"));
    await page.goto("/review-console/index.html");
    await page.evaluate(async image=>{
      const {putPreview}=await import("../studio/preview-db.js");
      await putPreview("examforge:handoff",await (await fetch("data:image/png;base64,"+image)).blob());
      sessionStorage.setItem("selection-ocr-handoff-v1",JSON.stringify({questionId:"Q-TEST-5",title:"سؤال ۵",sourceNumber:5}));
    },SAMPLE);
    await page.goto("/review-console/ocr-studio.html");
    await expect(page.locator("#questionList .ocr-list-row")).toHaveCount(1);
    await expect(page.locator("#questionTitle")).toHaveValue("سؤال ۵");
    await expect(page.locator("#referenceImage")).toBeVisible();
    expect(await page.evaluate(()=>sessionStorage.getItem("selection-ocr-handoff-v1"))).toBeNull();
  });
});
