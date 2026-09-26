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
    await expect(page.locator('.topbar nav a[href*="admin"]')).toHaveCount(0);
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
  test("admin drills from subject to selector username to that selector tests",async({page})=>{
    await page.addInitScript(()=>{
      const records=[
        {id:"EXAM-A-Q001",exam_id:"EXAM-A",source_question_number:1,subject:"BIO",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[],answer_regions:[],entered_by:"alice",review_status:"pending",created_at:"2026-01-01T00:00:00.000Z"},
        {id:"EXAM-A-Q002",exam_id:"EXAM-A",source_question_number:2,subject:"BIO",grade:10,chapter:"01",unit:"01",difficulty:"level_3",correct_option:2,question_regions:[],answer_regions:[],entered_by:"alice",review_status:"approved",created_at:"2026-01-01T00:00:00.000Z"},
        {id:"EXAM-B-Q003",exam_id:"EXAM-B",source_question_number:3,subject:"BIO",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:3,question_regions:[],answer_regions:[],entered_by:"bob",review_status:"pending",created_at:"2026-01-01T00:00:00.000Z"},
        {id:"EXAM-C-Q004",exam_id:"EXAM-C",source_question_number:4,subject:"MATH",grade:11,chapter:"01",unit:"01",difficulty:"level_2",correct_option:4,question_regions:[],answer_regions:[],entered_by:"alice",review_status:"pending",created_at:"2026-01-01T00:00:00.000Z"}
      ];
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify(records));
    });
    await page.goto("/review-console/");
    await expect(page.locator("#loginView h1")).toHaveText("مدیریت بانک تست");
    await page.locator("#adminUsername").fill("admin");
    await page.locator("#adminPassword").fill("admin");
    await page.locator("#adminLoginForm").press("Enter");
    await expect(page.locator("#loginView")).toBeHidden({timeout:2500});
    await expect(page.locator("#appView")).toBeVisible();
    await expect(page.locator(".back-link")).toHaveCount(0);
    await expect(page.locator("[data-subject]")).toHaveCount(4);

    await page.locator('[data-subject="BIO"]').click();
    await expect(page.locator("#operatorList")).toContainText("@alice");
    await expect(page.locator("#operatorList")).toContainText("@bob");
    await page.locator(".operator-item",{hasText:"@alice"}).click();

    await expect(page.locator("#batchTitle")).toContainText("@alice");
    await expect(page.locator("#batchTitle")).toContainText("زیست");
    await expect(page.locator(".review-question")).toHaveCount(2);
    await expect(page.locator("#questionList")).toContainText("EXAM-A");
    await expect(page.locator("#questionList")).not.toContainText("EXAM-C");
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
});
