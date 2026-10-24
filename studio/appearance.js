const THEME_KEY="testbank-ui-theme-v1";

export function preferredTheme(){return "dark"}

export function applyTheme(){
  try{localStorage.removeItem(THEME_KEY)}catch{ /* Storage may be blocked; keep the UI usable. */ }
  document.documentElement.dataset.theme="dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#1B1F23");
  document.querySelectorAll(".theme-toggle").forEach(button=>button.remove());
  return "dark";
}

export function installThemeToggle(button){
  button?.remove();
  applyTheme();
}
