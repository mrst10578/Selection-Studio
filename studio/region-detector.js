/* ZH-74: local, deterministic PDF pixel segmentation, never OCR or network.
 * All coordinates are [x1,y1,x2,y2] normalized to the original rendered canvas.
 * "Option" labels are only visual hypotheses and MUST be reviewed by an operator.
 */
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function boxOf(lines,width,height,padX=Math.max(3,Math.round(width*.012)),padY=Math.max(3,Math.round(height*.006))){
 const minX=Math.min(...lines.map(x=>x.left)),maxX=Math.max(...lines.map(x=>x.right));
 const minY=Math.min(...lines.map(x=>x.top)),maxY=Math.max(...lines.map(x=>x.bottom));
 return [
  clamp((minX-padX)/width,0,1),clamp((minY-padY)/height,0,1),
  clamp((maxX+padX+1)/width,0,1),clamp((maxY+padY+1)/height,0,1)
 ];
}
function lineRuns(data,width,height){
 const rows=[];
 const minPixels=Math.max(3,Math.round(width*.004));
 for(let y=0;y<height;y++){
  let left=width,right=-1,ink=0;
  for(let x=0;x<width;x++){
   const offset=(y*width+x)*4;
   if(data[offset+3]<128)continue;
   const gray=data[offset]*.2126+data[offset+1]*.7152+data[offset+2]*.0722;
   if(gray<185){ink++;if(x<left)left=x;if(x>right)right=x}
  }
  // Suppress page-wide rules/borders; these are not text rows.
  rows.push(ink>=minPixels&&ink<width*.93?{y,left,right,ink}:null);
 }
 const runs=[];let active=null,gap=0;
 function commit(){
  if(!active)return;
  if(active.bottom-active.top>=0&&active.ink>=35&&active.right-active.left>=width*.065)runs.push(active);
  active=null;gap=0;
 }
 for(let y=0;y<height;y++){
  const row=rows[y];
  if(row){
   if(!active)active={top:y,bottom:y,left:row.left,right:row.right,ink:0};
   active.bottom=y;active.left=Math.min(active.left,row.left);active.right=Math.max(active.right,row.right);active.ink+=row.ink;gap=0;
  }else if(active){
   gap++;if(gap>2)commit();
  }
 }
 commit();
 return runs;
}
function optionTail(lines,width,height){
 if(lines.length<5)return false;
 const tail=lines.slice(-4);
 const prior=lines.slice(0,-4);
 const heights=tail.map(l=>l.bottom-l.top+1);
 const sorted=[...heights].sort((a,b)=>a-b);
 const typical=sorted[1]+.5*(sorted[2]-sorted[1]);
 const validHeight=heights.every(h=>h>=2&&h<=Math.max(20,typical*2.2));
 const rightEdge=Math.max(...tail.map(l=>l.right))-Math.min(...tail.map(l=>l.right));
 const yGaps=tail.slice(1).map((l,i)=>l.top-tail[i].bottom-1);
 const validSpacing=yGaps.every(g=>g>=0&&g<Math.max(34,height*.042));
 const widths=tail.map(l=>l.right-l.left+1);
 // A loose right anchor works for RTL question options while avoiding random text.
 const validAnchor=rightEdge<=width*.2;
 const validWidth=widths.every(w=>w>width*.07&&w<width*.9);
 const stemSpace=tail[0].top-prior.at(-1).bottom;
 return validHeight&&validSpacing&&validAnchor&&validWidth&&stemSpace>=2;
}
function columnSegments(data,width,line){
 const counts=new Uint16Array(width);
 for(let y=line.top;y<=line.bottom;y++){
  for(let x=0;x<width;x++){
   const index=(y*width+x)*4;
   if(data[index+3]<128)continue;
   const gray=data[index]*.2126+data[index+1]*.7152+data[index+2]*.0722;
   if(gray<185)counts[x]++;
  }
 }
 const ranges=[];let left=-1,last=-1;
 const gapLimit=Math.max(20,Math.round(width*.072));
 const commit=()=>{if(left>=0&&last-left>width*.055)ranges.push({left,right:last,top:line.top,bottom:line.bottom})};
 for(let x=0;x<width;x++){
  if(counts[x]>0){if(left<0)left=x;last=x}
  else if(left>=0&&x-last>gapLimit){commit();left=-1;last=-1}
 }
 commit();
 return ranges;
}
function twoColumnOptionTail(lines,data,width,height){
 if(lines.length<3)return null;
 const last=lines.slice(-2);
 const first=columnSegments(data,width,last[0]);
 const second=columnSegments(data,width,last[1]);
 if(first.length!==2||second.length!==2)return null;
 const [leftA,rightA]=first,[leftB,rightB]=second;
 const spread=Math.max(Math.abs(leftA.left-leftB.left),Math.abs(rightA.left-rightB.left));
 const middle=Math.min(rightA.left-leftA.right,rightB.left-leftB.right);
 const gap=last[1].top-last[0].bottom-1;
 if(spread>width*.13||middle<width*.09||gap<0||gap>Math.max(30,height*.035))return null;
 // RTL reading order: right cell of first row, left cell, then next row.
 return [rightA,leftA,rightB,leftB];
}
export function detectQuestionLayout(data,width,height,{maxCandidates=12}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<24||height<24||
    !data||data.length<width*height*4)return [];
 const rows=lineRuns(data,width,height);
 if(!rows.length)return [];
 const heights=rows.map(x=>x.bottom-x.top+1).sort((a,b)=>a-b);
 const typical=heights[Math.floor(heights.length/2)];
 const gapLimit=Math.max(13,Math.min(39,Math.round(typical*1.8)),Math.round(height*.015));
 const groups=[];let current=[rows[0]];
 for(const line of rows.slice(1)){
  const prev=current.at(-1);
  if(line.top-prev.bottom-1>gapLimit){groups.push(current);current=[]}
  current.push(line);
 }
 groups.push(current);
 const proposals=[];
 for(const lines of groups){
  const top=lines[0].top,bottom=lines.at(-1).bottom;
  if(bottom-top+1<Math.max(9,Math.round(height*.01)))continue;
  if(optionTail(lines,width,height)){
   const stem=lines.slice(0,-4);
   const bounds=boxOf(stem,width,height);
   proposals.push({kind:'question',label:'متن احتمالی سؤال',confidence:.72,bbox_norm:bounds});
   lines.slice(-4).forEach((line,index)=>{
    proposals.push({kind:'option',label:'گزینه احتمالی '+(index+1),confidence:.58,bbox_norm:boxOf([line],width,height)});
   });
  }else{
   const cells=twoColumnOptionTail(lines,data,width,height);
   if(cells){
    proposals.push({kind:'question',label:'متن احتمالی سؤال',confidence:.65,bbox_norm:boxOf(lines.slice(0,-2),width,height)});
    cells.forEach((cell,index)=>proposals.push({kind:'option',label:'گزینه احتمالی '+(index+1),confidence:.5,bbox_norm:boxOf([cell],width,height)}));
   }else{
    proposals.push({kind:'block',label:'بخش احتمالی سؤال',confidence:.45,bbox_norm:boxOf(lines,width,height)});
   }
  }
 }
 return proposals.filter(p=>p.bbox_norm[2]>p.bbox_norm[0]&&p.bbox_norm[3]>p.bbox_norm[1])
  .slice(0,clamp(Number(maxCandidates)||12,1,12));
}
// Backward compatible API for existing consumers: exactly the original bounds shape.
export function detectInkBlocks(data,width,height,opts={}){
 return detectQuestionLayout(data,width,height,opts).map(({bbox_norm})=>({bbox_norm}));
}
export function createDetectionSnapshot(canvas,page,{maxCandidates=12}={}){
 if(!canvas?.width||!canvas?.height||!Number.isInteger(Number(page))||Number(page)<1)return null;
 const ratio=Math.min(1,700/canvas.width,1000/canvas.height);
 const thumbnail=document.createElement('canvas');
 thumbnail.width=Math.max(24,Math.round(canvas.width*ratio));
 thumbnail.height=Math.max(24,Math.round(canvas.height*ratio));
 const ctx=thumbnail.getContext('2d',{willReadFrequently:true});
 if(!ctx)return null;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,thumbnail.width,thumbnail.height);
 ctx.drawImage(canvas,0,0,thumbnail.width,thumbnail.height);
 const image=ctx.getImageData(0,0,thumbnail.width,thumbnail.height);
 const candidates=detectQuestionLayout(image.data,thumbnail.width,thumbnail.height,{maxCandidates})
  .map((proposal,index)=>({...proposal,id:'proposal-'+(index+1),page:Number(page)}));
 return {thumbnail,candidates,width:thumbnail.width,height:thumbnail.height};
}
export function suggestRegionsOnCanvas(canvas,page){
 return createDetectionSnapshot(canvas,page)?.candidates.map(({page,bbox_norm})=>({page,bbox_norm}))||[];
}
export function validateEditedBounds(values){
 if(!Array.isArray(values)||values.length!==4)return null;
 const numbers=values.map(Number);
 if(!numbers.every(finite))return null;
 const [left,top,right,bottom]=numbers;
 if(left<0||top<0||right>100||bottom>100||right-left<1||bottom-top<1)return null;
 return numbers.map(x=>Math.round(x*100)/10000);
}
