"use strict";
// Силовий журнал → «Об'єм на групи м'язів»: виконані робочі підходи на тиждень за словником вправ (exercises.js).
// Основний м'яз вправи — 1 підхід, допоміжний — 0,5. Окремий файл: читає sessions і logs зі strength.js.
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const MON = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const monday = s => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
  const addD = (s, n) => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() + n); return iso(d); };
  const fd = s => { const d = new Date(s + "T12:00"); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const n1 = v => (Math.round(v * 2) / 2).toString().replace(".", ",");
  const PER = [[4, "4 тиж"], [8, "8 тиж"], [10, "10 тиж"], [12, "12 тиж"]];
  // орієнтир на тиждень: менше 6 — підтримка, 6–20 — робочий діапазон, понад 20 — забагато поруч із велосипедом і БЖЖ
  const LOW = 6, HIGH = 20;
  let weeksN = (() => { try { return +localStorage.getItem("td_sv_weeks") || 4; } catch { return 4; } })();

  function render() {
    const wrap = $("volWrap"); if (!wrap || !window.EX) return;
    const thisMon = monday(iso(new Date()));
    const weeks = Array.from({ length: weeksN }, (_, i) => addD(thisMon, -7 * (weeksN - 1 - i)));
    const vol = {}, unknown = new Set(); let any = false;
    for (const s of Object.values(typeof sessions === "object" ? sessions : {})) {
      const w = monday(s.date); if (w < weeks[0] || w > thisMon) continue;
      for (const ex of s.exercises || []) {
        const done = (logs?.[s.id]?.sets?.[ex.key] || []).filter(x => x.done).length;
        if (!done) continue;
        any = true;
        if (!EX.BY[ex.cid]) { unknown.add(ex.name); continue; }
        for (const [m, v] of Object.entries(EX.muscleSets(ex.cid, done))) ((vol[m] ??= {})[w] = (vol[m][w] || 0) + v);
      }
    }
    wrap.hidden = false;
    $("volPer").innerHTML = PER.map(([d, t]) => `<button type="button" data-w="${d}" aria-pressed="${d === weeksN}">${t}</button>`).join("");
    if (!any) { $("volBody").innerHTML = `<p class="muted" style="margin:0">За ${weeksN} тиж. немає виконаних підходів.</p>`; $("volUnk").textContent = ""; return; }
    const full = weeks.slice(0, -1); // поточний тиждень ще не закінчився — середнє за повні тижні
    const rows = Object.keys(EX.MUSCLES).map(m => {
      const per = weeks.map(w => vol[m]?.[w] || 0), cur = per.at(-1);
      const avg = full.length ? full.reduce((t, w) => t + (vol[m]?.[w] || 0), 0) / full.length : cur;
      return { m, per, cur, avg };
    }).sort((a, b) => b.avg - a.avg || b.cur - a.cur);
    const max = Math.max(HIGH + 4, ...rows.flatMap(r => r.per));
    const cls = v => v < LOW ? "lo" : v > HIGH ? "hi" : "ok";
    $("volBody").innerHTML = `<div class="vol-legend"><span><i class="lo"></i>менше ${LOW}</span><span><i class="ok"></i>${LOW}–${HIGH}</span><span><i class="hi"></i>понад ${HIGH}</span><span class="muted">підходів на тиждень</span></div>
      <div class="tbl-wrap"><table class="vol-tbl"><thead><tr><th>Група</th><th class="r" title="Середнє за повні тижні">Сер./тиж</th><th class="r">Цей тиж.</th><th title="${fd(weeks[0])} – ${fd(thisMon)}">По тижнях</th></tr></thead><tbody>${rows.map(r => `<tr>
        <td>${esc(EX.MUSCLES[r.m])}</td><td class="r num"><span class="vb ${cls(r.avg)}">${n1(r.avg)}</span></td><td class="r num">${n1(r.cur)}</td>
        <td><div class="vbars" aria-label="${esc(r.per.map((v, i) => `${fd(weeks[i])}: ${n1(v)}`).join(", "))}">${r.per.map((v, i) => `<i class="${cls(v)}${i === r.per.length - 1 ? " now" : ""}" style="height:${Math.max(2, v / max * 100)}%" title="${fd(weeks[i])}: ${n1(v)} підх."></i>`).join("")}<b style="bottom:${LOW / max * 100}%"></b><b style="bottom:${HIGH / max * 100}%"></b></div></td></tr>`).join("")}</tbody></table></div>`;
    $("volUnk").textContent = unknown.size ? `Не враховано (вправ немає в словнику): ${[...unknown].join(", ")}.` : "";
  }
  document.addEventListener("click", e => { const b = e.target.closest("#volPer [data-w]"); if (b) { weeksN = +b.dataset.w; try { localStorage.setItem("td_sv_weeks", weeksN); } catch { } render(); } });
  addEventListener("strength:render", render);
  window.SV = { render };
})();
