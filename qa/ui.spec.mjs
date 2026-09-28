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

function contrastRatio(a,b){
  const lum=value=>{
    const hex=value.trim().replace("#","");
    const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  };
  const x=lum(a),y=lum(b),hi=Math.max(x,y),lo=Math.min(x,y);
  return (hi+.05)/(lo+.05);
}

test.describe("Selection Studio",()=>{
  test("production route aliases serve both public panels",async({page})=>{
    await page.goto("/");
    await waitForStudioBoot(page);
    await expect(page.locator("#operatorLoginTitle")).toHaveText("ورود گزینشگر");
    await page.goto("/admin/");
    await expect(page.locator("#loginView h1")).toHaveText("مدیریت بانک تست");
    await page.keyboard.press("Control+K");
    await expect(page.locator("#commandPalette")).not.toHaveAttribute("open","");
  });

  test("operator workbench requires temporary operator login",async({page})=>{
    await page.goto("/studio/");
    await waitForStudioBoot(page);
    await page.keyboard.press("Control+K");
    await expect(page.locator("#hotkeysDialog")).not.toHaveAttribute("open","");
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator("#operatorLogin")).toHaveClass(/auth-success/);
    await expect(page.locator("#operatorLoginSubmit")).toHaveText("ورود موفق");
    await expect(page.locator("#operatorLogin")).toBeHidden({timeout:2500});
    await expect(page.locator(".topbar h1")).toHaveText("Selection Studio");
    await expect(page.locator('.topbar nav a[href*="admin"]')).toHaveCount(0);
    await expect(page.locator("#saveQuestion")).toBeDisabled();
    await expect(page.locator("#taxonomySearch")).toHaveCount(0);
    await expect(page.locator("#qRegionLock")).toHaveClass(/unlocked/);
    await expect(page.locator("#aRegionLock")).toHaveClass(/unlocked/);
    await expect(page.locator("#qRegionLock")).toHaveAttribute("aria-pressed","false");
    await expect(page.locator("#aRegionLock")).toHaveAttribute("aria-pressed","false");
    await expect(page.locator(".date-separator")).toHaveCount(2);
    await expect(page.locator("#provider")).toHaveAttribute("placeholder","قلمچی");
    await expect(page.locator("#questionPdfState")).toHaveAttribute("data-state","empty");
    await expect(page.locator("#answerPdfState")).toHaveAttribute("data-state","empty");
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
  test("dark theme is fixed and display-mode controls are removed",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-ui-theme-v1","light");
    });
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await expect(page.locator(".theme-toggle")).toHaveCount(0);
    await expect(page.locator("#focusToggle")).toHaveCount(0);
    await expect(page.locator("#densityToggle")).toHaveCount(0);
    expect(await page.evaluate(()=>localStorage.getItem("testbank-ui-theme-v1"))).toBeNull();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
    await expect(page.locator("#focusToggle")).toHaveCount(0);
    await expect(page.locator("#densityToggle")).toHaveCount(0);
  });
  test("control boundaries and text keep required contrast in the fixed dark theme",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});
    const vars=await page.evaluate(()=>{const c=getComputedStyle(document.documentElement);return{
      border:c.getPropertyValue("--control-border").trim(),
      subtle:c.getPropertyValue("--surface-subtle").trim(),
      selection:c.getPropertyValue("--selection").trim(),
      text:c.getPropertyValue("--text").trim(),
      bg:c.getPropertyValue("--bg").trim(),
      accent:c.getPropertyValue("--accent").trim()
    }});
    expect(contrastRatio(vars.border,vars.subtle)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(vars.border,vars.selection)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(vars.text,vars.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(vars.accent,vars.selection)).toBeGreaterThanOrEqual(3);
  });

  test("legacy record ID page and bbox semantics remain unchanged",async({page})=>{
    const legacy={id:"LEGACY-1404-Q007",exam_id:"LEGACY-1404",source_question_number:7,subject:"PHY",grade:11,chapter:"03",unit:"02",difficulty:"level_4",correct_option:3,question_regions:[{page:3,bbox_norm:[.125,.2,.625,.72]}],answer_regions:[{page:9,bbox_norm:[.1,.1,.9,.9]}],entered_by:"legacy"};
    await page.addInitScript(record=>{sessionStorage.setItem("selection-studio-operator-auth-v1","admin");localStorage.setItem("testbank-studio.records.v1",JSON.stringify([record]))},legacy);
    await page.goto("/studio/selected.html");
    const loaded=await page.evaluate(async()=>{const {loadRecords}=await import("/studio/store.js");return loadRecords()[0]});
    expect(loaded.id).toBe(legacy.id);
    expect(loaded.question_regions[0].page).toBe(3);
    expect(loaded.question_regions[0].bbox_norm).toEqual(legacy.question_regions[0].bbox_norm);
    expect(loaded.answer_regions[0].page).toBe(9);
    expect(loaded.answer_regions[0].bbox_norm).toEqual(legacy.answer_regions[0].bbox_norm);
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
  test("exam month and day reject values above 12 and 31",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});

    const month=page.locator("#examMonth"),day=page.locator("#examDay");
    await month.fill("13");
    await expect(month).toHaveValue("");
    await month.fill("12");
    await expect(month).toHaveValue("12");

    await day.fill("32");
    await expect(day).toHaveValue("");
    await day.fill("31");
    await expect(day).toHaveValue("31");
    await expect(page.locator("#examDate")).toHaveValue("1405/12/31");

    await month.fill("3");
    await day.fill("7");
    await expect(page.locator("#examDate")).toHaveValue("1405/03/07");
  });

  test("Level active styling appears immediately on the same click",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});

    const level=page.locator('[data-target="difficulty"] button[data-value="level_3"]');
    await level.click();
    await expect(page.locator("#difficulty")).toHaveValue("level_3");
    await expect(level).toHaveClass(/active/);

    const visual=await level.evaluate(el=>{
      const style=getComputedStyle(el);
      return {backgroundImage:style.backgroundImage,borderColor:style.borderColor,color:style.color};
    });
    expect(visual.backgroundImage).toContain("linear-gradient");
    expect(visual.borderColor).not.toBe("rgb(117, 137, 160)");
  });

  test("question number readiness is independent from exam completion and accepts Persian digits",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});

    await page.locator("#sourceNumber").fill("۱۲");
    await expect(page.locator("#sourceNumber")).toHaveValue("12");
    await expect(page.locator('[data-check="number"]')).toHaveClass(/done/);
    await expect(page.locator("#questionIdentity")).toContainText("12");
    await expect(page.locator('[data-check="exam"]')).not.toHaveClass(/done/);
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
    await expect(page.locator("#qCropLock svg")).toHaveCount(1);
    await expect(page.locator("#qStage")).toHaveClass(/mobile-browse-mode/);
    const lockBox=await page.locator("#qCropLock").boundingBox(),stageBox=await page.locator("#qStage").boundingBox();
    expect(lockBox).not.toBeNull();expect(stageBox).not.toBeNull();
    expect(Math.abs(lockBox.x-(stageBox.x+10))).toBeLessThanOrEqual(2);
    expect(Math.abs(lockBox.y-(stageBox.y+10))).toBeLessThanOrEqual(2);
    await expect(page.locator("#hotkeysLauncher")).toBeHidden();
    const nativeFileStyle=await page.locator("#questionPdf").evaluate(el=>({opacity:getComputedStyle(el).opacity,position:getComputedStyle(el).position}));
    expect(nativeFileStyle.opacity).toBe("0");
    expect(nativeFileStyle.position).toBe("absolute");
    await expect(page.locator(".theme-toggle")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
  test("coarse-pointer wide viewport still exposes PDF crop lock",async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="mobile-chromium","Requires coarse-pointer mobile context.");
    await page.setViewportSize({width:820,height:900});
    await page.goto("/studio/");
    await waitForStudioBoot(page);
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator("#operatorLogin")).toBeHidden({timeout:2500});
    await expect(page.locator("#qStage")).toHaveClass(/mobile-browse-mode/);
    await expect(page.locator("#qCropLock")).toBeVisible();
    await expect(page.locator("#qCropLock svg")).toHaveCount(1);
  });

  test("360px mobile workbench keeps header and crop controls reachable",async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="mobile-chromium","Explicit narrow-width mobile check.");
    await page.setViewportSize({width:360,height:800});
    await page.goto("/studio/");
    await waitForStudioBoot(page);
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator("#operatorLogin")).toBeHidden({timeout:2500});
    await expect(page.locator("#qCropLock")).toBeVisible();
    await expect(page.locator(".theme-toggle")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("biology UX never leaks into restored non-biology subjects",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-studio.sticky.v1",JSON.stringify({subject:"MATH",grade:"10",chapter:"",unit:""}));
    });
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});
    await expect(page.locator("#subject")).toHaveValue("MATH");
    await expect(page.locator("#bioCombinationPanel")).toBeHidden();
    await expect(page.locator("#bioReadinessCheck")).toBeHidden();
    for(const subject of ["PHY","CHEM"]){
      await page.locator("#subject").selectOption(subject);
      await expect(page.locator("#bioCombinationPanel")).toBeHidden();
      await expect(page.locator("#bioReadinessCheck")).toBeHidden();
    }
    await page.locator("#subject").selectOption("BIO");
    await expect(page.locator("#bioCombinationPanel")).toBeVisible();
    await expect(page.locator("#bioReadinessCheck")).toBeVisible();
  });

  test("guide omits golden rule and keeps the concise Windows shortcut note",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/guide.html");
    await expect(page.locator("body")).not.toContainText("قانون طلایی");
    const card=page.locator(".guide-card").filter({hasText:"میانبر دسکتاپ ویندوز"});
    await expect(card).toContainText("اگه از ویندوز استفاده میکنی، پایین صفحه اصلی پنل گزینش روی دکمه میانبرها کلیک کنید یا دکمه‌های Ctrl + K را فشار دهید.");
    await expect(card.locator(".shortcut-table")).toHaveCount(0);
    await expect(page.locator(".theme-toggle")).toHaveCount(0);
  });

  test("Windows Hotkeys panel replaces inline shortcut guide",async({page})=>{
    await page.goto("/studio/");
    await waitForStudioBoot(page);
    await page.locator("#operatorUsername").fill("admin");
    await page.locator("#operatorPassword").fill("admin");
    await page.locator("#operatorLoginForm").press("Enter");
    await expect(page.locator(".shortcut-card")).toHaveCount(0);
    await expect(page.locator("#hotkeysLauncher")).toHaveText("میانبرها");
    if((page.viewportSize()?.width||0)<=600){
      await expect(page.locator("#hotkeysLauncher")).toBeHidden();
      await expectNoHorizontalOverflow(page);
      return;
    }
    await expect(page.locator("#hotkeysLauncher")).toBeVisible();
    await page.locator("#hotkeysLauncher").click();
    await expect(page.locator("#hotkeysDialog")).toBeVisible();
    await expect(page.locator("#hotkeysDialog")).toContainText("Numpad 1–4");
    await expect(page.locator("#hotkeysDialog")).toContainText("Ctrl + K");
    await expectNoHorizontalOverflow(page);
  });
  test("taxonomy search controls are removed from selector, edit, and review surfaces",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/");
    await expect(page.locator("#taxonomySearch")).toHaveCount(0);
    await page.goto("/studio/selected.html");
    await expect(page.locator("#editTaxonomySearch")).toHaveCount(0);
    await page.goto("/admin/");
    await expect(page.locator("#quickTaxonomySearch")).toHaveCount(0);
  });

  test("selected batch surface keeps exports and submit gate",async({page})=>{
    await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
    await page.goto("/studio/selected.html");
    await expect(page.locator("#exportQuestions")).toBeVisible();
    await expect(page.locator("#exportExam")).toBeVisible();
    await expect(page.locator("#submitBatch")).toBeDisabled();
    await expect(page.locator("#densityToggle")).toHaveCount(0);
    await expectNoSeriousA11y(page);
    await expectNoHorizontalOverflow(page);
  });
  test("Studio and selected batch stay scoped to the active exam",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-studio.exam-draft.v1",JSON.stringify({id:"EXAM-A",provider:"قلمچی",date:"1405/01/01",entered_by:"admin",question_pdf_name:"q.pdf",answer_pdf_name:"a.pdf"}));
      localStorage.setItem("testbank-studio.last-batch.v1",JSON.stringify({id:"EXAM-B-BATCH-OLD",exam_id:"EXAM-B",question_count:9,sent_at:"2026-01-03T00:00:00.000Z",fingerprint:"old"}));
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-A-Q001",exam_id:"EXAM-A",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[{page:1,bbox_norm:[0,0,.8,.8]}],answer_regions:[{page:1,bbox_norm:[0,0,.8,.8]}],entered_by:"admin"},
        {id:"EXAM-B-Q001",exam_id:"EXAM-B",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[{page:1,bbox_norm:[0,0,.8,.8]}],answer_regions:[{page:1,bbox_norm:[0,0,.8,.8]}],entered_by:"admin"},
        {id:"EXAM-B-Q002",exam_id:"EXAM-B",source_question_number:2,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,trashed_at:"2026-01-02T00:00:00.000Z",entered_by:"admin"}
      ]));
    });
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});
    await expect(page.locator("#recordCount")).toHaveText("1");
    await expect(page.locator("#recentList")).toContainText("سؤال 1");
    await page.goto("/studio/selected.html");
    await expect(page.locator("#questionCount")).toHaveText("1");
    await expect(page.locator("#lastSubmission")).toHaveText("هنوز ارسالی ثبت نشده است.");
    await expect(page.locator(".question-card")).toHaveCount(1);
    await expect(page.locator("#questionList")).toContainText("سؤال 1");
    await expect(page.locator("#trashSection")).toBeHidden();
  });

  test("suggested next question number is scoped to the restored exam",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-studio.exam-draft.v1",JSON.stringify({id:"EXAM-A",provider:"قلمچی",date:"1405/01/01",entered_by:"admin",question_pdf_name:"q.pdf",answer_pdf_name:"a.pdf"}));
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-B-Q099",exam_id:"EXAM-B",source_question_number:99,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1},
        {id:"EXAM-A-Q003",exam_id:"EXAM-A",source_question_number:3,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1},
        {id:"EXAM-A-Q004",exam_id:"EXAM-A",source_question_number:4,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,trashed_at:"2026-01-02T00:00:00.000Z"}
      ]));
    });
    await page.goto("/studio/");
    await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});
    await expect(page.locator("#sourceNumber")).toHaveValue("5");
  });

  test("renaming a selected question preserves its IndexedDB previews and rejects missing numbers",async({page})=>{
    const record={id:"EXAM-A-Q001",exam_id:"EXAM-A",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[{page:1,bbox_norm:[0,0,.5,.5]}],answer_regions:[{page:1,bbox_norm:[0,0,.5,.5]}],entered_by:"alice"};
    await page.addInitScript(record=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([record]));
    },record);
    await page.goto("/studio/selected.html");
    await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open("selection-studio-previews-v1",1);
        req.onupgradeneeded=()=>req.result.createObjectStore("previews");
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      await new Promise((resolve,reject)=>{
        const tx=db.transaction("previews","readwrite"),store=tx.objectStore("previews");
        store.put(new Blob(["question"],{type:"image/webp"}),"EXAM-A-Q001:question");
        store.put(new Blob(["answer"],{type:"image/webp"}),"EXAM-A-Q001:answer");
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await page.locator(".edit-btn").click();
    await expect(page.locator("#editNumber")).toHaveAttribute("required","");
    await page.locator("#editNumber").fill("2");
    await page.locator("#editForm").evaluate(form=>form.requestSubmit());
    await expect(page.locator("#editDialog")).not.toHaveAttribute("open","");
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("testbank-studio.records.v1")||"[]")[0]?.id)).toBe("EXAM-A-Q002");
    const previewState=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const req=indexedDB.open("selection-studio-previews-v1",1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
      const get=key=>new Promise((resolve,reject)=>{const tx=db.transaction("previews","readonly"),req=tx.objectStore("previews").get(key);req.onsuccess=()=>resolve(Boolean(req.result));req.onerror=()=>reject(req.error)});
      const result={newQ:await get("EXAM-A-Q002:question"),newA:await get("EXAM-A-Q002:answer"),oldQ:await get("EXAM-A-Q001:question"),oldA:await get("EXAM-A-Q001:answer")};
      db.close();return result;
    });
    expect(previewState.newQ).toBe(true);expect(previewState.newA).toBe(true);
    expect(previewState.oldQ).toBe(false);expect(previewState.oldA).toBe(false);
  });

  test("missing selected-question preview does not open the preview dialog",async({page})=>{
    await page.addInitScript(()=>{
      sessionStorage.setItem("selection-studio-operator-auth-v1","admin");
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-A-Q001",exam_id:"EXAM-A",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[{page:1,bbox_norm:[0,0,.5,.5]}],answer_regions:[{page:1,bbox_norm:[0,0,.5,.5]}],entered_by:"alice"}
      ]));
    });
    await page.goto("/studio/selected.html");
    await expect(page.locator(".q-preview")).toHaveClass(/missing/);
    await page.locator(".q-preview").evaluate(img=>img.click());
    await expect(page.locator("#previewDialog")).not.toHaveAttribute("open","");
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
    await expect(page.locator(".question-title strong")).toHaveText("سؤال 2");
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
    await page.goto("/admin/");
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
  test("opening Quick Review is mutation-free and undo enables only after a real edit",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,.8,.8]};
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-Q1",exam_id:"EXAM",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:"pending",revision_history:[]}
      ]));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");await page.locator("#adminPassword").fill("admin");await page.locator("#adminLoginForm").press("Enter");
    await expect(page.locator("#appView")).toBeVisible({timeout:2500});
    await page.locator('[data-subject="PHY"]').click();await page.locator(".operator-item").click();
    await page.locator("#quickReviewBtn").click();
    await expect(page.locator("#quickUndoBtn")).toBeDisabled();
    await page.locator("#quickClose").click();
    await page.locator("#quickReviewBtn").click();
    await expect(page.locator("#quickUndoBtn")).toBeDisabled();
    await page.locator('[data-target="quickDifficulty"] button[data-value="level_3"]').click();
    await expect(page.locator("#quickUndoBtn")).toBeEnabled();
    await expect(page.locator("#reviewHistory")).toContainText("سطح");
    await page.locator("#approveBtn").click();
    await expect(page.locator("#quickDialog")).not.toHaveAttribute("open","");
    await expect(page.locator("#pendingCount")).toHaveText("0");
    await expect(page.locator("#undoBtn")).toBeEnabled();
  });

  test("autosave flushes the edited operator before an immediate operator switch",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,.8,.8]};
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-A-Q1",exam_id:"EXAM-A",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:"pending"},
        {id:"EXAM-B-Q1",exam_id:"EXAM-B",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"bob",review_status:"pending"}
      ]));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");await page.locator("#adminPassword").fill("admin");await page.locator("#adminLoginForm").press("Enter");
    await page.locator('[data-subject="PHY"]').click();
    await page.locator(".operator-item",{hasText:"@alice"}).click();
    await page.locator("#quickReviewBtn").click();
    await page.locator('[data-target="quickDifficulty"] button[data-value="level_4"]').click();
    await page.locator("#quickClose").click();
    await page.locator(".operator-item",{hasText:"@bob"}).click();
    await page.locator(".operator-item",{hasText:"@alice"}).click();
    await page.locator("#quickReviewBtn").click();
    await expect(page.locator("#quickDifficulty")).toHaveValue("level_4");
    await expect(page.locator('[data-target="quickDifficulty"] button[data-value="level_4"]')).toHaveClass(/active/);
  });

  test("rapid subject and operator switches cannot paint stale review data",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,.8,.8]};
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"BIO-A-Q1",exam_id:"BIO-A",source_question_number:1,subject:"BIO",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"bio-user",review_status:"pending",biology_combination:{is_combined:false,topics:[]}},
        {id:"PHY-A-Q1",exam_id:"PHY-A",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:"pending"},
        {id:"PHY-B-Q1",exam_id:"PHY-B",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"bob",review_status:"pending"}
      ]));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");await page.locator("#adminPassword").fill("admin");await page.locator("#adminLoginForm").press("Enter");
    await expect(page.locator("#appView")).toBeVisible({timeout:2500});
    await page.evaluate(()=>{
      document.querySelector('[data-subject="BIO"]').click();
      document.querySelector('[data-subject="PHY"]').click();
    });
    await expect(page.locator('[data-subject="PHY"]')).toHaveClass(/active/);
    await expect(page.locator("#operatorList")).toContainText("@alice");
    await expect(page.locator("#operatorList")).toContainText("@bob");
    await expect(page.locator("#operatorList")).not.toContainText("@bio-user");
    await page.evaluate(()=>{
      const buttons=[...document.querySelectorAll(".operator-item")];
      buttons.find(b=>b.textContent.includes("@alice"))?.click();
      buttons.find(b=>b.textContent.includes("@bob"))?.click();
    });
    await expect(page.locator("#batchTitle")).toContainText("@bob");
    await expect(page.locator("#questionList")).toContainText("PHY-B");
    await expect(page.locator("#questionList")).not.toContainText("PHY-A");
  });

  test("operator usernames render as text and cannot inject markup",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,.8,.8]};
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-X-Q1",exam_id:"EXAM-X",source_question_number:1,subject:"CHEM",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"<img src=x onerror=window.__operatorXss=1>",review_status:"pending"}
      ]));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");await page.locator("#adminPassword").fill("admin");await page.locator("#adminLoginForm").press("Enter");
    await page.locator('[data-subject="CHEM"]').click();
    await expect(page.locator("#operatorList .operator-item img")).toHaveCount(0);
    await expect(page.locator("#operatorList")).toContainText("<img src=x onerror=window.__operatorXss=1>");
    expect(await page.evaluate(()=>window.__operatorXss)).toBeUndefined();
  });

  test("local publish is one-shot for already published approved questions",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,.8,.8]};
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-P-Q1",exam_id:"EXAM-P",source_question_number:1,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:"approved",status:"draft"},
        {id:"EXAM-P-Q2",exam_id:"EXAM-P",source_question_number:2,subject:"PHY",grade:10,chapter:"",unit:"",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:"approved",status:"draft"}
      ]));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");await page.locator("#adminPassword").fill("admin");await page.locator("#adminLoginForm").press("Enter");
    await page.locator('[data-subject="PHY"]').click();await page.locator(".operator-item").click();
    await expect(page.locator("#publishBtn")).toBeEnabled();
    page.once("dialog",dialog=>dialog.accept());
    await page.locator("#publishBtn").click();
    await expect(page.locator("#publishBtn")).toBeDisabled();
    const statuses=await page.evaluate(()=>JSON.parse(localStorage.getItem("testbank-studio.records.v1")||"[]").map(x=>x.status));
    expect(statuses).toEqual(["published","draft"]);
  });

  test("command palette accepts Persian digits for question lookup",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,.8,.8]};
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify([
        {id:"EXAM-Q12",exam_id:"EXAM",source_question_number:12,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:"pending"}
      ]));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");await page.locator("#adminPassword").fill("admin");await page.locator("#adminLoginForm").press("Enter");
    await page.locator('[data-subject="PHY"]').click();await page.locator(".operator-item").click();
    await page.locator("#commandLauncher").click();
    await page.locator("#commandInput").fill("۱۲");
    await expect(page.locator("#commandList")).toContainText("باز کردن سؤال 12");
  });

  test("quick review navigation stays inside the active pending queue",async({page})=>{
    await page.addInitScript(()=>{
      const region={page:1,bbox_norm:[0,0,1,1]};
      const questions=[1,2,3].map((number)=>({id:"EXAM-Q"+number,exam_id:"EXAM",source_question_number:number,subject:"PHY",grade:10,chapter:"01",unit:"01",difficulty:"level_2",correct_option:1,question_regions:[region],answer_regions:[region],entered_by:"alice",review_status:number===2?"approved":"pending"}));
      localStorage.setItem("testbank-studio.records.v1",JSON.stringify(questions));
    });
    await page.goto("/admin/");
    await page.locator("#adminUsername").fill("admin");
    await page.locator("#adminPassword").fill("admin");
    await page.locator("#adminLoginForm").press("Enter");
    await expect(page.locator("#appView")).toBeVisible({timeout:2500});
    await page.locator('[data-subject="PHY"]').click();
    await page.locator(".operator-item").click();
    await page.locator("#quickReviewBtn").click();
    await expect(page.locator("#quickId")).toHaveText("EXAM-Q1");
    await expectNoSeriousA11y(page);
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
