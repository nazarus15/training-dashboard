"use strict";
// Огляд → прогноз фітнесу, втоми і форми за планом (модель Банистера, як в intervals.icu: CTL — 42 дні, ATL — 7).
// Навантаження запланованих тренувань: вело — з intervals.icu (план там уже має навантаження), решта — з твоєї
// середньої ціни хвилини цього виду за 8 тижнів × тривалість у плані. Сьогодні: виконане + ще не виконане з плану.
// Малюється пунктиром на графіку «Фітнес, втома, форма» + висновок під ним. Окремий файл: щоб прибрати — видалити його
// і рядок <script> в index.html (app.js без нього малює графік як раніше).
window.FC = (() => {
  const SPMAP = { bike: "bike", strength: "str", bjj: "bjj", run: "other", other: "other" };
  const DEF_MIN = { bike: 60, str: 70, bjj: 90, other: 45 };
  let DAYS = [], SUM = null;
  const fx = (v, d = 0) => v == null || isNaN(v) ? "—" : (+v).toFixed(d).replace(".", ",");
  const dS = s => { const [, m, d] = s.split("-"); return `${+d}.${m}`; };

  function compute(PD, EV) {
    const O = window.OV; if (!O?.wr?.length) return;
    const t = WK.today(), base = [...O.wr].reverse().find(r => r.date < t && r.ctl != null);
    if (!base) return;
    // ціна хвилини кожного виду за 8 тижнів (навантаження intervals.icu / хв)
    const since = WK.addDays(t, -56), rate = {}, mins = {};
    for (const a of O.acts) if (a.day >= since && a.load && a.moving) { (rate[a.sport] ??= []).push(a.load / (a.moving / 60)); (mins[a.sport] ??= []).push(a.moving / 60); }
    const avg = x => x?.length ? x.reduce((p, c) => p + c, 0) / x.length : null;
    const allRate = avg(Object.values(rate).flat()) || 0.6;
    const horizonEnd = WK.addDays(t, 27);
    const items = WK.items(PD || { workouts: [], recurring: [] }, EV, t, horizonEnd);
    const lastPlan = items.reduce((m, it) => it.date > m ? it.date : m, t);
    const to = lastPlan < WK.addDays(t, 13) ? WK.addDays(t, 13) : lastPlan;
    const doneToday = new Set(O.acts.filter(a => a.day === t).map(a => a.sport));
    const est = it => {
      const sp = SPMAP[it.sport] || "other";
      if (it.load) return it.load;
      const m = it.mins || Math.round(avg(mins[sp]) || DEF_MIN[sp] || 60);
      return Math.round((avg(rate[sp]) ?? allRate) * m);
    };
    let ctl = base.ctl, atl = base.atl, planned = 0, n = 0;
    const out = [];
    for (let d = t; d <= to; d = WK.addDays(d, 1)) {
      const its = items.filter(it => it.date === d && !(d === t && doneToday.has(SPMAP[it.sport] || "other")));
      const pl = its.reduce((s, it) => s + est(it), 0);
      const load = (d === t ? (O.loadByDay[t] || 0) : 0) + pl;
      planned += pl; if (pl) n += its.length;
      ctl += (load - ctl) / 42; atl += (load - atl) / 7;
      if (d > t) out.push({ date: d, load: pl || null, ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10, n: its.length });
      else out.unshift({ date: d, today: true, ctl, atl });
    }
    // без жодного тренування — для порівняння
    let c0 = base.ctl; for (let d = t; d <= to; d = WK.addDays(d, 1)) c0 += ((d === t ? (O.loadByDay[t] || 0) : 0) - c0) / 42;
    DAYS = out.filter(x => !x.today);
    const end = DAYS.at(-1), days = DAYS.length + 1, minT = DAYS.reduce((m, x) => x.tsb < m.tsb ? x : m, DAYS[0]), maxT = DAYS.reduce((m, x) => x.tsb > m.tsb ? x : m, DAYS[0]);
    SUM = { from: base.ctl, end, days, ramp: (end.ctl - base.ctl) / days * 7, rest: c0, minT, maxT, n, planned: Math.round(planned), lastPlan: lastPlan > t ? lastPlan : null };
  }

  function render() {
    const box = document.getElementById("fcNote"); if (!box) return;
    if (!SUM) { box.hidden = true; return; }
    const s = SUM, r = s.ramp;
    const tone = r > 7 || s.minT.tsb < -30 ? "bad" : r < 0 ? "warn" : r <= 5 ? "good" : "warn";
    box.hidden = false;
    box.className = "fc-note fc-" + tone;
    box.innerHTML = s.n
      ? `<b>Прогноз за планом</b> (${s.n} ${s.n % 10 >= 1 && s.n % 10 <= 4 && !(s.n % 100 >= 11 && s.n % 100 <= 14) ? "тренування" : "тренувань"} до ${dS(s.lastPlan || s.end.date)}): фітнес ${fx(s.from, 1)} → <b>${fx(s.end.ctl, 1)}</b> за ${s.days} дн. (${r >= 0 ? "+" : ""}${fx(r, 1)} на тиждень), форма на ${dS(s.end.date)} — <b>${s.end.tsb > 0 ? "+" : ""}${fx(s.end.tsb, 1)}</b>. Найважче — ${dS(s.minT.date)} (форма ${fx(s.minT.tsb, 1)}). Без тренувань фітнес упав би до ${fx(s.rest, 1)}.
        ${r > 7 ? " Ріст понад 7 на тиждень — ризик перевантаження, розріди план." : s.minT.tsb < -30 ? " Форма нижче −30 — зона ризику перевтоми." : r < 0 ? " План не тримає поточний фітнес: він знижуватиметься." : r <= 5 ? " Стійкий ріст (до 3–5 на тиждень)." : ""}`
      : `<b>Прогноз:</b> у плані на 2 тижні нічого немає — фітнес за цей час упаде з ${fx(s.from, 1)} до ${fx(s.rest, 1)}. Запланувати — у <a href="planner.html">Планері</a>.`;
  }

  async function init() {
    const ready = () => new Promise(res => { const f = () => window.OV ? res() : setTimeout(f, 200); f(); });
    try {
      const [PD, EV] = await Promise.all([WK.loadPlanned(), fetch(`data/events.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null), ready()]);
      compute(PD, EV);
      render();
      if (DAYS.length && typeof PER !== "undefined") PER.on?.cPmc?.();
    } catch (e) { console.warn("forecast", e); }
  }
  if (window.AUTH) AUTH.ready.then(init);
  return { days: () => DAYS, summary: () => SUM };
})();
