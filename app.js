// Rico’s Mealtracker — app.js (Modal/Drawer + OFF + Barcode + Templates + Cut)
// Works with the provided index.html IDs.

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

const STORAGE_KEY = "ricos_mealtracker_main_v4";

let editingId = null;
let scanStream = null;
let scanRunning = false;

// Install prompt (Chrome heuristic may suppress event)
let deferredInstallPrompt = null;

// ---------------- utils ----------------
function $(id){ return document.getElementById(id); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function dayKey(d){ return `day_${d}`; }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function round1(x){ return Math.round((x + Number.EPSILON) * 10) / 10; }

function loadState(){ return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

function initDefaults(s){
  if (!s.goals) s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
  if (!s.cut) s.cut = { maintenance: 3000, budgetStart: 0, budgetLeft: 0, committedDays: {} };
  if (!s.templates) s.templates = [];
  if (!s.lastDate) s.lastDate = todayISO();
  if (!s.recents) s.recents = [];
  if (!s.settings) s.settings = { mode: "cut" };
  return s;
}
 

function setText(id, txt){ const el=$(id); if(el) el.textContent=String(txt); }

function refreshQuickTemplateSelect(){
  const s = initDefaults(loadState());
  const sel = $("tplSelectQuick");
  if(!sel) return;
 
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "— wählen —";
  sel.appendChild(o0);
 
  (s.templates||[]).forEach(t=>{
    const o=document.createElement("option");
    o.value=t.id;
    o.textContent=t.name;
    sel.appendChild(o);
  });
}
 
function refreshRecentSelect(){
  const s = initDefaults(loadState());
  const sel = $("recentSelect");
  if(!sel) return;
 
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "— wählen —";
  sel.appendChild(o0);
 
  (s.recents||[]).forEach(r=>{
    const o=document.createElement("option");
    o.value=r.id;
    o.textContent=r.name;
    sel.appendChild(o);
  });
}

function applyRecentToCreate(recentId){
  const s = initDefaults(loadState());
  const r = (s.recents||[]).find(x=>x.id===recentId);
  if(!r) return;
 
  $("name").value = r.name || "";
  const g=(Number.isFinite(+r.grams) && +r.grams > 0)? +r.grams:100;
  $("grams").value = g;
 
  // wenn per100 vorhanden -> Base setzen und skalieren
  if(r.p100!=null || r.c100!=null || r.f100!=null){
    setPer100Base(r.p100||0, r.c100||0, r.f100||0, r.kcal100||null);
    applyPer100ScalingIfPresent();
  }else{
    clearPer100Base();
    $("p").value = r.p || 0;
    $("c").value = r.c || 0;
    $("f").value = r.f || 0;
    $("manualKcal").checked = false;
    updateKcalFromMacros();
  }
}
 
 

function num(id){
  const el=$(id);
  if(!el) return 0;
  const v=String(el.value??"").trim().replace(",",".");
  const n=parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function ensureDateFilled(){
  const d=$("date");
  if(d && !d.value) d.value=todayISO();
  return d?.value || todayISO();
}

function calcKcalFromMacros(p,c,f){
  return p*KCAL_PER_G_PROTEIN + c*KCAL_PER_G_CARBS + f*KCAL_PER_G_FAT;
}

function sumEntries(entries){
  return (entries||[]).reduce((acc,e)=>{
    acc.kcal += (e.kcal||0);
    acc.p += (e.p||0);
    acc.c += (e.c||0);
    acc.f += (e.f||0);
    return acc;
  },{kcal:0,p:0,c:0,f:0});
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function normalizeOFF(n){ return Number.isFinite(n) ? n : 0; }

// ---------------- modal + drawer ----------------
function openDrawer(){
  const overlay = $("overlay");
  const drawer  = $("drawer");
  if(!overlay || !drawer) return;
 
  overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden","false");
 
  const s = initDefaults(loadState());
  const mode = s.settings?.mode || "cut";
 
  // Switch setzen
  const t = $("modeToggle");
  if (t) t.checked = (mode === "bulk");
 
  // Label setzen (optional, aber nice)
  const lbl = $("modeLabel");
  if (lbl) lbl.textContent = "Aktiv: " + (mode === "bulk" ? "Bulk" : "Cut");
}
 
function closeDrawer(){
  const overlay=$("overlay"), drawer=$("drawer"), modal=$("modal");
  if(!overlay || !drawer || !modal) return;
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden","true");
  const modalOpen=!modal.classList.contains("hidden");
  if(!modalOpen) overlay.classList.add("hidden");
}

function closeModal(){
  const overlay=$("overlay"), modal=$("modal"), drawer=$("drawer");
  if(!overlay || !modal || !drawer) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  const drawerOpen=!drawer.classList.contains("hidden");
  if(!drawerOpen) overlay.classList.add("hidden");
}

function prefillGoalsModal(){
  const s = initDefaults(loadState());
  $("goalKcal").value = s.goals.kcal ?? 0;
  $("goalP").value = s.goals.p ?? 0;
  $("goalC").value = s.goals.c ?? 0;
  $("goalF").value = s.goals.f ?? 0;
  updateGoalsKcalFromMacros();
}
function updateGoalsKcalFromMacros(){
  const p = parseFloat(($("goalP")?.value || "0").replace(",", ".")) || 0;
  const c = parseFloat(($("goalC")?.value || "0").replace(",", ".")) || 0;
  const f = parseFloat(($("goalF")?.value || "0").replace(",", ".")) || 0;
  const kcal = Math.round(calcKcalFromMacros(p, c, f));
  if ($("goalsKcalFromMacros")) $("goalsKcalFromMacros").textContent = String(kcal);
  if($("goalKcal")) $("goalKcal").value = String(kcal);
}
 
function prefillCutModal(){
  const s = initDefaults(loadState());
  $("cutMaint").value = s.cut.maintenance ?? 0;
  $("cutBudgetStart").value = s.cut.budgetStart ?? 0;
}

function refreshTemplatePick(){
  const s = initDefaults(loadState());
  const sel = $("tplPick");
  if(!sel) return;

  const tpls = s.templates || [];
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— auswählen —";
  sel.appendChild(opt0);

  tpls.forEach(t=>{
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  });
}
function prefillTemplatesModal(){
  refreshTemplatePick();
  $("tplEditName").value = "";
  $("tplEditBaseG").value = 100;
  $("tplEditP").value = "";
  $("tplEditC").value = "";
  $("tplEditF").value = "";
}
function loadTemplateToEditor(tplId){
  const s = initDefaults(loadState());
  const t = (s.templates||[]).find(x=>x.id===tplId);
  if(!t) return;

  $("tplEditName").value = t.name || "";
  $("tplEditBaseG").value = t.baseG ?? 100;
  $("tplEditP").value = t.p100 ?? 0;
  $("tplEditC").value = t.c100 ?? 0;
  $("tplEditF").value = t.f100 ?? 0;
}

function openModal(which){
  const overlay=$("overlay"), modal=$("modal"), title=$("modalTitle");
  if(!overlay || !modal || !title) return;

  const allViews = ["viewSearch","viewCreate","viewScan","viewGoals","viewCut","viewTemplates"];
  allViews.forEach(id => $(id)?.classList.add("hidden"));

  const map = {
    scan: { title: "Scannen", view: "viewScan" },
    search: { title: "Lebensmittel suchen", view: "viewSearch" },
    create: { title: "Neues erstellen", view: "viewCreate" },
    goals: { title: "Tagesziele", view: "viewGoals" },
    cut: { title: "Cut-Countdown", view: "viewCut" },
    templates: { title: "Templates", view: "viewTemplates" },
  };

  const cfg = map[which] || map.create;
  title.textContent = cfg.title;
  $(cfg.view)?.classList.remove("hidden");

  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");

  if(which === "goals") prefillGoalsModal();
  if(which === "cut") prefillCutModal();
  if(which === "templates") prefillTemplatesModal();
  if(which === "create"){
    refreshQuickTemplateSelect();
    refreshRecentSelect();
  }
}

// ---------------- install FAB ----------------
function isStandalone(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function showInstallToast(msg){
  let t = $("installToast");
  if(!t){
    t = document.createElement("div");
    t.id = "installToast";
    t.className = "installToast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.add("hidden"), 3500);
}

function wireInstallFab(){
  const fab=$("installFab");
  if(!fab) return;

  if(isStandalone()){
    fab.classList.add("hidden");
    return;
  }
  fab.classList.remove("hidden");

  window.addEventListener("beforeinstallprompt",(e)=>{
    e.preventDefault();
    deferredInstallPrompt=e;
    fab.classList.remove("hidden");
  });

  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    fab.classList.add("hidden");
  });

  fab.addEventListener("click", async ()=>{
    if(deferredInstallPrompt){
      try{
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
      }catch(_){}
      deferredInstallPrompt=null;
      return;
    }
    showInstallToast("Installation über Chrome-Menü: ⋮ → „App installieren“");
  });
}

// ---------------- per-100g scaling ----------------
function setPer100Base(p100,c100,f100,kcal100=null){
  const gramsEl=$("grams");
  if(!gramsEl) return;
  gramsEl.dataset.per100="1";
  gramsEl.dataset.p100=String(p100??0);
  gramsEl.dataset.c100=String(c100??0);
  gramsEl.dataset.f100=String(f100??0);
  gramsEl.dataset.kcal100=String(kcal100??"");
}
function clearPer100Base(){
  const gramsEl=$("grams");
  if(!gramsEl) return;
  delete gramsEl.dataset.per100;
  delete gramsEl.dataset.p100;
  delete gramsEl.dataset.c100;
  delete gramsEl.dataset.f100;
  delete gramsEl.dataset.kcal100;
}
function updateKcalFromMacros(){
  if ($("manualKcal")?.checked) return;
  const kcal = calcKcalFromMacros(num("p"), num("c"), num("f"));
  if($("kcal")) $("kcal").value = String(Math.round(kcal));
}
function applyPer100ScalingIfPresent(){
  const gramsEl=$("grams");
  if(!gramsEl || gramsEl.dataset.per100!=="1") return;
  const g=num("grams");
  if(!(g>0)) return;

  const p100=parseFloat(gramsEl.dataset.p100||"0")||0;
  const c100=parseFloat(gramsEl.dataset.c100||"0")||0;
  const f100=parseFloat(gramsEl.dataset.f100||"0")||0;
  const factor=g/100;

  $("p").value=round1(p100*factor);
  $("c").value=round1(c100*factor);
  $("f").value=round1(f100*factor);

  $("manualKcal").checked=false;
  updateKcalFromMacros();
}

// ---------------- OpenFoodFacts search ----------------
// ---------------- OpenFoodFacts search (DE, robust) ----------------
async function offSearch(q){
  const status = $("offStatus"), box = $("offResults");
  if(!status || !box) return;
 
  const term = String(q || "").trim();
  if(!term){
    status.textContent = "Bitte Suchbegriff eingeben.";
    box.innerHTML = "";
    return;
  }
 
  status.textContent = "Suche…";
  box.innerHTML = "";
 
  // Classic OFF search endpoint (supports search_terms properly)
  // Using DE settings + nocache to avoid stale cached results
  const url =
    "https://de.openfoodfacts.org/cgi/search.pl"
    + `?search_terms=${encodeURIComponent(term)}`
    + `&search_simple=1`
    + `&action=process`
    + `&json=1`
    + `&page_size=20`
    + `&page=1`
    + `&lc=de&cc=de`
    + `&nocache=1`
    + `&fields=product_name,brands,nutriments`;
 
  const r = await fetch(url);
  if(!r.ok) throw new Error(`OFF Fehler (${r.status})`);
  const j = await r.json();
 
  const products = (j.products || []).filter(p => p && p.nutriments);
  if(!products.length){
    status.textContent = `Keine Treffer für „${term}“.`;
    return;
  }
 
  status.textContent = `${products.length} Treffer für „${term}“`;
  box.innerHTML = products.map(p=>{
    const name = (p.product_name || "Unbenannt").trim();
    const brand = (p.brands || "").trim();
    const n = p.nutriments || {};
 
    const p100 = normalizeOFF(parseFloat(n.proteins_100g));
    const c100 = normalizeOFF(parseFloat(n.carbohydrates_100g));
    const f100 = normalizeOFF(parseFloat(n.fat_100g));
    const kcal100 =
      normalizeOFF(parseFloat(n["energy-kcal_100g"])) ||
      (normalizeOFF(parseFloat(n.energy_100g)) ? normalizeOFF(parseFloat(n.energy_100g))/4.184 : 0);
 
    const kcalShow = kcal100
      ? Math.round(kcal100)
      : Math.round(calcKcalFromMacros(p100, c100, f100));
 
    return `
      <div class="item">
        <div class="item-main">
          <div class="item-name">${escapeHtml(name)}${brand ? ` <span class="muted small">(${escapeHtml(brand)})</span>` : ""}</div>
          <div class="muted small">pro 100g: ${kcalShow} kcal · P ${round1(p100)} · C ${round1(c100)} · F ${round1(f100)}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost" data-use="1">Übernehmen</button>
        </div>
      </div>`;
  }).join("");
 
  [...box.querySelectorAll('[data-use="1"]')].forEach((btn, idx)=>{
    btn.addEventListener("click", ()=>{
      const p = products[idx], n = p.nutriments || {};
      const name = (p.product_name || "Unbenannt").trim();
 
      const p100 = normalizeOFF(parseFloat(n.proteins_100g));
      const c100 = normalizeOFF(parseFloat(n.carbohydrates_100g));
      const f100 = normalizeOFF(parseFloat(n.fat_100g));
      const kcal100 =
        normalizeOFF(parseFloat(n["energy-kcal_100g"])) ||
        (normalizeOFF(parseFloat(n.energy_100g)) ? normalizeOFF(parseFloat(n.energy_100g))/4.184 : 0);
 
      $("name").value = name;
      $("grams").value = 100;
      setPer100Base(p100, c100, f100, kcal100);
      applyPer100ScalingIfPresent();
      openModal("create");
    });
  });
}
 //---------------------------------------------------------------------------------------------------------------
 

async function fetchOFFByBarcode(code){
  const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,nutriments,brands`;
  const r=await fetch(url);
  if(!r.ok) throw new Error(`OFF Fehler (${r.status})`);
  const j=await r.json();
  const p=j.product;
  if(!p || !p.nutriments) throw new Error("Produkt nicht gefunden.");

  const name=(p.product_name||"Unbenannt").trim();
  const n=p.nutriments||{};
  const p100=normalizeOFF(parseFloat(n.proteins_100g));
  const c100=normalizeOFF(parseFloat(n.carbohydrates_100g));
  const f100=normalizeOFF(parseFloat(n.fat_100g));
  const kcal100=normalizeOFF(parseFloat(n["energy-kcal_100g"])) || normalizeOFF(parseFloat(n.energy_100g)/4.184);

  return {name,p100,c100,f100,kcal100};
}

// ---------------- Barcode scan ----------------
async function startBarcodeScan(){
  const status=$("scanStatus"), wrap=$("scannerWrap"), video=$("scanVideo");
  if(!status || !wrap || !video) return;

  if(!("BarcodeDetector" in window)){
    status.textContent="BarcodeDetector nicht verfügbar (Android Chrome sollte es haben).";
    return;
  }
  const detector=new BarcodeDetector({ formats:["ean_13","ean_8","upc_a","upc_e","code_128"] });

  try{
    scanStream=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
    video.srcObject=scanStream;
    await video.play();
    wrap.classList.remove("hidden");
    scanRunning=true;
    status.textContent="Scanner läuft…";

    const tick=async ()=>{
      if(!scanRunning) return;
      try{
        const codes=await detector.detect(video);
        if(codes && codes.length){
          const code=codes[0].rawValue;
          status.textContent=`Gefunden: ${code}`;
          stopBarcodeScan();

          const off=await fetchOFFByBarcode(code);
          $("name").value=off.name;
          $("grams").value=100;
          setPer100Base(off.p100,off.c100,off.f100,off.kcal100);
          applyPer100ScalingIfPresent();
          openModal("create");
          return;
        }
      }catch(e){
        status.textContent="Scan-Fehler: "+(e?.message||e);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }catch(e){
    status.textContent="Kamera nicht verfügbar: "+(e?.message||e);
  }
}

function stopBarcodeScan(){
  scanRunning=false;
  const wrap=$("scannerWrap"), video=$("scanVideo");
  if(video) video.pause();
  if(scanStream){
    scanStream.getTracks().forEach(t=>t.stop());
    scanStream=null;
  }
  wrap?.classList.add("hidden");
}

// ---------------- Cut commit ----------------
function commitDeficitForCurrentDay(){
  const s = initDefaults(loadState());
  const date = ensureDateFilled();
 
  if (!s.cut.committedDays) s.cut.committedDays = {};
  if (s.cut.committedDays[date]) {
    alert("Heute bereits verbucht.");
    return;
  }
 
  const entries = s[dayKey(date)] || [];
  const sums = sumEntries(entries);
 
  const maintenance = Math.round(s.cut.maintenance || 0);
  const eaten = Math.round(sums.kcal || 0);
 
  const mode = s.settings?.mode || "cut";
 
  let amount = 0;
  if (mode === "bulk") {
    // Überschuss: gegessen - maintenance
    amount = Math.max(0, eaten - maintenance);
  } else {
    // Defizit: maintenance - gegessen
    amount = Math.max(0, maintenance - eaten);
  }
 
  s.cut.budgetLeft = Math.max(0, Math.round((s.cut.budgetLeft || 0) - amount));
  s.cut.committedDays[date] = true;
 
  saveState(s);
  render();
 
  alert(`Verbucht (${mode.toUpperCase()}): ${amount} kcal`);
}
 

// ---------------- Templates apply ----------------
function applyTemplateToCreate(tplId){
  const s = initDefaults(loadState());
  const t = (s.templates||[]).find(x=>x.id===tplId);
  if(!t) return;

  openModal("create");
  $("name").value = t.name || "";
  $("grams").value = 100;

  setPer100Base(t.p100||0, t.c100||0, t.f100||0, t.kcal100||null);
  applyPer100ScalingIfPresent();
}

// ---------------- render ----------------
function renderDayList(state,date){
  const list=$("dayList"), empty=$("emptyHint");
  if(!list || !empty) return;

  const entries=state[dayKey(date)] || [];
  if(!entries.length){
    list.innerHTML="";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML=entries.map(e=>{
    const line=`kcal ${Math.round(e.kcal||0)} · P ${round1(e.p||0)} · C ${round1(e.c||0)} · F ${round1(e.f||0)}`;
    return `
      <div class="item" data-id="${e.id}">
        <div class="item-main">
          <div class="item-name">${escapeHtml(e.name||"Eintrag")}</div>
          <div class="muted small">${(e.grams||0)} g · ${line}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost" data-edit="1">Bearbeiten</button>
          <button class="btn btn-danger" data-del="1">Löschen</button>
        </div>
      </div>`;
  }).join("");

  [...list.querySelectorAll(".item")].forEach(row=>{
    const id=row.getAttribute("data-id");

    row.querySelector('[data-del="1"]')?.addEventListener("click",()=>{
      if(!confirm("Eintrag löschen?")) return;
      state[dayKey(date)]=(state[dayKey(date)]||[]).filter(x=>x.id!==id);
      saveState(state);
      render();
    });

    row.querySelector('[data-edit="1"]')?.addEventListener("click",()=>{
      const entries=state[dayKey(date)]||[];
      const entry=entries.find(x=>x.id===id);
      if(!entry) return;
      editingId=id;

      $("name").value=entry.name||"";
      $("grams").value=entry.grams||0;

      clearPer100Base();
      $("p").value=entry.p??0;
      $("c").value=entry.c??0;
      $("f").value=entry.f??0;

      $("manualKcal").checked=!!entry.manualKcal;
      $("kcal").value=entry.kcal ?? Math.round(calcKcalFromMacros(entry.p||0,entry.c||0,entry.f||0));

      openModal("create");
    });
  });
}

function render(){
  const state = initDefaults(loadState());
 
  if ($("date")) $("date").value = state.lastDate || todayISO();
  const date = ensureDateFilled();
 
  // --- goals ---
  setText("gKcal", state.goals.kcal);
  setText("gP", state.goals.p);
  setText("gC", state.goals.c);
  setText("gF", state.goals.f);
 
  // --- sums ---
  const entries = state[dayKey(date)] || [];
  const sums = sumEntries(entries);
  setText("sumKcal", Math.round(sums.kcal));
  setText("sumP", Math.round(sums.p));
  setText("sumC", Math.round(sums.c));
  setText("sumF", Math.round(sums.f));
 
 
  // --- kcal progress bar (Bulk: grün NUR rechts vom Maintenance-Marker) ---
const goalKcal = Math.max(0, Math.round(state.goals.kcal || 0));
const pct = goalKcal > 0 ? clamp01(sums.kcal / goalKcal) : 0;
 
const kcalBarEl = $("kcalBar");
if (kcalBarEl) {
  kcalBarEl.style.width = `${Math.round(pct * 100)}%`;
 
  // Default: Brand-Türkis
  kcalBarEl.style.background =
    "linear-gradient(90deg, var(--accent), var(--accent2))";
 
  const mode = state.settings?.mode || "cut";
 
  if (mode === "bulk") {
    const maint = Math.max(0, Math.round(state.cut.maintenance || 0));
    const markerPct = goalKcal > 0 ? clamp01(maint / goalKcal) : 0;
 
    // Nur wenn über Maintenance gegessen wurde
    if (pct > markerPct && pct > 0) {
      // Aufteilung relativ zur gefüllten Breite
      const split = Math.round((markerPct / pct) * 100);
 
      kcalBarEl.style.background = `
      linear-gradient(90deg,
      var(--accent) 0%,
      var(--accent2) ${split}%,   
   
    /* Bulk-Überschuss */
    #22c55e ${split}%,
    #22c55e ${split + (100 - split) * 0.8}%,
    #f59e0b 100%)`
;
    }
  }
}
 
  // --- mode + maintenance (define ONCE) ---
  //const mode = state.settings?.mode || "cut"; // "cut" | "bulk"

    // ----------------------------
// Cut / Bulk Modal Texte
// ----------------------------
const cutModalTitle = $("cutModalTitle");
const cutBudgetLabel = $("cutBudgetLabel");
 
if (mode === "bulk") {
  if (cutModalTitle) cutModalTitle.textContent = "Bulk-Counter Einstellungen";
  if (cutBudgetLabel) cutBudgetLabel.textContent = "Überschuss-Budget Start (kcal)";
} else {
  if (cutModalTitle) cutModalTitle.textContent = "Cut-Countdown Einstellungen";
  if (cutBudgetLabel) cutBudgetLabel.textContent = "Defizit-Budget Start (kcal)";
}
  
  const maint = Math.max(0, Math.round(state.cut.maintenance || 0));
 
  // --- maintenance marker (ONLY in bulk mode) ---
  const marker = $("maintMarker");
  if (marker) {
    if (mode === "bulk" && goalKcal > 0) {
      const markerPct = clamp01(maint / goalKcal);
      marker.style.left = `${Math.round(markerPct * 100)}%`;
      marker.style.display = "block";
    } else {
      marker.style.display = "none";
    }
  }

  
 
  // --- cut/bulk progress ---
  setText("budgetLeft", Math.max(0, Math.round(state.cut.budgetLeft || 0)));
  const cutStart = Math.max(0, Math.round(state.cut.budgetStart || 0));
  const cutLeft  = Math.max(0, Math.round(state.cut.budgetLeft || 0));
  const cutPct = cutStart > 0 ? clamp01(1 - (cutLeft / cutStart)) : 0;
 
  if ($("cutBar")) $("cutBar").style.width = `${Math.round(cutPct * 100)}%`;
  setText("cutPercent", Math.round(cutPct * 100));
 
  // --- UI Texte anpassen ---
  const cutLabelEl = document.querySelector(".cut-label");
  if (cutLabelEl) cutLabelEl.textContent = (mode === "bulk") ? "BULK COUNTER" : "CUT COUNTDOWN";
 
  const commitBtn = $("commitDay");
  if (commitBtn) commitBtn.textContent = (mode === "bulk") ? "Überschuss verbuchen" : "Defizit verbuchen";
 
  if ($("budgetHint")) {
    $("budgetHint").textContent =
      (mode === "bulk")
        ? `Bulk-Modus: verbucht max(0, gegessen − Maintenance ${maint})`
        : `Cut-Modus: verbucht max(0, Maintenance ${maint} − gegessen)`;
  }
 
  // --- status line ---
  if ($("statusLine")) $("statusLine").textContent = `${entries.length} Einträge · ${Math.round(sums.kcal)} kcal`;
 
  // --- version display ---
  if ($("appVersion")) $("appVersion").textContent = "Version: 20260122-3";
 
  renderDayList(state, date);
}
 

// ---------------- wire ----------------
function wire(){
  // Helper: safe bind
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };
  const click = (id, fn) => on(id, "click", fn);

  // ----------------------------
  // Bottom nav -> open modals
  // ----------------------------
  document.querySelectorAll(".navbtn").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const which = btn.dataset.modal;     // IMPORTANT: data-modal
      if (which) openModal(which);
    });
  });

  // ----------------------------
  // Modal / Drawer close
  // ----------------------------
  click("modalClose", closeModal);

  click("burger", openDrawer);
  click("drawerClose", closeDrawer);

  // Overlay click closes whichever is open
  on("overlay","click", ()=>{
    const modal = document.getElementById("modal");
    const drawer = document.getElementById("drawer");
    if (modal && !modal.classList.contains("hidden")) closeModal();
    if (drawer && !drawer.classList.contains("hidden")) closeDrawer();
  });

  // ESC closes
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      const modal = document.getElementById("modal");
      const drawer = document.getElementById("drawer");
      if (modal && !modal.classList.contains("hidden")) closeModal();
      if (drawer && !drawer.classList.contains("hidden")) closeDrawer();
    }
  });

  // ----------------------------
  // Date change
  // ----------------------------
  on("date","change",(e)=>{
    const s=initDefaults(loadState());
    s.lastDate = e.target.value || todayISO();
    saveState(s);
    editingId=null;
    render();
  });

  // ----------------------------
  // Create form: macros -> kcal auto
  // WICHTIG: wenn User Makros tippt => per100-Automatik deaktivieren
  // ----------------------------
  ["p","c","f"].forEach((id)=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener("input", ()=>{
      clearPer100Base();
      updateKcalFromMacros();
    });
    el.addEventListener("change", ()=>{
      clearPer100Base();
      updateKcalFromMacros();
    });
  });
  on("manualKcal","change", ()=> updateKcalFromMacros());

  // grams scaling (only if per100 base active)
  on("grams","input", ()=> applyPer100ScalingIfPresent());

  // ----------------------------
  // Template Dropdown -> SOFORT übernehmen
  // (Buttons nicht mehr nötig)
  // ----------------------------
  on("tplSelectQuick","change", ()=>{
    const id = document.getElementById("tplSelectQuick")?.value;
    if(!id) return;

    const s=initDefaults(loadState());
    const tpl = (s.templates||[]).find(x=>x.id===id);
    if(!tpl) return;

    // Template anwenden => per100 aktiv setzen, damit Gramm-Skalierung klappt
    // (tpl ist pro 100g)
    document.getElementById("name").value = tpl.name || "";
    document.getElementById("grams").value = Number(document.getElementById("grams").value) > 0
      ? document.getElementById("grams").value
      : 100;

    setPer100Base(tpl.p100||0, tpl.c100||0, tpl.f100||0, tpl.kcal100||null);
    applyPer100ScalingIfPresent();
    updateKcalFromMacros();
  });

  // ----------------------------
  // Recents Dropdown -> SOFORT übernehmen (inkl. Nährwerte)
  // ----------------------------
  on("recentSelect","change", ()=>{
    const id = document.getElementById("recentSelect")?.value;
    if(!id) return;

    const s=initDefaults(loadState());
    const r = (s.recents||[]).find(x=>x.id===id);
    if(!r) return;

    document.getElementById("name").value = r.name || "";
    document.getElementById("grams").value = (Number.isFinite(+r.grams) && +r.grams > 0) ? +r.grams : 100;

    // wenn per100 vorhanden -> Base setzen und skalieren
    if(r.p100!=null || r.c100!=null || r.f100!=null){
      setPer100Base(r.p100||0, r.c100||0, r.f100||0, r.kcal100||null);
      applyPer100ScalingIfPresent();
    }else{
      clearPer100Base();
      document.getElementById("p").value = r.p ?? 0;
      document.getElementById("c").value = r.c ?? 0;
      document.getElementById("f").value = r.f ?? 0;
      document.getElementById("manualKcal").checked = false;
      updateKcalFromMacros();
    }
  });

  // ----------------------------
  // Add / Save entry
  // ----------------------------
  click("add", ()=>{
    const s=initDefaults(loadState());
    const date=ensureDateFilled();
    const key=dayKey(date);
    if(!s[key]) s[key]=[];

    const name=(document.getElementById("name")?.value||"").trim() || "Eintrag";
    const grams=num("grams");
    const p=num("p"), c=num("c"), f=num("f");

    const manual=document.getElementById("manualKcal")?.checked;
    const kcal = manual ? num("kcal") : calcKcalFromMacros(p,c,f);

    // Save/update entry
    if(editingId){
      const idx=(s[key]||[]).findIndex(x=>x.id===editingId);
      if(idx>=0){
        s[key][idx] = { ...s[key][idx], name, grams, p, c, f, kcal: Math.round(kcal), manualKcal: !!manual };
      }
      editingId=null;
    }else{
      s[key].push({ id: uid(), name, grams, p, c, f, kcal: Math.round(kcal), manualKcal: !!manual });
    }

    // Recents (Top 12) speichern
    const isPer100 = document.getElementById("grams")?.dataset.per100 === "1";
    const recentObj = {
      id: uid(),
      name,
      grams,
      p, c, f,
      kcal: Math.round(kcal),
      p100: isPer100 ? (parseFloat(document.getElementById("grams").dataset.p100||"0")||0) : null,
      c100: isPer100 ? (parseFloat(document.getElementById("grams").dataset.c100||"0")||0) : null,
      f100: isPer100 ? (parseFloat(document.getElementById("grams").dataset.f100||"0")||0) : null,
      kcal100: isPer100 ? (parseFloat(document.getElementById("grams").dataset.kcal100||"")||null) : null
    };

    s.recents = (s.recents || []).filter(x => x.name !== name);
    s.recents.unshift(recentObj);
    s.recents = s.recents.slice(0, 12);

    saveState(s);

    clearPer100Base();
    closeModal();
    render();
  });

  // ----------------------------
  // OFF search
  // ----------------------------
  click("offSearchBtn", async ()=>{
    const q=(document.getElementById("offQuery")?.value||"").trim();
    if(!q) return;
    try{ await offSearch(q); }
    catch(e){
      const st=document.getElementById("offStatus");
      if(st) st.textContent="Fehler: "+(e?.message||e);
    }
  });

  on("offQuery","keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); document.getElementById("offSearchBtn")?.click(); }
  });

  // ----------------------------
  // Barcode scan
  // ----------------------------
  click("scanBtn", startBarcodeScan);
  click("scanStop", stopBarcodeScan);

  // ----------------------------
  // Cut commit
  // ----------------------------
  click("commitDay", commitDeficitForCurrentDay);
  click("drawerCommit", ()=>{
    closeDrawer();
    commitDeficitForCurrentDay();
  });

  // ----------------------------
  // Drawer -> open modals
  // ----------------------------
  click("openGoals", ()=>{ closeDrawer(); openModal("goals"); });
  click("openCut", ()=>{ closeDrawer(); openModal("cut"); });
  click("openTemplates", ()=>{ closeDrawer(); openModal("templates"); });

 
 // Mode toggle (Cut/Bulk) — Switch
  on("modeToggle", "change", (e)=>{
    const s = initDefaults(loadState());
    s.settings = s.settings || {};  
    s.settings.mode = e.target.checked ? "bulk" : "cut";
    saveState(s);
    const lbl = document.getElementById("modeLabel");
    if (lbl) lbl.textContent = "Aktiv: " + (s.settings.mode === "bulk" ? "Bulk" : "Cut");
    render();
  });
 
 

  // Drawer reset buttons
  click("resetGoals", ()=>{
    const s=initDefaults(loadState());
    if(!confirm("Tagesziele auf Default zurücksetzen?")) return;
    s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
    saveState(s);
    closeDrawer();
    render();
  });

  click("resetCut", ()=>{
    if(!confirm("Cut-Countdown komplett resetten?")) return;
    const s=initDefaults(loadState());
    s.cut.budgetStart = 0;
    s.cut.budgetLeft = 0;
    s.cut.committedDays = {};
    saveState(s);
    closeDrawer();
    render();
  });

  // ----------------------------
  // GOALS modal: live kcal from macro
  // ----------------------------
  ["goalP","goalC","goalF"].forEach(id=>{
    on(id,"input", updateGoalsKcalFromMacros);
  });

  click("goalsResetBtn", ()=>{
    const s=initDefaults(loadState());
    s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
    saveState(s);
    prefillGoalsModal();
    render();
  });

  click("goalsSaveBtn", ()=>{
    const s=initDefaults(loadState());

    s.goals.p = Math.max(0, parseFloat(String(document.getElementById("goalP")?.value||"0").replace(",", ".")) || 0);
    s.goals.c = Math.max(0, parseFloat(String(document.getElementById("goalC")?.value||"0").replace(",", ".")) || 0);
    s.goals.f = Math.max(0, parseFloat(String(document.getElementById("goalF")?.value||"0").replace(",", ".")) || 0);

    // kcal wird read-only aus Makros berechnet
    s.goals.kcal = Math.round(calcKcalFromMacros(s.goals.p, s.goals.c, s.goals.f));

    saveState(s);
    closeModal();
    render();
  });

  // ----------------------------
  // CUT modal
  // ----------------------------
  click("cutSaveBtn", ()=>{
    const s=initDefaults(loadState());
    s.cut.maintenance = Math.max(0, parseInt(document.getElementById("cutMaint")?.value || "0", 10) || 0);
    s.cut.budgetStart = Math.max(0, parseInt(document.getElementById("cutBudgetStart")?.value || "0", 10) || 0);
    s.cut.budgetLeft = s.cut.budgetStart;
    s.cut.committedDays = {};
    saveState(s);
    closeModal();
    render();
  });

  click("cutResetBtn", ()=>{
    if(!confirm("Cut-Countdown komplett resetten?")) return;
    const s=initDefaults(loadState());
    s.cut.budgetStart = 0;
    s.cut.budgetLeft = 0;
    s.cut.committedDays = {};
    saveState(s);
    prefillCutModal();
    render();
  });

  // ----------------------------
  // Templates modal
  // ----------------------------
  on("tplPick","change", (e)=> loadTemplateToEditor(e.target.value));

  click("tplUseCurrentBtn", ()=>{
    const g = num("grams") || 100;
    const p = num("p"), c = num("c"), f = num("f");
    const factor = g > 0 ? (100 / g) : 1;

    document.getElementById("tplEditBaseG").value = 100;
    document.getElementById("tplEditP").value = round1(p * factor);
    document.getElementById("tplEditC").value = round1(c * factor);
    document.getElementById("tplEditF").value = round1(f * factor);

    if(!(document.getElementById("tplEditName")?.value||"").trim()){
      document.getElementById("tplEditName").value = (document.getElementById("name")?.value || "").trim();
    }
  });

  click("tplSaveBtn2", ()=>{
    const s=initDefaults(loadState());
    if(!s.templates) s.templates=[];

    const currentId = document.getElementById("tplPick")?.value;
    const id = currentId || uid();

    const name = (document.getElementById("tplEditName")?.value || "").trim();
    if(!name){ alert("Bitte Template-Namen eingeben."); return; }

    const baseG = Math.max(1, parseInt(document.getElementById("tplEditBaseG")?.value || "100", 10) || 100);
    const p100 = Math.max(0, parseFloat(String(document.getElementById("tplEditP")?.value||"0").replace(",", ".")) || 0);
    const c100 = Math.max(0, parseFloat(String(document.getElementById("tplEditC")?.value||"0").replace(",", ".")) || 0);
    const f100 = Math.max(0, parseFloat(String(document.getElementById("tplEditF")?.value||"0").replace(",", ".")) || 0);
    const kcal100 = Math.round(calcKcalFromMacros(p100,c100,f100));

    const obj = { id, name, baseG, p100, c100, f100, kcal100 };

    const idx = s.templates.findIndex(x=>x.id===id);
    if(idx>=0) s.templates[idx]=obj;
    else s.templates.push(obj);

    saveState(s);
    refreshTemplatePick();
    document.getElementById("tplPick").value = id;
    alert("Template gespeichert.");
  });

  click("tplDeleteBtn2", ()=>{
    const id = document.getElementById("tplPick")?.value;
    if(!id){ alert("Kein Template gewählt."); return; }
    if(!confirm("Template löschen?")) return;

    const s=initDefaults(loadState());
    s.templates = (s.templates||[]).filter(x=>x.id!==id);
    saveState(s);
    prefillTemplatesModal();
    alert("Gelöscht.");
  });

  click("tplApplyToCreateBtn", ()=>{
    const id = document.getElementById("tplPick")?.value;
    if(!id){ alert("Bitte Template auswählen."); return; }
    applyTemplateToCreate(id);
  });

  // ----------------------------
  // Export / Import / Wipe / Force Update
  // ----------------------------
  click("exportData", ()=>{
    const s=initDefaults(loadState());
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ricos-mealtracker-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  on("importFile","change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const txt = await file.text();
      const obj = JSON.parse(txt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      alert("Import erfolgreich.");
      closeDrawer();
      render();
    }catch(err){
      alert("Import fehlgeschlagen: " + (err?.message || err));
    }finally{
      e.target.value="";
    }
  });

  click("wipeAll", ()=>{
    if(!confirm("Wirklich ALLES löschen?")) return;
    localStorage.removeItem(STORAGE_KEY);
    closeDrawer();
    render();
  });

  click("forceUpdate", async ()=>{
    try{
      if("serviceWorker" in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
    }catch(_){}
    alert("Update erzwungen. Seite lädt neu…");
    location.reload();
  });

  // Initial values
  updateKcalFromMacros();
}
 

// ---------------- boot ----------------
document.addEventListener("DOMContentLoaded", ()=>{
  const s = initDefaults(loadState());
  saveState(s);

  if($("date")) $("date").value = s.lastDate || todayISO();

  wire();
  wireInstallFab();
  render();
});
























