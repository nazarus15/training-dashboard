"use strict";
// Огляд → «Вага і Вт/кг»: зважування з intervals.icu (туди приходить вага з Garmin Connect) + записані на сайті,
// 7-денне середнє і Вт/кг за встановленим FTP та eFTP. Запис з сайту — у зашифрованому logs.json (ключ «w:<дата>»),
// через ту саму чергу, що й силові: працює без інтернету. Окремий файл: щоб прибрати — видалити його і рядок <script>.
window.WT = (() => {
  const $ = id => document.getElementById(id);
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lw = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  const fx = (v, d = 1) => v == null || isNaN(v) ? "—" : (+v).toFixed(d).replace(".", ",");
  const PER = [[28, "4 тиж"], [70, "10 тиж"], [91, "3 міс"], [182, "6 міс"], [365, "рік"]];
  let remote = {}, per = ls("td_wt_per", 91), chart = null;

  const logs = () => ({ ...(ls("td_logs_cache", {})?.logs || {}), ...remote, ...(ls("td_pending_logs", {}) || {}) });
  // усі зважування: сайт перемагає intervals.icu того ж дня
  function series() {
    const O = window.OV, m = {};
    for (const r of O?.wr || []) if (r.weight) m[r.date] = { kg: +r.weight, src: "intervals.icu" };
    for (const [k, v] of Object.entries(logs())) if (k.startsWith("w:") && v?.kg && !v.deleted) m[k.slice(2)] = { kg: +v.kg, src: "сайт" };
    return Object.entries(m).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date < b.date ? -1 : 1);
  }
  function save(date, kg) {
    const pend = ls("td_pending_logs", {}) || {};
    pend["w:" + date] = { kind: "weight", kg, updatedAt: new Date().toISOString() };
    lw("td_pending_logs", pend);
    WK.flushLogs("Вага: " + date).then(r => { if (r?.body) remote = r.body.logs || remote; msg(r?.ok ? "Збережено." : r?.kind === "offline" ? "Без зв'язку: збережено на пристрої." : r?.kind === "local" ? "Немає токена GitHub: лише на цьому пристрої." : r?.msg || ""); render(); });
    render();
  }
  const msg = t => { const el = $("wtMsg"); if (el) el.textContent = t; };

  function render() {
    const box = $("wtBody"), O = window.OV; if (!box || !O) return;
    const all = series(), t = WK.today(), since = WK.addDays(t, -per + 1);
    const pts = all.filter(p => p.date >= since);
    // 7-денне середнє по днях із зважуваннями
    const avg7 = d => { const w = all.filter(p => p.date <= d && p.date > WK.addDays(d, -7)); return w.length ? w.reduce((s, p) => s + p.kg, 0) / w.length : null; };
    const last = all.at(-1), cur = last ? avg7(last.date) : null;
    const ftp = O.P?.zones?.ftp, eftp = O.P?.eftp?.raw, prof = O.P?.weight;
    const base = all.filter(p => p.date <= WK.addDays(t, -28)).at(-1), d28 = base && cur ? cur - avg7(base.date) : null;
    const wkg = (w, kg) => w && kg ? fx(w / kg, 2) : "—";
    $("wtPer").innerHTML = PER.map(([d, n]) => `<button type="button" data-d="${d}" aria-pressed="${d === per}">${n}</button>`).join("");
    $("wtSum").innerHTML = last
      ? `<dl class="kv"><dt>Вага (7-денне середнє)</dt><dd><b>${fx(cur)} кг</b>${d28 != null ? ` · ${d28 > 0 ? "+" : ""}${fx(d28)} за 4 тиж.` : ""}</dd>
        <dt>Останнє зважування</dt><dd>${fx(last.kg)} кг · ${last.date.slice(8)}.${last.date.slice(5, 7)} (${last.src})</dd>
        ${ftp ? `<dt>FTP ${ftp} Вт</dt><dd>${wkg(ftp, cur)} Вт/кг</dd>` : ""}${eftp ? `<dt>eFTP ${eftp} Вт</dt><dd>${wkg(eftp, cur)} Вт/кг</dd>` : ""}
        ${prof && Math.abs(prof - cur) >= 1 ? `<dt>Вага в intervals.icu</dt><dd>${fx(prof)} кг — для правильних Вт/кг і рангів онови її там (Settings → Weight)</dd>` : ""}</dl>`
      : `<p class="note">Зважувань ще немає.</p>`;
    $("wtNote").textContent = all.filter(p => p.date >= WK.addDays(t, -28)).length < 4
      ? "Для тренду зважуйся 2–3 рази на тиждень зранці, до їжі: записуй тут або в Garmin Connect (звідти вага прийде через intervals.icu сама)."
      : "7-денне середнє згладжує коливання води; дивись на тренд, а не на окремий день.";
    if (typeof Chart === "undefined" || !$("wtChart")) return;
    chart?.destroy();
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const days = []; for (let d = since; d <= t; d = WK.addDays(d, 1)) days.push(d);
    const byD = Object.fromEntries(pts.map(p => [p.date, p.kg]));
    chart = new Chart($("wtChart"), {
      data: { labels: days.map(d => `${+d.slice(8)}.${d.slice(5, 7)}`), datasets: [
        { type: "line", label: "Зважування, кг", data: days.map(d => byD[d] ?? null), showLine: false, pointRadius: 3, borderColor: css("--accent"), backgroundColor: css("--accent"), yAxisID: "y" },
        { type: "line", label: "7-денне середнє", data: days.map(d => all.some(p => p.date <= d) && all.some(p => p.date >= since && p.date <= d) ? avg7(d) && Math.round(avg7(d) * 10) / 10 : null), borderColor: css("--accent-3"), borderWidth: 2, pointRadius: 0, tension: .3, spanGaps: true, yAxisID: "y" },
        ...(ftp ? [{ type: "line", label: "Вт/кг (FTP)", data: days.map(d => { const a = avg7(d); return a && all.some(p => p.date >= since && p.date <= d) ? Math.round(ftp / a * 100) / 100 : null; }), borderColor: css("--accent-2"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, spanGaps: true, yAxisID: "w" }] : []),
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { position: "left", grace: "5%", title: { display: true, text: "кг" } }, ...(ftp ? { w: { position: "right", grid: { display: false }, grace: "5%", title: { display: true, text: "Вт/кг" } } } : {}) } },
    });
  }
  function bind() {
    const f = $("wtForm"); if (!f || f.dataset.b) return; f.dataset.b = 1;
    $("wtDate").value = WK.today();
    f.onsubmit = e => {
      e.preventDefault();
      const kg = +String($("wtKg").value).replace(",", "."), d = $("wtDate").value || WK.today();
      if (!(kg >= 35 && kg <= 200)) { msg("Вага — від 35 до 200 кг."); return; }
      msg("Зберігаю…"); save(d, Math.round(kg * 10) / 10); $("wtKg").value = "";
    };
    $("wtPer").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (b) { per = +b.dataset.d; lw("td_wt_per", per); render(); } });
  }
  async function init() {
    const go = async () => {
      bind(); render();
      try { const x = await WK.ghGet("logs.json", "journal"); const d = x.data ? await AUTH.decrypt(x.data) : null; if (d?.logs) { remote = d.logs; render(); } } catch { }
    };
    const f = () => window.OV ? go() : setTimeout(f, 200); f();
  }
  if (window.AUTH) AUTH.ready.then(init);
  return { render, series };
})();
