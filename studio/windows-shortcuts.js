import {isTypingTarget,toast} from "./ui-runtime.js";

export function installWindowsMetadataShortcuts({
  enabled=()=>true,gradeEnabled=()=>true,setCorrectOption,setLevel,setGrade,setChapter,setUnit,chapterMax=13,unitMax=14
}={}){
  let timer=null,prefix="";
  const clear=()=>{if(timer)clearTimeout(timer);timer=null;prefix=""};
  const commitChapter=n=>{
    n=Number(n); if(n<1||n>chapterMax){toast("فصل نامعتبر","error");return}
    setChapter?.(n); toast("فصل "+n,"shortcut");
  };
  const chapterDigit=d=>{
    if(prefix==="1"){
      const n=Number("1"+d); clear();
      if(n>=10&&n<=chapterMax) commitChapter(n); else toast("فصل فقط ۱ تا ۱۲","error");
      return;
    }
    if(d==="1"&&chapterMax>=10){
      prefix="1"; timer=setTimeout(()=>{clear();commitChapter(1)},560);
      toast("فصل ۱ — برای ۱۰/۱۱/۱۲ رقم دوم را بزن","shortcut"); return;
    }
    clear(); commitChapter(Number(d));
  };
  function handler(e){
    if(!enabled()||isTypingTarget(e.target))return;
    const num=e.code.match(/^Numpad([1-4])$/);
    if(num&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey){e.preventDefault();setCorrectOption?.(Number(num[1]));toast("کلید "+num[1],"shortcut");return}
    const f=e.code.match(/^F([1-5])$/);
    if(f&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey){e.preventDefault();setLevel?.(Number(f[1]));toast("Level "+f[1],"shortcut");return}
    const grade=e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey?e.code.match(/^Digit([1-3])$/):null;
    if(grade){
      e.preventDefault();
      if(!gradeEnabled()){toast("پایه ریاضی از زیرعنوان تعیین می‌شود","shortcut");return}
      const g={1:10,2:11,3:12}[Number(grade[1])];setGrade?.(g);toast("پایه "+g,"shortcut");return
    }
    const unit=e.altKey&&!e.ctrlKey&&!e.shiftKey&&!e.metaKey?e.code.match(/^Digit([1-8])$/):null;
    if(unit){e.preventDefault();const n=Number(unit[1]);if(n<=unitMax){setUnit?.(n);toast("گفتار/مبحث "+n,"shortcut")}return}
    const chapter=e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey?e.code.match(/^Digit([0-9])$/):null;
    if(chapter){e.preventDefault();chapterDigit(chapter[1]);return}
    if(prefix&&!e.ctrlKey)clear();
  }
  document.addEventListener("keydown",handler,true);
  return ()=>{clear();document.removeEventListener("keydown",handler,true)};
}
