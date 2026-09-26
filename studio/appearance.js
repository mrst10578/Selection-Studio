const THEME_KEY="testbank-ui-theme-v1";
const FOCUS_KEY="testbank-focus-mode-v1";

export function preferredTheme(){
  const saved=localStorage.getItem(THEME_KEY);
  return saved==="dark"?"dark":"light";
}

export function applyTheme(theme){
  const next=theme==="dark"?"dark":"light";
  document.documentElement.dataset.theme=next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",next==="dark"?"#1B1F23":"#F4F3F0");
  return next;
}

export function installThemeToggle(button){
  if(!button)return;
  const sync=()=>{
    const dark=document.documentElement.dataset.theme==="dark";
    button.textContent=dark?"تم روشن":"تم تیره";
    button.setAttribute("aria-pressed",String(dark));
    button.setAttribute("aria-label",dark?"فعال‌کردن تم روشن":"فعال‌کردن تم تیره");
  };
  applyTheme(preferredTheme());
  button.addEventListener("click",()=>{
    const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
    localStorage.setItem(THEME_KEY,next);
    applyTheme(next);
    sync();
  });
  sync();
}

export function installFocusMode(button){
  if(!button)return;
  const root=document.documentElement;
  const sync=()=>{
    const active=root.dataset.focusMode==="true";
    button.textContent=active?"خروج از تمرکز":"حالت تمرکز";
    button.setAttribute("aria-pressed",String(active));
  };
  root.dataset.focusMode=localStorage.getItem(FOCUS_KEY)==="true"?"true":"false";
  button.addEventListener("click",()=>{
    const next=root.dataset.focusMode==="true"?"false":"true";
    root.dataset.focusMode=next;
    localStorage.setItem(FOCUS_KEY,next);
    sync();
  });
  sync();
}
