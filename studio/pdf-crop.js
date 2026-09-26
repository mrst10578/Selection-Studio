import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

export class PdfCropper{
  constructor({canvas,stage,pageLabel,prevBtn,nextBtn,onChange=()=>{}}){
    this.canvas=canvas; this.stage=stage; this.pageLabel=pageLabel; this.prevBtn=prevBtn; this.nextBtn=nextBtn; this.onChange=onChange;
    this.ctx=canvas.getContext("2d"); this.pdf=null; this.page=1; this.region=null; this.drag=null;
    this.box=document.createElement("div"); this.box.className="crop-box hidden"; stage.appendChild(this.box);
    prevBtn.addEventListener("click",()=>this.go(this.page-1)); nextBtn.addEventListener("click",()=>this.go(this.page+1));
    stage.addEventListener("pointerdown",e=>this.down(e)); stage.addEventListener("pointermove",e=>this.move(e));
    stage.addEventListener("pointerup",e=>this.up(e)); stage.addEventListener("pointercancel",()=>this.cancel());
  }
  async loadFile(file){
    this.file=file||null; this.region=null; this.box.classList.add("hidden");
    if(!file){this.pdf=null;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);this.pageLabel.textContent="-";this.onChange();return}
    const bytes=await file.arrayBuffer();
    this.pdf=await pdfjsLib.getDocument({data:bytes}).promise; this.page=1; await this.render(); this.onChange();
  }
  async go(n){
    if(!this.pdf)return; n=Math.max(1,Math.min(this.pdf.numPages,n)); if(n===this.page)return;
    this.page=n; this.region=null; this.box.classList.add("hidden"); await this.render(); this.onChange();
  }
  async render(){
    if(!this.pdf)return;
    const p=await this.pdf.getPage(this.page); const base=p.getViewport({scale:1});
    const maxWidth=Math.max(280,this.stage.clientWidth-4); const scale=Math.min(2,maxWidth/base.width);
    const vp=p.getViewport({scale}); this.canvas.width=Math.round(vp.width); this.canvas.height=Math.round(vp.height);
    await p.render({canvasContext:this.ctx,viewport:vp}).promise;
    this.pageLabel.textContent=`${this.page}/${this.pdf.numPages}`;
    this.prevBtn.disabled=this.page<=1; this.nextBtn.disabled=this.page>=this.pdf.numPages;
  }
  point(e){
    const r=this.canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(r.width,e.clientX-r.left)),y:Math.max(0,Math.min(r.height,e.clientY-r.top)),w:r.width,h:r.height,left:r.left-this.stage.getBoundingClientRect().left,top:r.top-this.stage.getBoundingClientRect().top};
  }
  down(e){
    if(!this.pdf||e.button!==0)return;
    const p=this.point(e); this.drag={start:p,current:p}; this.stage.setPointerCapture?.(e.pointerId); this.paintBox();
  }
  move(e){if(!this.drag)return;this.drag.current=this.point(e);this.paintBox()}
  up(e){
    if(!this.drag)return; this.drag.current=this.point(e); const {start,current}=this.drag;
    const x1=Math.min(start.x,current.x),x2=Math.max(start.x,current.x),y1=Math.min(start.y,current.y),y2=Math.max(start.y,current.y);
    this.drag=null;
    if(x2-x1<12||y2-y1<12){this.clearRegion();return}
    this.region={page:this.page,bbox_norm:[x1/start.w,y1/start.h,x2/start.w,y2/start.h].map(v=>Math.max(0,Math.min(1,Number(v.toFixed(6)))))};
    this.paintRegion(); this.onChange(this.region);
  }
  cancel(){this.drag=null;this.paintRegion()}
  paintBox(){
    if(!this.drag)return; const {start,current}=this.drag;
    const x=Math.min(start.x,current.x)+start.left,y=Math.min(start.y,current.y)+start.top,w=Math.abs(current.x-start.x),h=Math.abs(current.y-start.y);
    Object.assign(this.box.style,{left:x+"px",top:y+"px",width:w+"px",height:h+"px"});this.box.classList.remove("hidden");
  }
  paintRegion(){
    if(!this.region){this.box.classList.add("hidden");return}
    const r=this.canvas.getBoundingClientRect(),sr=this.stage.getBoundingClientRect(),[x1,y1,x2,y2]=this.region.bbox_norm;
    Object.assign(this.box.style,{left:(r.left-sr.left+x1*r.width)+"px",top:(r.top-sr.top+y1*r.height)+"px",width:((x2-x1)*r.width)+"px",height:((y2-y1)*r.height)+"px"});this.box.classList.remove("hidden");
  }
  clearRegion(){this.region=null;this.box.classList.add("hidden");this.onChange(null)}
  setRegion(region){this.region=region||null;if(region?.page)this.page=Number(region.page);this.paintRegion();this.onChange(this.region)}
  async cropBlob(){
    if(!this.region)return null;
    const [x1,y1,x2,y2]=this.region.bbox_norm; const sx=Math.round(x1*this.canvas.width),sy=Math.round(y1*this.canvas.height),sw=Math.max(1,Math.round((x2-x1)*this.canvas.width)),sh=Math.max(1,Math.round((y2-y1)*this.canvas.height));
    const out=document.createElement("canvas");out.width=sw;out.height=sh;out.getContext("2d").drawImage(this.canvas,sx,sy,sw,sh,0,0,sw,sh);
    return new Promise(resolve=>out.toBlob(resolve,"image/webp",.82));
  }
  async visualHash(){
    if(!this.region)return null;
    const blob=await this.cropBlob(); if(!blob)return null;
    const bmp=await createImageBitmap(blob); const c=document.createElement("canvas");c.width=9;c.height=8;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(bmp,0,0,9,8);
    const data=x.getImageData(0,0,9,8).data; let bits=0n,i=0n;
    for(let y=0;y<8;y++)for(let xx=0;xx<8;xx++){const a=(data[(y*9+xx)*4]+data[(y*9+xx)*4+1]+data[(y*9+xx)*4+2])/3,b=(data[(y*9+xx+1)*4]+data[(y*9+xx+1)*4+1]+data[(y*9+xx+1)*4+2])/3;if(a>b)bits|=1n<<i;i++}
    return bits.toString(16).padStart(16,"0");
  }
}
export function validRegion(region){
  if(!region||!Number.isInteger(Number(region.page))||Number(region.page)<1)return false;
  if(!Array.isArray(region.bbox_norm)||region.bbox_norm.length!==4)return false;
  const [x1,y1,x2,y2]=region.bbox_norm.map(Number);return [x1,y1,x2,y2].every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&x2>x1&&y2>y1;
}
