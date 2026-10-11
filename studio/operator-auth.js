// The server endpoint verifies a signed Cloudflare Access identity.
// Browser state is never used as proof of authorization.
let authenticated=false;
export function isOperatorAuthenticated(){return authenticated}

function endSplash(){
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
 document.body.classList.add("auth-locked");
 document.body.insertAdjacentHTML("afterbegin",`<section id="operatorLogin" class="operator-login" role="dialog" aria-modal="true" aria-labelledby="operatorLoginTitle"><div class="operator-login-card"><div class="login-card-head"><div><span class="eyebrow">Selection Studio</span><h1 id="operatorLoginTitle">تأیید هویت گزینشگر</h1></div></div><p id="operatorLoginStatus" role="status" aria-live="polite">در حال بررسی دسترسی Cloudflare Access…</p><button id="operatorLoginRetry" type="button" class="primary large" hidden>بررسی دوباره</button></div></section>`);
 document.body.classList.remove("auth-pending");
 const view=document.getElementById("operatorLogin");
 const status=document.getElementById("operatorLoginStatus");
 const retry=document.getElementById("operatorLoginRetry");
 async function check(){
  retry.hidden=true;
  status.textContent="در حال بررسی دسترسی Cloudflare Access…";
  try{
   const response=await fetch("/api/session",{credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw Error(response.status===401?"اجازهٔ دسترسی تأیید نشد.":"ارتباط با سرویس هویت برقرار نیست.");
   const identity=await response.json();
   if(!identity.authenticated||identity.role!=="operator")throw Error("دسترسی اپراتور معتبر نیست.");
   authenticated=true;
   const operator=document.getElementById("operator");
   if(operator&&!operator.value)operator.value=identity.email?.split("@")[0]||"operator";
   document.body.classList.remove("auth-locked");
   view.classList.add("hidden");
  }catch(error){
   authenticated=false;
   status.textContent=error.message||"ورود تأیید نشد.";
   retry.hidden=false;
  }finally{endSplash()}
 }
 retry.addEventListener("click",check);
 check();
}
installOperatorAuth();
