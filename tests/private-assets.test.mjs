import test from 'node:test';
import assert from 'node:assert/strict';
import {detectAssetType,privateAssetKey,putPrivateAsset,readPrivateAsset} from '../cloudflare/private-assets.js';
const actor='a'.repeat(32),other='b'.repeat(32);
const pdf=new TextEncoder().encode('%PDF-1.7\nhello question'.padEnd(60,' '));
function fixture(){const items=new Map();return {items,env:{QUESTION_ASSETS:{
 async head(k){return items.has(k)?{key:k}:null},async get(k){return items.get(k)||null},
 async put(k,data,opts){items.set(k,{arrayBuffer:async()=>data.buffer,metadata:opts})}
 }}};}
test('magic bytes are checked, and private object keys are actor scoped',()=>{
 assert.equal(detectAssetType(pdf),'application/pdf');
 assert.equal(detectAssetType(new Uint8Array(30)),null);
 assert.throws(()=>privateAssetKey('../x','0'.repeat(64),'application/pdf'),/INVALID_ASSET_KEY/);
});
test('R2 put deduplicates same document and never exposes public URL or credential',async()=>{
 const f=fixture();const first=await putPrivateAsset(f.env,actor,pdf,{mime:'application/pdf'});
 assert.equal(first.existing,false);
 const again=await putPrivateAsset(f.env,actor,pdf,{mime:'application/pdf'});
 assert.equal(again.existing,true);assert.equal(first.key,again.key);assert.equal(f.items.size,1);
 assert.equal(Object.hasOwn(first,'url'),false);
 assert.ok((await readPrivateAsset(f.env,actor,first)).object);
 assert.equal(await readPrivateAsset(f.env,other,first),null);
});
test('mismatched declared content and missing bindings fail closed',async()=>{
 const f=fixture();
 await assert.rejects(()=>putPrivateAsset(f.env,actor,pdf,{mime:'image/png'}),/INVALID_ASSET_TYPE/);
 await assert.rejects(()=>putPrivateAsset({},actor,pdf,{mime:'application/pdf'}),/PRIVATE_R2_NOT_CONFIGURED/);
});
