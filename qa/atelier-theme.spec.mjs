import {test,expect} from "@playwright/test";

const scenarios=[
 {path:"/studio/",body:"atelier-studio",selector:".workflow-rail"},
 {path:"/studio/selected.html",body:"atelier-selected",selector:".batch-summary"},
 {path:"/studio/guide.html",body:"atelier-guide",selector:".guide-card"},
 {path:"/review-console/index.html",body:"atelier-admin",selector:".review-layout"},
 {path:"/review-console/ocr-studio.html",body:"atelier-ocr",selector:".ocr-layout"},
 {path:"/review-console/guide.html",body:"atelier-guide",selector:".review-main"}
];

test.describe("Ember Atelier premium theme",()=>{
 test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
   sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
   sessionStorage.setItem("selection-review-admin-user-v1","admin");
  });
 });

 for(const s of scenarios){
  test("renders accessible theme on "+s.path,async({page})=>{
   await page.goto(s.path);
   await expect(page.locator("body")).toHaveClass(new RegExp(s.body));
   await expect(page.locator(s.selector).first()).toBeVisible();
   const state=await page.evaluate(()=>{
    const root=getComputedStyle(document.documentElement);
    return {
     accent:root.getPropertyValue("--accent").trim(),
     bg:root.getPropertyValue("--bg").trim(),
     hasHorizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth>2,
     sheet:[...document.styleSheets].some(sheet=>sheet.href?.includes("atelier-ui.css"))
    };
   });
   expect(state.accent.toLowerCase()).toBe("#ffc094");
   expect(state.bg.toLowerCase()).toBe("#0b121d");
   expect(state.hasHorizontalOverflow).toBe(false);
   expect(state.sheet).toBe(true);
  });
 }

 test("operator PDF crop area preserves its interaction surface",async({page})=>{
  await page.goto("/studio/");
  await expect(page.locator("#bootSplash")).toBeHidden();
  await expect(page.locator("#qCanvas")).toHaveCount(1);
  await expect(page.locator("#qRegionLock")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#saveQuestion")).toBeDisabled();
  await expect(page.locator(".viewer-tabs button.active")).toHaveCount(1);
 });

 test("review panel still exposes OCR in admin and keeps protected login form",async({page})=>{
  await page.goto("/review-console/");
  await expect(page.locator(".ocr-admin-link")).toHaveAttribute("href","./ocr-studio.html");
  await expect(page.locator("#adminLoginForm")).toHaveCount(1);
  await expect(page.locator("#quickDialog")).toHaveCount(1);
  await expect(page.locator("#openOcrStudio")).toHaveCount(1);
 });

 test("OCR typography tools and safe preview remain usable",async({page})=>{
  await page.goto("/review-console/ocr-studio.html");
  await page.locator("#newQuestion").click();
  await page.locator("#questionText").fill("کدام گزینه صحیح است؟\nالف) پاسخ اول");
  await page.locator("#fontSize").evaluate(el=>{el.value="19";el.dispatchEvent(new Event("input",{bubbles:true}))});
  await expect(page.locator("#fontSizeValue")).toHaveText("۱۹");
  await page.locator("#reviewed").check();
  await page.locator("#previewAll").click();
  await expect(page.locator("#previewDialog")).toBeVisible();
  await expect(page.locator("#previewContent")).toContainText("پاسخ اول");
 });
});
