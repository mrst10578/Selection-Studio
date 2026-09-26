import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const LOCKED_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1.2A1.8 1.8 0 0 1 20 11.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 20.2v-8.4A1.8 1.8 0 0 1 5.8 10H7Zm2 0h6V7a3 3 0 0 0-6 0v3Zm3 4a2 2 0 0 0-1 3.73V20h2v-2.27A2 2 0 0 0 12 14Z"/></svg>';
const UNLOCKED_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 8h-2V7a3 3 0 0 0-5.83-1H7.1A5 5 0 0 1 17 7v1Zm1.2 2A1.8 1.8 0 0 1 20 11.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 20.2v-8.4A1.8 1.8 0 0 1 5.8 10h12.4ZM12 14a2 2 0 0 0-1 3.73V20h2v-2.27A2 2 0 0 0 12 14Z"/></svg>';

export class PdfCropper{
  constructor({canvas,stage,pageLabel,prevBtn,nextBtn,modeBtn=null,onChange=()=>{}}){
    this.canvas=canvas;
    this.stage=stage;
    this.pageLabel=pageLabel;
    this.prevBtn=prevBtn;
    this.nextBtn=nextBtn;
    this.modeBtn=modeBtn;
    this.onChange=onChange;
    this.ctx=canvas.getContext("2d",{alpha:false});
    this.pdf=null;
    this.file=null;
    this.page=1;
    this.region=null;
    this.drag=null;
    this.renderTask=null;
    this.renderSeq=0;
    this.mobileCropMode=false;
    this.box=document.createElement("div");
    this.box.className="crop-box hidden";
    stage.appendChild(this.box);

    prevBtn.addEventListener("click",()=>this.go(this.page-1));
    nextBtn.addEventListener("click",()=>this.go(this.page+1));
    canvas.addEventListener("pointerdown",e=>this.down(e));
    canvas.addEventListener("pointermove",e=>this.move(e));
    canvas.addEventListener("pointerup",e=>this.up(e));
    canvas.addEventListener("pointercancel",()=>this.cancel());
    modeBtn?.addEventListener("click",()=>this.toggleMobileCrop());

    this.resizeObserver=new ResizeObserver(()=>{
      clearTimeout(this.resizeTimer);
      this.resizeTimer=setTimeout(()=>{if(this.pdf&&this.stage.offsetParent!==null)this.render()},120);
    });
    this.resizeObserver.observe(stage);
    this.syncInteractionMode();
  }

  isMobile(){
    return window.innerWidth<=700;
  }

  canCrop(){
    return !this.isMobile()||this.mobileCropMode;
  }

  syncInteractionMode(){
    const mobile=this.isMobile();
    this.stage.classList.toggle("mobile-browse-mode",mobile&&!this.mobileCropMode);
    this.stage.classList.toggle("mobile-crop-mode",mobile&&this.mobileCropMode);
    this.stage.classList.toggle("desktop-crop-mode",!mobile);
    if(this.modeBtn){
      this.modeBtn.disabled=!this.pdf;
      this.modeBtn.innerHTML=this.mobileCropMode?LOCKED_ICON:UNLOCKED_ICON;
      this.modeBtn.setAttribute("aria-pressed",this.mobileCropMode?"true":"false");
      this.modeBtn.setAttribute("aria-label",this.mobileCropMode?"خروج از حالت کراپ و فعال کردن حرکت PDF":"قفل کردن PDF و فعال کردن کراپ");
      this.modeBtn.title=this.mobileCropMode?"حالت کراپ فعال است":"حالت حرکت PDF فعال است";
    }
  }

  async toggleMobileCrop(){
    if(!this.pdf||!this.isMobile())return;
    this.mobileCropMode=!this.mobileCropMode;
    this.drag=null;
    this.syncInteractionMode();
    this.stage.scrollTo({left:0,top:0,behavior:"auto"});
    await this.render();
  }

  async loadFile(file){
    this.file=file||null;
    this.region=null;
    this.drag=null;
    this.box.classList.add("hidden");
    this.mobileCropMode=false;
    this.stage.classList.toggle("has-pdf",Boolean(file));
    if(!file){
      this.pdf=null;
      this.canvas.width=0;
      this.canvas.height=0;
      this.canvas.style.width="";
      this.canvas.style.height="";
      this.pageLabel.textContent="-";
      this.syncInteractionMode();
      this.onChange();
      return;
    }
    const bytes=await file.arrayBuffer();
    this.pdf=await pdfjsLib.getDocument({
      data:bytes,
      cMapUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
      cMapPacked:true,
      standardFontDataUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/",
      wasmUrl:"https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/wasm/",
      useSystemFonts:true,
      disableFontFace:false,
      useWorkerFetch:true
    }).promise;
    this.page=1;
    this.syncInteractionMode();
    await this.render();
    this.onChange();
  }

  async go(n){
    if(!this.pdf)return;
    n=Math.max(1,Math.min(this.pdf.numPages,n));
    if(n===this.page)return;
    this.page=n;
    this.region=null;
    this.drag=null;
    this.box.classList.add("hidden");
    this.stage.scrollTo({left:0,top:0,behavior:"auto"});
    await this.render();
    this.onChange();
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

  async render(){
    if(!this.pdf)return;
    const seq=++this.renderSeq;
    if(this.renderTask){
      const previous=this.renderTask;
      this.renderTask=null;
      try{previous.cancel();await previous.promise}catch{}
    }
    const page=await this.pdf.getPage(this.page);
    if(seq!==this.renderSeq)return;
    const base=page.getViewport({scale:1});
    const cssScale=this.cssScale(base);
    const cssViewport=page.getViewport({scale:cssScale});
    const dpr=this.renderPixelRatio(cssViewport);
    const renderViewport=page.getViewport({scale:cssScale*dpr});

    this.canvas.width=Math.max(1,Math.round(renderViewport.width));
    this.canvas.height=Math.max(1,Math.round(renderViewport.height));
    this.canvas.style.width=Math.round(cssViewport.width)+"px";
    this.canvas.style.height=Math.round(cssViewport.height)+"px";

    this.renderTask=page.render({canvasContext:this.ctx,viewport:renderViewport});
    try{
      await this.renderTask.promise;
    }catch(error){
      if(error?.name!=="RenderingCancelledException")throw error;
      return;
    }finally{
      if(seq===this.renderSeq)this.renderTask=null;
    }
    if(seq!==this.renderSeq)return;

    this.pageLabel.textContent=`${this.page}/${this.pdf.numPages}`;
    this.prevBtn.disabled=this.page<=1;
    this.nextBtn.disabled=this.page>=this.pdf.numPages;
    this.paintRegion();

    if(this.isMobile()&&!this.mobileCropMode){
      requestAnimationFrame(()=>{
        this.stage.scrollTop=0;
        this.stage.scrollLeft=Math.max(0,(this.canvas.getBoundingClientRect().width-this.stage.clientWidth)/2);
      });
    }
  }

  async refresh(){
    if(!this.pdf)return;
    this.syncInteractionMode();
    await this.render();
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
    if(!this.pdf||!this.canCrop()||e.button!==0)return;
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
      this.clearRegion();
      return;
    }
    this.region={
      page:this.page,
      bbox_norm:[x1/start.w,y1/start.h,x2/start.w,y2/start.h].map(v=>Math.max(0,Math.min(1,Number(v.toFixed(6)))))
    };
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
    this.box.classList.add("hidden");
    this.onChange(null);
  }

  async setRegion(region){
    this.region=region||null;
    if(region?.page&&Number(region.page)!==this.page){
      this.page=Number(region.page);
      await this.render();
    }
    this.paintRegion();
    this.onChange(this.region);
  }

  async cropBlob(){
    if(!this.region)return null;
    const [x1,y1,x2,y2]=this.region.bbox_norm;
    const sx=Math.round(x1*this.canvas.width),sy=Math.round(y1*this.canvas.height);
    const sw=Math.max(1,Math.round((x2-x1)*this.canvas.width)),sh=Math.max(1,Math.round((y2-y1)*this.canvas.height));
    const out=document.createElement("canvas");
    out.width=sw;
    out.height=sh;
    out.getContext("2d").drawImage(this.canvas,sx,sy,sw,sh,0,0,sw,sh);
    return new Promise(resolve=>out.toBlob(resolve,"image/webp",.9));
  }

  async visualHash(){
    if(!this.region)return null;
    const blob=await this.cropBlob();
    if(!blob)return null;
    const bmp=await createImageBitmap(blob);
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
  }
}

export function validRegion(region){
  if(!region||!Number.isInteger(Number(region.page))||Number(region.page)<1)return false;
  if(!Array.isArray(region.bbox_norm)||region.bbox_norm.length!==4)return false;
  const [x1,y1,x2,y2]=region.bbox_norm.map(Number);
  return [x1,y1,x2,y2].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&x2>x1&&y2>y1;
}
