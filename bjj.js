"use strict";
// Огляд → «Журнал БЖЖ»: після тренування — оцінка зусилля (RPE сесії 1–10), кількість спарингів і нотатки по техніці.
// Пульс на БЖЖ погано відображає зусилля (ізометрія, утримання), тому навантаження рахується як sRPE = RPE × хвилини
// (метод Фостера) — поруч із навантаженням intervals.icu. Записи — у тому ж зашифрованому logs.json, що й силові
// (ключ «bjj:<id активності>»), через ту саму чергу td_pending_logs: працює і без інтернету.
// Окремий файл: щоб прибрати — видалити його і рядок <script> в index.html (записи в logs.json лишаться).
window.BJJ = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const MON = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
  const DOW = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
  const fd = s => { const d = new Date(s + "T12:00"); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };
  const key = a => "bjj:" + (a.id || a.date);
  let remote = {}, shown = 6, timer = null;

  // записи: збережене з GitHub → кеш → ще не відправлене (перемагає)
  const all = () => ({ ...(ls("td_logs_cache", {})?.logs || {}), ...remote, ...(ls("td_pending_logs", {}) || {}) });
  function save(k, patch) {
    const pend = ls("td_pending_logs", {}) || {};
    const cur = { ...(all()[k] || { kind: "bjj" }), ...patch, kind: "bjj", updatedAt: new Date().toISOString() };
    pend[k] = cur; lw("td_pending_logs", pend);
    clearTimeout(timer); timer = setTimeout(() => WK.flushLogs("БЖЖ: оцінка тренування").then(r => { if (r?.body) remote = r.body.logs || remote; status(r); }), 1500);
    status({ kind: "pending" });
  }
  function status(r) {
    const el = $("bjjSync"); if (!el) return;
    el.textContent = r?.kind === "pending" ? "Збережено на пристрої…" : r?.ok ? "Збережено на GitHub." : r?.kind === "offline" ? "Без зв'язку: збережено на пристрої, відправлю пізніше." : r?.kind === "local" ? "Немає токена GitHub: запис лише на цьому пристрої." : r?.msg || "";
  }

  function render() {
    const O = window.OV, box = $("bjjBody"); if (!O || !box) return;
    const sess = O.acts.filter(a => a.sport === "bjj" && a.moving >= 900).slice().reverse();
    if (!sess.length) { box.innerHTML = `<p class="note">Тренувань БЖЖ ще немає.</p>`; return; }
    const L = all(), mins = a => Math.round(a.moving / 60);
    const srpe = a => L[key(a)]?.rpe ? L[key(a)].rpe * mins(a) : null;
    // тижні: sRPE, кількість, середній RPE, спаринги — 8 тижнів
    const t = WK.today(), weeks = [];
    for (let i = 7; i >= 0; i--) {
      const w = WK.addDays(WK.monday(t), -7 * i), ss = sess.filter(a => a.day >= w && a.day < WK.addDays(w, 7));
      const rated = ss.filter(a => L[key(a)]?.rpe);
      weeks.push({ w, n: ss.length, srpe: rated.reduce((s, a) => s + srpe(a), 0), rpe: rated.length ? rated.reduce((s, a) => s + L[key(a)].rpe, 0) / rated.length : null, rounds: ss.reduce((s, a) => s + (+L[key(a)]?.rounds || 0), 0), rated: rated.length });
    }
    const maxS = Math.max(1, ...weeks.map(w => w.srpe));
    const unrated = sess.filter(a => !L[key(a)]?.rpe && a.day >= WK.addDays(t, -14));
    const row = a => {
      const r = L[key(a)] || {};
      return `<div class="bj-row" data-k="${esc(key(a))}">
        <div class="bj-h"><b>${fd(a.day)}</b><span class="muted num">${a.date.slice(11)} · ${mins(a)} хв${a.avgHr ? ` · пульс ${a.avgHr}/${a.maxHr ?? "—"}` : ""}${a.load ? ` · навант. ${a.load}` : ""}${r.rpe ? ` · sRPE ${r.rpe * mins(a)}` : ""}</span></div>
        <div class="bj-rpe" role="group" aria-label="Наскільки важко (RPE сесії)"><span class="muted">Важкість</span>${Array.from({ length: 10 }, (_, i) => `<button type="button" data-rpe="${i + 1}" aria-pressed="${r.rpe === i + 1}">${i + 1}</button>`).join("")}</div>
        <div class="bj-f"><label>Спарингів <input type="number" min="0" max="30" inputmode="numeric" data-f="rounds" value="${r.rounds ?? ""}"></label>
        <label class="bj-note">Нотатки <textarea rows="2" data-f="note" placeholder="Техніка, позиції, що не виходило">${esc(r.note || "")}</textarea></label></div>
      </div>`;
    };
    box.innerHTML = `${unrated.length ? `<p class="bj-ask">Оціни ${unrated.length === 1 ? "останнє тренування" : `останні ${unrated.length} ${unrated.length % 10 >= 2 && unrated.length % 10 <= 4 && !(unrated.length % 100 >= 12 && unrated.length % 100 <= 14) ? "тренування" : "тренувань"}`}: важкість сесії від 1 (легко) до 10 (на максимум).</p>` : ""}
      <div class="bj-weeks" aria-label="Навантаження БЖЖ за тижнями (sRPE)">${weeks.map(w => `<div class="bj-w" title="${w.n} трен. · sRPE ${w.srpe}${w.rpe ? ` · середній RPE ${w.rpe.toFixed(1)}` : ""}${w.rounds ? ` · спарингів ${w.rounds}` : ""}"><i style="height:${Math.max(w.n ? 4 : 0, w.srpe / maxS * 100)}%"></i><span>${w.n || ""}</span><small>${+w.w.slice(8)}.${w.w.slice(5, 7)}</small></div>`).join("")}</div>
      <p class="note" style="margin:0">Стовпці — sRPE за тиждень (RPE × хвилини оцінених тренувань), число — кількість тренувань. ${(() => { const c = weeks.at(-1), p = weeks.slice(3, 7).filter(w => w.n); const avg = p.length ? p.reduce((s, w) => s + w.srpe, 0) / p.length : 0; return avg && c.srpe ? `Цей тиждень — ${Math.round(c.srpe / avg * 100)}% від середнього за попередні 4.` : ""; })()}</p>
      <div class="bj-list">${sess.slice(0, shown).map(row).join("")}</div>
      ${sess.length > shown ? `<button type="button" class="btn-link ghost" id="bjjMore">Показати ще</button>` : ""}
      <p class="muted" id="bjjSync" role="status" style="margin:0;font-size:12px"></p>`;
  }

  function bind() {
    const box = $("bjjBody"); if (!box || box.dataset.bound) return; box.dataset.bound = 1;
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-rpe]");
      if (b) { const k = b.closest(".bj-row").dataset.k; save(k, { rpe: +b.dataset.rpe }); render(); return; }
      if (e.target.id === "bjjMore") { shown += 6; render(); }
    });
    box.addEventListener("change", e => {
      const f = e.target.dataset.f; if (!f) return;
      const k = e.target.closest(".bj-row").dataset.k;
      save(k, { [f]: f === "rounds" ? (e.target.value === "" ? null : +e.target.value) : e.target.value.trim() });
    });
  }
  async function init() {
    const f = () => window.OV ? go() : setTimeout(f, 200);
    async function go() {
      bind(); render();
      try { const x = await WK.ghGet("logs.json", "journal"); const d = x.data ? await AUTH.decrypt(x.data) : null; if (d?.logs) { remote = d.logs; render(); } } catch { }
    }
    f();
  }
  if (window.AUTH) AUTH.ready.then(init);
  return { render };
})();
