const THEME_KEY="testbank-ui-theme-v1";

export function preferredTheme(){return "dark"}

export function applyTheme(){
  localStorage.removeItem(THEME_KEY);
  document.documentElement.dataset.theme="dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#1B1F23");
  document.querySelectorAll(".theme-toggle").forEach(button=>button.remove());
  return "dark";
}

export function installThemeToggle(button){
  button?.remove();
  applyTheme();
}
