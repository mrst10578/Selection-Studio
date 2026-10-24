import test from 'node:test';
import assert from 'node:assert/strict';
import {installWindowsMetadataShortcuts} from '../studio/windows-shortcuts.js';

function keyboardFixture(options={}){
  const previous=globalThis.document;
  const listeners=new Map();
  const focus={closest:()=>null};
  const host={dataset:{},classList:{add(){},remove(){}}};
  globalThis.document={activeElement:focus,querySelector:()=>host,
    addEventListener:(name,fn)=>listeners.set(name,fn),
    removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}};
  const chapters=[],optionsChosen=[];
  const dispose=installWindowsMetadataShortcuts({setChapter:n=>chapters.push(n),setCorrectOption:n=>optionsChosen.push(n),chapterMax:13,...options});
  const key=(code,modifiers={},target=focus)=>{
    let prevented=false;
    listeners.get('keydown')?.({code,target,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,
      ...modifiers,preventDefault(){prevented=true}});
    return prevented;
  };
  const cleanup=()=>{dispose();globalThis.document=previous};
  return {key,chapters,optionsChosen,cleanup};
}

test('second chapter digit works without holding Ctrl, and never hijacks a standalone digit',()=>{
  const f=keyboardFixture();
  try{
    assert.equal(f.key('Digit3'),false);
    assert.equal(f.key('Digit1',{ctrlKey:true}),true);
    assert.equal(f.key('Digit3'),true);
    assert.deepEqual(f.chapters,[13]);
    assert.equal(f.key('Digit2'),false);
    assert.deepEqual(f.chapters,[13]);
  }finally{f.cleanup()}
});

test('a pending chapter prefix does not intercept typing or a Numpad answer shortcut',async()=>{
  const f=keyboardFixture();
  try{
    f.key('Digit1',{ctrlKey:true});
    assert.equal(f.key('Digit2',{}, {closest:()=>true}),false);
    assert.deepEqual(f.chapters,[]);
    assert.equal(f.key('Numpad2'),true);
    assert.deepEqual(f.optionsChosen,[2]);
    await new Promise(resolve=>setTimeout(resolve,620));
    assert.deepEqual(f.chapters,[]);
  }finally{f.cleanup()}
});

test('chapter bounds are honored when the second digit is unmodified',()=>{
  const f=keyboardFixture({chapterMax:12});
  try{
    f.key('Digit1',{ctrlKey:true});
    assert.equal(f.key('Digit3'),true);
    assert.deepEqual(f.chapters,[]);
    f.key('Digit1',{ctrlKey:true});
    assert.equal(f.key('Digit2'),true);
    assert.deepEqual(f.chapters,[12]);
  }finally{f.cleanup()}
});

test('single chapter 1 still commits after the timeout without a second digit',async()=>{
  const f=keyboardFixture();
  try{
    f.key('Digit1',{ctrlKey:true});
    await new Promise(resolve=>setTimeout(resolve,620));
    assert.deepEqual(f.chapters,[1]);
  }finally{f.cleanup()}
});
