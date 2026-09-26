import {installThemeToggle} from "./appearance.js";

const AUTH_KEY="selection-studio-operator-auth-v1";
const USERNAME="admin";
const PASSWORD="admin";

function loginMarkup(){
  return `
  <section id="operatorLogin" class="operator-login" role="dialog" aria-modal="true" aria-labelledby="operatorLoginTitle">
    <form id="operatorLoginForm" class="operator-login-card" autocomplete="off">
      <div class="login-card-head"><div><span class="eyebrow">Selection Studio</span><h1 id="operatorLoginTitle">ورود گزینشگر</h1></div><button id="operatorLoginThemeToggle" class="theme-toggle" type="button" aria-pressed="false">تم تیره</button></div>
      <label>نام کاربری<input id="operatorUsername" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" /></label>
      <label>رمز عبور<input id="operatorPassword" name="password" type="password" autocomplete="current-password" /></label>
      <p id="operatorLoginError" class="login-error" role="alert" aria-live="polite"></p>
      <button id="operatorLoginSubmit" class="primary large" type="submit">ورود به پنل</button>
    </form>
  </section>`;
}

export function isOperatorAuthenticated(){
  return sessionStorage.getItem(AUTH_KEY)===USERNAME;
}

function finishBootSplash(){
  const splash=document.getElementById("bootSplash");
  requestAnimationFrame(()=>{
    document.body.classList.remove("booting");
    if(!splash)return;
    splash.classList.add("leaving");
    setTimeout(()=>splash.classList.add("hidden"),180);
  });
}

export function installOperatorAuth(){
  if(document.getElementById("operatorLogin"))return;
  document.body.insertAdjacentHTML("afterbegin",loginMarkup());
  const view=document.getElementById("operatorLogin");
  const form=document.getElementById("operatorLoginForm");
  const username=document.getElementById("operatorUsername");
  const password=document.getElementById("operatorPassword");
  const error=document.getElementById("operatorLoginError");
  const submit=document.getElementById("operatorLoginSubmit");
  installThemeToggle(document.getElementById("operatorLoginThemeToggle"));

  const unlock=()=>{
    document.body.classList.remove("auth-locked");
    view.classList.add("hidden");
    const operator=document.getElementById("operator");
    if(operator&&!operator.value)operator.value=USERNAME;
  };

  if(isOperatorAuthenticated()){
    unlock();
    finishBootSplash();
    return;
  }

  document.body.classList.add("auth-locked");
  finishBootSplash();
  setTimeout(()=>requestAnimationFrame(()=>username.focus()),180);
  form.addEventListener("submit",event=>{
    event.preventDefault();
    if(username.value.trim()===USERNAME&&password.value===PASSWORD){
      sessionStorage.setItem(AUTH_KEY,USERNAME);
      error.textContent="";
      view.classList.add("auth-success");
      form.classList.add("auth-success");
      username.disabled=true;
      password.disabled=true;
      submit.disabled=true;
      submit.textContent="ورود موفق";
      setTimeout(unlock,180);
      return;
    }
    error.textContent="Username یا Password اشتباه است.";
    password.value="";
    password.focus();
  });
}

installOperatorAuth();
