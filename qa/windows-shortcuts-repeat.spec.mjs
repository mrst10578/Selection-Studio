import {test,expect} from '@playwright/test';

test('holding Ctrl+1 never changes chapter 1 into 11; deliberate Ctrl+1 then Ctrl+2 still selects 12',async({page})=>{
  await page.goto('/studio/guide.html');
  const result=await page.evaluate(async()=>{
    const {installWindowsMetadataShortcuts}=await import('/studio/windows-shortcuts.js');
    const chapters=[];
    const fire=(digit,repeat=false)=>document.dispatchEvent(new KeyboardEvent('keydown',{
      code:`Digit${digit}`,ctrlKey:true,repeat,bubbles:true,cancelable:true
    }));
    let dispose=installWindowsMetadataShortcuts({setChapter:n=>chapters.push(n)});
    fire(1);fire(1,true);fire(1,true);
    await new Promise(resolve=>setTimeout(resolve,650));
    fire(1,true);
    await new Promise(resolve=>setTimeout(resolve,650));
    const held=[...chapters];dispose();
    chapters.length=0;
    dispose=installWindowsMetadataShortcuts({setChapter:n=>chapters.push(n)});
    fire(1);fire(2);
    const deliberate=[...chapters];dispose();
    return {held,deliberate};
  });
  expect(result).toEqual({held:[1],deliberate:[12]});
});
