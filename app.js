// Rico's Mealtracker — Mobile-first UI
// Features: sticky overview, cut countdown, day list with edit/save, templates, OFF DE search, barcode scan (if supported)

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

const STORAGE_KEY = "ricos_mealtracker_mobile_v1";

let editingId = null;
let scanStream = null;
let scanRunning = false;

function todayISO(){ return new Date().toISOString().slice(0,10); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function dayKey(d){ return `day_${d}`; }

function loadState(){ return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

function initDefaults(s){
  if (!s.goals) s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
  if (!s.cut) s.cut = { maintenance: 3000, budgetStart: 0, budgetLeft: 0, committedDays: {} };
  if (!s.templates) s.templates = [];
  if (!s.lastDate) s.lastDate = todayISO();
  if (!s.ui) s.ui = { view: "home" };

  if (s.templates.length === 0){
    s.templates.push(
      { id: uid(), name: "Oats + Whey + Milk", baseGrams: 400, p: 50, c: 95, f: 15 },
      { id: uid(), name: "Chicken + Rice", baseGrams: 700, p: 48, c: 120, f: 4 },
      { id: uid(), name: "Monstermash", baseGrams: 750, p: 60, c: 120, f: 15 }
    );
  }
}

function calcKcalFromMacros(p,c,f){
  return (p*KCAL_PER_G_PROTEIN) + (c*KCAL_PER_G_CARBS) + (f*KCAL_PER_G_FAT);
}
function setPer100Base(p100, c100, f100, kcal100 = null) {
  const gramsEl = document.getElementById("grams");
  gramsEl.dataset.per100 = "1";
  gramsEl.dataset.p100 = String(p100 ?? 0);
  gramsEl.dataset.c100 = String(c100 ?? 0);
  gramsEl.dataset.f100 = String(f100 ?? 0);
  gramsEl.dataset.kcal100 = String(kcal100 ?? "");
}
 
function clearPer100Base() {
  const gramsEl = document.getElementById("grams");
  delete gramsEl.dataset.per100;
  delete gramsEl.dataset.p100;
  delete gramsEl.dataset.c100;
  delete gramsEl.dataset.f100;
  delete gramsEl.dataset.kcal100;
}
 
function applyPer100ScalingIfPresent() {
  const gramsEl = document.getElementById("grams");
  if (gramsEl.dataset.per100 !== "1") return;
 
  const g = num("grams");
  if (!Number.isFinite(g) || g <= 0) return;
 
  const p100 = parseFloat(gramsEl.dataset.p100 || "0") || 0;
  const c100 = parseFloat(gramsEl.dataset.c100 || "0") || 0;
  const f100 = parseFloat(gramsEl.dataset.f100 || "0") || 0;
 
  const factor = g / 100;
 
  document.getElementById("p").value = round1(p100 * factor);
  document.getElementById("c").value = round1(c100 * factor);
  document.getElementById("f").value = round1(f100 * factor);
 
  // kcal auto (wenn nicht manuell)
  document.getElementById("manualKcal").checked = false;
  updateKcalFromMacros();
}
 
// Robust number parsing (supports comma)
function num(id){
  const el = document.getElementById(id);
  if (!el) return 0;
  const raw = String(el.value ?? "").trim().replace(",", ".");
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : 0;
}

function setText(id, v){
  const el = document.getElementById(id);
  if (el) el.textContent = String(v);
}

function round1(x){
  return (Math.round((x + Number.EPSILON) * 10) / 10).toFixed(1);
}

function ensureDateFilled(){
  const el = document.getElementById("date");
  if (!el.value) el.value = todayISO();
  return el.value;
}

function sumEntries(entries){
  return entries.reduce((a, e) => {
    a.kcal += (e.kcal||0);
    a.p += (e.p||0);
    a.c += (e.c||0);
    a.f += (e.f||0);
    return a;
  }, {kcal:0,p:0,c:0,f:0});
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

// ---------- Views ----------
function setView(view){
  const s = loadState();
  initDefaults(s);
  s.ui.view = view;
  saveState(s);
  editingId = null;
  render();
}

function renderViews(state){
  const view = state.ui.view || "home";
  const map = {
    home: ["viewHome", "Tagesübersicht"],
    search:["viewSearch","Lebensmittel suchen"],
    create:["viewCreate","Neues erstellen"],
    scan:  ["viewScan","Scannen"]
  };

  for (const id of ["viewHome","viewSearch","viewCreate","viewScan"]){
    document.getElementById(id).classList.add("hidden");
  }
  const [showId, title] = map[view] || map.home;
  document.getElementById(showId).classList.remove("hidden");
  document.getElementById("viewTitle").textContent = title;

  // nav active state
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

// ---------- Templates ----------
function getTemplateById(state, id){
  return state.templates.find(t => t.id === id) || null;
}

function renderTemplateSelects(state){
  const selQuick = document.getElementById("tplSelectQuick");
  const selManage = document.getElementById("tplSelect");
  selQuick.innerHTML = "";
  selManage.innerHTML = "";

  const mkOpt = (value, text) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    return o;
  };

  selQuick.appendChild(mkOpt("", "— Template —"));
  selManage.appendChild(mkOpt("", "— auswählen —"));

  for (const t of state.templates){
    const kcal = Math.round(calcKcalFromMacros(t.p,t.c,t.f));
    const label = `${t.name} • ${t.baseGrams}g • ${kcal} kcal`;
    selQuick.appendChild(mkOpt(t.id, label));
    selManage.appendChild(mkOpt(t.id, label));
  }
}

function applyTemplateToForm(tpl, gramsOverride=null){
  if (!tpl) return;
  document.getElementById("name").value = tpl.name;

  const grams = (gramsOverride && gramsOverride>0) ? gramsOverride : tpl.baseGrams;
  document.getElementById("grams").value = Math.round(grams);

  const ratio = tpl.baseGrams>0 ? (grams/tpl.baseGrams) : 1;
  const p = tpl.p*ratio, c = tpl.c*ratio, f = tpl.f*ratio;

  document.getElementById("p").value = round1(p);
  document.getElementById("c").value = round1(c);
  document.getElementById("f").value = round1(f);

  updateKcalFromMacros();
}

function wireScalingFromGrams(){
  document.getElementById("grams").addEventListener("input", () => {
    const s = loadState(); initDefaults(s);
 
    // 1) Wenn Template ausgewählt: Template-Skalierung
    const tplId = document.getElementById("tplSelectQuick").value;
    if (tplId) {
      const tpl = getTemplateById(s, tplId);
      if (!tpl) return;
      const grams = num("grams");
      if (grams <= 0) return;
      applyTemplateToForm(tpl, grams);
      return;
    }
 
    // 2) Sonst: OFF/Barcode (per100) Skalierung
    applyPer100ScalingIfPresent();
  });
}
 

// ---------- kcal auto ----------
function updateKcalFromMacros(){
  const manual = document.getElementById("manualKcal")?.checked;
  if (manual) return;
  const p = num("p"), c = num("c"), f = num("f");
  const kcal = calcKcalFromMacros(p,c,f);
  document.getElementById("kcal").value = Math.round(kcal);
}

// ---------- OFF Search (DE-only) ----------
async function offSearch(q){
  const status = document.getElementById("offStatus");
  const results = document.getElementById("offResults");
  results.innerHTML = "";
  status.textContent = "Suche…";

  const url =
    "https://world.openfoodfacts.org/api/v2/search" +
    `?search_terms=${encodeURIComponent(q)}` +
    "&countries_tags=de" +
    "&page_size=20" +
    "&fields=product_name,brands,code,nutriments";

  const res = await fetch(url);
  if (!res.ok) throw new Error("OFF Anfrage fehlgeschlagen");
  const data = await res.json();

  const items = data?.products || [];
  status.textContent = items.length ? `${items.length} Treffer` : "Keine Treffer";

  for (const p of items){
    const n = p.nutriments || {};
    const name = p.product_name || "(ohne Name)";
    const brand = p.brands ? ` • ${p.brands}` : "";
    const p100 = Number(n.proteins_100g)||0;
    const c100 = Number(n.carbohydrates_100g)||0;
    const f100 = Number(n.fat_100g)||0;
    const kcal100 = Number(n["energy-kcal_100g"]) || Math.round(calcKcalFromMacros(p100,c100,f100));

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-left">
        <div class="item-name">${escapeHtml(name)}</div>
        <div class="item-sub">100g • ${kcal100} kcal • P ${round1(p100)} • C ${round1(c100)} • F ${round1(f100)}</div>
      </div>
      <div class="item-right">
        <div class="item-meta">${escapeHtml(brand)}</div>
        <div class="actions">
          <button class="btn btn-ghost" data-use="1">Übernehmen</button>
        </div>
      </div>
    `;
    el.querySelector("[data-use]").onclick = () => {
  document.getElementById("name").value = name;
 
  // Basis auf 100g setzen
  document.getElementById("grams").value = 100;
  setPer100Base(p100, c100, f100, kcal100);
 
  // Felder füllen & kcal berechnen
  applyPer100ScalingIfPresent();
 
  setView("create");
};
 
    results.appendChild(el);
  }
}

// ---------- Barcode Scan ----------
async function fetchOFFByBarcode(barcode){
  const url = `https://world.openfoodfacts.net/api/v2/product/${encodeURIComponent(barcode)}?fields=product_name,nutriments`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("OFF Barcode Anfrage fehlgeschlagen");
  const data = await res.json();
  if (!data || data.status !== 1 || !data.product) throw new Error("Produkt nicht gefunden");

  const p = data.product;
  const n = p.nutriments || {};
  const p100 = Number(n.proteins_100g)||0;
  const c100 = Number(n.carbohydrates_100g)||0;
  const f100 = Number(n.fat_100g)||0;
  const kcal100 = Number(n["energy-kcal_100g"]) || Math.round(calcKcalFromMacros(p100,c100,f100));

  return { name: p.product_name || `Barcode ${barcode}`, p100, c100, f100, kcal100 };
}

async function startBarcodeScan(){
  const statusEl = document.getElementById("scanStatus");
  const wrap = document.getElementById("scannerWrap");
  const video = document.getElementById("scanVideo");
 
  if (!("BarcodeDetector" in window)){
    statusEl.textContent = "BarcodeDetector nicht verfügbar (Fallback-Library später möglich).";
    return;
  }
 
  const detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128"] });
 
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = scanStream;
    await video.play();
    wrap.classList.remove("hidden");
    scanRunning = true;
    statusEl.textContent = "Scanner läuft…";
 
    const tick = async () => {
      if (!scanRunning) return;
 
      try{
        const codes = await detector.detect(video);
 
        if (codes && codes.length){
          const code = codes[0].rawValue;
          statusEl.textContent = `Gefunden: ${code}`;
          stopBarcodeScan();
 
          const off = await fetchOFFByBarcode(code);
 
          // --- WICHTIG: per-100g Basis setzen + dynamisch skalieren ---
          document.getElementById("name").value = off.name;
          document.getElementById("grams").value = 100;
 
          // speichert die 100g-Werte "unsichtbar" als Basis
          setPer100Base(off.p100, off.c100, off.f100, off.kcal100);
 
          // füllt P/C/F passend zu current grams (hier 100g) + setzt kcal (auto)
          applyPer100ScalingIfPresent();
 
          setView("create");
          return;
        }
      }catch(e){
        statusEl.textContent = "Scan-Fehler: " + (e?.message || e);
      }
 
      requestAnimationFrame(tick);
    };
 
    requestAnimationFrame(tick);
  }catch(e){
    statusEl.textContent = "Kamera nicht verfügbar: " + (e?.message || e);
  }
}
 
function stopBarcodeScan(){
  scanRunning = false;
  const wrap = document.getElementById("scannerWrap");
  const video = document.getElementById("scanVideo");
 
  if (video) video.pause();
 
  if (scanStream){
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
 
  wrap.classList.add("hidden");
}
 

// ---------- Render ----------
function render(){
  const state = loadState();
  initDefaults(state);

  // date
  const dateEl = document.getElementById("date");
  dateEl.value = state.lastDate || todayISO();
  const date = ensureDateFilled();

  // views
  renderViews(state);

  // templates
  renderTemplateSelects(state);

  // goals
  setText("gKcal", state.goals.kcal);
  setText("gP", state.goals.p);
  setText("gC", state.goals.c);
  setText("gF", state.goals.f);

  // day sums
  const entries = state[dayKey(date)] || [];
  const sums = sumEntries(entries);

  setText("sumKcal", Math.round(sums.kcal));
  setText("sumP", Math.round(sums.p));
  setText("sumC", Math.round(sums.c));
  setText("sumF", Math.round(sums.f));

  // kcal progress
  const pct = state.goals.kcal > 0 ? Math.max(0, Math.min(1, sums.kcal / state.goals.kcal)) : 0;
  document.getElementById("kcalBar").style.width = `${Math.round(pct*100)}%`;

  const left = Math.round(state.goals.kcal - sums.kcal);
  const statusLine = document.getElementById("statusLine");
  statusLine.textContent = left >= 0
    ? `Im Ziel: ${left} kcal übrig`
    : `Über Ziel: ${Math.abs(left)} kcal drüber`;

  // cut inputs
  document.getElementById("maintKcal").value = state.cut.maintenance;
  document.getElementById("defBudget").value = state.cut.budgetStart;

  // cut progress
  const budgetLeftEl = document.getElementById("budgetLeft");
  const hintEl = document.getElementById("budgetHint");
  const cutPercentEl = document.getElementById("cutPercent");
  const cutBarEl = document.getElementById("cutBar");

  if (!state.cut.budgetStart || state.cut.budgetStart <= 0){
    budgetLeftEl.textContent = "–";
    hintEl.textContent = "Setze ein Defizit-Budget im Budget-Menü.";
    cutPercentEl.textContent = "0";
    cutBarEl.style.width = "0%";
  } else {
    const start = state.cut.budgetStart;
    const leftB = state.cut.budgetLeft;

    budgetLeftEl.textContent = Math.round(leftB);

    const maint = state.cut.maintenance || 0;
    const dayDef = Math.max(0, maint - sums.kcal);
    const committed = !!state.cut.committedDays?.[date];

    hintEl.textContent =
      `Heute: Defizit-Schätzung ${Math.round(dayDef)} kcal. ` +
      (committed ? "✅ Bereits verbucht." : "⏳ Noch nicht verbucht.");

    const prog = Math.max(0, Math.min(1, (start - leftB) / start));
    const percent = Math.round(prog * 100);
    cutPercentEl.textContent = String(percent);
    cutBarEl.style.width = `${percent}%`;
  }

  // day list render (mobile)
  const list = document.getElementById("dayList");
  list.innerHTML = "";

  if (!entries.length){
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "Noch keine Einträge. Unten „Neues erstellen“ oder „Scannen“.";
    list.appendChild(empty);
  } else {
    for (const e of entries){
      const item = document.createElement("div");
      item.className = "item";

      if (editingId === e.id){
        item.innerHTML = `
          <div class="item-left">
            <div class="field">
              <label>Name</label>
              <input id="e_name_${e.id}" value="${escapeHtml(e.name)}" />
            </div>
            <div class="row3 top10">
              <div class="field">
                <label>Protein</label>
                <input id="e_p_${e.id}" type="number" step="0.1" min="0" value="${round1(e.p)}" />
              </div>
              <div class="field">
                <label>Carbs</label>
                <input id="e_c_${e.id}" type="number" step="0.1" min="0" value="${round1(e.c)}" />
              </div>
              <div class="field">
                <label>Fett</label>
                <input id="e_f_${e.id}" type="number" step="0.1" min="0" value="${round1(e.f)}" />
              </div>
            </div>
          </div>

          <div class="item-right">
            <div class="field">
              <label>Gramm</label>
              <input id="e_grams_${e.id}" type="number" step="1" min="0" value="${Math.round(e.grams||0)}" />
            </div>
            <div class="field">
              <label>kcal</label>
              <input id="e_kcal_${e.id}" type="number" step="1" min="0" value="${Math.round(e.kcal||0)}" />
            </div>
            <label class="pill toggle">
              <input id="e_manual_${e.id}" type="checkbox" ${e.manualKcal ? "checked" : ""}/>
              kcal manuell
            </label>
            <div class="actions">
              <button class="btn btn-ghost" data-save="${e.id}">Speichern</button>
              <button class="btn btn-danger" data-cancel="${e.id}">Abbrechen</button>
            </div>
          </div>
        `;

        // auto kcal update when not manual
        const hookAuto = () => {
          const manual = document.getElementById(`e_manual_${e.id}`).checked;
          if (manual) return;
          const p = parseFloat(String(document.getElementById(`e_p_${e.id}`).value).replace(",", ".")) || 0;
          const c = parseFloat(String(document.getElementById(`e_c_${e.id}`).value).replace(",", ".")) || 0;
          const f = parseFloat(String(document.getElementById(`e_f_${e.id}`).value).replace(",", ".")) || 0;
          document.getElementById(`e_kcal_${e.id}`).value = Math.round(calcKcalFromMacros(p,c,f));
        };

        setTimeout(() => {
          ["e_p_","e_c_","e_f_"].forEach(pref => {
            const el = document.getElementById(`${pref}${e.id}`);
            if (el) el.addEventListener("input", hookAuto);
          });
          const man = document.getElementById(`e_manual_${e.id}`);
          if (man) man.addEventListener("change", hookAuto);
        }, 0);

      } else {
        item.innerHTML = `
          <div class="item-left">
            <div class="item-name">${escapeHtml(e.name)}</div>
            <div class="item-sub">
              <span>P ${round1(e.p)}g</span>
              <span>C ${round1(e.c)}g</span>
              <span>F ${round1(e.f)}g</span>
            </div>
          </div>
          <div class="item-right">
            <div class="item-meta">${Math.round(e.grams||0)} g • <b>${Math.round(e.kcal||0)}</b> kcal</div>
            <div class="actions">
              <button class="btn btn-ghost" data-edit="${e.id}">Edit</button>
              <button class="btn btn-ghost" data-del="${e.id}">✕</button>
            </div>
          </div>
        `;
      }

      list.appendChild(item);
    }
  }

  // event delegation for list actions
  list.onclick = (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;

    const editId = t.getAttribute("data-edit");
    const delId = t.getAttribute("data-del");
    const saveId = t.getAttribute("data-save");
    const cancelId = t.getAttribute("data-cancel");

    if (editId){
      editingId = editId;
      render();
      return;
    }
    if (cancelId){
      editingId = null;
      render();
      return;
    }
    if (saveId){
      const st = loadState(); initDefaults(st);
      const d = ensureDateFilled();
      const key = dayKey(d);

      const name = (document.getElementById(`e_name_${saveId}`).value || "").trim() || "Eintrag";
      const grams = parseFloat(String(document.getElementById(`e_grams_${saveId}`).value).replace(",", ".")) || 0;
      const p = parseFloat(String(document.getElementById(`e_p_${saveId}`).value).replace(",", ".")) || 0;
      const c = parseFloat(String(document.getElementById(`e_c_${saveId}`).value).replace(",", ".")) || 0;
      const f = parseFloat(String(document.getElementById(`e_f_${saveId}`).value).replace(",", ".")) || 0;
      const manual = document.getElementById(`e_manual_${saveId}`).checked;
      const kcal = manual
        ? (parseFloat(String(document.getElementById(`e_kcal_${saveId}`).value).replace(",", ".")) || 0)
        : calcKcalFromMacros(p,c,f);

      st[key] = (st[key] || []).map(x => x.id !== saveId ? x : ({
        ...x,
        name, grams,
        p, c, f,
        kcal: Math.round(kcal),
        manualKcal: manual
      }));

      saveState(st);
      editingId = null;
      render();
      return;
    }
    if (delId){
      const st = loadState(); initDefaults(st);
      const d = ensureDateFilled();
      const key = dayKey(d);
      st[key] = (st[key] || []).filter(x => x.id !== delId);
      saveState(st);
      if (editingId === delId) editingId = null;
      render();
      return;
    }
  };

  // persist last date
  state.lastDate = date;
  saveState(state);
}

// ---------- Wire ----------
function wire(){
  // nav
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
 
  // date change
  document.getElementById("date").addEventListener("change", (e) => {
    const s = loadState(); initDefaults(s);
    s.lastDate = e.target.value || todayISO();
    saveState(s);
    editingId = null;
    render();
  });
 
  // macros -> kcal auto
  // WICHTIG: wenn User Makros tippt => per100-Automatik deaktivieren, sonst "kämpfst" du gegen die App
  ["p","c","f"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      clearPer100Base();
      updateKcalFromMacros();
    });
    el.addEventListener("change", () => {
      clearPer100Base();
      updateKcalFromMacros();
    });
  });
 
  document.getElementById("manualKcal").addEventListener("change", () => updateKcalFromMacros());
 
  // apply template
  document.getElementById("applyTplQuick").onclick = () => {
    const s = loadState(); initDefaults(s);
    const id = document.getElementById("tplSelectQuick").value;
    if (!id) return;
    const tpl = getTemplateById(s, id);
    const grams = num("grams") > 0 ? num("grams") : tpl.baseGrams;
 
    // Template anwenden => per100-Automatik aus
    clearPer100Base();
    applyTemplateToForm(tpl, grams);
  };
 
  // templates manage load/delete/save
  document.getElementById("tplLoad").onclick = () => {
    const s = loadState(); initDefaults(s);
    const id = document.getElementById("tplSelect").value;
    if (!id) return;
    const tpl = getTemplateById(s, id);
 
    clearPer100Base();
    applyTemplateToForm(tpl, tpl.baseGrams);
    document.getElementById("tplSelectQuick").value = id;
  };
 
  document.getElementById("tplDelete").onclick = () => {
    const s = loadState(); initDefaults(s);
    const id = document.getElementById("tplSelect").value;
    if (!id) return;
    const tpl = getTemplateById(s, id);
    if (!tpl) return;
    if (!confirm(`Template wirklich löschen?\n\n${tpl.name}`)) return;
    s.templates = s.templates.filter(t => t.id !== id);
    saveState(s);
    render();
  };
 
  document.getElementById("tplSave").onclick = () => {
    const s = loadState(); initDefaults(s);
 
    const name = (document.getElementById("tplName").value || "").trim();
    const baseGrams = parseFloat(String(document.getElementById("tplBaseG").value||"").replace(",", "."));
    if (!name) return alert("Bitte Template-Name eingeben.");
    if (!Number.isFinite(baseGrams) || baseGrams <= 0) return alert("Bitte gültiges Basisgramm eingeben (z.B. 100).");
 
    const p = num("p"), c = num("c"), f = num("f");
    if ((p+c+f) <= 0) return alert("Bitte erst Makros (P/C/F) eingeben.");
 
    const existing = s.templates.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing){
      if (!confirm(`Template "${name}" existiert. Überschreiben?`)) return;
      existing.baseGrams = baseGrams;
      existing.p = p; existing.c = c; existing.f = f;
    } else {
      s.templates.push({ id: uid(), name, baseGrams, p, c, f });
    }
 
    saveState(s);
    document.getElementById("tplName").value = "";
    document.getElementById("tplBaseG").value = "";
    render();
  };
 
  // add entry
  document.getElementById("add").onclick = () => {
    const s = loadState(); initDefaults(s);
    const date = ensureDateFilled();
    const key = dayKey(date);
    if (!s[key]) s[key] = [];
 
    const name = (document.getElementById("name").value || "").trim() || "Eintrag";
    const grams = num("grams");
    const p = num("p"), c = num("c"), f = num("f");
    const manual = document.getElementById("manualKcal").checked;
    const kcal = manual ? num("kcal") : calcKcalFromMacros(p,c,f);
 
    s[key].push({ id: uid(), name, grams, p, c, f, kcal: Math.round(kcal), manualKcal: manual });
    saveState(s);
 
    // clear name for quick next
    document.getElementById("name").value = "";
    editingId = null;
 
    setView("home");
  };
 
  // clear day
  document.getElementById("clearDay").onclick = () => {
    const s = loadState(); initDefaults(s);
    const date = ensureDateFilled();
    delete s[dayKey(date)];
    if (s.cut?.committedDays?.[date]) delete s.cut.committedDays[date];
    saveState(s);
    editingId = null;
    render();
  };
 
  // cut save/reset
  document.getElementById("saveCut").onclick = () => {
    const s = loadState(); initDefaults(s);
    const start = num("defBudget");
    s.cut.maintenance = num("maintKcal");
    s.cut.budgetStart = start;
    s.cut.budgetLeft = start;
    s.cut.committedDays = {};
    saveState(s);
    render();
  };
 
  // commit day deficit
  document.getElementById("commitDay").onclick = () => {
    const s = loadState(); initDefaults(s);
    const date = ensureDateFilled();
 
    if (!s.cut.budgetStart || s.cut.budgetStart <= 0){
      alert("Bitte erst ein Defizit-Budget setzen (Budget-Menü).");
      return;
    }
    if (s.cut.committedDays?.[date]){
      alert("Heute wurde bereits verbucht.");
      return;
    }
 
    const entries = s[dayKey(date)] || [];
    const sums = sumEntries(entries);
    const maint = s.cut.maintenance || 0;
    const dayDef = Math.max(0, maint - sums.kcal);
 
    s.cut.budgetLeft = Math.max(0, (s.cut.budgetLeft || 0) - dayDef);
    s.cut.committedDays[date] = true;
 
    saveState(s);
    render();
  };
 
  // OFF search
  document.getElementById("offSearchBtn").onclick = async () => {
    const q = (document.getElementById("offQuery").value || "").trim();
    if (!q) return;
    try{
      await offSearch(q);
    }catch(e){
      document.getElementById("offStatus").textContent = "Fehler: " + (e?.message || e);
    }
  };
 
  // Scan
  document.getElementById("scanBtn").onclick = startBarcodeScan;
  document.getElementById("scanStop").onclick = stopBarcodeScan;
 
  // grams scaling (Template ODER per100 OFF/Scan)
  wireScalingFromGrams();
}
 

// ---------- Boot ----------
(function boot(){
  const s = loadState();
  initDefaults(s);
  saveState(s);

  document.getElementById("date").value = s.lastDate || todayISO();

  wire();
  // initial kcal in create form
  updateKcalFromMacros();
  render();
})();



