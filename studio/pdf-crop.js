const PDFJS_SOURCES=[
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38",
  "https://unpkg.com/pdfjs-dist@4.10.38"
];
let pdfjsLoader=null;

async function loadPdfJs(){
  if(pdfjsLoader)return pdfjsLoader;
  pdfjsLoader=(async()=>{
    let lastError=null;
    for(const base of PDFJS_SOURCES){
      try{
        const lib=await import(base+"/build/pdf.min.mjs");
        lib.GlobalWorkerOptions.workerSrc=base+"/build/pdf.worker.min.mjs";
        return {lib,base};
      }catch(error){
        lastError=error;
      }
    }
    pdfjsLoader=null;
    throw lastError||new Error("PDF.js load failed");
  })();
  return pdfjsLoader;
}

const LOCKED_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1.2A1.8 1.8 0 0 1 20 11.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 20.2v-8.4A1.8 1.8 0 0 1 5.8 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Zm3 4a2 2 0 0 0-1 3.73V20h2v-2.27A2 2 0 0 0 12 14Z"/></svg>';
const UNLOCKED_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 8h-2V7a3 3 0 0 0-5.83-1H7.1A5 5 0 0 1 17 7v1Zm1.2 2A1.8 1.8 0 0 1 20 11.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 20.2v-8.4A1.8 1.8 0 0 1 5.8 10h12.4ZM12 14a2 2 0 0 0-1 3.73V20h2v-2.27A2 2 0 0 0 12 14Z"/></svg>';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const cancelled=error=>error?.name==="RenderingCancelledException";

export class PdfCropper{
  constructor({
    canvas,stage,pageLabel,prevBtn,nextBtn,modeBtn=null,
    onChange=()=>{},onPageChange=()=>{},onError=()=>{},pdfLoader=loadPdfJs
  }){
    this.canvas=canvas;
    this.stage=stage;
    this.pageLabel=pageLabel;
    this.prevBtn=prevBtn;
    this.nextBtn=nextBtn;
    this.modeBtn=modeBtn;
    this.onChange=onChange;
    this.onPageChange=onPageChange;
    this.onError=onError;
    this.pdfLoader=pdfLoader;
    this.ctx=canvas.getContext("2d",{alpha:false});
    this.pdf=null;
    this.file=null;
    this.page=1;
    this.region=null;
    this.regionsByPage=new Map();
    this.viewByPage=new Map();
    this.mobileBrowseViewByPage=new Map();
    this.drag=null;
    this.renderTask=null;
    this.loadingTask=null;
    this.renderSeq=0;
    this.loadGeneration=0;
    this.documentGeneration=0;
    this.readyFrame=null;
    this.loading=false;
    this.rendering=false;
    this.mobileCropMode=false;
    this.box=document.createElement("div");
    this.box.className="crop-box hidden";
    stage.appendChild(this.box);

    stage.dir="ltr";
    canvas.dir="ltr";
    canvas.style.direction="ltr";

    prevBtn.addEventListener("click",()=>this.go(this.page-1));
    nextBtn.addEventListener("click",()=>this.go(this.page+1));
    canvas.addEventListener("pointerdown",e=>this.down(e));
    canvas.addEventListener("pointermove",e=>this.move(e));
    canvas.addEventListener("pointerup",e=>this.up(e));
    canvas.addEventListener("pointercancel",()=>this.cancel());
    modeBtn?.addEventListener("click",()=>this.toggleMobileCrop());

    this.resizeObserver=new ResizeObserver(()=>{
      clearTimeout(this.resizeTimer);
      this.resizeTimer=setTimeout(()=>{
        if(this.pdf&&!this.loading&&this.stage.offsetParent!==null)this.render().catch(error=>this.reportError(error));
      },120);
    });
    this.resizeObserver.observe(stage);
    this.syncInteractionMode();
  }

  reportError(error){
    if(cancelled(error))return;
    this.onError(error);
  }

  isMobile(){return window.matchMedia("(pointer:coarse)").matches||window.innerWidth<=700}
  canCrop(){return !this.isMobile()||this.mobileCropMode}

  isRenderReady(){
    return Boolean(
      this.pdf&&this.file&&!this.loading&&!this.rendering&&this.readyFrame&&
      this.readyFrame.documentGeneration===this.documentGeneration&&
      this.readyFrame.page===this.page
    );
  }

  isRegionReady(region=this.region){
    return this.isRenderReady()&&validRegion(region)&&Number(region.page)===this.page;
  }

  syncInteractionMode(){
    const mobile=this.isMobile();
    this.stage.classList.toggle("mobile-browse-mode",mobile&&!this.mobileCropMode);
    this.stage.classList.toggle("mobile-crop-mode",mobile&&this.mobileCropMode);
    this.stage.classList.toggle("desktop-crop-mode",!mobile);
    this.stage.classList.toggle("is-loading",this.loading||this.rendering);
    this.stage.classList.toggle("has-pdf",Boolean(this.file));
    if(this.modeBtn){
      this.modeBtn.disabled=!this.pdf||this.loading||this.rendering;
      this.modeBtn.innerHTML=this.mobileCropMode?LOCKED_ICON:UNLOCKED_ICON;
      this.modeBtn.setAttribute("aria-pressed",this.mobileCropMode?"true":"false");
      this.modeBtn.setAttribute("aria-label",this.mobileCropMode?"خاموش کردن حالت برش و فعال‌کردن حرکت سند":"فعال‌کردن حالت برش");
      this.modeBtn.title=this.mobileCropMode?"حالت برش فعال است":"فعال‌کردن انتخاب برش";
    }
    const help=document.getElementById(this.stage.id==="qStage"?"qCropHelp":"aCropHelp");
    if(help)help.textContent=this.mobileCropMode?"حالت برش فعال است؛ محدوده را روی صفحه بکش. برای حرکت سند، این حالت را خاموش کن.":"برای جابه‌جایی صفحه، سند را بکش؛ برای برش، حالت انتخاب برش را فعال کن.";
  }

  captureViewAnchor(){
    if(!this.canvas.width||!this.canvas.style.width)return null;
    const rect=this.canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    const centerX=this.stage.scrollLeft+this.stage.clientWidth/2;
    const centerY=this.stage.scrollTop+this.stage.clientHeight/2;
    const left=this.canvas.offsetLeft;
    const top=this.canvas.offsetTop;
    return {
      x:clamp((centerX-left)/rect.width,0,1),
      y:clamp((centerY-top)/rect.height,0,1)
    };
  }

  rememberView(){
    if(!this.pdf||!this.readyFrame||this.readyFrame.page!==this.page)return;
    const anchor=this.captureViewAnchor();
    if(anchor)this.viewByPage.set(this.page,anchor);
  }

  restoreView(anchor,{startAtTop=false}={}){
    const rect=this.canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const canvasLeft=this.canvas.offsetLeft;
    const canvasTop=this.canvas.offsetTop;
    const x=anchor?.x??.5;
    const y=startAtTop?0:(anchor?.y??0);
    const left=clamp(canvasLeft+x*rect.width-this.stage.clientWidth/2,0,Math.max(0,this.stage.scrollWidth-this.stage.clientWidth));
    const top=startAtTop?0:clamp(canvasTop+y*rect.height-this.stage.clientHeight/2,0,Math.max(0,this.stage.scrollHeight-this.stage.clientHeight));
    this.stage.scrollTo({left,top,behavior:"auto"});
  }

  async toggleMobileCrop(){
    if(!this.pdf||!this.isMobile()||this.loading)return;
    const enteringCrop=!this.mobileCropMode;
    let anchor=null;
    if(enteringCrop){
      anchor=this.captureViewAnchor();
      if(anchor)this.mobileBrowseViewByPage.set(this.page,anchor);
    }else{
      anchor=this.mobileBrowseViewByPage.get(this.page)||this.viewByPage.get(this.page)||null;
    }
    this.mobileCropMode=enteringCrop;
    this.drag=null;
    this.syncInteractionMode();
    await this.render({anchor});
  }

  async clearDocument(){
    ++this.loadGeneration;
    ++this.renderSeq;
    try{await this.loadingTask?.destroy?.()}catch{}
    try{this.renderTask?.cancel?.()}catch{}
    try{await this.pdf?.destroy?.()}catch{}
    this.loadingTask=null;
    this.renderTask=null;
    this.pdf=null;
    this.file=null;
    this.page=1;
    this.region=null;
    this.regionsByPage.clear();
    this.viewByPage.clear();
    this.mobileBrowseViewByPage.clear();
    this.drag=null;
    this.readyFrame=null;
    this.loading=false;
    this.rendering=false;
    this.mobileCropMode=false;
    this.box.classList.add("hidden");
    this.canvas.width=0;
    this.canvas.height=0;
    this.canvas.style.width="";
    this.canvas.style.height="";
    this.pageLabel.textContent="-";
    this.onPageChange(0,0);
    this.prevBtn.disabled=true;
    this.nextBtn.disabled=true;
    this.syncInteractionMode();
    this.onChange();
    return {status:"cleared"};
  }

  async loadFile(file){
    if(!file)return this.clearDocument();
    const request=++this.loadGeneration;
    ++this.renderSeq;
    try{this.renderTask?.cancel?.()}catch{}
    try{await this.loadingTask?.destroy?.()}catch{}
    this.loading=true;
    this.rendering=false;
    this.drag=null;
    this.syncInteractionMode();
    this.onChange();

    let candidate=null;
    try{
      const bytes=await file.arrayBuffer();
      if(request!==this.loadGeneration)return {status:"stale"};
      const {lib,base}=await this.pdfLoader();
      if(request!==this.loadGeneration)return {status:"stale"};
      const task=lib.getDocument({
        data:bytes,
        cMapUrl:base?base+"/cmaps/":undefined,
        cMapPacked:true,
        standardFontDataUrl:base?base+"/standard_fonts/":undefined,
        wasmUrl:base?base+"/wasm/":undefined,
        useSystemFonts:true,
        disableFontFace:false,
        useWorkerFetch:true
      });
      this.loadingTask=task;
      candidate=await task.promise;
      if(request!==this.loadGeneration){
        try{await candidate?.destroy?.()}catch{}
        return {status:"stale"};
      }
      const seq=++this.renderSeq;
      const prepared=await this.preparePage(candidate,1,seq,()=>request===this.loadGeneration&&seq===this.renderSeq);
      if(!prepared||request!==this.loadGeneration){
        try{await candidate?.destroy?.()}catch{}
        return {status:"stale"};
      }

      const previous=this.pdf;
      this.pdf=candidate;
      this.file=file;
      this.documentGeneration++;
      this.page=1;
      this.region=null;
      this.regionsByPage.clear();
      this.viewByPage.clear();
      this.drag=null;
      this.mobileCropMode=false;
      this.loading=false;
      this.rendering=false;
      this.readyFrame=null;
      this.commitPrepared(prepared,{seq,startAtTop:true});
      try{if(previous&&previous!==candidate)await previous.destroy?.()}catch{}
      this.loadingTask=null;
      this.syncInteractionMode();
      this.onChange();
      return {status:"ready",file:this.file};
    }catch(error){
      if(request!==this.loadGeneration){
        try{await candidate?.destroy?.()}catch{}
        return {status:"stale"};
      }
      this.loading=false;
      this.loadingTask=null;
      this.syncInteractionMode();
      this.onChange();
      throw error;
    }
  }

  async go(n){
    if(!this.pdf||this.loading)return false;
    n=Math.max(1,Math.min(this.pdf.numPages,n));
    if(n===this.page)return this.isRenderReady();
    this.rememberView();
    if(this.region)this.regionsByPage.set(this.page,structuredClone(this.region));
    this.page=n;
    this.region=structuredClone(this.regionsByPage.get(n)||null);
    this.drag=null;
    this.readyFrame=null;
    this.box.classList.add("hidden");
    this.onChange();
    const anchor=this.viewByPage.get(n)||null;
    return this.render({anchor,startAtTop:!anchor});
  }

  cssScale(base){
    const width=Math.max(280,this.stage.clientWidth-4);
    if(this.isMobile()){
      if(this.mobileCropMode){
        const height=Math.max(360,this.stage.clientHeight-4||Math.round(innerHeight*.68));
        return Math.max(.1,Math.min(width/base.width,height/base.height));
      }
      const fit=width/base.width;
      return Math.max(fit*1.38,.92);
    }
    return Math.max(.1,Math.min(2,width/base.width));
  }

  renderPixelRatio(cssViewport){
    const desired=Math.min(Math.max(window.devicePixelRatio||1,1.5),3);
    const maxPixels=18000000;
    const pixels=cssViewport.width*cssViewport.height*desired*desired;
    if(pixels<=maxPixels)return desired;
    return Math.max(1,desired*Math.sqrt(maxPixels/pixels));
  }

  async preparePage(pdf,pageNumber,seq,isCurrent){
    const page=await pdf.getPage(pageNumber);
    if(!isCurrent())return null;
    const base=page.getViewport({scale:1});
    const cssScale=this.cssScale(base);
    const cssViewport=page.getViewport({scale:cssScale});
    const dpr=this.renderPixelRatio(cssViewport);
    const renderViewport=page.getViewport({scale:cssScale*dpr});
    const temp=document.createElement("canvas");
    temp.width=Math.max(1,Math.round(renderViewport.width));
    temp.height=Math.max(1,Math.round(renderViewport.height));
    const context=temp.getContext("2d",{alpha:false});
    context.direction="ltr";

    if(this.renderTask){
      const previous=this.renderTask;
      this.renderTask=null;
      try{previous.cancel();await previous.promise}catch{}
    }
    const task=page.render({canvasContext:context,viewport:renderViewport});
    this.renderTask=task;
    try{
      await task.promise;
    }catch(error){
      if(cancelled(error))return null;
      throw error;
    }finally{
      if(this.renderTask===task)this.renderTask=null;
    }
    if(!isCurrent())return null;
    return {canvas:temp,cssViewport,pageNumber,seq};
  }

  commitPrepared(prepared,{seq,anchor=null,startAtTop=false}={}){
    this.canvas.width=prepared.canvas.width;
    this.canvas.height=prepared.canvas.height;
    this.canvas.style.width=Math.round(prepared.cssViewport.width)+"px";
    this.canvas.style.height=Math.round(prepared.cssViewport.height)+"px";
    this.ctx=this.canvas.getContext("2d",{alpha:false});
    this.ctx.direction="ltr";
    this.ctx.drawImage(prepared.canvas,0,0);
    this.readyFrame={documentGeneration:this.documentGeneration,page:prepared.pageNumber,renderSeq:seq};
    this.pageLabel.textContent=`${this.page}/${this.pdf.numPages}`;
    this.onPageChange(this.page,this.pdf.numPages);
    this.prevBtn.disabled=this.page<=1;
    this.nextBtn.disabled=this.page>=this.pdf.numPages;
    this.paintRegion();
    this.restoreView(anchor,{startAtTop});
  }

  async render({anchor=null,startAtTop=false}={}){
    if(!this.pdf||this.loading)return false;
    if(anchor===null&&this.readyFrame?.page===this.page)anchor=this.captureViewAnchor();
    if(anchor)this.viewByPage.set(this.page,anchor);
    const seq=++this.renderSeq;
    const documentGeneration=this.documentGeneration;
    const pageNumber=this.page;
    this.rendering=true;
    this.readyFrame=null;
    this.syncInteractionMode();
    this.onChange();
    try{
      const prepared=await this.preparePage(
        this.pdf,pageNumber,seq,
        ()=>seq===this.renderSeq&&documentGeneration===this.documentGeneration&&pageNumber===this.page&&!this.loading
      );
      if(!prepared)return false;
      this.commitPrepared(prepared,{seq,anchor,startAtTop});
      return true;
    }catch(error){
      this.reportError(error);
      throw error;
    }finally{
      if(seq===this.renderSeq){
        this.rendering=false;
        this.syncInteractionMode();
        this.onChange();
      }
    }
  }

  async refresh(){
    if(!this.pdf||this.loading)return false;
    this.syncInteractionMode();
    return this.render();
  }

  point(e){
    const r=this.canvas.getBoundingClientRect();
    const sr=this.stage.getBoundingClientRect();
    return {
      x:Math.max(0,Math.min(r.width,e.clientX-r.left)),
      y:Math.max(0,Math.min(r.height,e.clientY-r.top)),
      w:r.width,
      h:r.height,
      left:r.left-sr.left+this.stage.scrollLeft,
      top:r.top-sr.top+this.stage.scrollTop
    };
  }

  down(e){
    if(!this.isRenderReady()||!this.canCrop()||e.button!==0)return;
    e.preventDefault();
    const p=this.point(e);
    this.drag={start:p,current:p};
    this.canvas.setPointerCapture?.(e.pointerId);
    this.paintBox();
  }

  move(e){
    if(!this.drag)return;
    e.preventDefault();
    this.drag.current=this.point(e);
    this.paintBox();
  }

  up(e){
    if(!this.drag)return;
    e.preventDefault();
    this.drag.current=this.point(e);
    const {start,current}=this.drag;
    const x1=Math.min(start.x,current.x),x2=Math.max(start.x,current.x);
    const y1=Math.min(start.y,current.y),y2=Math.max(start.y,current.y);
    this.drag=null;
    if(x2-x1<12||y2-y1<12){
      this.paintRegion();
      return;
    }
    const next={
      page:this.page,
      bbox_norm:[x1/start.w,y1/start.h,x2/start.w,y2/start.h].map(v=>Math.max(0,Math.min(1,Number(v.toFixed(6)))))
    };
    if(!validRegion(next)){
      this.paintRegion();
      return;
    }
    this.region=next;
    this.regionsByPage.set(this.page,structuredClone(this.region));
    this.paintRegion();
    this.onChange(this.region);
  }

  cancel(){
    this.drag=null;
    this.paintRegion();
  }

  paintBox(){
    if(!this.drag)return;
    const {start,current}=this.drag;
    const x=Math.min(start.x,current.x)+start.left;
    const y=Math.min(start.y,current.y)+start.top;
    const w=Math.abs(current.x-start.x);
    const h=Math.abs(current.y-start.y);
    Object.assign(this.box.style,{left:x+"px",top:y+"px",width:w+"px",height:h+"px"});
    this.box.classList.remove("hidden");
  }

  paintRegion(){
    if(!this.region||!this.pdf){
      this.box.classList.add("hidden");
      return;
    }
    const r=this.canvas.getBoundingClientRect();
    const sr=this.stage.getBoundingClientRect();
    const [x1,y1,x2,y2]=this.region.bbox_norm;
    Object.assign(this.box.style,{
      left:(r.left-sr.left+this.stage.scrollLeft+x1*r.width)+"px",
      top:(r.top-sr.top+this.stage.scrollTop+y1*r.height)+"px",
      width:((x2-x1)*r.width)+"px",
      height:((y2-y1)*r.height)+"px"
    });
    this.box.classList.remove("hidden");
  }

  clearRegion(){
    this.region=null;
    this.regionsByPage.delete(this.page);
    this.box.classList.add("hidden");
    this.onChange(null);
  }

  async setRegion(region){
    if(region?.page&&Number(region.page)!==this.page){
      const target=Number(region.page);
      this.regionsByPage.set(target,structuredClone(region));
      await this.go(target);
    }
    this.region=region?structuredClone(region):null;
    if(region)this.regionsByPage.set(Number(region.page)||this.page,structuredClone(region));
    this.paintRegion();
    this.onChange(this.region);
  }

  async captureCrop(region=this.region){
    if(!this.isRegionReady(region))throw new Error("PDF_CROP_NOT_READY");
    const frame={...this.readyFrame};
    const snapshot=structuredClone(region);
    const [x1,y1,x2,y2]=snapshot.bbox_norm;
    const sx=Math.round(x1*this.canvas.width),sy=Math.round(y1*this.canvas.height);
    const sw=Math.max(1,Math.round((x2-x1)*this.canvas.width)),sh=Math.max(1,Math.round((y2-y1)*this.canvas.height));
    const out=document.createElement("canvas");
    out.width=sw;
    out.height=sh;
    out.getContext("2d").drawImage(this.canvas,sx,sy,sw,sh,0,0,sw,sh);
    const blob=await new Promise((resolve,reject)=>out.toBlob(value=>value?resolve(value):reject(new Error("PDF_CROP_ENCODE_FAILED")),"image/webp",.9));
    return {blob,region:snapshot,frame};
  }

  async cropBlob(){
    return (await this.captureCrop()).blob;
  }

  async visualHash(sourceBlob=null){
    const blob=sourceBlob||(await this.captureCrop()).blob;
    const bmp=await createImageBitmap(blob);
    try{
      const c=document.createElement("canvas");
      c.width=9;c.height=8;
      const x=c.getContext("2d",{willReadFrequently:true});
      x.drawImage(bmp,0,0,9,8);
      const data=x.getImageData(0,0,9,8).data;
      let bits=0n,i=0n;
      for(let y=0;y<8;y++)for(let xx=0;xx<8;xx++){
        const a=(data[(y*9+xx)*4]+data[(y*9+xx)*4+1]+data[(y*9+xx)*4+2])/3;
        const b=(data[(y*9+xx+1)*4]+data[(y*9+xx+1)*4+1]+data[(y*9+xx+1)*4+2])/3;
        if(a>b)bits|=1n<<i;
        i++;
      }
      return bits.toString(16).padStart(16,"0");
    }finally{
      bmp.close?.();
    }
  }
}

export function validRegion(region){
  if(!region||!Number.isInteger(Number(region.page))||Number(region.page)<1)return false;
  if(!Array.isArray(region.bbox_norm)||region.bbox_norm.length!==4)return false;
  const [x1,y1,x2,y2]=region.bbox_norm.map(Number);
  return [x1,y1,x2,y2].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&x2>x1&&y2>y1;
}
