import test from 'node:test';
import assert from 'node:assert/strict';
import {createCropQueue} from '../studio/crop-queue.js';

test('invalid crop reorder indexes never remove queued regions or fire changes', () => {
  const previousDocument=globalThis.document;
  globalThis.document={
    getElementById:()=>null,
    querySelector:()=>null,
    addEventListener:()=>{}
  };
  try{
    let changes=0;
    const crop={
      region:null,
      isRegionReady(){return Boolean(this.region)},
      isRegionLocked(){return false},
      clearRegion(){this.region=null}
    };
    const queue=createCropQueue({
      question:crop,answer:{...crop},switchPane:()=>{},
      onChange:()=>{changes++}
    });
    for(const page of [1,2]){
      crop.region={page,bbox_norm:[0.1,0.1,0.2,0.2]};
      assert.equal(queue.add('question'),true);
    }
    const pages=()=>queue.selections('question').map(region=>region.page);
    assert.deepEqual(pages(),[1,2]);
    const baseline=changes;
    for(const [index,delta] of [[-1,1],[2,-1],[0,0],[0,2],[0.5,1]]){
      assert.equal(queue.shift('question',index,delta),false);
      assert.deepEqual(pages(),[1,2]);
    }
    assert.equal(changes,baseline);
    assert.equal(queue.shift('question',0,1),true);
    assert.deepEqual(pages(),[2,1]);
    assert.equal(changes,baseline+1);
    assert.equal(queue.shift('question',1,-1),true);
    assert.deepEqual(pages(),[1,2]);
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
});
