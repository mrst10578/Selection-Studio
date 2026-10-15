/* ZH-84 | Optional encrypted offline drafts. No key/passphrase persistence.
 * Nothing is automatically uploaded, merged or accepted as a newer revision. */
const dbName='examforge-offline-v1',storeName='drafts',maxEntries=20;
const plain=s=>new TextEncoder().encode(s);
const fromBytes=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',plain(s))));
function openDB(){
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB)return reject(Error('OFFLINE_STORAGE_UNAVAILABLE'));
  const request=indexedDB.open(dbName,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(storeName)){
   const store=db.createObjectStore(storeName,{keyPath:'id'});
   store.createIndex('actor','actor',{unique:false});
  }};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('OFFLINE_STORAGE_UNAVAILABLE'));
 });
}
async function cryptKey(passphrase,salt){
 if(typeof passphrase!=='string'||passphrase.length<12||passphrase.length>256)throw Error('STRONG_PASSPHRASE_REQUIRED');
 const password=await crypto.subtle.importKey('raw',plain(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},password,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function txRequest(db,mode,handler){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(storeName,mode),store=tx.objectStore(storeName);
  let result;try{handler(store,v=>result=v)}catch(e){db.close();return reject(e)}
  tx.oncomplete=()=>{db.close();resolve(result)};
  tx.onerror=()=>{db.close();reject(Error('OFFLINE_STORAGE_FAILED'))};
  tx.onabort=()=>{db.close();reject(Error('OFFLINE_STORAGE_FAILED'))};
 });
}
async function actorId(actor){if(typeof actor!=='string'||actor.trim().length<6||actor.length>160)throw Error('OFFLINE_ACTOR_REQUIRED');return hash(actor.trim().toLowerCase())}
const isItem=v=>v&&typeof v==='object'&&!Array.isArray(v)&&
 typeof v.projectId==='string'&&v.projectId.length<100&&
 typeof v.questionText==='string'&&v.questionText.length<=16000&&
 Number.isSafeInteger(v.baseRevision)&&v.baseRevision>=0;
export async function saveOfflineDraft(actor,passphrase,item){
 if(!isItem(item))throw Error('INVALID_OFFLINE_DRAFT');
 const who=await actorId(actor),db=await openDB();
 const prior=await txRequest(db,'readonly',(store,done)=>{const req=store.index('actor').getAll(who);req.onsuccess=()=>done(req.result)});
 if(prior.length>=maxEntries)throw Error('OFFLINE_DRAFT_LIMIT');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await cryptKey(passphrase,salt);
 const value=JSON.stringify({projectId:item.projectId,questionId:item.questionId||null,baseRevision:item.baseRevision,
  sourceFingerprint:String(item.sourceFingerprint||'').slice(0,160),questionText:item.questionText,
  answerText:String(item.answerText||'').slice(0,16000),taxonomyId:String(item.taxonomyId||'').slice(0,80)});
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain(value)));
 const record={id:crypto.randomUUID(),actor:who,createdAt:new Date().toISOString(),salt:[...salt],iv:[...iv],ciphertext:[...ciphertext]};
 const next=await openDB();await txRequest(next,'readwrite',(store)=>store.add(record));
 return {id:record.id,createdAt:record.createdAt,encrypted:true};
}
export async function listOfflineDrafts(actor){
 const who=await actorId(actor),db=await openDB();
 const values=await txRequest(db,'readonly',(store,done)=>{const req=store.index('actor').getAll(who);req.onsuccess=()=>done(req.result)});
 return values.map(x=>({id:x.id,createdAt:x.createdAt,encrypted:true})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function readOfflineDraft(actor,passphrase,id){
 const who=await actorId(actor);
 if(!/^[0-9a-f-]{36}$/i.test(id||''))throw Error('INVALID_OFFLINE_ID');
 const db=await openDB(),record=await txRequest(db,'readonly',(store,done)=>{const req=store.get(id);req.onsuccess=()=>done(req.result)});
 if(!record||record.actor!==who)throw Error('OFFLINE_DRAFT_NOT_FOUND');
 try{
  const salt=new Uint8Array(record.salt),iv=new Uint8Array(record.iv),key=await cryptKey(passphrase,salt);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,new Uint8Array(record.ciphertext));
  const data=JSON.parse(fromBytes(bytes));
  if(!isItem(data))throw Error('INVALID_OFFLINE_DRAFT');
  return data;
 }catch(e){if(e.message==='STRONG_PASSPHRASE_REQUIRED')throw e;throw Error('OFFLINE_DECRYPTION_FAILED')}
}
export async function deleteOfflineDraft(actor,id){
 const who=await actorId(actor),db=await openDB();
 const record=await txRequest(db,'readonly',(store,done)=>{const req=store.get(id);req.onsuccess=()=>done(req.result)});
 if(!record||record.actor!==who)return false;
 const next=await openDB();await txRequest(next,'readwrite',(store)=>store.delete(id));
 return true;
}
