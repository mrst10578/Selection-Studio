import {test,expect} from "@playwright/test";

test.describe("Ember Atelier Pro workspace",()=>{
  test("command palette captures Ctrl+K, searches Persian commands, and supports arrows",async({page})=>{
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:7000});
    await expect(page.locator("#studioSidebarHolder")).toHaveCount(1);
    await page.keyboard.press("Control+k");
    await expect(page.locator("#studioCommandPalette")).toBeVisible();
    await expect(page.locator("#hotkeysDialog")).not.toBeVisible();
    const query=page.locator("#studioCommandSearch");
    await expect(query).toBeFocused();
    await query.fill("آزمون");
    await expect(page.locator(".studio-command-item").first()).toContainText("آزمون");
    await query.press("ArrowDown");
    await expect(page.locator(".studio-command-item.active")).toHaveCount(1);
    await query.press("Escape");
    await expect(page.locator("#studioCommandPalette")).toBeHidden();
  });

  test("dashboard shows actual locally saved questions and downloadable metadata",async({page})=>{
    await page.addInitScript(()=>localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
      {id:"q1",exam_id:"آزمون-۱",source_question_number:12},
      {id:"q2",exam_id:"آزمون-۱",source_question_number:13},
      {id:"q3",exam_id:"آزمون-۲",source_question_number:4}
    ])));
    await page.goto("/studio/");
    await expect(page.locator("#studioRecordCount")).toHaveText("3");
    await page.locator(".studio-history-controls button").last().click();
    await expect(page.locator("#studioProjectDashboard")).toBeVisible();
    await expect(page.locator(".studio-project-card")).toHaveCount(2);
    await expect(page.locator(".studio-dashboard-hero")).toContainText("3 سؤال");
    await expect(page.locator(".studio-dashboard-actions button").first()).toContainText("JSON");
    await page.keyboard.press("Escape");
  });

  test("metadata undo and version snapshots preserve form values without saving PDF credentials",async({page})=>{
    await page.goto("/studio/");
    const provider=page.locator("#provider");
    await provider.fill("قلمچی");
    await expect(page.locator("#studioUndo")).toBeEnabled();
    await page.locator("#studioUndo").click();
    await expect(provider).toHaveValue("");
    await page.locator("#studioRedo").click();
    await expect(provider).toHaveValue("قلمچی");
    await page.waitForTimeout(800);
    const value=await page.evaluate(()=>JSON.parse(localStorage.getItem("selection-studio-form-draft-v3")||"null"));
    expect(value?.version).toBe(3);
    expect(value?.fields?.provider).toBe("قلمچی");
    expect(value?.fields?.questionPdf).toBeUndefined();
    expect(value?.fields?.accessToken).toBeUndefined();
    await page.getByRole("button",{name:"ذخیره نسخه"}).click();
    const revisions=await page.evaluate(()=>JSON.parse(localStorage.getItem("selection-studio-form-revisions-v1")||"[]"));
    expect(revisions).toHaveLength(1);
  });

  test("desktop three panes resize and persist layout across refresh",async({page},testInfo)=>{
    test.skip(testInfo.project.name==="mobile-chromium","Desktop interaction check.");
    await page.goto("/studio/");
    await expect(page.locator("#studioSidebarHolder")).toBeVisible();
    const before=await page.evaluate(()=>parseInt(getComputedStyle(document.documentElement).getPropertyValue("--studio-sidebar")));
    const resize=page.locator(".studio-resize-sidebar");
    await resize.focus();await resize.press("ArrowLeft");
    const after=await page.evaluate(()=>parseInt(document.documentElement.style.getPropertyValue("--studio-sidebar")));
    expect(after).toBeGreaterThan(before);
    await page.locator(".studio-toggle-projects").click();
    await expect(page.locator("#studioSidebarHolder")).toBeHidden();
    await page.reload();
    await expect(page.locator("#studioSidebarHolder")).toBeHidden();
    await page.locator(".studio-toggle-projects").click();
    await expect(page.locator("#studioSidebarHolder")).toBeVisible();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("selection-studio-layout-v3")||"{}"));
    expect(saved.sidebar).toBe(after);
  });

  test("narrow mobile workspace has no horizontal overflow",async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="mobile-chromium","Mobile viewport only.");
    await page.setViewportSize({width:390,height:844});
    await page.goto("/studio/");
    await expect(page.locator(".studio-projects")).toBeVisible();
    await expect(page.locator(".viewer")).toBeVisible();
    await expect(page.locator(".inspector")).toBeVisible();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
