"use strict";
// Огляд → «Ранні сигнали»: пульс спокою, HRV, дихання і SpO₂ уві сні, температура шкіри, стрес уві сні — минула ніч
// проти твоєї норми. Два і більше сигнали одночасно часто з'являються за 1–2 дні до симптомів застуди або на тлі
// перевтоми. Плашка вгорі — лише коли є сигнали; картка в «Відновленні» — завжди.
// Окремий файл: щоб прибрати — видалити його і рядок <script> в index.html.
window.HW = (() => {
  const fx = (v, d = 0) => v == null || isNaN(v) ? "—" : (+v).toFixed(d).replace(".", ",");
  const mean = a => a.length ? a.reduce((p, c) => p + c, 0) / a.length : null;
  const sd = a => { const m = mean(a); return a.length > 2 ? Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / (a.length - 1)) : null; };
  const num = v => v == null || v === "" || isNaN(+v) ? null : +v;

  function evaluate() {
    const O = window.OV; if (!O) return null;
    const G = O.G || {}, t = WK.today(), rows = [];
    // пульс спокою і HRV — wellness intervals.icu (з Garmin), норма — 30 попередніх днів
    const wr = O.wr.filter(r => r.date <= t), last = wr.at(-1);
    const prev = wr.filter(r => r.date < (last?.date || t)).slice(-30);
    const add = (key, name, unit, cur, base, digits, rule) => {
      const b = base.filter(v => v != null);
      if (cur == null || b.length < 5) { rows.push({ key, name, unit, cur, norm: b.length ? mean(b) : null, st: "nd", note: b.length < 5 ? "мало даних для норми" : "немає даних за ніч" }); return; }
      const m = mean(b), s = sd(b) || 0, z = s ? (cur - m) / s : 0;
      const r = rule(cur, m, s, z);
      rows.push({ key, name, unit, cur, norm: m, z, digits, st: r[0], note: r[1] });
    };
    add("rhr", "Пульс спокою", "уд/хв", num(last?.rhr), prev.map(r => num(r.rhr)), 0, (c, m, s, z) => c - m >= 5 || (c - m >= 3 && z >= 2) ? ["bad", `+${fx(c - m)} до норми`] : c - m >= 3 || z >= 1.5 ? ["warn", `+${fx(c - m)} до норми`] : ["ok", "у нормі"]);
    add("hrv", "HRV уночі", "мс", num(last?.hrv), prev.map(r => num(r.hrv)), 0, (c, m, s, z) => z <= -2 ? ["bad", `${fx((c / m - 1) * 100)}% від норми`] : z <= -1.3 ? ["warn", `${fx((c / m - 1) * 100)}% від норми`] : ["ok", "у нормі"]);
    // сон Garmin: 7 ночей (норма — попередні ночі) + денні підсумки за 28 днів
    const sc = G.sleepCols || [], sw = (G.sleepWeek || []).map(r => Object.fromEntries(sc.map((c, i) => [c, r[i]])));
    const lastN = sw.at(-1), prevN = sw.slice(0, -1);
    const dc = G.dailyCols || [], dd = (G.daily || []).map(r => Object.fromEntries(dc.map((c, i) => [c, r[i]]))).filter(r => r.date < t);
    const respCur = num(G.sleepNight?.resp?.[0] ?? lastN?.resp);
    add("resp", "Дихання уві сні", "вд/хв", respCur, prevN.map(r => num(r.resp)), 1, (c, m) => c - m >= 1.5 ? ["bad", `+${fx(c - m, 1)} до норми`] : c - m >= 0.8 ? ["warn", `+${fx(c - m, 1)} до норми`] : ["ok", "у нормі"]);
    const spoCur = num(G.sleepNight?.spo2?.[0] ?? lastN?.spo2), spoMin = num(G.sleepNight?.spo2?.[1]);
    add("spo2", "SpO₂ уві сні", "%", spoCur, [...prevN.map(r => num(r.spo2)), ...dd.map(r => num(r.spo2))], 0, (c, m) => m - c >= 3 || (spoMin != null && spoMin < 88) ? ["bad", `${fx(c - m)} до норми${spoMin != null ? `, мінімум ${spoMin}%` : ""}`] : m - c >= 2 ? ["warn", `${fx(c - m)} до норми`] : ["ok", "у нормі"]);
    const st = num(lastN?.stress);
    add("sstress", "Стрес уві сні", "", st, prevN.map(r => num(r.stress)), 0, (c, m) => c - m >= 10 ? ["bad", `+${fx(c - m)} до норми`] : c - m >= 6 ? ["warn", `+${fx(c - m)} до норми`] : ["ok", "у нормі"]);
    // температура шкіри: Garmin уже віддає відхилення від твоєї норми
    const tmp = num(lastN?.skinTempC);
    if (tmp != null) rows.push({ key: "temp", name: "Температура шкіри", unit: "°C", cur: tmp, norm: 0, digits: 1, st: tmp >= 0.8 ? "bad" : tmp >= 0.5 ? "warn" : "ok", note: tmp >= 0.5 ? `+${fx(tmp, 1)} °C до норми` : "у нормі", dev: true });
    // пульс спокою вище норми другий день поспіль — сильніший сигнал
    const r2 = wr.at(-2), m30 = mean(prev.map(r => num(r.rhr)).filter(v => v != null));
    const rhrTwo = r2?.rhr != null && m30 != null && r2.rhr - m30 >= 3 && rows.find(r => r.key === "rhr")?.st !== "ok";
    const score = rows.reduce((s, r) => s + (r.st === "bad" ? 2 : r.st === "warn" ? 1 : 0), 0) + (rhrTwo ? 1 : 0);
    const flagged = rows.filter(r => r.st === "bad" || r.st === "warn");
    const level = flagged.length >= 2 && score >= 3 ? "bad" : flagged.length >= 2 || score >= 2 ? "warn" : flagged.length ? "watch" : "ok";
    return { rows, level, flagged, rhrTwo, night: lastN?.date || last?.date };
  }

  function render() {
    const R = evaluate(); if (!R) return;
    const card = document.getElementById("hwCard"), ban = document.getElementById("hwBanner");
    const L = { ok: ["Усе в нормі", "good"], watch: ["Один показник поза нормою", "warn"], warn: ["Кілька показників поза нормою", "warn"], bad: ["Схоже на початок хвороби або перевтому", "bad"] }[R.level];
    if (card) card.innerHTML = `<h3>Ранні сигнали</h3>
      <p class="note">Минула ніч проти твоєї норми: пульс спокою і HRV — 30 днів, дихання, SpO₂ і стрес уві сні — попередні ночі, температура — відхилення від норми за Garmin. Два і більше сигнали разом часто з'являються за 1–2 дні до симптомів застуди або на тлі перевтоми.</p>
      <p class="hw-sum hw-${L[1]}"><b>${L[0]}.</b>${R.rhrTwo ? " Пульс спокою вище норми другий день поспіль." : ""}</p>
      <table class="hw-tbl"><thead><tr><th>Показник</th><th class="r">Минула ніч</th><th class="r">Норма</th><th>Стан</th></tr></thead><tbody>${R.rows.map(r => `<tr><td>${r.name}</td><td class="r num">${r.dev ? (r.cur > 0 ? "+" : "") : ""}${fx(r.cur, r.digits)} ${r.unit}</td><td class="r num">${r.dev ? "0" : fx(r.norm, r.digits)} ${r.norm != null ? r.unit : ""}</td><td><span class="hw-dot hw-${r.st}"></span>${r.note}</td></tr>`).join("")}</tbody></table>`;
    if (ban) {
      ban.hidden = R.level === "ok" || R.level === "watch";
      if (!ban.hidden) ban.innerHTML = `<b>${L[0]}.</b> ${R.flagged.map(r => `${r.name.toLowerCase()} ${r.note}`).join("; ")}.${R.level === "bad" ? " Сьогодні краще легкий день або відпочинок, більше сну і рідини; якщо з'являться симптоми — без інтенсивних тренувань." : " Якщо план важкий — зменш інтенсивність і подивись завтрашні цифри."} <a href="#hwCard">Деталі</a>`;
      ban.className = `hw-banner hw-${L[1]}`;
    }
    window.HW_STATE = R;
  }
  if (window.AUTH) AUTH.ready.then(() => { const f = () => window.OV ? render() : setTimeout(f, 200); f(); });
  return { evaluate, render };
})();
