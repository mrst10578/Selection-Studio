export function isTypingTarget(target){
  return Boolean(target?.closest?.("input,textarea,select,[contenteditable='true']"));
}
export function toast(message,type="info"){
  let host=document.querySelector("#globalToast");
  if(!host){
    host=document.createElement("div"); host.id="globalToast"; host.className="global-toast";
    document.body.appendChild(host);
  }
  host.textContent=message; host.dataset.type=type; host.classList.add("show");
  clearTimeout(toast.timer);
  const duration=type==="error"?4600:type==="ok"?2400:2800;
  toast.timer=setTimeout(()=>host.classList.remove("show"),duration);
}
export function createCommandPalette({dialog,input,list,getCommands,onQuery=()=>[]}){
  let visible=[];
  const escape=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const searchable=s=>String(s??"").replace(/[۰-۹]/g,ch=>"۰۱۲۳۴۵۶۷۸۹".indexOf(ch)).replace(/[٠-٩]/g,ch=>"٠١٢٣٤٥٦٧٨٩".indexOf(ch)).toLowerCase();
  function render(){
    const raw=input.value.trim(),q=searchable(raw);
    const all=[...onQuery(raw),...(getCommands?.()||[])];
    visible=all.filter(cmd=>!q||searchable([cmd.label,cmd.hint,...(cmd.keywords||[])].filter(Boolean).join(" ")).includes(q)).slice(0,10);
    list.innerHTML=visible.length?visible.map((cmd,i)=>`<button type="button" class="command-item ${i===0?"active":""}" data-i="${i}"><span><strong>${escape(cmd.label)}</strong><small>${escape(cmd.hint||"")}</small></span>${cmd.shortcut?`<kbd>${escape(cmd.shortcut)}</kbd>`:""}</button>`).join(""):`<div class="command-empty">فرمانی پیدا نشد.</div>`;
    list.querySelectorAll(".command-item").forEach(btn=>btn.addEventListener("click",()=>run(Number(btn.dataset.i))));
  }
  function run(i){const cmd=visible[i]; dialog.close(); cmd?.run?.()}
  function open(){dialog.showModal(); input.value=""; render(); requestAnimationFrame(()=>input.focus())}
  input.addEventListener("input",render);
  input.addEventListener("keydown",e=>{
    const items=[...list.querySelectorAll(".command-item")];
    let i=items.findIndex(x=>x.classList.contains("active"));
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      e.preventDefault(); if(!items.length)return;
      items[i]?.classList.remove("active");
      i=(i+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;
      items[i].classList.add("active"); items[i].scrollIntoView({block:"nearest"});
    }else if(e.key==="Enter"){e.preventDefault(); run(Math.max(i,0))}
  });
  dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close()});
  return {open,render};
}
