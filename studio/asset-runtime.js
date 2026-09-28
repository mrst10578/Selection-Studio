const ASSET_PREF_KEY="selection-studio-assets-v1";

function resolveAssetPreference(){
  const params=new URLSearchParams(location.search);
  const requested=params.get("assets");
  if(requested==="on"||requested==="off"){
    localStorage.setItem(ASSET_PREF_KEY,requested);
    return requested;
  }
  return localStorage.getItem(ASSET_PREF_KEY)||"on";
}

const assetPreference=resolveAssetPreference();
document.documentElement.dataset.assets=assetPreference;

if(assetPreference==="on"){
  const bySelector=(selector)=>document.querySelector(selector);
  const makeAsset=(number,slug,classes="")=>{
    const span=document.createElement("span");
    span.className=`asset-art ${classes}`.trim();
    span.setAttribute("aria-hidden","true");
    span.dataset.assetId=String(number).padStart(2,"0");
    span.style.setProperty("--asset-image",`var(--asset-${String(number).padStart(2,"0")}-${slug})`);
    return span;
  };
  const add=(target,number,slug,classes="",where="append")=>{
    if(typeof target==="string") target=bySelector(target);
    if(!target||target.querySelector(`:scope > .asset-art[data-asset-id="${String(number).padStart(2,"0")}"]`)) return null;
    target.classList.add("asset-host");
    const art=makeAsset(number,slug,classes);
    target[where==="prepend"?"prepend":"append"](art);
    return art;
  };
  const addToAll=(selector,number,slug,classes="",where="prepend")=>{
    document.querySelectorAll(selector).forEach(el=>add(el,number,slug,classes,where));
  };

  function syncSubject(select,host){
    if(!select||!host) return;
    const map={
      BIO:[5,"biology-dna"],
      MATH:[6,"math-crystal-orbit"],
      PHY:[7,"physics-atom"],
      CHEM:[8,"chemistry-molecule"]
    };
    let art=host.querySelector(":scope > .asset-subject");
    if(!art){
      art=document.createElement("span");
      art.className="asset-art asset-subject";
      art.setAttribute("aria-hidden","true");
      host.classList.add("asset-host");
      host.append(art);
    }
    const [number,slug]=map[select.value]||map.BIO;
    art.dataset.assetId=String(number).padStart(2,"0");
    art.style.setProperty("--asset-image",`var(--asset-${String(number).padStart(2,"0")}-${slug})`);
  }

  function syncRegionLock(button){
    if(!button) return;
    let art=button.querySelector(":scope > .asset-lock");
    if(!art){
      art=document.createElement("span");
      art.className="asset-art asset-lock";
      art.setAttribute("aria-hidden","true");
      button.classList.add("asset-host");
      button.prepend(art);
    }
    const locked=button.classList.contains("locked")||button.getAttribute("aria-pressed")==="true";
    const number=locked?19:20;
    const slug=locked?"crop-lock-locked":"crop-lock-unlocked";
    art.dataset.assetId=String(number);
    art.style.setProperty("--asset-image",`var(--asset-${number}-${slug})`);
  }

  function syncReady(){
    const panel=bySelector(".readiness");
    const save=bySelector("#saveQuestion");
    if(!panel||!save) return;
    panel.classList.toggle("asset-ready-state",!save.disabled);
  }

  function decorateShared(){
    const topbar=bySelector(".topbar");
    if(topbar) add(topbar,1,"crystal-orb","asset-brand","append");
    addToAll(".pdf-empty",3,"paper-stack","asset-pdf-empty","prepend");
  }

  function decorateStudio(){
    const sessionHead=bySelector("#sessionCard > .section-head");
    add(sessionHead,2,"floating-question-tile","asset-corner asset-medium");
    add(".inspector > .section-head",4,"academic-crystal-totem","asset-corner asset-medium");

    const subject=bySelector("#subject");
    const subjectHost=bySelector("#subjectGradeRow");
    if(subject&&subjectHost){
      syncSubject(subject,subjectHost);
      subject.addEventListener("change",()=>syncSubject(subject,subjectHost));
    }

    const difficulty=bySelector('[data-target="difficulty"]')?.closest("fieldset");
    add(difficulty,9,"level-gems","asset-level");

    const readiness=bySelector(".readiness");
    add(readiness,10,"ready-check-token","asset-ready");
    syncReady();
    const save=bySelector("#saveQuestion");
    if(save) new MutationObserver(syncReady).observe(save,{attributes:true,attributeFilter:["disabled"]});

    const recent=bySelector(".recent");
    add(recent,11,"crystal-pebble-separator","asset-separator","prepend");
    addToAll("#recentList .empty-box",12,"empty-state-magnifier","asset-empty","prepend");

    add(".workflow-rail",22,"selection-cursor-crystal","asset-step");
    add("#hotkeysLauncher",23,"keyboard-shortcut-keycap","asset-hotkey","prepend");

    document.querySelectorAll(".pdf-stage-shell").forEach(shell=>add(shell,18,"pdf-crop-corners","asset-crop"));
    ["#qRegionLock","#aRegionLock"].forEach(selector=>{
      const button=bySelector(selector);
      if(!button) return;
      syncRegionLock(button);
      new MutationObserver(()=>syncRegionLock(button)).observe(button,{attributes:true,attributeFilter:["class","aria-pressed"]});
    });

    const counter=bySelector("#recordCount");
    if(counter){
      const spark=document.createElement("span");
      spark.className="asset-save-spark";
      spark.setAttribute("aria-hidden","true");
      document.body.append(spark);
      let previous=Number(counter.textContent)||0;
      let timer=0;
      new MutationObserver(()=>{
        const next=Number(counter.textContent)||0;
        if(next>previous){
          spark.classList.remove("show");
          requestAnimationFrame(()=>spark.classList.add("show"));
          clearTimeout(timer);
          timer=setTimeout(()=>spark.classList.remove("show"),900);
        }
        previous=next;
      }).observe(counter,{childList:true,characterData:true,subtree:true});
    }

    const recentList=bySelector("#recentList");
    if(recentList) new MutationObserver(()=>addToAll("#recentList .empty-box",12,"empty-state-magnifier","asset-empty","prepend"))
      .observe(recentList,{childList:true,subtree:true});
  }

  function decorateSelected(){
    add(".batch-summary",13,"empty-state-pencil","asset-corner asset-large");
    add(".batch-gate",10,"ready-check-token","asset-corner asset-small asset-soft");
    add(".list-panel",3,"paper-stack","asset-corner asset-small asset-soft");
  }

  function decorateGuide(){
    const first=bySelector(".guide-card");
    if(first){
      first.classList.add("asset-guide-hero");
      add(first,21,"selection-studio-hero","asset-corner asset-hero");
    }
    const cards=document.querySelectorAll(".guide-card");
    const hotkeyCard=cards[cards.length-1];
    add(hotkeyCard,23,"keyboard-shortcut-keycap","asset-corner asset-small");
  }

  function decorateAdmin(){
    add("#loginView .login-card",21,"selection-studio-hero","asset-hero");
    add(".review-header",14,"admin-review-stamp","asset-review");
    add("#emptyBatch",12,"empty-state-magnifier","asset-empty","prepend");
    add("#commandLauncher",22,"selection-cursor-crystal","asset-action","prepend");
    add("#approveBtn",15,"approve-token","asset-action","prepend");
    add("#needsBtn",16,"needs-revision-token","asset-action","prepend");
    add("#rejectBtn",17,"reject-token","asset-action","prepend");
    add(".quick-inspector .inspector-title",4,"academic-crystal-totem","asset-action","prepend");
    const quickDifficulty=bySelector('[data-target="quickDifficulty"]')?.closest("fieldset");
    add(quickDifficulty,9,"level-gems","asset-level");

    const quickSubject=bySelector("#quickSubject");
    const quickHost=bySelector("#quickSubjectGradeRow");
    if(quickSubject&&quickHost){
      syncSubject(quickSubject,quickHost);
      quickSubject.addEventListener("change",()=>syncSubject(quickSubject,quickHost));
      new MutationObserver(()=>syncSubject(quickSubject,quickHost)).observe(quickSubject,{attributes:true,attributeFilter:["value"]});
    }

    const picker=bySelector(".subject-picker");
    if(picker){
      const adminSubjectArt=makeAsset(5,"biology-dna","asset-subject");
      picker.classList.add("asset-host");
      picker.append(adminSubjectArt);
      const update=()=>{
        const active=picker.querySelector("button.active")?.dataset.subject||"BIO";
        const fake={value:active};
        const map={BIO:[5,"biology-dna"],MATH:[6,"math-crystal-orbit"],PHY:[7,"physics-atom"],CHEM:[8,"chemistry-molecule"]};
        const [number,slug]=map[fake.value]||map.BIO;
        adminSubjectArt.dataset.assetId=String(number).padStart(2,"0");
        adminSubjectArt.style.setProperty("--asset-image",`var(--asset-${String(number).padStart(2,"0")}-${slug})`);
      };
      picker.addEventListener("click",()=>queueMicrotask(update));
      new MutationObserver(update).observe(picker,{subtree:true,attributes:true,attributeFilter:["class"]});
      update();
    }
  }

  function boot(){
    decorateShared();
    if(bySelector("#sessionCard")) decorateStudio();
    if(document.body.querySelector(".selected-page")) decorateSelected();
    if(document.body.querySelector(".guide-page")) decorateGuide();
    if(bySelector("#adminLoginForm")) decorateAdmin();
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
}

export {ASSET_PREF_KEY};
