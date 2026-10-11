/* ZH-74 experimental LOCAL region proposals. No image upload or OCR inference. */
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function detectInkBlocks(data,width,height,{maxCandidates=12}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<24||height<24||!data||data.length<width*height*4)return [];
 const count=new Uint32Array(height);
 const minRowInk=Math.max(3,Math.floor(width*.006));
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){
   const i=(y*width+x)*4;
   const darkness=(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)<185;
   if(darkness&&data[i+3]>127)count[y]++;
  }
 }
 const lines=[];let first=-1,last=-1;
 for(let y=0;y<height;y++){
  if(count[y]>=minRowInk){
   if(first<0)first=y;
   last=y;
  }else if(first>=0&&y-last>2){
   lines.push([first,last]);first=-1;last=-1;
  }
 }
 if(first>=0)lines.push([first,last]);
 if(!lines.length)return [];
 const sortedHeights=lines.map(([a,b])=>b-a+1).sort((a,b)=>a-b);
 const typical=sortedHeights[Math.floor(sortedHeights.length/2)];
 const breakGap=Math.max(15,Math.round(typical*2.8),Math.round(height*.017));
 const blocks=[];let start=lines[0][0],end=lines[0][1];
 for(const [a,b] of lines.slice(1)){
  if(a-end-1>breakGap){blocks.push([start,end]);start=a}
  end=b;
 }
 blocks.push([start,end]);
 const candidates=[];
 for(const [from,to] of blocks){
  if(to-from+1<Math.max(11,Math.floor(height*.015)))continue;
  let left=width,right=0,darkPixels=0;
  for(let y=from;y<=to;y++){
   for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    if(data[i+3]>127&&(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)<185){
     left=Math.min(left,x);right=Math.max(right,x);darkPixels++;
    }
   }
  }
  if(right-left+1<width*.12||darkPixels<35)continue;
  const px=Math.max(4,Math.round(width*.015)),py=Math.max(4,Math.round(height*.008));
  const box=[
   clamp((left-px)/width,0,1),clamp((from-py)/height,0,1),
   clamp((right+px+1)/width,0,1),clamp((to+py+1)/height,0,1)
  ];
  if(box[2]>box[0]&&box[3]>box[1])candidates.push({bbox_norm:box});
 }
 return candidates.slice(0,clamp(Number(maxCandidates)||12,1,12));
}
export function suggestRegionsOnCanvas(canvas,page){
 if(!canvas?.width||!canvas?.height)return [];
 const ratio=Math.min(1,700/canvas.width,1000/canvas.height);
 const copy=document.createElement('canvas');
 copy.width=Math.max(24,Math.round(canvas.width*ratio));
 copy.height=Math.max(24,Math.round(canvas.height*ratio));
 const context=copy.getContext('2d',{willReadFrequently:true});
 context.fillStyle='#fff';context.fillRect(0,0,copy.width,copy.height);
 context.drawImage(canvas,0,0,copy.width,copy.height);
 const image=context.getImageData(0,0,copy.width,copy.height);
 return detectInkBlocks(image.data,copy.width,copy.height).map(x=>({page,bbox_norm:x.bbox_norm}));
}
