import {test,expect} from "@playwright/test";

async function openHarness(page){
  await page.addInitScript(()=>sessionStorage.setItem("selection-studio-operator-auth-v1","admin"));
  await page.goto("/studio/");
}

test.describe("PdfCropper concurrency and crop integrity",()=>{
  test("only the newest concurrent file load can become active",async({page})=>{
    await openHarness(page);
    const result=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="tStage" style="position:relative;width:350px;height:300px;overflow:auto"><canvas id="tCanvas"></canvas></div><span id="tPage"></span><button id="tPrev"></button><button id="tNext"></button>');
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const fakePdf=(code)=>({
        numPages:2,
        async getPage(page){
          return {
            getViewport:({scale})=>({width:500*scale,height:1200*scale}),
            render({canvasContext}){
              let stopped=false;
              const promise=(async()=>{
                await sleep(page===2?80:5);
                if(stopped){const e=new Error("cancel");e.name="RenderingCancelledException";throw e}
                canvasContext.fillStyle=code===2?"rgb(0,120,255)":"rgb(220,40,40)";
                canvasContext.fillRect(0,0,canvasContext.canvas.width,canvasContext.canvas.height);
              })();
              return {promise,cancel(){stopped=true}};
            }
          };
        },
        async destroy(){}
      });
      const loader=async()=>({base:"",lib:{getDocument({data}){
        const code=new Uint8Array(data)[0];
        let stopped=false;
        const delay=({1:100,2:10,3:10,4:100})[code]||10;
        const promise=(async()=>{await sleep(delay);if(stopped)throw new Error("destroyed");return fakePdf(code)})();
        return {promise,async destroy(){stopped=true}};
      }}});
      const crop=new PdfCropper({canvas:tCanvas,stage:tStage,pageLabel:tPage,prevBtn:tPrev,nextBtn:tNext,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      const names={1:"A.pdf",2:"B.pdf",3:"C.pdf",4:"D.pdf"};
      const file=code=>({name:names[code],arrayBuffer:async()=>new Uint8Array([code]).buffer});
      const a=crop.loadFile(file(1));
      await sleep(5);
      const b=crop.loadFile(file(2));
      const settled=await Promise.allSettled([a,b]);
      const pixel=[...crop.ctx.getImageData(0,0,1,1).data];
      const firstName=crop.file?.name;
      const c=crop.loadFile(file(3));
      await sleep(5);
      const d=crop.loadFile(file(4));
      const settledReverse=await Promise.allSettled([c,d]);
      return {firstName,name:crop.file?.name,ready:crop.isRenderReady(),page:crop.page,pixel,statuses:settled.map(x=>x.status),reverseStatuses:settledReverse.map(x=>x.status)};
    });
    expect(result.firstName).toBe("B.pdf");
    expect(result.name).toBe("D.pdf");
    expect(result.ready).toBe(true);
    expect(result.page).toBe(1);
    expect(result.pixel[2]).toBeGreaterThan(result.pixel[0]);
    expect(result.statuses).toEqual(["fulfilled","fulfilled"]);
    expect(result.reverseStatuses).toEqual(["fulfilled","fulfilled"]);
  });

  test("a delayed next page cannot crop pixels from the previous committed page",async({page})=>{
    await openHarness(page);
    const result=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="dStage" style="position:relative;width:350px;height:300px;overflow:auto"><canvas id="dCanvas"></canvas></div><span id="dPage"></span><button id="dPrev"></button><button id="dNext"></button>');
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const pdf={numPages:2,async getPage(page){return{
        getViewport:({scale})=>({width:500*scale,height:1200*scale}),
        render({canvasContext}){
          let stopped=false;
          const promise=(async()=>{await sleep(page===2?120:1);if(stopped){const e=new Error("cancel");e.name="RenderingCancelledException";throw e}canvasContext.fillStyle=page===2?"rgb(20,180,80)":"rgb(210,40,40)";canvasContext.fillRect(0,0,canvasContext.canvas.width,canvasContext.canvas.height)})();
          return {promise,cancel(){stopped=true}};
        }
      }},async destroy(){}};
      const loader=async()=>({base:"",lib:{getDocument(){return{promise:Promise.resolve(pdf),async destroy(){}}}}});
      const crop=new PdfCropper({canvas:dCanvas,stage:dStage,pageLabel:dPage,prevBtn:dPrev,nextBtn:dNext,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      await crop.loadFile({name:"two-pages.pdf",arrayBuffer:async()=>new Uint8Array([1]).buffer});
      const region={page:2,bbox_norm:[.1,.1,.4,.4]};
      crop.regionsByPage.set(2,structuredClone(region));
      const moving=crop.go(2);
      await sleep(10);
      let earlyError="";
      try{await crop.captureCrop()}catch(error){earlyError=error.message}
      await moving;
      const capture=await crop.captureCrop();
      const bitmap=await createImageBitmap(capture.blob);
      const probe=document.createElement("canvas");probe.width=1;probe.height=1;
      const ctx=probe.getContext("2d");ctx.drawImage(bitmap,0,0,1,1);
      const pixel=[...ctx.getImageData(0,0,1,1).data];bitmap.close();
      return {earlyError,page:crop.page,framePage:capture.frame.page,regionPage:capture.region.page,pixel};
    });
    expect(result.earlyError).toBe("PDF_CROP_NOT_READY");
    expect(result.page).toBe(2);
    expect(result.framePage).toBe(2);
    expect(result.regionPage).toBe(2);
    expect(result.pixel[1]).toBeGreaterThan(result.pixel[0]);
  });

  test("failed replacement keeps the previously committed document identity",async({page})=>{
    await openHarness(page);
    const result=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="fStage" style="position:relative;width:350px;height:300px;overflow:auto"><canvas id="fCanvas"></canvas></div><span id="fPage"></span><button id="fPrev"></button><button id="fNext"></button>');
      const pdf={numPages:1,async getPage(){return{getViewport:({scale})=>({width:500*scale,height:800*scale}),render({canvasContext}){const promise=Promise.resolve().then(()=>{canvasContext.fillStyle="rgb(30,150,220)";canvasContext.fillRect(0,0,canvasContext.canvas.width,canvasContext.canvas.height)});return{promise,cancel(){}}}}},async destroy(){}};
      const loader=async()=>({base:"",lib:{getDocument({data}){const code=new Uint8Array(data)[0];return{promise:code===9?Promise.reject(Object.assign(new Error("bad"),{name:"InvalidPDFException"})):Promise.resolve(pdf),async destroy(){}}}}});
      const crop=new PdfCropper({canvas:fCanvas,stage:fStage,pageLabel:fPage,prevBtn:fPrev,nextBtn:fNext,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      await crop.loadFile({name:"good.pdf",arrayBuffer:async()=>new Uint8Array([1]).buffer});
      let errorName="";
      try{await crop.loadFile({name:"broken.pdf",arrayBuffer:async()=>new Uint8Array([9]).buffer})}catch(error){errorName=error.name}
      return {errorName,name:crop.file?.name,ready:crop.isRenderReady(),hasPdf:fStage.classList.contains("has-pdf")};
    });
    expect(result.errorName).toBe("InvalidPDFException");
    expect(result.name).toBe("good.pdf");
    expect(result.ready).toBe(true);
    expect(result.hasPdf).toBe(true);
  });

  test("refresh and resize preserve document-space view anchor and crop geometry",async({page})=>{
    await page.setViewportSize({width:390,height:844});
    await openHarness(page);
    const result=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="sStage" style="position:relative;width:350px;height:300px;overflow:auto;display:block"><canvas id="sCanvas"></canvas></div><span id="sPage"></span><button id="sPrev"></button><button id="sNext"></button><button id="sMode"></button>');
      const pdf={numPages:1,async getPage(){return{getViewport:({scale})=>({width:500*scale,height:1600*scale}),render({canvasContext}){const promise=Promise.resolve().then(()=>{const w=canvasContext.canvas.width,h=canvasContext.canvas.height;canvasContext.fillStyle="#ddd";canvasContext.fillRect(0,0,w,h);canvasContext.fillStyle="#245";canvasContext.fillRect(0,0,w/2,h/2)});return{promise,cancel(){}}}}},async destroy(){}};
      const loader=async()=>({base:"",lib:{getDocument(){return{promise:Promise.resolve(pdf),async destroy(){}}}}});
      const crop=new PdfCropper({canvas:sCanvas,stage:sStage,pageLabel:sPage,prevBtn:sPrev,nextBtn:sNext,modeBtn:sMode,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      await crop.loadFile({name:"scroll.pdf",arrayBuffer:async()=>new Uint8Array([1]).buffer});
      crop.region={page:1,bbox_norm:[.1,.2,.4,.5]};crop.regionsByPage.set(1,structuredClone(crop.region));crop.paintRegion();
      sStage.scrollTop=620;
      const beforeAnchor=crop.captureViewAnchor();
      const beforeRegion=structuredClone(crop.region);
      const beforeHash=await crop.visualHash();
      sStage.style.width="320px";
      await crop.refresh();
      const afterAnchor=crop.captureViewAnchor();
      const afterHash=await crop.visualHash();
      const beforeModeAnchor=structuredClone(afterAnchor);
      await crop.toggleMobileCrop();
      await crop.toggleMobileCrop();
      const afterModeAnchor=crop.captureViewAnchor();
      const expectedWidth=(beforeRegion.bbox_norm[2]-beforeRegion.bbox_norm[0])*sCanvas.getBoundingClientRect().width;
      const overlayError=Math.abs(parseFloat(crop.box.style.width)-expectedWidth);
      return {beforeAnchor,afterAnchor,beforeModeAnchor,afterModeAnchor,beforeRegion,afterRegion:crop.region,beforeHash,afterHash,scrollTop:sStage.scrollTop,overlayError};
    });
    expect(result.afterRegion).toEqual(result.beforeRegion);
    expect(Math.abs(result.afterAnchor.y-result.beforeAnchor.y)).toBeLessThan(.015);
    expect(result.scrollTop).toBeGreaterThan(100);
    expect(Math.abs(result.afterModeAnchor.y-result.beforeModeAnchor.y)).toBeLessThan(.02);
    expect(result.overlayError).toBeLessThanOrEqual(1);
    expect(result.afterHash).toBe(result.beforeHash);
  });

  test("mobile rotation preserves browse anchor and crop while staying in mobile interaction mode",async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="mobile-chromium","Rotation contract is a mobile interaction test.");
    await page.setViewportSize({width:390,height:844});
    await openHarness(page);
    const before=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="oStage" style="position:relative;width:calc(100vw - 40px);height:280px;overflow:auto;display:block"><canvas id="oCanvas"></canvas></div><span id="oPage"></span><button id="oPrev"></button><button id="oNext"></button><button id="oMode"></button>');
      const pdf={numPages:1,async getPage(){return{getViewport:({scale})=>({width:500*scale,height:1600*scale}),render({canvasContext}){const promise=Promise.resolve().then(()=>{canvasContext.fillStyle="#fff";canvasContext.fillRect(0,0,canvasContext.canvas.width,canvasContext.canvas.height);canvasContext.fillStyle="#345";canvasContext.fillRect(0,0,canvasContext.canvas.width/2,canvasContext.canvas.height/2)});return{promise,cancel(){}}}}},async destroy(){}};
      const loader=async()=>({base:"",lib:{getDocument(){return{promise:Promise.resolve(pdf),async destroy(){}}}}});
      const crop=new PdfCropper({canvas:oCanvas,stage:oStage,pageLabel:oPage,prevBtn:oPrev,nextBtn:oNext,modeBtn:oMode,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      await crop.loadFile({name:"rotate.pdf",arrayBuffer:async()=>new Uint8Array([1]).buffer});
      crop.region={page:1,bbox_norm:[.15,.2,.55,.6]};crop.regionsByPage.set(1,structuredClone(crop.region));crop.paintRegion();
      oStage.scrollTop=560;
      window.__rotationCrop=crop;
      window.__rotationStage=oStage;
      return {anchor:crop.captureViewAnchor(),region:structuredClone(crop.region),mobile:crop.isMobile(),scrollTop:oStage.scrollTop};
    });
    await page.setViewportSize({width:844,height:390});
    const after=await page.evaluate(async()=>{
      await window.__rotationCrop.refresh();
      return {anchor:window.__rotationCrop.captureViewAnchor(),region:structuredClone(window.__rotationCrop.region),mobile:window.__rotationCrop.isMobile(),scrollTop:window.__rotationStage.scrollTop,mode:window.__rotationStage.className};
    });
    expect(before.mobile).toBe(true);
    expect(after.mobile).toBe(true);
    expect(after.region).toEqual(before.region);
    expect(Math.abs(after.anchor.y-before.anchor.y)).toBeLessThan(.025);
    expect(after.scrollTop).toBeGreaterThan(100);
    expect(after.mode).toContain("mobile-browse-mode");
  });

  test("short tap, short drag and pointer cancel do not erase a valid crop",async({page})=>{
    await openHarness(page);
    const result=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="pStage" style="position:relative;width:350px;height:300px;overflow:auto"><canvas id="pCanvas"></canvas></div><span id="pPage"></span><button id="pPrev"></button><button id="pNext"></button>');
      const pdf={numPages:1,async getPage(){return{getViewport:({scale})=>({width:500*scale,height:800*scale}),render({canvasContext}){const promise=Promise.resolve().then(()=>{canvasContext.fillStyle="#fff";canvasContext.fillRect(0,0,canvasContext.canvas.width,canvasContext.canvas.height)});return{promise,cancel(){}}}}},async destroy(){}};
      const loader=async()=>({base:"",lib:{getDocument(){return{promise:Promise.resolve(pdf),async destroy(){}}}}});
      const crop=new PdfCropper({canvas:pCanvas,stage:pStage,pageLabel:pPage,prevBtn:pPrev,nextBtn:pNext,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      await crop.loadFile({name:"tap.pdf",arrayBuffer:async()=>new Uint8Array([1]).buffer});
      const original={page:1,bbox_norm:[.2,.2,.7,.7]};crop.region=structuredClone(original);crop.regionsByPage.set(1,structuredClone(original));crop.paintRegion();
      const rect=pCanvas.getBoundingClientRect();
      crop.drag={start:{x:20,y:20,w:rect.width,h:rect.height,left:0,top:0},current:{x:20,y:20,w:rect.width,h:rect.height,left:0,top:0}};
      crop.up({preventDefault(){},clientX:rect.left+24,clientY:rect.top+24});
      const afterShort=structuredClone(crop.region);
      crop.drag={start:{x:40,y:40,w:300,h:400,left:0,top:0},current:{x:42,y:42,w:300,h:400,left:0,top:0}};
      crop.cancel();
      return {original,afterShort,afterCancel:crop.region};
    });
    expect(result.afterShort).toEqual(result.original);
    expect(result.afterCancel).toEqual(result.original);
  });

  test("PDF drawing surface is explicitly LTR while the app remains RTL",async({page})=>{
    await openHarness(page);
    const result=await page.evaluate(async()=>{
      const {PdfCropper}=await import("/studio/pdf-crop.js");
      document.body.insertAdjacentHTML("beforeend",'<div id="rStage" style="position:relative;width:350px;height:300px;overflow:auto"><canvas id="rCanvas"></canvas></div><span id="rPage"></span><button id="rPrev"></button><button id="rNext"></button>');
      const pdf={numPages:1,async getPage(){return{getViewport:({scale})=>({width:500*scale,height:800*scale}),render({canvasContext}){const promise=Promise.resolve().then(()=>{canvasContext.fillStyle="#fff";canvasContext.fillRect(0,0,canvasContext.canvas.width,canvasContext.canvas.height)});return{promise,cancel(){}}}}},async destroy(){}};
      const loader=async()=>({base:"",lib:{getDocument(){return{promise:Promise.resolve(pdf),async destroy(){}}}}});
      const crop=new PdfCropper({canvas:rCanvas,stage:rStage,pageLabel:rPage,prevBtn:rPrev,nextBtn:rNext,pdfLoader:loader});
      crop.resizeObserver.disconnect();
      await crop.loadFile({name:"direction.pdf",arrayBuffer:async()=>new Uint8Array([1]).buffer});
      return {html:getComputedStyle(document.documentElement).direction,stage:getComputedStyle(rStage).direction,canvas:getComputedStyle(rCanvas).direction,context:crop.ctx.direction};
    });
    expect(result.html).toBe("rtl");
    expect(result.stage).toBe("ltr");
    expect(result.canvas).toBe("ltr");
    expect(result.context).toBe("ltr");
  });
});
