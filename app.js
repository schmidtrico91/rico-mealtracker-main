/* =========================================================
   Rico’s Mealtracker – app.js
   Budget in kg (UI) / kcal (intern)
   ========================================================= */

const STORAGE_KEY = "ricos-mealtracker-v1";
const KCAL_PER_KG_FAT = 9000;

// ----------------------------
// Helpers
// ----------------------------
const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2);

const kcalToKg = (kcal) =>
  Math.round((kcal / KCAL_PER_KG_FAT) * 10) / 10;

const kgToKcal = (kg) =>
  Math.round(kg * KCAL_PER_KG_FAT);

const num = (id) =>
  parseFloat(String($(id)?.value || "0").replace(",", ".")) || 0;

const setText = (id, v) => {
  const el = $(id);
  if (el) el.textContent = v;
};

// ----------------------------
// State
// ----------------------------
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function initDefaults(s) {
  s.goals ??= { kcal: 2400, p: 150, c: 300, f: 60 };
  s.cut ??= {
    maintenance: 2400,
    budgetStart: 0,
    budgetLeft: 0,
    committedDays: {}
  };
  s.settings ??= { mode: "cut" };
  s.recents ??= [];
  s.templates ??= [];
  s.lastDate ??= todayISO();
  return s;
}

const dayKey = (date) => `day_${date}`;

// ----------------------------
// Calculations
// ----------------------------
function calcKcalFromMacros(p, c, f) {
  return p * 4 + c * 4 + f * 9;
}

function sumEntries(arr) {
  return arr.reduce(
    (a, e) => {
      a.kcal += e.kcal || 0;
      a.p += e.p || 0;
      a.c += e.c || 0;
      a.f += e.f || 0;
      return a;
    },
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
}

// ----------------------------
// Render
// ----------------------------
function render() {
  const state = initDefaults(loadState());

  // date
  if ($("date")) $("date").value = state.lastDate;
  const date = state.lastDate;

  // goals
  setText("gKcal", state.goals.kcal);
  setText("gP", state.goals.p);
  setText("gC", state.goals.c);
  setText("gF", state.goals.f);

  // sums
  const entries = state[dayKey(date)] || [];
  const sums = sumEntries(entries);

  setText("sumKcal", Math.round(sums.kcal));
  setText("sumP", Math.round(sums.p));
  setText("sumC", Math.round(sums.c));
  setText("sumF", Math.round(sums.f));

  // kcal bar
  const goalKcal = Math.max(1, state.goals.kcal);
  const pct = clamp01(sums.kcal / goalKcal);
  const kcalBar = $("kcalBar");

  if (kcalBar) {
    kcalBar.style.width = `${Math.round(pct * 100)}%`;
    kcalBar.style.background =
      "linear-gradient(90deg, var(--accent), var(--accent2))";

    const mode = state.settings.mode;
    if (mode === "bulk") {
      const maint = state.cut.maintenance;
      const markerPct = clamp01(maint / goalKcal);

      if (pct > markerPct) {
        const split = Math.round((markerPct / pct) * 100);
        kcalBar.style.background = `
          linear-gradient(90deg,
            #7c3aed 0%,
            #7c3aed ${split}%,
            #22c55e ${split}%,
            #22c55e ${split + (100 - split) * 0.8}%,
            #f59e0b 100%)
        `;
      }
    }
  }

  // maintenance marker
  const marker = $("maintMarker");
  if (marker) {
    if (state.settings.mode === "bulk") {
      const pctM = clamp01(state.cut.maintenance / goalKcal);
      marker.style.left = `${Math.round(pctM * 100)}%`;
      marker.style.display = "block";
    } else {
      marker.style.display = "none";
    }
  }

  // cut / bulk counter
  const start = state.cut.budgetStart;
  const left = state.cut.budgetLeft;

  setText("budgetLeft", kcalToKg(left).toFixed(1));

  const prog = start > 0 ? clamp01(1 - left / start) : 0;
  if ($("cutBar")) $("cutBar").style.width = `${Math.round(prog * 100)}%`;
  setText("cutPercent", Math.round(prog * 100));

  // labels
  const mode = state.settings.mode;
  const cutLabel = document.querySelector(".cut-label");
  if (cutLabel)
    cutLabel.textContent = mode === "bulk" ? "BULK COUNTER" : "CUT COUNTDOWN";

  const commitBtn = $("commitDay");
  if (commitBtn)
    commitBtn.textContent =
      mode === "bulk" ? "Überschuss verbuchen" : "Defizit verbuchen";

  if ($("budgetHint")) {
    $("budgetHint").textContent =
      mode === "bulk"
        ? `Ziel: ${kcalToKg(start).toFixed(1)} kg Zunahme`
        : `Ziel: ${kcalToKg(start).toFixed(1)} kg Abnahme`;
  }

  if ($("statusLine"))
    $("statusLine").textContent = `${entries.length} Einträge · ${Math.round(
      sums.kcal
    )} kcal`;

  if ($("appVersion"))
    $("appVersion").textContent = "Version: 2026.1.2";

  renderDayList(state, date);
}

// ----------------------------
// Day list
// ----------------------------
function renderDayList(state, date) {
  const list = $("dayList");
  const empty = $("emptyHint");
  if (!list) return;

  list.innerHTML = "";
  const entries = state[dayKey(date)] || [];

  if (!entries.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");

  entries.forEach((e) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <div>
        <b>${e.name}</b><br>
        <span class="muted">${e.kcal} kcal · ${e.grams} g</span>
      </div>
    `;
    list.appendChild(div);
  });
}

// ----------------------------
// Commit day
// ----------------------------
function commitDeficitForCurrentDay() {
  const s = initDefaults(loadState());
  const date = s.lastDate;
  const key = dayKey(date);

  if (s.cut.committedDays[date]) return alert("Heute bereits verbucht.");

  const entries = s[key] || [];
  const sums = sumEntries(entries);
  const maint = s.cut.maintenance;

  let delta = 0;
  if (s.settings.mode === "cut") {
    delta = Math.max(0, maint - sums.kcal);
  } else {
    delta = Math.max(0, sums.kcal - maint);
  }

  s.cut.budgetLeft = Math.max(0, s.cut.budgetLeft - delta);
  s.cut.committedDays[date] = true;

  saveState(s);
  render();
}

// ----------------------------
// Wire
// ----------------------------
function wire() {
  document
    .querySelectorAll(".navbtn")
    .forEach((b) =>
      b.addEventListener("click", () => openModal(b.dataset.modal))
    );

  $("burger")?.addEventListener("click", openDrawer);
  $("drawerClose")?.addEventListener("click", closeDrawer);
  $("modalClose")?.addEventListener("click", closeModal);

  $("date")?.addEventListener("change", (e) => {
    const s = initDefaults(loadState());
    s.lastDate = e.target.value || todayISO();
    saveState(s);
    render();
  });

  $("commitDay")?.addEventListener("click", commitDeficitForCurrentDay);
  $("drawerCommit")?.addEventListener("click", () => {
    closeDrawer();
    commitDeficitForCurrentDay();
  });

  $("modeToggle")?.addEventListener("change", (e) => {
    const s = initDefaults(loadState());
    s.settings.mode = e.target.checked ? "bulk" : "cut";
    saveState(s);
    render();
  });

  $("cutSaveBtn")?.addEventListener("click", () => {
    const s = initDefaults(loadState());
    const kg = parseFloat(
      String($("cutBudgetStart")?.value || "0").replace(",", ".")
    );
    s.cut.budgetStart = kgToKcal(kg);
    s.cut.budgetLeft = s.cut.budgetStart;
    s.cut.maintenance = num("cutMaint");
    s.cut.committedDays = {};
    saveState(s);
    closeModal();
    render();
  });

  render();
}

// ----------------------------
wire();
render();
