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
  test("operator workbench requires temporary operator login",async({page})=>{
    await page.goto("/studio/");
    await expect(page.locator("#operatorLogin")).toBeVisible();
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator("#operatorLogin")).toHaveClass(/auth-success/);
    await expect(page.locator("#operatorLoginSubmit")).toHaveText("ورود موفق");
    await expect(page.locator("#operatorLogin")).toBeHidden({timeout:2500});
    await expect(page.locator(".topbar h1")).toHaveText("Selection Studio");
    await expect(page.locator("#saveQuestion")).toBeDisabled();
    await expect(page.locator(".date-separator")).toHaveCount(2);
    await expect(page.locator("#examYear")).toHaveAttribute("inputmode","numeric");
    await expect(page.locator("#examMonth")).toHaveAttribute("inputmode","numeric");
    await expect(page.locator("#examDay")).toHaveAttribute("inputmode","numeric");
    await expect(page.locator("html")).toHaveAttribute("dir","rtl");
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
  test("mobile PDF player exposes crop lock without overflowing",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto("/studio/");
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator("#qCropLock")).toBeVisible();
    await expect(page.locator("#qCropLock")).toHaveAttribute("aria-pressed","false");
    await expect(page.locator("#qStage")).toHaveClass(/mobile-browse-mode/);
    await expectNoHorizontalOverflow(page);
  });
  test("Windows Hotkeys panel replaces inline shortcut guide",async({page})=>{
    await page.goto("/studio/");
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator(".shortcut-card")).toHaveCount(0);
    await expect(page.locator("#hotkeysLauncher")).toHaveText("Windows Hotkeys");
    await page.locator("#hotkeysLauncher").click();
    await expect(page.locator("#hotkeysDialog")).toBeVisible();
    await expect(page.locator("#hotkeysDialog")).toContainText("Numpad 1–4");
    await expect(page.locator("#hotkeysDialog")).toContainText("Ctrl + K");
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
  test("local admin login opens management console",async({page})=>{
    await page.goto("/review-console/");
    await expect(page.locator("#loginView h1")).toHaveText("مدیریت بانک تست");
    await expect(page.locator("#adminPassword")).toHaveAttribute("type","password");
    await page.locator("#adminUsername").fill("admin");
    await page.locator("#adminPassword").fill("admin");
    await page.locator("#adminLoginForm").press("Enter");
    await expect(page.locator("#loginView")).toHaveClass(/auth-success/);
    await expect(page.locator("#loginBtn")).toHaveText("ورود موفق");
    await expect(page.locator("#loginView")).toBeHidden({timeout:2500});
    await expect(page.locator("#appView")).toBeVisible();
    await expect(page.locator(".queue-tabs")).toBeVisible();
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
});
