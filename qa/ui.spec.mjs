import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function expectNoSeriousA11y(page){
  const result=await new AxeBuilder({page}).analyze();
  const serious=result.violations.filter(v=>["serious","critical"].includes(v.impact));
  expect(serious,serious.map(v=>v.id+": "+v.description).join("\n")).toEqual([]);
}
async function expectNoHorizontalOverflow(page){
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("Selection Studio",()=>{
  test("operator workbench boots with hard gate",async({page})=>{
    await page.goto("/studio/");
    await expect(page.locator("h1")).toHaveText("Selection Studio");
    await expect(page.locator("#saveQuestion")).toBeDisabled();
    await expect(page.locator("html")).toHaveAttribute("dir","rtl");
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
  test("selected batch surface keeps exports and submit gate",async({page})=>{
    await page.goto("/studio/selected.html");
    await expect(page.locator("#exportQuestions")).toBeVisible();
    await expect(page.locator("#exportExam")).toBeVisible();
    await expect(page.locator("#submitBatch")).toBeDisabled();
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Review Console",()=>{
  test("independent admin login surface boots",async({page})=>{
    await page.goto("/review-console/");
    await expect(page.locator("#loginView h1")).toHaveText("مدیریت بانک تست");
    await expect(page.locator("#adminKey")).toHaveAttribute("type","password");
    await expect(page.locator("#appView")).toHaveClass(/hidden/);
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
});
