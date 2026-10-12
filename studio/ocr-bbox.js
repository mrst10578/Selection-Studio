/* ZH-76: links are candidate OCR-composite-image coordinates, NEVER invented PDF page bboxes.
 * A link is valid only for the exact transcription it was created against. */
const round=v=>Number(v.toFixed(6));
export function validOcrBox(box){
 return Array.isArray(box)&&box.length===4&&box.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)&&box[2]>box[0]&&box[3]>box[1];
}
export function normalizeOcrLinks(items,text,{source='model'}={}){
 if(!Array.isArray(items)||typeof text!=='string')return [];
 const found=[],seen=new Set();
 for(const candidate of items.slice(0,80)){
  if(!candidate||typeof candidate!=='object')continue;
  const bbox=candidate.bbox_norm??candidate.bbox;
  if(!validOcrBox(bbox))continue;
  let start=Number(candidate.start),end=Number(candidate.end);
  const snippet=typeof candidate.text==='string'?candidate.text:'';
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||snippet&&text.slice(start,end)!==snippet){
   if(!snippet||snippet.length>500)continue;
   start=text.indexOf(snippet);end=start+snippet.length;
   // Ambiguous substring: never claim a precise match.
   if(start<0||text.indexOf(snippet,start+1)!==-1)continue;
  }
  if(end-start>1200)continue;
  const key=start+':'+end;
  if(seen.has(key))continue;
  seen.add(key);
  found.push({start,end,bbox_norm:bbox.map(round),source:candidate.source==='operator'?'operator':candidate.source==='region_reocr'?'region_reocr':source==='operator'?'operator':'model'});
  if(found.length>=48)break;
 }
 return found.sort((a,b)=>a.start-b.start);
}
export function addOcrLink(existing,text,start,end,bbox_norm){
 if(!validOcrBox(bbox_norm)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>text.length||end-start>1200)throw Error('OCR_LINK_INVALID');
 if(existing.some(item=>Math.max(start,item.start)<Math.min(end,item.end)&&(item.start!==start||item.end!==end)))throw Error('OCR_LINK_OVERLAP');
 // Matching text span: operator may correct an inaccurate model-proposed rectangle.
 return normalizeOcrLinks([...existing.filter(item=>item.start!==start||item.end!==end),{start,end,bbox_norm,source:'operator'}],text);
}
export function replaceLinkedSpan(text,links,index,replacement){
 const target=links[index];
 if(!target||typeof replacement!=='string'||replacement.length>3000||!replacement.trim()||target.end>text.length)throw Error('OCR_REPLACEMENT_INVALID');
 const next=text.slice(0,target.start)+replacement+text.slice(target.end);
 if(next.length>12000)throw Error('OCR_REPLACEMENT_TOO_LONG');
 const offset=replacement.length-(target.end-target.start);
 const updated=links.map((item,i)=>{
  if(i===index)return {...item,end:item.start+replacement.length,source:'region_reocr'};
  if(item.end<=target.start)return item;
  if(item.start>=target.end)return {...item,start:item.start+offset,end:item.end+offset};
  return null;
 }).filter(Boolean);
 return {text:next,links:normalizeOcrLinks(updated,next,{source:'model'})};
}
export async function cropOcrBox(blob,box){
 if(!(blob instanceof Blob)||!validOcrBox(box))throw Error('OCR_REGION_INVALID');
 const bitmap=await createImageBitmap(blob);
 try{
  const [x1,y1,x2,y2]=box;
  const sx=Math.floor(x1*bitmap.width),sy=Math.floor(y1*bitmap.height);
  const ex=Math.ceil(x2*bitmap.width),ey=Math.ceil(y2*bitmap.height);
  const w=Math.min(bitmap.width-sx,ex-sx),h=Math.min(bitmap.height-sy,ey-sy);
  if(w<12||h<12)throw Error('OCR_REGION_TOO_SMALL');
  if(w*h>12000000)throw Error('OCR_REGION_TOO_LARGE');
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('OCR_REGION_DECODE_FAILED');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  ctx.drawImage(bitmap,sx,sy,w,h,0,0,w,h);
  return await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('OCR_REGION_ENCODE_FAILED')),'image/webp',.92));
 }finally{bitmap.close?.()}
}
export function safeOcrMap({text,links,regions,events}){
 const clean=normalizeOcrLinks(links,text);
 if(!clean.length)return null;
 const cleanRegions=Array.isArray(regions)?regions.slice(0,12).filter(item=>item&&Number.isInteger(item.page)&&item.page>0&&validOcrBox(item.bbox_norm)).map(x=>({page:x.page,bbox_norm:x.bbox_norm.map(round)})):[];
 const cleanEvents=Array.isArray(events)?events.slice(-32).filter(x=>x&&['linked_manually','selective_reocr_applied'].includes(x.type)&&Number.isSafeInteger(x.link_start)&&validOcrBox(x.bbox_norm)).map(x=>({type:x.type,link_start:x.link_start,bbox_norm:x.bbox_norm.map(round),at:typeof x.at==='string'?x.at.slice(0,32):''})):[];
 return {coordinate_space:'ocr_composite_image',source_regions:cleanRegions,links:clean,events:cleanEvents};
}