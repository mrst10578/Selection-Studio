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
async function waitForStudioBoot(page){
  const splash=page.locator("#bootSplash");
  await expect(splash).toHaveCount(1);
  if(await splash.isVisible())await expect(splash).toBeHidden({timeout:1800});
  await expect(page.locator("#operatorLogin")).toBeVisible();
}

test.describe("Selection Studio",()=>{
  test("operator workbench requires temporary operator login",async({page})=>{
    await page.goto("/studio/");
    await waitForStudioBoot(page);
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
    await expect(page.locator("#provider")).toHaveAttribute("placeholder","قلمچی");
    await page.locator("#provider").fill("MAZ");
    await expect(page.locator("#providerWarning")).toBeVisible();
    await expect(page.locator("#providerWarning")).toHaveText("(اسم حتما باید فارسی باشه)");
    await page.locator("#provider").fill("قلمچی");
    await expect(page.locator("#providerWarning")).toBeHidden();
    await expect(page.locator("#examYear")).toHaveValue("1405");
    await expect(page.locator("#examYear")).toHaveAttribute("readonly","");
    await expect(page.locator("#examMonth")).toHaveAttribute("inputmode","numeric");
    await expect(page.locator("#examDay")).toHaveAttribute("inputmode","numeric");
    await expect(page.locator(".field-hint")).toHaveCount(0);
    await expect(page.locator("#gateHint")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("موارد باقی‌مانده:");
    await expect(page.locator("body")).not.toContainText("۱ یادآوری ساده، ۳ حل چندمرحله‌ای و ۵ دشوار و ترکیبی است");
    await expect(page.locator("html")).toHaveAttribute("dir","rtl");
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
  test("theme and focus mode persist without reloading work state",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});
    await expect(page.locator("html")).toHaveAttribute("data-theme","light");

    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await expect(page.locator("#themeToggle")).toHaveText("تم روشن");

    await page.locator("#focusToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-focus-mode","true");
    await expect(page.locator(".recent")).toBeHidden();
    await expect(page.locator("#sessionEditor")).toBeHidden();
    await expect(page.locator("#saveQuestion")).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await expect(page.locator("html")).toHaveAttribute("data-focus-mode","true");
  });
  test("exam date starts at month, keeps 1405 fixed, and jumps to day after two digits",async({page})=>{
    await page.goto("/studio/");
    await waitForStudioBoot(page);
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator("#operatorLogin")).toBeHidden({timeout:2500});

    await page.locator("#examDateField").click({position:{x:8,y:8}});
    await expect(page.locator("#examMonth")).toBeFocused();
    await page.locator("#examMonth").fill("03");
    await expect(page.locator("#examDay")).toBeFocused();
    await page.locator("#examDay").fill("07");

    await expect(page.locator("#examYear")).toHaveValue("1405");
    await expect(page.locator("#examMonth")).toHaveValue("03");
    await expect(page.locator("#examDay")).toHaveValue("07");
    await expect(page.locator("#examDate")).toHaveValue("1405/03/07");
  });
  test("mobile PDF player exposes crop lock without overflowing",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto("/studio/");
    await waitForStudioBoot(page);
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
    await waitForStudioBoot(page);
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator(".shortcut-card")).toHaveCount(0);
    await expect(page.locator("#hotkeysLauncher")).toHaveText("میانبرها");
    await page.locator("#hotkeysLauncher").click();
    await expect(page.locator("#hotkeysDialog")).toBeVisible();
    await expect(page.locator("#hotkeysDialog")).toContainText("Numpad 1–4");
    await expect(page.locator("#hotkeysDialog")).toContainText("Ctrl + K");
    await expectNoHorizontalOverflow(page);
  });
  test("selected batch surface keeps exports and submit gate",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/selected.html");
    await expect(page.locator("#exportQuestions")).toBeVisible();
    await expect(page.locator("#exportExam")).toBeVisible();
    await expect(page.locator("#submitBatch")).toBeDisabled();
    if((page.viewportSize()?.width||0)>=760){
      await page.locator("#densityToggle").click();
      await expect(page.locator("html")).toHaveAttribute("data-density","comfortable");
      await expect(page.locator("#densityToggle")).toHaveText("نمایش فشرده");
    }
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
  test("selected questions can be filtered and restored after soft delete",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-A-Q001",exam_id:"EXAM-A",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[],answer_regions:[],entered_by:"alice"},
        {id:"EXAM-A-Q002",exam_id:"EXAM-A",source_question_number:2,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_3",correct_option:2,question_regions:[],answer_regions:[],entered_by:"alice"}
      ]));
    });
    await page.goto("/studio/selected.html");
    await expect(page.locator(".question-card")).toHaveCount(2);
    await page.locator("#questionSearch").fill("2");
    await expect(page.locator(".question-card")).toHaveCount(1);
    await expect(page.locator(".question-title strong")).toHaveText("سوال 2");
    await page.locator("#questionSearch").fill("");
    await page.locator(".question-card").first().getByRole("button",{name:"انتقال به حذف‌شده‌ها"}).click();
    await expect(page.locator("#trashSection")).toBeVisible();
    await page.locator(".restore-btn").click();
    await expect(page.locator(".question-card")).toHaveCount(2);
    await expect(page.locator("#trashSection")).toBeHidden();
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
    await expect(page.locator(".review-question")).toHaveCount(1);
    await page.locator("#statusFilter").selectOption("");
    await expect(page.locator(".review-question")).toHaveCount(2);
    await expect(page.locator("#questionList")).toContainText("EXAM-A");
    await expect(page.locator("#questionList")).not.toContainText("EXAM-C");
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
  test("quick review navigation stays inside the active pending queue",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,1,1]};
      const questions=[1,2,3].map((number)=>({id:"EXAM-Q"+number,exam_id:"EXAM",source_question_number:number,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:number===2?"approved":"pending"}));
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify(questions));
    });
    await page.goto("/review-console/");
    await page.locator("#adminUsername").fill("admin");
    await page.locator("#adminPassword").fill("admin");
    await page.locator("#adminLoginForm").press("Enter");
    await expect(page.locator("#appView")).toBeVisible({timeout:2500});
    await page.locator('[data-subject="PHY"]').click();
    await page.locator(".operator-item").click();
    await page.locator("#quickReviewBtn").click();
    await expect(page.locator("#quickId")).toHaveText("EXAM-Q1");
    await page.locator("#nextBtn").click();
    await expect(page.locator("#quickId")).toHaveText("EXAM-Q3");
    await page.locator("#prevBtn").click();
    await expect(page.locator("#quickId")).toHaveText("EXAM-Q1");
    if((page.viewportSize()?.width||0)<=650){
      await page.locator('[data-review-view="answer"]').click();
      await expect(page.locator("#quickViewers")).toHaveAttribute("data-active-view","answer");
    }else{
      await expect(page.locator("#quickAnswerFigure")).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });
});
