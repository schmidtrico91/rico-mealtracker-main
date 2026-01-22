// Rico’s Mealtracker — Modal + Drawer UI (Mobile-first)
// Home = always visible (overview + cut + date + day list)
// Bottomnav opens modal: scan/search/create
// Drawer (burger) opens settings/tools
// Includes: templates, OFF search (DE), barcode scan, dynamic per-100g scaling, edit/save entries, cut budget tracking

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

// Storage
const STORAGE_KEY = "ricos_mealtracker_main_v2";

// Globals
let editingId = null;
let scanStream = null;
let scanRunning = false;
let deferredInstallPrompt = null;

let deferredInstallPrompt = null;
 
// Listener SOFORT registrieren (damit wir das Event nicht verpassen)
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
 
  const fab = document.getElementById("installFab");
  // Button nur zeigen, wenn nicht bereits standalone
  if (fab && !isStandalone()) fab.classList.remove("hidden");
});
 
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const fab = document.getElementById("installFab");
  if (fab) fab.classList.add("hidden");
});
 
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}
 
function showInstallToast(msg) {
  // minimaler Fallback-Hinweis (verschwindet automatisch)
  let t = document.getElementById("installToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "installToast";
    t.className = "installToast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 3500);
}
 
function wireInstallFab() {
  const fab = document.getElementById("installFab");
  if (!fab) return;
 
  // Wenn schon installiert -> verstecken
  if (isStandalone()) {
    fab.classList.add("hidden");
    return;
  }
 
  // Button IMMER anbieten (nicht nur wenn beforeinstallprompt kam)
  // => wenn Chrome das Event unterdrückt, zeigen wir Fallback-Hinweis.
  fab.classList.remove("hidden");
 
  fab.addEventListener("click", async () => {
    // 1) Wenn echtes Prompt verfügbar -> nutzen
    if (deferredInstallPrompt) {
      fab.disabled = true;
      try {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice; // akzeptiert/abgelehnt
      } catch (_) {
        // ignore
      } finally {
        deferredInstallPrompt = null;
        fab.disabled = false;
        // wenn nicht installiert, Button bleibt sichtbar
      }
      return;
    }
 
    // 2) Fallback: Nutzer zum Menü schicken
    showInstallToast("Installation über Chrome-Menü: ⋮  →  „App installieren“");
  });
}
 

// -------------------- Utils --------------------
function todayISO() { return new Date().toISOString().slice(0, 10); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function dayKey(d) { return `day_${d}`; }

function loadState() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
function saveState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

function initDefaults(s) {
  if (!s.goals) s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
  if (!s.cut) s.cut = { maintenance: 3000, budgetStart: 0, budgetLeft: 0, committedDays: {} };
  if (!s.templates) s.templates = [];
  if (!s.lastDate) s.lastDate = todayISO();
  return s;
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(txt);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function round1(x) { return Math.round((x + Number.EPSILON) * 10) / 10; }

function num(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = String(el.value ?? "").trim().replace(",", ".");
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function ensureDateFilled() {
  const dateEl = document.getElementById("date");
  if (!dateEl.value) dateEl.value = todayISO();
  return dateEl.value;
}

function calcKcalFromMacros(p, c, f) {
  return (p * KCAL_PER_G_PROTEIN) + (c * KCAL_PER_G_CARBS) + (f * KCAL_PER_G_FAT);
}

function sumEntries(entries) {
  return entries.reduce((acc, e) => {
    acc.kcal += (e.kcal || 0);
    acc.p += (e.p || 0);
    acc.c += (e.c || 0);
    acc.f += (e.f || 0);
    return acc;
  }, { kcal: 0, p: 0, c: 0, f: 0 });
}

// -------------------- Modal + Drawer --------------------
function openModal(which) {
  const overlay = document.getElementById("overlay");
  const modal = document.getElementById("modal");
  const title = document.getElementById("modalTitle");

  // hide modal views
  ["viewSearch", "viewCreate", "viewScan"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });

  if (which === "scan") title.textContent = "Scannen";
  if (which === "search") title.textContent = "Lebensmittel suchen";
  if (which === "create") title.textContent = "Neues erstellen";

  const targetId = (which === "scan") ? "viewScan" : (which === "search") ? "viewSearch" : "viewCreate";
  document.getElementById(targetId).classList.remove("hidden");

  overlay.classList.remove("hidden");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  const overlay = document.getElementById("overlay");
  const modal = document.getElementById("modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");

  // If drawer open -> keep overlay
  const drawerOpen = !document.getElementById("drawer").classList.contains("hidden");
  if (!drawerOpen) overlay.classList.add("hidden");
}

function openDrawer() {
  const overlay = document.getElementById("overlay");
  const drawer = document.getElementById("drawer");
  overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  const overlay = document.getElementById("overlay");
  const drawer = document.getElementById("drawer");
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");

  // If modal open -> keep overlay
  const modalOpen = !document.getElementById("modal").classList.contains("hidden");
  if (!modalOpen) overlay.classList.add("hidden");
}

// -------------------- Per-100g base scaling (Scan/OFF) --------------------
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

function updateKcalFromMacros() {
  const manual = document.getElementById("manualKcal")?.checked;
  if (manual) return; // user controls kcal

  const p = num("p"), c = num("c"), f = num("f");
  const kcal = calcKcalFromMacros(p, c, f);
  const kcalEl = document.getElementById("kcal");
  if (kcalEl) kcalEl.value = String(Math.round(kcal));
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

  // kcal auto
  const mk = document.getElementById("manualKcal");
  if (mk) mk.checked = false;
  updateKcalFromMacros();
}

// -------------------- Templates --------------------
function getTemplateById(state, id) {
  return (state.templates || []).find(t => t.id === id);
}

function renderTemplateSelects(state) {
  const selQuick = document.getElementById("tplSelectQuick");
  const selMain = document.getElementById("tplSelect");
  if (!selQuick || !selMain) return;

  const opts = ['<option value="">—</option>']
    .concat((state.templates || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`))
    .join("");

  selQuick.innerHTML = opts;
  selMain.innerHTML = opts;
}

function applyTemplateToForm(tpl, grams) {
  if (!tpl) return;
  if (!Number.isFinite(grams) || grams <= 0) grams = tpl.baseGrams || 100;

  // template wins over per100
  clearPer100Base();

  const factor = grams / (tpl.baseGrams || 100);

  document.getElementById("grams").value = String(grams);
  document.getElementById("p").value = round1((tpl.p || 0) * factor);
  document.getElementById("c").value = round1((tpl.c || 0) * factor);
  document.getElementById("f").value = round1((tpl.f || 0) * factor);

  const mk = document.getElementById("manualKcal");
  if (mk) mk.checked = false;
  updateKcalFromMacros();
}

// Scale on grams input: template if selected, else per100 if present
function wireScalingFromGrams() {
  document.getElementById("grams").addEventListener("input", () => {
    const state = initDefaults(loadState());

    const tplId = document.getElementById("tplSelectQuick").value;
    if (tplId) {
      const tpl = getTemplateById(state, tplId);
      const g = num("grams");
      if (g > 0) applyTemplateToForm(tpl, g);
      return;
    }

    applyPer100ScalingIfPresent();
  });
}

// -------------------- Open Food Facts (DE) --------------------
function normalizeOFF(n) { return Number.isFinite(n) ? n : 0; }

async function offSearch(q) {
  const status = document.getElementById("offStatus");
  const resBox = document.getElementById("offResults");
  if (!status || !resBox) return;

  status.textContent = "Suche…";
  resBox.innerHTML = "";

  const url =
    "https://world.openfoodfacts.org/cgi/search.pl" +
    `?search_terms=${encodeURIComponent(q)}` +
    "&search_simple=1&action=process&json=1&page_size=20&fields=product_name,nutriments,brands";

  const r = await fetch(url);
  if (!r.ok) throw new Error(`OFF Fehler (${r.status})`);
  const j = await r.json();

  const products = (j.products || []).filter(p => p && p.nutriments);
  if (!products.length) {
    status.textContent = "Keine Treffer.";
    return;
  }

  status.textContent = `${products.length} Treffer`;

  const html = products.map(p => {
    const name = (p.product_name || "Unbenannt").trim();
    const brand = (p.brands || "").trim();

    const n = p.nutriments || {};
    const p100 = normalizeOFF(parseFloat(n.proteins_100g));
    const c100 = normalizeOFF(parseFloat(n.carbohydrates_100g));
    const f100 = normalizeOFF(parseFloat(n.fat_100g));
    const kcal100 = normalizeOFF(parseFloat(n["energy-kcal_100g"])) || normalizeOFF(parseFloat(n.energy_100g) / 4.184);

    return `
      <div class="item">
        <div class="item-main">
          <div class="item-name">${escapeHtml(name)}${brand ? ` <span class="muted small">(${escapeHtml(brand)})</span>` : ""}</div>
          <div class="muted small">pro 100g: ${kcal100 ? Math.round(kcal100) : Math.round(calcKcalFromMacros(p100,c100,f100))} kcal · P ${round1(p100)} · C ${round1(c100)} · F ${round1(f100)}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost" data-use="1">Übernehmen</button>
        </div>
      </div>
    `;
  }).join("");

  resBox.innerHTML = html;

  // Bind "Übernehmen"
  [...resBox.querySelectorAll('[data-use="1"]')].forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      const p = products[idx];
      const name = (p.product_name || "Unbenannt").trim();
      const n = p.nutriments || {};
      const p100 = normalizeOFF(parseFloat(n.proteins_100g));
      const c100 = normalizeOFF(parseFloat(n.carbohydrates_100g));
      const f100 = normalizeOFF(parseFloat(n.fat_100g));
      const kcal100 = normalizeOFF(parseFloat(n["energy-kcal_100g"])) || normalizeOFF(parseFloat(n.energy_100g) / 4.184);

      document.getElementById("name").value = name;
      document.getElementById("grams").value = 100;

      setPer100Base(p100, c100, f100, kcal100);
      applyPer100ScalingIfPresent();

      openModal("create");
    });
  });
}

async function fetchOFFByBarcode(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,nutriments,brands`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`OFF Fehler (${r.status})`);
  const j = await r.json();

  const p = j.product;
  if (!p || !p.nutriments) throw new Error("Produkt nicht gefunden.");

  const name = (p.product_name || "Unbenannt").trim();
  const n = p.nutriments || {};
  const p100 = normalizeOFF(parseFloat(n.proteins_100g));
  const c100 = normalizeOFF(parseFloat(n.carbohydrates_100g));
  const f100 = normalizeOFF(parseFloat(n.fat_100g));
  const kcal100 = normalizeOFF(parseFloat(n["energy-kcal_100g"])) || normalizeOFF(parseFloat(n.energy_100g) / 4.184);

  return { name, p100, c100, f100, kcal100 };
}

// -------------------- Barcode Scan --------------------
async function startBarcodeScan() {
  const statusEl = document.getElementById("scanStatus");
  const wrap = document.getElementById("scannerWrap");
  const video = document.getElementById("scanVideo");

  if (!("BarcodeDetector" in window)) {
    statusEl.textContent = "BarcodeDetector nicht verfügbar (Fallback-Library später möglich).";
    return;
  }

  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = scanStream;
    await video.play();
    wrap.classList.remove("hidden");
    scanRunning = true;
    statusEl.textContent = "Scanner läuft…";

    const tick = async () => {
      if (!scanRunning) return;

      try {
        const codes = await detector.detect(video);

        if (codes && codes.length) {
          const code = codes[0].rawValue;
          statusEl.textContent = `Gefunden: ${code}`;
          stopBarcodeScan();

          const off = await fetchOFFByBarcode(code);

          document.getElementById("name").value = off.name;
          document.getElementById("grams").value = 100;

          setPer100Base(off.p100, off.c100, off.f100, off.kcal100);
          applyPer100ScalingIfPresent();

          openModal("create");
          return;
        }
      } catch (e) {
        statusEl.textContent = "Scan-Fehler: " + (e?.message || e);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  } catch (e) {
    statusEl.textContent = "Kamera nicht verfügbar: " + (e?.message || e);
  }
}

function stopBarcodeScan() {
  scanRunning = false;
  const wrap = document.getElementById("scannerWrap");
  const video = document.getElementById("scanVideo");

  if (video) video.pause();

  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }

  wrap.classList.add("hidden");
}

// -------------------- Render Day List --------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function renderDayList(state, date) {
  const list = document.getElementById("dayList");
  const emptyHint = document.getElementById("emptyHint");
  if (!list || !emptyHint) return;

  const entries = state[dayKey(date)] || [];

  if (!entries.length) {
    list.innerHTML = "";
    emptyHint.classList.remove("hidden");
    return;
  }
  emptyHint.classList.add("hidden");

  list.innerHTML = entries.map(e => {
    const macrosLine = `kcal ${Math.round(e.kcal || 0)} · P ${round1(e.p || 0)} · C ${round1(e.c || 0)} · F ${round1(e.f || 0)}`;
    return `
      <div class="item" data-id="${e.id}">
        <div class="item-main">
          <div class="item-name">${escapeHtml(e.name || "Eintrag")}</div>
          <div class="muted small">${(e.grams || 0)} g · ${macrosLine}</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost" data-edit="1">Bearbeiten</button>
          <button class="btn btn-danger" data-del="1">Löschen</button>
        </div>
      </div>
    `;
  }).join("");

  // bind actions
  [...list.querySelectorAll(".item")].forEach(row => {
    const id = row.getAttribute("data-id");
    const entry = entries.find(x => x.id === id);
    if (!entry) return;

    row.querySelector('[data-del="1"]').addEventListener("click", () => {
      if (!confirm("Eintrag löschen?")) return;
      state[dayKey(date)] = entries.filter(x => x.id !== id);
      saveState(state);
      render();
    });

    row.querySelector('[data-edit="1"]').addEventListener("click", () => {
      editingId = id;

      // Fill create form
      document.getElementById("name").value = entry.name || "";
      document.getElementById("grams").value = entry.grams || 0;

      // editing = manual values; disable per100 mode
      clearPer100Base();
      document.getElementById("p").value = entry.p ?? 0;
      document.getElementById("c").value = entry.c ?? 0;
      document.getElementById("f").value = entry.f ?? 0;

      const mk = document.getElementById("manualKcal");
      if (mk) mk.checked = !!entry.manualKcal;

      document.getElementById("kcal").value = entry.kcal ?? Math.round(calcKcalFromMacros(entry.p||0, entry.c||0, entry.f||0));
      openModal("create");
    });
  });
}

// -------------------- Cut Logic --------------------
function commitDayDeficit(state, date) {
  if (!state.cut.budgetStart || state.cut.budgetStart <= 0) {
    alert("Bitte erst ein Defizit-Budget setzen (Burger-Menü → Cut-Countdown).");
    return;
  }
  if (state.cut.committedDays?.[date]) {
    alert("Heute wurde bereits verbucht.");
    return;
  }

  const entries = state[dayKey(date)] || [];
  const sums = sumEntries(entries);
  const maint = state.cut.maintenance || 0;
  const dayDef = Math.max(0, maint - sums.kcal);

  state.cut.budgetLeft = Math.max(0, (state.cut.budgetLeft || 0) - dayDef);
  state.cut.committedDays[date] = true;
  saveState(state);
  render();
}

// -------------------- Drawer actions (Goals/Cut/Backup) --------------------
function promptNumber(label, current, step = 10) {
  const v = prompt(`${label}`, String(current ?? ""));
  if (v === null) return null;
  const n = parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  // snap to step
  return Math.round(n / step) * step;
}

function openGoalsEditor() {
  const s = initDefaults(loadState());

  const kcal = promptNumber("Kalorien-Ziel (kcal)", s.goals.kcal, 10);
  if (kcal === null) return;
  const p = promptNumber("Protein-Ziel (g)", s.goals.p, 1);
  if (p === null) return;
  const c = promptNumber("Carbs-Ziel (g)", s.goals.c, 1);
  if (c === null) return;
  const f = promptNumber("Fett-Ziel (g)", s.goals.f, 1);
  if (f === null) return;

  s.goals = { kcal, p, c, f };
  saveState(s);
  render();
}

function resetGoals() {
  const s = initDefaults(loadState());
  s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
  saveState(s);
  render();
}

function openCutEditor() {
  const s = initDefaults(loadState());

  const maint = promptNumber("Maintenance (kcal)", s.cut.maintenance, 10);
  if (maint === null) return;

  const start = promptNumber("Defizit-Budget START (kcal) — setzt den Countdown zurück", s.cut.budgetStart, 100);
  if (start === null) return;

  s.cut.maintenance = maint;
  s.cut.budgetStart = start;
  s.cut.budgetLeft = start;
  s.cut.committedDays = {};
  saveState(s);
  render();
}

function resetCut() {
  const s = initDefaults(loadState());
  s.cut = { maintenance: 3000, budgetStart: 0, budgetLeft: 0, committedDays: {} };
  saveState(s);
  render();
}

function exportData() {
  const s = initDefaults(loadState());
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `ricos-mealtracker-export-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function importData(file) {
  const text = await file.text();
  const obj = JSON.parse(text);
  // minimal sanity
  if (typeof obj !== "object" || obj === null) throw new Error("Ungültige JSON-Datei.");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  render();
}

function wipeAll() {
  if (!confirm("Wirklich ALLE Daten löschen?")) return;
  localStorage.removeItem(STORAGE_KEY);
  const s = initDefaults(loadState());
  saveState(s);
  editingId = null;
  render();
}

async function forceUpdate() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    // Clear caches
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    location.reload(true);
  } catch (e) {
    alert("Update fehlgeschlagen: " + (e?.message || e));
  }
}

// -------------------- Render --------------------
function render() {
  const state = initDefaults(loadState());

  // date
  const dateEl = document.getElementById("date");
  if (dateEl) dateEl.value = state.lastDate || todayISO();
  const date = ensureDateFilled();

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

  // kcal bar
  const pct = state.goals.kcal > 0 ? clamp01(sums.kcal / state.goals.kcal) : 0;
  const kcalBar = document.getElementById("kcalBar");
  if (kcalBar) kcalBar.style.width = `${Math.round(pct * 100)}%`;

  // cut
  const bl = Math.max(0, Math.round(state.cut.budgetLeft || 0));
  setText("budgetLeft", bl);

  const hint = document.getElementById("budgetHint");
  if (hint) {
    const maint = state.cut.maintenance || 0;
    const todayDef = Math.max(0, maint - sums.kcal);
    const done = !!state.cut.committedDays?.[date];
    hint.textContent = done
      ? "Heute bereits verbucht."
      : `Wenn du heute verbuchst: ${Math.round(todayDef)} kcal Defizit`;
  }

  const cutPct = (state.cut.budgetStart > 0) ? clamp01(1 - (state.cut.budgetLeft / state.cut.budgetStart)) : 0;
  const cutBar = document.getElementById("cutBar");
  if (cutBar) cutBar.style.width = `${Math.round(cutPct * 100)}%`;
  setText("cutPercent", Math.round(cutPct * 100));

  // templates selects
  renderTemplateSelects(state);

  // day list
  renderDayList(state, date);

  // status line
  const st = document.getElementById("statusLine");
  if (st) st.textContent = `${entries.length} Einträge · ${Math.round(sums.kcal)} kcal`;

  // version (drawer)
  const ver = document.getElementById("appVersion");
  if (ver) ver.textContent = "Version: v2 (modal+drawer)";
}

// -------------------- Wire --------------------
function wire() {
  // Bottomnav -> modals
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.modal));
  });

  // Modal close
  document.getElementById("modalClose").addEventListener("click", closeModal);

  // Drawer open/close
  document.getElementById("burger").addEventListener("click", openDrawer);
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);

  // Overlay click closes what is open
  document.getElementById("overlay").addEventListener("click", () => {
    if (!document.getElementById("modal").classList.contains("hidden")) closeModal();
    if (!document.getElementById("drawer").classList.contains("hidden")) closeDrawer();
  });

  // ESC (desktop)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!document.getElementById("modal").classList.contains("hidden")) closeModal();
      if (!document.getElementById("drawer").classList.contains("hidden")) closeDrawer();
    }
  });

  // Date change
  document.getElementById("date").addEventListener("change", (e) => {
    const s = initDefaults(loadState());
    s.lastDate = e.target.value || todayISO();
    saveState(s);
    editingId = null;
    render();
  });

  // Macros -> kcal auto; typing macros disables per100 mode
  ["p", "c", "f"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => { clearPer100Base(); updateKcalFromMacros(); });
    el.addEventListener("change", () => { clearPer100Base(); updateKcalFromMacros(); });
  });
  document.getElementById("manualKcal").addEventListener("change", () => updateKcalFromMacros());

  // Apply template
  document.getElementById("applyTplQuick").addEventListener("click", () => {
    const s = initDefaults(loadState());
    const id = document.getElementById("tplSelectQuick").value;
    if (!id) return;
    const tpl = getTemplateById(s, id);
    const grams = num("grams") > 0 ? num("grams") : (tpl.baseGrams || 100);
    applyTemplateToForm(tpl, grams);
  });

  // Templates manage
  document.getElementById("tplLoad").addEventListener("click", () => {
    const s = initDefaults(loadState());
    const id = document.getElementById("tplSelect").value;
    if (!id) return;
    const tpl = getTemplateById(s, id);
    applyTemplateToForm(tpl, tpl.baseGrams || 100);
    document.getElementById("tplSelectQuick").value = id;
  });

  document.getElementById("tplDelete").addEventListener("click", () => {
    const s = initDefaults(loadState());
    const id = document.getElementById("tplSelect").value;
    if (!id) return;
    const tpl = getTemplateById(s, id);
    if (!tpl) return;
    if (!confirm(`Template wirklich löschen?\n\n${tpl.name}`)) return;
    s.templates = (s.templates || []).filter(t => t.id !== id);
    saveState(s);
    render();
  });

  document.getElementById("tplSave").addEventListener("click", () => {
    const s = initDefaults(loadState());

    const name = (document.getElementById("tplName").value || "").trim();
    const baseGrams = parseFloat(String(document.getElementById("tplBaseG").value || "").replace(",", "."));

    if (!name) return alert("Bitte Template-Name eingeben.");
    if (!Number.isFinite(baseGrams) || baseGrams <= 0) return alert("Bitte gültiges Basisgramm eingeben (z.B. 100).");

    const p = num("p"), c = num("c"), f = num("f");
    if ((p + c + f) <= 0) return alert("Bitte erst Makros (P/C/F) eingeben.");

    const existing = (s.templates || []).find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
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
  });

  // Add entry / Save edit
  document.getElementById("add").addEventListener("click", () => {
    const s = initDefaults(loadState());
    const date = ensureDateFilled();
    const key = dayKey(date);
    if (!s[key]) s[key] = [];

    const name = (document.getElementById("name").value || "").trim() || "Eintrag";
    const grams = num("grams");
    const p = num("p"), c = num("c"), f = num("f");

    const manual = document.getElementById("manualKcal").checked;
    const kcal = manual ? num("kcal") : calcKcalFromMacros(p, c, f);

    if (editingId) {
      const idx = s[key].findIndex(x => x.id === editingId);
      if (idx >= 0) {
        s[key][idx] = { ...s[key][idx], name, grams, p, c, f, kcal: Math.round(kcal), manualKcal: manual };
      }
      editingId = null;
    } else {
      s[key].push({ id: uid(), name, grams, p, c, f, kcal: Math.round(kcal), manualKcal: manual });
    }

    saveState(s);

    // clear for next
    document.getElementById("name").value = "";
    clearPer100Base();
    closeModal();
    render();
  });

  // Cut commit
  document.getElementById("commitDay").addEventListener("click", () => {
    const s = initDefaults(loadState());
    const date = ensureDateFilled();
    commitDayDeficit(s, date);
  });

  // OFF search
  document.getElementById("offSearchBtn").addEventListener("click", async () => {
    const q = (document.getElementById("offQuery").value || "").trim();
    if (!q) return;
    try { await offSearch(q); }
    catch (e) { document.getElementById("offStatus").textContent = "Fehler: " + (e?.message || e); }
  });

  // Scan buttons
  document.getElementById("scanBtn").addEventListener("click", startBarcodeScan);
  document.getElementById("scanStop").addEventListener("click", stopBarcodeScan);

  // Drawer actions
  document.getElementById("openGoals").addEventListener("click", () => { closeDrawer(); openGoalsEditor(); });
  document.getElementById("resetGoals").addEventListener("click", () => { closeDrawer(); resetGoals(); });

  document.getElementById("openCut").addEventListener("click", () => { closeDrawer(); openCutEditor(); });
  document.getElementById("drawerCommit").addEventListener("click", () => {
    closeDrawer();
    const s = initDefaults(loadState());
    const date = ensureDateFilled();
    commitDayDeficit(s, date);
  });
  document.getElementById("resetCut").addEventListener("click", () => { closeDrawer(); resetCut(); });

  document.getElementById("openTemplates").addEventListener("click", () => {
    closeDrawer();
    openModal("create");
    // scroll in modal to templates area
    setTimeout(() => {
      const det = document.querySelector("#viewCreate details");
      if (det) det.open = true;
      det?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  });

  document.getElementById("exportData").addEventListener("click", () => { closeDrawer(); exportData(); });

  document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importData(file);
      alert("Import erfolgreich.");
    } catch (err) {
      alert("Import fehlgeschlagen: " + (err?.message || err));
    } finally {
      e.target.value = "";
      closeDrawer();
    }
  });

  document.getElementById("wipeAll").addEventListener("click", () => { closeDrawer(); wipeAll(); });
  document.getElementById("forceUpdate").addEventListener("click", () => { closeDrawer(); forceUpdate(); });

  // grams scaling for template/per100
  wireScalingFromGrams();

  // initial kcal calc
  updateKcalFromMacros();
}
// -------------------- Install funktion --------------------
function wireInstallFab(){
  const fab = document.getElementById("installFab");
  if (!fab) return;
 
  // If already installed => hide
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
 
  if (isStandalone) {
    fab.classList.add("hidden");
    return;
  }
 
  // Listen for install prompt availability
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    fab.classList.remove("hidden");
  });
 
  // Hide if installed
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    fab.classList.add("hidden");
  });
 
  // Click -> prompt
  fab.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    fab.disabled = true;
    try{
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
    } finally {
      deferredInstallPrompt = null;
      fab.classList.add("hidden");
      fab.disabled = false;
    }
  });
}
 

// -------------------- Boot --------------------
(function boot() {
  const s = initDefaults(loadState());
  saveState(s);

  // set date
  document.getElementById("date").value = s.lastDate || todayISO();

  wire();
  wireInstallFab();
  render();
})();


