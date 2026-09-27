import {test,expect} from "@playwright/test";

test("real PDF.js renders an allowed mixed-script PDF with isolated LTR drawing surface",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","One real-engine integration pass is sufficient.");
  await page.setContent(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
    body{font-family:Arial,Tahoma,sans-serif;padding:48px;font-size:24px;line-height:2;color:#111}
    .box{border:2px solid #333;padding:24px}
  </style></head><body><div class="box">
    <div>متن فارسی آزمایشی</div>
    <div dir="ltr">Latin ABC · 1234 · + − × ÷</div>
    <div dir="ltr">x² + y² = z² · E = mc²</div>
    <div>ترکیب فارسی ۱۲۳۴ و ABC</div>
  </div></body></html>`);
  const pdf=await page.pdf({width:"600px",height:"800px",printBackground:true});
  await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
  await page.goto("/studio/");
  await expect(page.locator("#bootSplash")).toBeHidden({timeout:1800});

  await page.setInputFiles("#questionPdf",{name:"mixed-script.pdf",mimeType:"application/pdf",buffer:pdf});
  await expect(page.locator("#qPage")).toHaveText("1/1",{timeout:10000});
  const render=await page.evaluate(()=>{
    const canvas=document.querySelector("#qCanvas");
    const stage=document.querySelector("#qStage");
    const probe=document.createElement("canvas");probe.width=60;probe.height=80;
    const x=probe.getContext("2d");x.drawImage(canvas,0,0,60,80);
    const data=x.getImageData(0,0,60,80).data;
    let dark=0;
    for(let i=0;i<data.length;i+=4)if((data[i]+data[i+1]+data[i+2])/3<235)dark++;
    return {
      dark,
      stageDirection:getComputedStyle(stage).direction,
      canvasDirection:getComputedStyle(canvas).direction,
      width:canvas.width,
      height:canvas.height
    };
  });
  expect(render.dark).toBeGreaterThan(10);
  expect(render.stageDirection).toBe("ltr");
  expect(render.canvasDirection).toBe("ltr");
  expect(render.width).toBeGreaterThan(100);
  expect(render.height).toBeGreaterThan(100);

  await page.locator("#provider").fill("قلمچی");
  await page.locator("#examMonth").fill("03");
  await page.locator("#examDay").fill("07");
  await page.setInputFiles("#answerPdf",{name:"mixed-answer.pdf",mimeType:"application/pdf",buffer:pdf});
  await expect(page.locator("#aPage")).toHaveText("1/1",{timeout:10000});
  await page.locator("#saveSession").click();
  await expect(page.locator("#sessionSummary")).toContainText("قلمچی");

  const before=await page.locator("#qCanvas").screenshot();
  await page.setInputFiles("#questionPdf",{name:"broken.pdf",mimeType:"application/pdf",buffer:Buffer.from("not a pdf")});
  await expect(page.locator(".global-toast")).toContainText("سند فعال قبلی «mixed-script.pdf» حفظ شد",{timeout:10000});
  await expect(page.locator("#questionPdf")).toHaveValue("");
  await expect(page.locator("#qPage")).toHaveText("1/1");
  const after=await page.locator("#qCanvas").screenshot();
  expect(after.equals(before)).toBe(true);
});
