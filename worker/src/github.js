const API="https://api.github.com";

function headers(env,extra={}){
  if(!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured");
  return {
    accept:"application/vnd.github+json",
    authorization:"Bearer "+env.GITHUB_TOKEN,
    "x-github-api-version":"2022-11-28",
    "user-agent":"selection-studio-worker",
    ...extra
  };
}
function repoBase(env){
  if(!env.GITHUB_OWNER||!env.GITHUB_REPO) throw new Error("GitHub repository is not configured");
  return `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
}
async function gh(env,path,init={}){
  const response=await fetch(API+path,{...init,headers:headers(env,init.headers||{})});
  const text=await response.text();
  let body=null; try{body=text?JSON.parse(text):null}catch{body=text}
  if(!response.ok){
    const error=new Error(typeof body==="string"?body:(body?.message||("GitHub HTTP "+response.status)));
    error.status=response.status; error.github=body; throw error;
  }
  return body;
}
function decodeBase64(base64){
  const raw=atob(String(base64||"").replace(/\n/g,""));
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
function encodeBase64Bytes(bytes){
  let raw=""; const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)raw+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(raw);
}
export function safeSegment(value,label="segment"){
  const s=String(value||"").trim();
  if(!s||! /^[A-Za-z0-9._-]+$/.test(s)||s==="."||s==="..") throw new Error("invalid "+label);
  return s;
}
export async function readFile(env,path,ref=env.GITHUB_REF||"main"){
  try{
    const item=await gh(env,`${repoBase(env)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
    if(Array.isArray(item))throw new Error("expected file, got directory");
    return {exists:true,sha:item.sha,content:new TextDecoder().decode(decodeBase64(item.content)),encoding:item.encoding};
  }catch(error){
    if(error.status===404)return {exists:false,sha:null,content:null};
    throw error;
  }
}
export async function readBinaryFile(env,path,ref=env.GITHUB_REF||"main"){
  const item=await gh(env,`${repoBase(env)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
  if(Array.isArray(item))throw new Error("expected file, got directory");
  return {sha:item.sha,bytes:decodeBase64(item.content)};
}
export async function listDirectory(env,path,ref=env.GITHUB_REF||"main"){
  try{
    const items=await gh(env,`${repoBase(env)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
    return Array.isArray(items)?items:[];
  }catch(error){
    if(error.status===404)return [];
    throw error;
  }
}
async function currentRef(env){
  const ref=env.GITHUB_REF||"main";
  const refInfo=await gh(env,`${repoBase(env)}/git/ref/heads/${encodeURIComponent(ref)}`);
  const commit=await gh(env,`${repoBase(env)}/git/commits/${refInfo.object.sha}`);
  return {ref,commitSha:refInfo.object.sha,treeSha:commit.tree.sha};
}
async function createBlob(env,file){
  if(file.delete)return null;
  const payload=file.encoding==="base64"
    ? {content:file.content,encoding:"base64"}
    : {content:String(file.content??""),encoding:"utf-8"};
  const blob=await gh(env,`${repoBase(env)}/git/blobs`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  return blob.sha;
}
export async function commitFiles(env,files,message,{retry=true}={}){
  if(!Array.isArray(files)||!files.length)throw new Error("files required");
  const base=await currentRef(env);
  const entries=[];
  for(const file of files){
    const sha=await createBlob(env,file);
    entries.push({path:file.path,mode:"100644",type:"blob",sha});
  }
  const tree=await gh(env,`${repoBase(env)}/git/trees`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({base_tree:base.treeSha,tree:entries})});
  const commit=await gh(env,`${repoBase(env)}/git/commits`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message,tree:tree.sha,parents:[base.commitSha]})});
  try{
    await gh(env,`${repoBase(env)}/git/refs/heads/${encodeURIComponent(base.ref)}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({sha:commit.sha,force:false})});
    return commit.sha;
  }catch(error){
    if(retry&&(error.status===409||error.status===422)) return commitFiles(env,files,message,{retry:false});
    throw error;
  }
}
export async function writeTextFile(env,path,content,message){
  return commitFiles(env,[{path,content}],message);
}
export function bytesToBase64(bytes){return encodeBase64Bytes(bytes)}
