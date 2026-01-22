// Rico’s Mealtracker — app.js (stable boot + modal + drawer + install FAB)
// IMPORTANT: boots on DOMContentLoaded and fails gracefully if elements are missing.

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

const STORAGE_KEY = "ricos_mealtracker_main_v3";

let editingId = null;
let scanStream = null;
let scanRunning = false;

// Install prompt (Chrome heuristic may suppress event)
let deferredInstallPrompt = null;

// ---------- tiny visible "JS running" badge ----------
function showJsBadge() {
  try {
    const b = document.createElement("div");
    b.textContent = "JS OK ✅";
    b.style.cssText =
      "position:fixed;left:10px;top:70px;z-index:99999;background:rgba(34,211,238,.18);border:1px solid rgba(34,211,238,.35);color:#e9eef6;padding:6px 10px;border-radius:10px;font:12px ui-monospace,monospace";
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2500);
  } catch (_) {}
}

function $(id){ return document.getElementById(id); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function dayKey(d){ return `day_${d}`; }

function loadState(){ return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

function initDefaults(s){
  if (!s.goals) s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
  if (!s.cut) s.cut = { maintenance: 3000, budgetStart: 0, budgetLeft: 0, committedDays: {} };
  if (!s.templates) s.templates = [];
  if (!s.lastDate) s.lastDate = todayISO();
  return s;
}

function setText(id, txt){ const el=$(id); if(el) el.textContent=String(txt); }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function round1(x){ return Math.round((x + Number.EPSILON) * 10) / 10; }
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

// ---------- modal + drawer ----------
function openModal(which){
  const overlay=$("overlay"), modal=$("modal"), title=$("modalTitle");
  if(!overlay || !modal || !title) return;

  ["viewSearch","viewCreate","viewScan"].forEach(id => $(id)?.classList.add("hidden"));

  if(which==="scan") title.textContent="Scannen";
  if(which==="search") title.textContent="Lebensmittel suchen";
  if(which==="create") title.textContent="Neues erstellen";

  const target = which==="scan" ? "viewScan" : which==="search" ? "viewSearch" : "viewCreate";
  $(target)?.classList.remove("hidden");

  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
}
function closeModal(){
  const overlay=$("overlay"), modal=$("modal"), drawer=$("drawer");
  if(!overlay || !modal || !drawer) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  const drawerOpen=!drawer.classList.contains("hidden");
  if(!drawerOpen) overlay.classList.add("hidden");
}
function openDrawer(){
  const overlay=$("overlay"), drawer=$("drawer");
  if(!overlay || !drawer) return;
  overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden","false");
}
function closeDrawer(){
  const overlay=$("overlay"), drawer=$("drawer"), modal=$("modal");
  if(!overlay || !drawer || !modal) return;
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden","true");
  const modalOpen=!modal.classList.contains("hidden");
  if(!modalOpen) overlay.classList.add("hidden");
}

// ---------- install FAB (robust fallback) ----------
function isStandalone(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function showInstallToast(msg){
  let t=$("installToast");
  if(!t){
    t=document.createElement("div");
    t.id="installToast";
    t.className="installToast";
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.add("hidden"), 3500);
}
function wireInstallFab(){
  const fab=$("installFab");
  if(!fab) return;

  if(isStandalone()){
    fab.classList.add("hidden");
    return;
  }
  // Always show (fallback if event suppressed)
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

// ---------- per-100g scaling ----------
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
  const manual=$("manualKcal")?.checked;
  if(manual) return;
  const kcal=calcKcalFromMacros(num("p"),num("c"),num("f"));
  const el=$("kcal");
  if(el) el.value=String(Math.round(kcal));
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

// ---------- OFF search + barcode ----------
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function normalizeOFF(n){ return Number.isFinite(n) ? n : 0; }

async function offSearch(q){
  const status=$("offStatus"), box=$("offResults");
  if(!status || !box) return;

  status.textContent="Suche…";
  box.innerHTML="";

  const url="https://world.openfoodfacts.org/cgi/search.pl"
    +`?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=product_name,nutriments,brands`;

  const r=await fetch(url);
  if(!r.ok) throw new Error(`OFF Fehler (${r.status})`);
  const j=await r.json();

  const products=(j.products||[]).filter(p=>p && p.nutriments);
  if(!products.length){ status.textContent="Keine Treffer."; return; }

  status.textContent=`${products.length} Treffer`;
  box.innerHTML=products.map(p=>{
    const name=(p.product_name||"Unbenannt").trim();
    const brand=(p.brands||"").trim();
    const n=p.nutriments||{};
    const p100=normalizeOFF(parseFloat(n.proteins_100g));
    const c100=normalizeOFF(parseFloat(n.carbohydrates_100g));
    const f100=normalizeOFF(parseFloat(n.fat_100g));
    const kcal100=normalizeOFF(parseFloat(n["energy-kcal_100g"])) || normalizeOFF(parseFloat(n.energy_100g)/4.184);
    const kcalShow = kcal100 ? Math.round(kcal100) : Math.round(calcKcalFromMacros(p100,c100,f100));

    return `
      <div class="item">
        <div class="item-main">
          <div class="item-name">${escapeHtml(name)}${brand?` <span class="muted small">(${escapeHtml(brand)})</span>`:""}</div>
          <div class="muted small">pro 100g: ${kcalShow} kcal · P ${round1(p100)} · C ${round1(c100)} · F ${round1(f100)}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost" data-use="1">Übernehmen</button>
        </div>
      </div>`;
  }).join("");

  [...box.querySelectorAll('[data-use="1"]')].forEach((btn,idx)=>{
    btn.addEventListener("click",()=>{
      const p=products[idx], n=p.nutriments||{};
      const name=(p.product_name||"Unbenannt").trim();
      const p100=normalizeOFF(parseFloat(n.proteins_100g));
      const c100=normalizeOFF(parseFloat(n.carbohydrates_100g));
      const f100=normalizeOFF(parseFloat(n.fat_100g));
      const kcal100=normalizeOFF(parseFloat(n["energy-kcal_100g"])) || normalizeOFF(parseFloat(n.energy_100g)/4.184);

      $("name").value=name;
      $("grams").value=100;
      setPer100Base(p100,c100,f100,kcal100);
      applyPer100ScalingIfPresent();
      openModal("create");
    });
  });
}

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

// Barcode scan
async function startBarcodeScan(){
  const status=$("scanStatus"), wrap=$("scannerWrap"), video=$("scanVideo");
  if(!status || !wrap || !video) return;

  if(!("BarcodeDetector" in window)){
    status.textContent="BarcodeDetector nicht verfügbar.";
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

// ---------- render ----------
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
  const state=initDefaults(loadState());

  if($("date")) $("date").value = state.lastDate || todayISO();
  const date=ensureDateFilled();

  // goals
  setText("gKcal", state.goals.kcal);
  setText("gP", state.goals.p);
  setText("gC", state.goals.c);
  setText("gF", state.goals.f);

  // sums
  const entries=state[dayKey(date)]||[];
  const sums=sumEntries(entries);
  setText("sumKcal", Math.round(sums.kcal));
  setText("sumP", Math.round(sums.p));
  setText("sumC", Math.round(sums.c));
  setText("sumF", Math.round(sums.f));

  // bars
  const pct = state.goals.kcal>0 ? clamp01(sums.kcal/state.goals.kcal) : 0;
  if($("kcalBar")) $("kcalBar").style.width = `${Math.round(pct*100)}%`;

  // cut
  setText("budgetLeft", Math.max(0, Math.round(state.cut.budgetLeft||0)));
  const cutPct = state.cut.budgetStart>0 ? clamp01(1-(state.cut.budgetLeft/state.cut.budgetStart)) : 0;
  if($("cutBar")) $("cutBar").style.width = `${Math.round(cutPct*100)}%`;
  setText("cutPercent", Math.round(cutPct*100));

  if($("statusLine")) $("statusLine").textContent = `${entries.length} Einträge · ${Math.round(sums.kcal)} kcal`;

  renderDayList(state,date);
}

// ---------- wire ----------
function wire() {
  // --- Bottom nav -> modals ---
  document.querySelectorAll(".navbtn").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.modal));
  });

  // --- Modal close ---
  $("modalClose")?.addEventListener("click", closeModal);

  // --- Drawer open/close ---
  $("burger")?.addEventListener("click", openDrawer);
  $("drawerClose")?.addEventListener("click", closeDrawer);

  // Overlay click closes whichever is open
  $("overlay")?.addEventListener("click", () => {
    if (!$("modal")?.classList.contains("hidden")) closeModal();
    if (!$("drawer")?.classList.contains("hidden")) closeDrawer();
  });

  // ESC closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("modal")?.classList.contains("hidden")) closeModal();
      if (!$("drawer")?.classList.contains("hidden")) closeDrawer();
    }
  });

  // --- Date change ---
  $("date")?.addEventListener("change", (e) => {
    const s = initDefaults(loadState());
    s.lastDate = e.target.value || todayISO();
    saveState(s);
    editingId = null;
    render();
  });

  // --- Macro inputs -> kcal auto ---
  ["p", "c", "f"].forEach((id) => {
    $(id)?.addEventListener("input", () => {
      clearPer100Base();
      updateKcalFromMacros();
    });
  });
  $("manualKcal")?.addEventListener("change", () => updateKcalFromMacros());

  // grams scaling for per100
  $("grams")?.addEventListener("input", () => applyPer100ScalingIfPresent());

  // --- Add / Save entry ---
  $("add")?.addEventListener("click", () => {
    const s = initDefaults(loadState());
    const date = ensureDateFilled();
    const key = dayKey(date);
    if (!s[key]) s[key] = [];

    const name = ($("name")?.value || "").trim() || "Eintrag";
    const grams = num("grams");
    const p = num("p"), c = num("c"), f = num("f");

    const manual = $("manualKcal")?.checked;
    const kcal = manual ? num("kcal") : calcKcalFromMacros(p, c, f);

    if (editingId) {
      const idx = s[key].findIndex((x) => x.id === editingId);
      if (idx >= 0) {
        s[key][idx] = {
          ...s[key][idx],
          name, grams, p, c, f,
          kcal: Math.round(kcal),
          manualKcal: !!manual
        };
      }
      editingId = null;
    } else {
      s[key].push({
        id: uid(),
        name, grams, p, c, f,
        kcal: Math.round(kcal),
        manualKcal: !!manual
      });
    }

    saveState(s);
    clearPer100Base();
    closeModal();
    render();
  });

  // --- OpenFoodFacts search ---
  $("offSearchBtn")?.addEventListener("click", async () => {
    const q = ($("offQuery")?.value || "").trim();
    if (!q) return;
    try {
      await offSearch(q);
    } catch (e) {
      if ($("offStatus")) $("offStatus").textContent = "Fehler: " + (e?.message || e);
    }
  });

  // --- Barcode scan ---
  $("scanBtn")?.addEventListener("click", startBarcodeScan);
  $("scanStop")?.addEventListener("click", stopBarcodeScan);

  // =========================
  // Drawer Buttons (Menu)
  // =========================

  // Goals edit (prompt-based because no dedicated view in HTML)
  $("openGoals")?.addEventListener("click", () => {
    const s = initDefaults(loadState());

    const kcal = prompt("Tagesziel kcal:", s.goals.kcal);
    if (kcal === null) return;

    const p = prompt("Protein Ziel (g):", s.goals.p);
    if (p === null) return;

    const c = prompt("Carbs Ziel (g):", s.goals.c);
    if (c === null) return;

    const f = prompt("Fett Ziel (g):", s.goals.f);
    if (f === null) return;

    s.goals.kcal = Math.max(0, parseInt(kcal, 10) || 0);
    s.goals.p = Math.max(0, parseFloat(String(p).replace(",", ".")) || 0);
    s.goals.c = Math.max(0, parseFloat(String(c).replace(",", ".")) || 0);
    s.goals.f = Math.max(0, parseFloat(String(f).replace(",", ".")) || 0);

    saveState(s);
    closeDrawer();
    render();
  });

  $("resetGoals")?.addEventListener("click", () => {
    const s = initDefaults(loadState());
    if (!confirm("Tagesziele auf Default zurücksetzen?")) return;
    s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
    saveState(s);
    closeDrawer();
    render();
  });

  // Cut settings (prompt-based)
  $("openCut")?.addEventListener("click", () => {
    const s = initDefaults(loadState());

    const maint = prompt("Maintenance kcal:", s.cut.maintenance ?? 3000);
    if (maint === null) return;

    const budgetStart = prompt("Defizit-Budget Start (kcal):", s.cut.budgetStart ?? 0);
    if (budgetStart === null) return;

    s.cut.maintenance = Math.max(0, parseInt(maint, 10) || 0);
    s.cut.budgetStart = Math.max(0, parseInt(budgetStart, 10) || 0);

    // Wenn Budget neu gesetzt wird, setzen wir Left = Start
    s.cut.budgetLeft = s.cut.budgetStart;
    s.cut.committedDays = {}; // optional: reset "already committed" markers

    saveState(s);
    closeDrawer();
    render();
  });

  // Commit deficit today: max(0, maintenance - eaten)
  function commitDeficitForCurrentDay() {
    const s = initDefaults(loadState());
    const date = ensureDateFilled();

    // only once per date
    if (!s.cut.committedDays) s.cut.committedDays = {};
    if (s.cut.committedDays[date]) {
      alert("Heute bereits verbucht.");
      return;
    }

    const entries = s[dayKey(date)] || [];
    const sums = sumEntries(entries);
    const deficit = Math.max(0, (s.cut.maintenance || 0) - Math.round(sums.kcal || 0));

    s.cut.budgetLeft = Math.max(0, (s.cut.budgetLeft || 0) - deficit);
    s.cut.committedDays[date] = true;

    saveState(s);
    render();
    alert(`Verbucht: ${deficit} kcal Defizit`);
  }

  $("commitDay")?.addEventListener("click", commitDeficitForCurrentDay);
  $("drawerCommit")?.addEventListener("click", () => {
    closeDrawer();
    commitDeficitForCurrentDay();
  });

  $("resetCut")?.addEventListener("click", () => {
    if (!confirm("Cut-Countdown komplett resetten?")) return;
    const s = initDefaults(loadState());
    s.cut.budgetStart = 0;
    s.cut.budgetLeft = 0;
    s.cut.committedDays = {};
    saveState(s);
    closeDrawer();
    render();
  });

  // Templates manager (falls du noch keinen Manager hast -> öffnet Create Modal)
  $("openTemplates")?.addEventListener("click", () => {
    closeDrawer();
    openModal("create");
  });

  // Export JSON
  $("exportData")?.addEventListener("click", () => {
    const s = initDefaults(loadState());
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ricos-mealtracker-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Import JSON
  $("importFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      alert("Import erfolgreich.");
      closeDrawer();
      render();
    } catch (err) {
      alert("Import fehlgeschlagen: " + (err?.message || err));
    } finally {
      e.target.value = "";
    }
  });

  // Wipe all
  $("wipeAll")?.addEventListener("click", () => {
    if (!confirm("Wirklich ALLES löschen?")) return;
    localStorage.removeItem(STORAGE_KEY);
    closeDrawer();
    render();
  });

  // Force update (Service Worker)
  $("forceUpdate")?.addEventListener("click", async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (_) {}
    alert("Update erzwungen. Seite lädt neu…");
    location.reload();
  });
}

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  showJsBadge();

  const s=initDefaults(loadState());
  saveState(s);
  if($("date")) $("date").value = s.lastDate || todayISO();

  wire();
  wireInstallFab();
  render();
});

