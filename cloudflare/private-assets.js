/* ZH-81 | Private R2 object helper; no public URLs, no tokens, no automatic publish.
 * Caller is an authenticated Worker and must pass a trusted hashed Access actor. */
const actorPattern=/^[a-f0-9]{32}$/i,digestPattern=/^[a-f0-9]{64}$/i;
const types=new Set(['application/pdf','image/webp','image/png','image/jpeg','application/json']);
const sizeCap=8*1024*1024;
const bytesOf=value=>value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):null;
export function detectAssetType(value){
 const b=bytesOf(value);
 if(!b||b.length<8)return null;
 if(b.length>=5&&String.fromCharCode(...b.slice(0,5))==='%PDF-')return 'application/pdf';
 if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10)return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 if(b.length<=200000){try{const val=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));if(val&&typeof val==='object'&&!Array.isArray(val))return 'application/json';}catch{}}
 return null;
}
export async function sha256Hex(value){const b=bytesOf(value);if(!b)throw Error('INVALID_BYTES');const hash=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
export function privateAssetKey(actor,digest,mime){
 if(!actorPattern.test(actor||'')||!digestPattern.test(digest||'')||!types.has(mime))throw Error('INVALID_ASSET_KEY');
 const suffix={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/json':'json'}[mime];
 return 'private-assets/'+actor.toLowerCase()+'/'+digest.toLowerCase()+'.'+suffix;
}
export async function putPrivateAsset(env,actor,payload,{mime}={}){
 if(!env?.QUESTION_ASSETS?.put||!env.QUESTION_ASSETS?.head)throw Error('PRIVATE_R2_NOT_CONFIGURED');
 const b=bytesOf(payload);
 if(!b||b.length<16||b.length>sizeCap)throw Error('INVALID_ASSET_SIZE');
 const detected=detectAssetType(b);
 if(!detected||!types.has(mime)||mime!==detected)throw Error('INVALID_ASSET_TYPE');
 const digest=await sha256Hex(b),key=privateAssetKey(actor,digest,mime);
 if(await env.QUESTION_ASSETS.head(key))return {digest,mime,bytes:b.length,existing:true,key};
 await env.QUESTION_ASSETS.put(key,b,{httpMetadata:{contentType:mime},customMetadata:{purpose:'review-only'}});
 return {digest,mime,bytes:b.length,existing:false,key};
}
export async function readPrivateAsset(env,actor,{digest,mime}={}){
 if(!env?.QUESTION_ASSETS?.get)throw Error('PRIVATE_R2_NOT_CONFIGURED');
 const key=privateAssetKey(actor,digest,mime);
 const result=await env.QUESTION_ASSETS.get(key);
 return result?{object:result,mime,key}:null;
}
