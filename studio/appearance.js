const THEME_KEY="testbank-ui-theme-v1";
const FOCUS_KEY="testbank-focus-mode-v1";

export function preferredTheme(){return "light"}

export function applyTheme(){
  localStorage.removeItem(THEME_KEY);
  document.documentElement.dataset.theme="light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#F4F3F0");
  document.querySelectorAll(".theme-toggle").forEach(button=>button.remove());
  return "light";
}

export function installThemeToggle(button){
  button?.remove();
  applyTheme();
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

