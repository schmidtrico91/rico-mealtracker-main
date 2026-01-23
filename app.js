/* =========================================================
   Rico’s Mealtracker – app.js
   Stable baseline with Cut/Bulk (kg UX, kcal internal)
   Compatible with current index.html
========================================================= */

/* ---------------- constants ---------------- */
const KCAL_PER_KG_FAT = 9000; // 1 kg Fett = 9000 kcal
const STORAGE_KEY = "ricos_mealtracker_main_v7";

/* ---------------- utils ---------------- */
const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function loadState() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
}
function saveState(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function initDefaults(s) {
  if (!s.goals) s.goals = { kcal: 2400, p: 150, c: 300, f: 60 };
  if (!s.cut)
    s.cut = {
      maintenance: 2400,
      budgetStartKcal: 0,
      budgetLeftKcal: 0,
      committedDays: {},
    };
  if (!s.settings) s.settings = { mode: "cut" };
  if (!s.lastDate) s.lastDate = todayISO();
  if (!s.recents) s.recents = [];
  return s;
}

function dayKey(d) {
  return `day_${d}`;
}

function sumEntries(entries) {
  return (entries || []).reduce(
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

/* ---------------- modal / drawer ---------------- */
function openModal(which) {
  $("overlay")?.classList.remove("hidden");
  $("modal")?.classList.remove("hidden");
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const id = "view" + which[0].toUpperCase() + which.slice(1);
  $(id)?.classList.remove("hidden");
}
function closeModal() {
  $("modal")?.classList.add("hidden");
  $("overlay")?.classList.add("hidden");
}
function openDrawer() {
  $("drawer")?.classList.remove("hidden");
  $("overlay")?.classList.remove("hidden");

  const s = initDefaults(loadState());
  const toggle = $("modeToggle");
  if (toggle) toggle.checked = s.settings.mode === "bulk";
  if ($("modeLabel"))
    $("modeLabel").textContent =
      s.settings.mode === "bulk" ? "Aktiv: Bulk" : "Aktiv: Cut";
}
function closeDrawer() {
  $("drawer")?.classList.add("hidden");
  $("overlay")?.classList.add("hidden");
}

/* ---------------- render ---------------- */
function render() {
  const state = initDefaults(loadState());
  const date = state.lastDate;

  const entries = state[dayKey(date)] || [];
  const sums = sumEntries(entries);

  // goals
  $("gKcal").textContent = state.goals.kcal;
  $("gP").textContent = state.goals.p;
  $("gC").textContent = state.goals.c;
  $("gF").textContent = state.goals.f;

  // sums
  $("sumKcal").textContent = Math.round(sums.kcal);
  $("sumP").textContent = Math.round(sums.p);
  $("sumC").textContent = Math.round(sums.c);
  $("sumF").textContent = Math.round(sums.f);

  // kcal bar
  const goal = Math.max(0, state.goals.kcal);
  const pct = goal > 0 ? clamp01(sums.kcal / goal) : 0;
  const bar = $("kcalBar");
  if (bar) {
    bar.style.width = `${Math.round(pct * 100)}%`;
    bar.style.background =
      "linear-gradient(90deg, #7c3aed, #22d3ee)";
  }

  // maintenance marker (bulk only)
  const marker = $("maintMarker");
  if (marker && state.settings.mode === "bulk" && goal > 0) {
    const mPct = clamp01(state.cut.maintenance / goal);
    marker.style.left = `${Math.round(mPct * 100)}%`;
    marker.style.display = "block";
  } else if (marker) {
    marker.style.display = "none";
  }

  // cut/bulk text
  const label = document.querySelector(".cut-label");
  if (label)
    label.textContent =
      state.settings.mode === "bulk" ? "BULK COUNTER" : "CUT COUNTDOWN";

  const commitBtn = $("commitDay");
  if (commitBtn)
    commitBtn.textContent =
      state.settings.mode === "bulk"
        ? "Überschuss verbuchen"
        : "Defizit verbuchen";

  // budget (kg display)
  const kgLeft = (state.cut.budgetLeftKcal / KCAL_PER_KG_FAT).toFixed(1);
  $("budgetLeft").textContent = kgLeft;

  $("statusLine").textContent = `${entries.length} Einträge · ${Math.round(
    sums.kcal
  )} kcal`;

  $("appVersion").textContent = "Version: 2026-01-23";

  renderDayList(state, date);
}

/* ---------------- day list ---------------- */
function renderDayList(state, date) {
  const list = $("dayList");
  const empty = $("emptyHint");
  const entries = state[dayKey(date)] || [];

  if (!entries.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = entries
    .map(
      (e) => `
    <div class="item">
      <div class="item-main">
        <div class="item-name">${e.name}</div>
        <div class="muted small">${e.grams} g · ${Math.round(
        e.kcal
      )} kcal</div>
      </div>
    </div>`
    )
    .join("");
}

/* ---------------- wire ---------------- */
function wire() {
  // bottom nav
  document.querySelectorAll(".navbtn").forEach((b) =>
    b.addEventListener("click", () => openModal(b.dataset.modal))
  );

  $("modalClose")?.addEventListener("click", closeModal);
  $("burger")?.addEventListener("click", openDrawer);
  $("drawerClose")?.addEventListener("click", closeDrawer);

  $("overlay")?.addEventListener("click", () => {
    closeModal();
    closeDrawer();
  });

  // date
  $("date")?.addEventListener("change", (e) => {
    const s = initDefaults(loadState());
    s.lastDate = e.target.value;
    saveState(s);
    render();
  });

  // add entry
  $("add")?.addEventListener("click", () => {
    const s = initDefaults(loadState());
    const date = s.lastDate;
    if (!s[dayKey(date)]) s[dayKey(date)] = [];

    const p = +$("p").value || 0;
    const c = +$("c").value || 0;
    const f = +$("f").value || 0;
    const kcal = p * 4 + c * 4 + f * 9;

    s[dayKey(date)].push({
      id: uid(),
      name: $("name").value || "Eintrag",
      grams: +$("grams").value || 0,
      p,
      c,
      f,
      kcal,
    });

    saveState(s);
    closeModal();
    render();
  });

  // mode toggle
  $("modeToggle")?.addEventListener("change", (e) => {
    const s = initDefaults(loadState());
    s.settings.mode = e.target.checked ? "bulk" : "cut";
    saveState(s);
    render();
  });

  // commit day
  $("commitDay")?.addEventListener("click", () => {
    const s = initDefaults(loadState());
    const date = s.lastDate;
    if (s.cut.committedDays[date]) return alert("Heute bereits verbucht.");

    const entries = s[dayKey(date)] || [];
    const sums = sumEntries(entries);

    let delta =
      s.settings.mode === "bulk"
        ? Math.max(0, sums.kcal - s.cut.maintenance)
        : Math.max(0, s.cut.maintenance - sums.kcal);

    s.cut.budgetLeftKcal = Math.max(0, s.cut.budgetLeftKcal - delta);
    s.cut.committedDays[date] = true;
    saveState(s);
    render();
  });
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  const s = initDefaults(loadState());
  saveState(s);
  if ($("date")) $("date").value = s.lastDate;
  wire();
  render();
});