"use strict";
// Силовий журнал → «Прогрес у вправі»: оціночний 1ПМ (або найкраща вага / повтори / секунди) і тоннаж по тренуваннях.
// Окремий файл: читає sessions і logs зі strength.js, малює після кожного render (подія strength:render).
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const MON = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
  const fd = s => { const d = new Date(s + "T12:00"); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const kg = v => (Math.round(v * 10) / 10).toString().replace(".", ",");
  const PER = [[28, "4 тиж"], [56, "8 тиж"], [91, "3 міс"], [182, "6 міс"], [365, "рік"], [99999, "усе"]];
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const E1_CATS = ["legs", "hinge", "push", "pull", "arms"];
  let chart = null, sel = ls("td_sp_ex", null), per = ls("td_sp_per", 99999);

  // історія виконаних підходів за канонічним рухом
  function collect() {
    const by = {};
    const list = Object.values(typeof sessions === "object" ? sessions : {}).sort((a, b) => a.date < b.date ? -1 : 1);
    for (const s of list) for (const ex of s.exercises || []) {
      const done = (logs?.[s.id]?.sets?.[ex.key] || []).filter(x => x.done && (+x.r > 0 || +x.w > 0));
      if (!done.length) continue;
      const cid = ex.cid || ex.key, cat = (EX.BY[cid] || EX.canon(ex.name)).cat, impl = ex.impl || 1;
      const p = by[cid] ??= { cid, name: ex.canonName || ex.name, type: ex.type, cat, hist: [] };
      const load = x => (+x.w || 0) * (ex.type === "bw" ? 1 : impl);
      const e1ok = E1_CATS.includes(cat) && ex.type !== "time" && ex.type !== "bw";
      const best = done.reduce((b, x) => {
        const sc = ex.type === "time" ? +x.r : e1ok ? (EX.e1rm(load(x), +x.r) ?? load(x)) : load(x) * 1000 + +x.r;
        return sc > b.sc ? { x, sc } : b;
      }, { x: done[0], sc: -1 }).x;
      const h = p.hist.find(z => z.date === s.date);
      const row = { date: s.date, impl, best, e1: e1ok ? EX.e1rm(load(best), +best.r) : null, top: load(best), reps: +best.r, secs: ex.type === "time" ? Math.max(...done.map(x => +x.r || 0)) : null,
        ton: ["weight", "kb"].includes(ex.type) ? done.reduce((t, x) => t + load(x) * (+x.r || 0), 0) : null, totalReps: done.reduce((t, x) => t + (+x.r || 0), 0), sets: done.length };
      if (h) { if ((row.e1 ?? row.top) > (h.e1 ?? h.top)) Object.assign(h, row, { ton: (h.ton || 0) + (row.ton || 0) }); else h.ton = (h.ton || 0) + (row.ton || 0); }
      else p.hist.push(row);
    }
    return by;
  }
  // [підпис осі, значення, коротка назва, одиниця]
  const metricOf = p => p.type === "time" ? ["Найдовше, с", h => h.secs, "найдовше", "с"] : p.hist.some(h => h.e1) ? ["Оціночний 1ПМ, кг", h => h.e1 && Math.round(h.e1 * 10) / 10, "1ПМ", "кг"] : p.type === "bw" ? ["Повторів за тренування", h => h.totalReps, "повторів", ""] : ["Найбільша вага, кг", h => h.top, "найбільша вага", "кг"];
  const setTxt = (p, h) => p.type === "time" ? `${h.secs} с` : p.type === "bw" ? `${+h.best.w ? `+${kg(+h.best.w)} кг × ` : ""}${h.reps}` : `${h.impl > 1 ? `${h.impl}×${kg(h.top / h.impl)}` : kg(h.top)} кг × ${h.reps}`;

  function render() {
    const wrap = $("progWrap"); if (!wrap || !window.EX) return;
    const by = collect(), all = Object.values(by).sort((a, b) => a.name.localeCompare(b.name, "uk"));
    wrap.hidden = !all.length; if (!all.length) return;
    if (!by[sel]) { const withE1 = all.filter(p => p.hist.some(h => h.e1)); sel = (withE1.length ? withE1 : all).reduce((b, p) => p.hist.at(-1).date > b.hist.at(-1).date ? p : b).cid; }
    const groups = EX.CATS.map(([id, n]) => [n, all.filter(p => p.cat === id)]).filter(g => g[1].length);
    $("progEx").innerHTML = groups.map(([n, xs]) => `<optgroup label="${esc(n)}">${xs.map(p => `<option value="${esc(p.cid)}"${p.cid === sel ? " selected" : ""}>${esc(p.name)} · ${p.hist.length}</option>`).join("")}</optgroup>`).join("");
    $("progPer").innerHTML = PER.map(([d, t]) => `<button type="button" data-d="${d}" aria-pressed="${d === per}">${t}</button>`).join("");
    const p = by[sel], since = per >= 99999 ? "" : new Date(Date.now() - per * 864e5).toISOString().slice(0, 10);
    const hs = p.hist.filter(h => h.date >= since);
    const [mName, mf, mShort, mU] = metricOf(p), vals = hs.map(mf), u = mU ? " " + mU : "";
    const first = vals.find(v => v != null), last = [...vals].reverse().find(v => v != null), best = Math.max(...vals.filter(v => v != null));
    const d = first != null && last != null && hs.length > 1 ? last - first : null;
    $("progSum").innerHTML = hs.length ? `<span>${mShort} зараз <b class="num">${kg(last ?? 0)}</b>${u}</span><span>рекорд <b class="num">${kg(best)}</b>${u}</span>${d != null ? `<span class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : ""}${kg(d)}${u} за період</span>` : ""}<span class="muted">${hs.length} ${hs.length % 10 >= 1 && hs.length % 10 <= 4 && !(hs.length % 100 >= 11 && hs.length % 100 <= 14) ? "тренування" : "тренувань"}</span>` : `<span class="muted">За цей період записів немає.</span>`;
    $("progTbl").innerHTML = hs.length ? `<thead><tr><th>Дата</th><th>Найкращий підхід</th><th>${p.hist.some(h => h.e1) ? "1ПМ" : "Підходів"}</th><th>Тоннаж</th></tr></thead><tbody>${hs.slice(-8).reverse().map(h => `<tr><td class="num">${fd(h.date)}</td><td class="num">${esc(setTxt(p, h))}</td><td class="num">${h.e1 ? kg(Math.round(h.e1 * 10) / 10) + " кг" : h.sets}</td><td class="num">${h.ton ? Math.round(h.ton) + " кг" : "—"}</td></tr>`).join("")}</tbody>` : "";
    $("progNote").textContent = p.hist.some(h => h.e1) ? "1ПМ — оцінка максимуму на один повтор за найкращим підходом (формула Еплі, 1–12 повторів). Росте і від ваги, і від повторів: зручно порівнювати тренування з різними схемами." : p.type === "time" ? "Найдовше утримання за тренування." : p.type === "bw" ? "Сума повторів у виконаних підходах." : "Найбільша вага за тренування; для махів і перенесень 1ПМ не рахується.";
    if (typeof Chart === "undefined") { $("progChart").parentElement.hidden = true; return; }
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    chart?.destroy();
    const hasTon = hs.some(h => h.ton);
    chart = new Chart($("progChart"), {
      data: { labels: hs.map(h => fd(h.date)), datasets: [
        { type: "line", label: mName, data: vals, borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2.5, pointRadius: 4, tension: .25, spanGaps: true, yAxisID: "y", order: 1 },
        ...(hasTon ? [{ type: "bar", label: "Тоннаж, кг", data: hs.map(h => h.ton ? Math.round(h.ton) : null), backgroundColor: css("--line"), yAxisID: "t", order: 2 }] : []),
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: { x: { ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true } }, y: { position: "left", title: { display: true, text: mName, font: { size: 11 } }, grace: "10%" },
          ...(hasTon ? { t: { position: "right", grid: { display: false }, title: { display: true, text: "Тоннаж", font: { size: 11 } }, beginAtZero: true } } : {}) } },
    });
  }
  document.addEventListener("change", e => { if (e.target.id === "progEx") { sel = e.target.value; lw("td_sp_ex", sel); render(); } });
  document.addEventListener("click", e => { const b = e.target.closest("#progPer [data-d]"); if (b) { per = +b.dataset.d; lw("td_sp_per", per); render(); } });
  addEventListener("strength:render", render);
  window.SP = { render, collect };
})();
