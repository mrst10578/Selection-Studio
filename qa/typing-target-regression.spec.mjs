import {test,expect} from "@playwright/test";

test("metadata shortcuts treat every editable surface as typing, including inherited editors",async({page})=>{
  await page.goto("/studio/");
  const result=await page.evaluate(async()=>{
    const {isTypingTarget}=await import("/studio/ui-runtime.js");
    const editor=document.createElement("div");
    editor.setAttribute("contenteditable","plaintext-only");
    const nested=document.createElement("span");
    const disabled=document.createElement("span");
    disabled.setAttribute("contenteditable","false");
    editor.append(nested,disabled);
    const blank=document.createElement("div");
    blank.setAttribute("contenteditable","");
    const input=document.createElement("input");
    const button=document.createElement("button");
    document.body.append(editor,blank,input,button);
    const observed={
      plaintextOnly:isTypingTarget(editor),
      inherited:isTypingTarget(nested),
      blankEditable:isTypingTarget(blank),
      nestedDisabled:isTypingTarget(disabled),
      input:isTypingTarget(input),
      button:isTypingTarget(button)
    };
    editor.remove();blank.remove();input.remove();button.remove();
    return observed;
  });
  expect(result).toEqual({
    plaintextOnly:true,
    inherited:true,
    blankEditable:true,
    nestedDisabled:false,
    input:true,
    button:false
  });
});
