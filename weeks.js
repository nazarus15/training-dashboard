"use strict";
// Чергування тижнів: станок ділиться з другом по тижню, тож тиждень «станка» (велосипед 2–3 рази) чергується з тижнем
// «залу» (силові 2 рази). Опорний тиждень задається в Налаштуваннях («Цей тиждень — станок / зал»), далі — через один.
// Зберігається у відкритій частині settings.json (weekAlt: { anchor: понеділок, type: "bike" | "gym" }).
// Показується в Календарі, Планері й на Огляді. Окремий файл: щоб прибрати — видалити його і рядки <script>.
window.WA = (() => {
  const NAMES = { bike: ["Тиждень станка", "станок", "велосипед 2–3 рази"], gym: ["Тиждень залу", "зал", "силові 2 рази"] };
  const cfg = () => { try { return JSON.parse(localStorage.getItem("td_settings_cache") || "null")?.weekAlt || null; } catch { return null; } };
  // тип тижня для дати: «bike» / «gym» / null (не налаштовано)
  function type(date) {
    const c = cfg(); if (!c?.anchor || !c.type) return null;
    const w = WK.monday(date), diff = Math.round((new Date(w + "T12:00") - new Date(c.anchor + "T12:00")) / (7 * 864e5));
    return diff % 2 === 0 ? c.type : c.type === "bike" ? "gym" : "bike";
  }
  const pill = (date, short) => { const t = type(date); return t ? `<span class="wa-pill wa-${t}" title="${NAMES[t][0]}: ${NAMES[t][2]}">${short ? NAMES[t][1] : NAMES[t][0]}</span>` : ""; };
  // підказка для Планера: чи вид тренування пасує до тижня
  function hint(date, sport) {
    const t = type(date); if (!t) return "";
    if (t === "gym" && sport === "bike") return `${NAMES.gym[0]}: станок у цей тиждень у друга.`;
    if (t === "bike" && sport === "strength") return `${NAMES.bike[0]}: за планом цей тиждень — велосипед 2–3 рази, силові — наступного.`;
    return `${NAMES[t][0]} (${NAMES[t][2]}).`;
  }
  async function set(t) {
    const anchor = WK.monday(WK.today()), now = new Date().toISOString();
    const val = t ? { anchor, type: t } : null;
    let cache = {}; try { cache = JSON.parse(localStorage.getItem("td_settings_cache") || "{}") || {}; } catch { }
    localStorage.setItem("td_settings_cache", JSON.stringify({ ...cache, weekAlt: val, updatedAt: now }));
    const d = await WK.ghPut("settings.json", "journal", cur => ({ ...(cur || {}), weekAlt: val, updatedAt: now }), "Чергування тижнів");
    try { localStorage.setItem("td_settings_cache", JSON.stringify(d)); } catch { }
    return val;
  }
  // свіжі налаштування з GitHub (могли змінити на іншому пристрої)
  fetch(`https://raw.githubusercontent.com/nazarus15/training-dashboard/journal/settings.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(s => {
    let c = null; try { c = JSON.parse(localStorage.getItem("td_settings_cache") || "null"); } catch { }
    if (s && (!c?.updatedAt || (s.updatedAt || "") >= c.updatedAt) && JSON.stringify(s.weekAlt || null) !== JSON.stringify(c?.weekAlt || null)) { try { localStorage.setItem("td_settings_cache", JSON.stringify(s)); } catch { } dispatchEvent(new Event("wa:change")); }
  }).catch(() => { });
  const st = document.createElement("style");
  st.textContent = `.wa-pill{display:inline-block;font-family:var(--f-data,monospace);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:99px;border:1px solid currentColor;white-space:nowrap;vertical-align:middle}
.wa-bike{color:var(--z2,#2b7)} .wa-gym{color:var(--accent-2,#c63)}`;
  document.head.appendChild(st);
  return { type, pill, hint, set, cfg, NAMES };
})();
