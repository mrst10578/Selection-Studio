const DB_NAME="selection-studio-previews-v1";
const STORE="previews";

function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function putPreview(key,blob){
  const db=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(blob,key);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
  db.close();
}
export async function getPreview(key){
  const db=await openDb();
  const value=await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readonly");
    const req=tx.objectStore(STORE).get(key);
    req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
  });
  db.close(); return value;
}
export async function deletePreview(key){
  const db=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
  db.close();
}
