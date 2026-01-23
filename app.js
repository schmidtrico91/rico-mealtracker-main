/* =========================================================
   Rico’s Mealtracker – app.js (FINAL, STABLE)
   ========================================================= */

/* -------------------- Constants -------------------- */
const STORAGE_KEY = "ricos_mealtracker_v1";

/* -------------------- Helpers -------------------- */
const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round1 = (v) => Math.round(v * 10) / 10;

const todayISO = () => new Date().toISOString().slice(0, 10);
const dayKey = (d) => `day_${d}`;
const uid = () => crypto.randomUUID();

/* -------------------- State -------------------- */
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
  s.settings ??= { mode: "cut" };
  s.goals ??= { kcal: 2400, p: 150, c: 300, f: 60 };
  s.cut ??= { maintenance: 0, budgetStart: 0, budgetLeft: 0, committedDays: {} };
  s.templates ??= [];
  s.recents ??= [];
  s.lastDate ??= todayISO();
  return s;
}

/* -------------------- Calculations -------------------- */
function calcKcalFromMacros(p, c, f) {
  return p * 4 + c * 4 + f * 9;
}

function sumEntries(list) {
  return list.reduce(
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

/* -------------------- Modal / Drawer -------------------- */
function openModal(view) {
  const modal = $("modal");
  const overlay = $("overlay");
  if (!modal || !overlay) return;

  modal.classList.remove("hidden");
  overlay.classList.remove("hidden");
  modal.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));

  const v = $("view" + view.charAt(0).toUpperCase() + view.slice(1));
  if (v) v.classList.remove("hidden");
}

function closeModal() {
  $("modal")?.classList.add("hidden");
  $("overlay")?.classList.add("hidden");
}

function openDrawer() {
  const s = initDefaults(loadState());
  $("drawer")?.classList.remove("hidden");
  $("overlay")?.classList.remove("hidden");
  if ($("modeToggle")) $("modeToggle").checked = s.settings.mode === "bulk";
}

function closeDrawer() {
  $("drawer")?.classList.add("hidden");
  $("overlay")?.classList.add("hidden");
}

/* -------------------- Rendering -------------------- */
function render() {
  const state = initDefaults(loadState());
  const date = state.lastDate;

  if ($("date")) $("date").value = date;

  const entries = state[dayKey(date)] || [];
  const sums = sumEntries(entries);

  setText("sumKcal", Math.round(sums.kcal));
  setText("sumP", Math.round(sums.p));
  setText("sumC", Math.round(sums.c));
  setText("sumF", Math.round(sums.f));

  setText("gKcal", state.goals.kcal);
  setText("gP", state.goals.p);
  setText("gC", state.goals.c);
  setText("gF", state.goals.f);

  const goal = Math.max(1, state.goals.kcal);
  const pct = clamp01(sums.kcal / goal);

  const bar = $("kcalBar");
  if (bar) {
    bar.style.width = `${pct * 100}%`;
    bar.style.background = "linear-gradient(90deg, var(--accent), var(--accent2))";

    if (state.settings.mode === "bulk") {
      const maintPct = clamp01((state.cut.maintenance || 0) / goal);
      if (pct > maintPct) {
        const split = (maintPct / pct) * 100;
        bar.style.background = `
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

  const marker = $("maintMarker");
  if (marker) {
    if (state.settings.mode === "bulk") {
      marker.style.display = "block";
      marker.style.left = `${(state.cut.maintenance / goal) * 100}%`;
    } else {
      marker.style.display = "none";
    }
  }

  setText("budgetLeft", Math.round(state.cut.budgetLeft || 0));

  const cutPct =
    state.cut.budgetStart > 0
      ? clamp01(1 - state.cut.budgetLeft / state.cut.budgetStart)
      : 0;

  if ($("cutBar")) $("cutBar").style.width = `${cutPct * 100}%`;
  setText("cutPercent", Math.round(cutPct * 100));

  const label = document.querySelector(".cut-label");
  if (label) label.textContent = state.settings.mode === "bulk" ? "BULK COUNTER" : "CUT COUNTDOWN";

  if ($("commitDay"))
    $("commitDay").textContent =
      state.settings.mode === "bulk" ? "Überschuss verbuchen" : "Defizit verbuchen";

  if ($("budgetHint")) {
    $("budgetHint").textContent =
      state.settings.mode === "bulk"
        ? "Bulk: verbucht gegessen − Maintenance"
        : "Cut: verbucht Maintenance − gegessen";
  }

  renderDayList(state, date);
}

/* -------------------- UI helpers -------------------- */
function setText(id, val) {
  if ($(id)) $(id).textContent = val;
}

/* -------------------- Day list -------------------- */
function renderDayList(state, date) {
  const list = $("dayList");
  if (!list) return;

  list.innerHTML = "";
  const entries = state[dayKey(date)] || [];

  if (!entries.length) {
    $("emptyHint")?.classList.remove("hidden");
    return;
  }
  $("emptyHint")?.classList.add("hidden");

  entries.forEach(e => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.textContent = `${e.name} – ${e.kcal} kcal`;
    list.appendChild(div);
  });
}

/* -------------------- Actions -------------------- */
function commitDay() {
  const s = initDefaults(loadState());
  const date = s.lastDate;
  if (s.cut.committedDays[date]) return;

  const sums = sumEntries(s[dayKey(date)] || []);
  let delta = 0;

  if (s.settings.mode === "cut") {
    delta = Math.max(0, s.cut.maintenance - sums.kcal);
  } else {
    delta = Math.max(0, sums.kcal - s.cut.maintenance);
  }

  s.cut.budgetLeft = Math.max(0, s.cut.budgetLeft - delta);
  s.cut.committedDays[date] = true;
  saveState(s);
  render();
}

/* -------------------- Wire -------------------- */
function wire() {
  document.querySelectorAll(".navbtn").forEach(b =>
    b.addEventListener("click", () => openModal(b.dataset.modal))
  );

  $("burger")?.addEventListener("click", openDrawer);
  $("drawerClose")?.addEventListener("click", closeDrawer);
  $("modalClose")?.addEventListener("click", closeModal);
  $("overlay")?.addEventListener("click", () => {
    closeModal();
    closeDrawer();
  });

  $("commitDay")?.addEventListener("click", commitDay);
  $("drawerCommit")?.addEventListener("click", () => {
    closeDrawer();
    commitDay();
  });

  $("modeToggle")?.addEventListener("change", e => {
    const s = initDefaults(loadState());
    s.settings.mode = e.target.checked ? "bulk" : "cut";
    saveState(s);
    render();
  });

  $("date")?.addEventListener("change", e => {
    const s = initDefaults(loadState());
    s.lastDate = e.target.value;
    saveState(s);
    render();
  });

  render();
}

/* -------------------- Init -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initDefaults(loadState());
  wire();
  render();
});