"use strict";
// Огляд → «Перевірка FTP»: встановлений FTP проти оцінок з даних — eFTP intervals.icu, моделей кривої потужності
// і 95% найкращих 20 хв за 42 дні. Розходження понад 5% — плашка з рекомендацією: тест або нове значення.
// Від FTP рахуються зони, ватті в планах вело і відсотки інтенсивності, тож завищений FTP робить кожен заїзд важчим.
// Окремий файл: щоб прибрати — видалити його і рядок <script> в index.html.
window.FTPC = (() => {
  const med = a => { const b = a.filter(v => v > 0).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
  const r5 = v => Math.round(v / 5) * 5;
  const pct = v => (v > 0 ? "+" : "") + Math.round(v * 100) + "%";

  function evaluate() {
    const O = window.OV; if (!O?.P) return null;
    const P = O.P, ftp = P.zones?.ftp; if (!ftp) return null;
    const c = s => P.curve?.find(x => x[0] === s)?.[1];
    const b20 = c(1200), b5 = c(300), allB20 = P.curveAll?.find(x => x[0] === 1200)?.[1];
    const models = (P.models || []).map(m => m[1]).filter(Boolean);
    const est = [
      P.eftp?.raw && ["eFTP intervals.icu", P.eftp.raw],
      models.length && ["Моделі кривої (медіана)", Math.round(med(models))],
      b20 && ["95% найкращих 20 хв", Math.round(b20 * .95)],
    ].filter(Boolean);
    if (!est.length) return null;
    const ref = Math.round(med(est.map(e => e[1])));
    const diff = (ftp - ref) / ref;
    const t = WK.today(), since = WK.addDays(t, -42);
    const test = O.acts.filter(a => a.sport === "bike" && a.day >= since && /ftp|ramp|тест|test/i.test(a.name || "")).at(-1);
    // без максимальних зусиль за 42 дні оцінки занижені: найкращі 20 хв помітно нижчі за рекорд, тесту не було
    const noMax = !test && allB20 && b20 && b20 < allB20 * .9;
    const level = Math.abs(diff) <= .05 ? "ok" : noMax && diff > 0 ? "maybe" : diff > 0 ? "high" : "low";
    return { ftp, ref, diff, est, test, noMax, b20, allB20, b5, level, wt: P.weight };
  }

  function render() {
    const R = evaluate(), box = document.getElementById("ftpCheck"); if (!R || !box) return;
    const fd = s => { const [, m, d] = s.split("-"); return `${+d}.${m}`; };
    const tone = { ok: "good", maybe: "warn", high: "bad", low: "warn" }[R.level];
    const head = {
      ok: `FTP ${R.ftp} Вт відповідає даним (оцінка ${R.ref} Вт, ${pct(R.diff)}).`,
      maybe: `FTP ${R.ftp} Вт на ${pct(R.diff)} вищий за оцінку ${R.ref} Вт, але максимальних зусиль за 42 дні не було — оцінка, ймовірно, занижена.`,
      high: `FTP ${R.ftp} Вт, ймовірно, завищений: дані дають ${R.ref} Вт (${pct(R.diff)}).`,
      low: `FTP ${R.ftp} Вт, ймовірно, занижений: дані дають ${R.ref} Вт (${pct(R.diff)}).`,
    }[R.level];
    const advice = {
      ok: "Перевір знову після 4–6 тижнів тренувань або після тесту.",
      maybe: `Найкращі 20 хв за 42 дні — ${R.b20} Вт проти ${R.allB20} Вт за весь час. Зроби тест у свіжий день (форма вище 0, готовність від 70): рамп-тест або 20 хв на максимум після розминки. До тесту плани вело на ${R.ftp} Вт можуть бути заважкі — орієнтуйся на пульс і відчуття.`,
      high: `Зони й ватті в планах рахуються від ${R.ftp} Вт, тож sweet spot і темп зараз важчі, ніж задумано. Варіанти: зробити тест у свіжий день або встановити ${r5(R.ref)} Вт в intervals.icu (Settings → Cycling → FTP) — план і зони перерахуються.`,
      low: `Тренування на ${R.ftp} Вт зараз легші, ніж задумано. Встанови ${r5(R.ref)} Вт в intervals.icu (Settings → Cycling → FTP) або підтверди тестом.`,
    }[R.level];
    box.className = `card ftpc ftpc-${tone}`;
    box.innerHTML = `<h3>Перевірка FTP</h3><p class="ftpc-h"><b>${head}</b></p><p class="note">${advice}</p>
      <dl class="kv">${R.est.map(([n, v]) => `<dt>${n}</dt><dd>${v} Вт${R.wt ? ` · ${(v / R.wt).toFixed(2).replace(".", ",")} Вт/кг` : ""}</dd>`).join("")}<dt>Встановлений FTP</dt><dd>${R.ftp} Вт</dd><dt>Останній тест за 42 дні</dt><dd>${R.test ? `${fd(R.test.day)} · ${WK.esc ? WK.esc(R.test.name) : R.test.name}` : "не було"}</dd></dl>`;
    window.FTPC_STATE = R;
  }
  if (window.AUTH) AUTH.ready.then(() => { const f = () => window.OV ? render() : setTimeout(f, 200); f(); });
  return { evaluate, render };
})();
