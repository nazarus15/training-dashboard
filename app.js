"use strict";
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $ = id => document.getElementById(id);
const fmtDur = s => { if (s == null) return "—"; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, "0")}` : `${m} хв`; };
const dShort = d => { const [, m, dd] = d.split("-"); return `${+dd}.${m}`; };
const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const sd = a => { const v = a.filter(x => x != null); const m = avg(v); return v.length ? Math.sqrt(avg(v.map(x => (x - m) ** 2))) : null; };
const fx = (v, n = 0) => v == null || isNaN(v) ? "—" : (+v).toFixed(n);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function alpha(v, a) { const c = css(v); if (c.startsWith("#")) { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; } return c; }
function noData(canvasId, text) { const c = $(canvasId); if (c) c.parentElement.innerHTML = `<p class="note" style="margin:auto">${text}</p>`; }

const PART_NAMES = { athlete: "профіль", wellness: "wellness", activities: "активності", power: "потужність", events: "календар", hrv: "HRV за тиждень", hrvNight: "HRV за ніч", sleep: "сон", sleepWeek: "сон за тиждень", daily: "денні підсумки", fitnessAge: "фітнес-вік" };

const load = name => AUTH.load(name);

const loadJournal = () => fetch(`https://raw.githubusercontent.com/nazarus15/training-dashboard/journal/logs.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(j => AUTH.decrypt(j)).catch(() => null);
AUTH.ready.then(() => Promise.all([...["wellness", "activities", "power", "garmin", "status", "events"].map(load), loadJournal(), WK.loadPlanned()]).then(([W, A, P, G, S, EV, JL, PD]) => {
  renderStatus(S, G);
  if (!W || !A) { $("strip").innerHTML = `<div class="tile">Не вдалося завантажити дані intervals.icu.</div>`; return; }
  run(W, A, P || {}, G || {}, PD, EV, JL);
}));

function renderStatus(S, G) {
  const box = $("status");
  if (!S) { box.innerHTML = `<div class="alert" style="--c:var(--warn)"><b>Статус</b>Файл статусу не знайдено.</div>`; return; }
  const at = new Date(S.generatedAt);
  const ageH = (Date.now() - at.getTime()) / 36e5;
  $("updated").textContent = `Оновлено: ${at.toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  const hist = (S.history || []).slice(-14).map(h => `<i title="${esc(h.at)}: intervals ${h.intervals ? "ok" : "помилка"}, Garmin ${h.garmin ? "ok" : "помилка"}" style="background:var(${h.intervals && h.garmin ? "--good" : h.intervals ? "--warn" : "--bad"})"></i>`).join("");
  const partsList = parts => Object.entries(parts || {}).map(([k, v]) => `<li>${esc(PART_NAMES[k] || k)}: ${esc(v)}</li>`).join("");
  const out = [];
  if (ageH > 30) out.push(`<div class="alert" style="--c:var(--warn)"><b>Дані застаріли</b>Останнє оновлення ${Math.round(ageH)} год тому. Перевір вкладку Actions у репозиторії.</div>`);
  const iv = S.intervals || {};
  if (!iv.ok) out.push(`<div class="alert" style="--c:var(--bad)"><b>intervals.icu</b>${esc(iv.error || "помилка оновлення")}${Object.keys(iv.parts || {}).length ? `<details><summary>Деталі</summary><ul>${partsList(iv.parts)}</ul></details>` : ""}</div>`);
  const ga = S.garmin || {};
  const gDate = ga.dataDate || G?.date;
  const garminOk = ga.ok;
  out.push(`<div class="alert" style="--c:var(${garminOk ? "--good" : ga.dataDate === S.generatedAt.slice(0, 10) ? "--warn" : "--bad"})"><b>Garmin</b>${garminOk ? `Усі запити успішні${ga.auth ? ` · вхід: ${esc(ga.auth)}` : ""}` : esc(ga.error || "помилка")}${!garminOk && gDate ? ` · показано дані Garmin за ${esc(gDate)}` : ""}<span class="hist" aria-label="Історія оновлень за 14 днів">${hist}</span>${Object.keys(ga.parts || {}).length ? `<details><summary>Деталі запитів</summary><ul>${partsList(ga.parts)}</ul></details>` : ""}</div>`);
  box.innerHTML = out.join("");
}

function run(W, A, P, G, PD, EV, JL) {
  // ---------- data prep ----------
  const wr = W.rows.map(r => Object.fromEntries(W.cols.map((c, i) => [c, r[i]])));
  wr.forEach(r => r.tsb = r.ctl != null && r.atl != null ? +(r.ctl - r.atl).toFixed(1) : null);
  let acts = A.rows.map(r => Object.fromEntries(A.cols.map((c, i) => [c, r[i]])));
  const seen = new Set();
  acts = acts.filter(a => { if (!a.moving || a.moving < 60) return false; const k = a.date + a.moving; if (seen.has(k)) return false; seen.add(k); return true; });
  // силові з Garmin, яких ще немає в intervals.icu
  const tmin = s => new Date(s).getTime() / 6e4;
  (G.activities || []).filter(g => /strength|fitness_equipment|hiit/i.test(g.type || "")).forEach(g => {
    if (!acts.some(a => Math.abs(tmin(a.date) - tmin(g.start)) < 6)) acts.push({ date: g.start, type: "Strength", name: g.name || "Силове", moving: g.durS, kcal: g.kcal, avgHr: g.avgHr, maxHr: g.maxHr, load: null, device: "Garmin" });
  });
  const isMMA = a => /mixed martial|бжж|bjj|jiu/i.test(a.name || "");
  const sportOf = a => {
    if (/Ride$|Cyclocross/.test(a.type || "")) return "bike";
    if (a.type === "BJJ") return "bjj";
    if (isMMA(a)) { const h = +a.date.slice(11, 13); return a.moving >= 1800 && (h >= 17 && h <= 21 || (a.avgHr ?? 100) >= 100) ? "bjj" : "other"; }
    if (a.type === "Strength" || a.type === "WeightTraining" || /strength|силов/i.test(a.name || "")) return "str";
    if (/Hike|SUP|StandUpPaddling|Swim|Kayak|Rowing|Ski/.test(a.type || "")) return "rest";
    return "other";
  };
  const SPORTS = { bike: ["Велосипед", "--z2"], bjj: ["БЖЖ", "--accent-3"], str: ["Сила", "--accent-2"], other: ["Інше", "--z1"], rest: ["Похід / SUP", "--z3"] };
  acts.forEach(a => { a.sport = sportOf(a); a.day = a.date.slice(0, 10); });
  acts.sort((a, b) => a.date < b.date ? -1 : 1);

  const today = wr[wr.length - 1];
  const shift = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const since42 = shift(today.date, -42), since70 = shift(today.date, -70);
  const loadByDay = {}; acts.forEach(a => { if (a.load) loadByDay[a.day] = (loadByDay[a.day] || 0) + a.load; });
  const mondayOf = d => { const dt = new Date(d + "T12:00:00"); const wd = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - wd); return dt.toISOString().slice(0, 10); };
  const weeks = {};
  acts.forEach(a => { const w = mondayOf(a.day); if (w < mondayOf(since70)) return; weeks[w] ??= { bike: 0, bjj: 0, str: 0, other: 0, rest: 0, secs: 0 }; weeks[w][a.sport] += a.load || 0; weeks[w].secs += a.moving || 0; });
  const weekKeys = Object.keys(weeks).sort();

  const days = wr.map(r => r.date);
  const mono = [];
  for (let i = 6; i < days.length; i++) { if (days[i] < since70) continue; const win = days.slice(i - 6, i + 1).map(d => loadByDay[d] || 0); const m = avg(win), s = sd(win); const tot = win.reduce((x, y) => x + y, 0); mono.push({ d: days[i], mono: s ? +(m / s).toFixed(2) : null, strain: s ? Math.round(tot * m / s) : null }); }
  const lastMono = mono[mono.length - 1] || {};

  const firstHrv = wr.findIndex(r => r.hrv != null);
  const hrvRows = wr.slice(Math.max(0, firstHrv, wr.length - 75));
  hrvRows.forEach((r, i) => { const v = avg(hrvRows.slice(Math.max(0, i - 6), i + 1).map(x => x.hrv)); r.hrv7 = v != null ? +v.toFixed(1) : null; });
  const last30 = hrvRows.slice(-30);
  const hrv30 = avg(last30.map(r => r.hrv)), hrvSd30 = sd(last30.map(r => r.hrv)), rhr30 = avg(last30.map(r => r.rhr));
  const lastSleep = [...wr].reverse().find(r => r.sleepSecs);

  const hrz = {}; acts.filter(a => a.day >= since42 && a.hrZones).forEach(a => { hrz[a.sport] ??= [0, 0, 0, 0, 0]; a.hrZones.slice(0, 5).forEach((s, i) => hrz[a.sport][i] += s || 0); });
  const allZ = [0, 0, 0, 0, 0]; Object.values(hrz).forEach(z => z.forEach((s, i) => allZ[i] += s));
  const totZ = allZ.reduce((a, b) => a + b, 0) || 1;
  const lowPct = Math.round((allZ[0] + allZ[1]) / totZ * 100), midPct = Math.round(allZ[2] / totZ * 100), hiPct = 100 - lowPct - midPct;
  const bikeZ = hrz.bike || [0, 0, 0, 0, 0], bikeTot = bikeZ.reduce((a, b) => a + b, 0) || 1;
  const bikeMid = Math.round(bikeZ[2] / bikeTot * 100);
  const last6 = acts.filter(a => a.day >= since42);
  const cnt = s => last6.filter(a => a.sport === s).length;
  const hrsOf = s => last6.filter(a => a.sport === s).reduce((x, a) => x + (a.moving || 0), 0) / 3600;
  const Z = P.zones || {}, ftp = Z.ftp, wt = P.weight || today.weight;
  const pRides = acts.filter(a => a.np).slice(-6);
  const decs = pRides.filter(a => a.decoupling != null && a.moving >= 2700);



  // ---------- plan: 2 тижні з Планера й календаря intervals.icu ----------
  (function renderPlan() {
    $("planSec").hidden = false;
    const todayISO = WK.today(), from = WK.monday(todayISO), to = WK.addDays(from, 13);
    const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"], MON = ["січ.", "лют.", "бер.", "квіт.", "трав.", "черв.", "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."];
    const dd = s => new Date(s + "T12:00:00");
    const rng = (a, b) => { const x = dd(a), y = dd(b); return x.getMonth() === y.getMonth() ? `${x.getDate()}–${y.getDate()} ${MON[y.getMonth()]}` : `${x.getDate()} ${MON[x.getMonth()]} – ${y.getDate()} ${MON[y.getMonth()]}`; };
    const SPA = { strength: "str", bike: "bike", bjj: "bjj" };
    const its = WK.items(PD, EV, from, to);
    let planned = 0, done = 0, missed = 0;
    const dayHead = s => { const d = dd(s); return `<span class="d">${DOW[d.getDay()]}<b>${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}</b></span>`; };
    const card = it => {
      const [sn, sc] = WK.SPORT[it.sport] || WK.SPORT.other;
      const sp = SPA[it.sport];
      const actual = sp ? acts.filter(a => a.day === it.date && a.sport === sp) : [];
      const jl = it.id ? JL?.logs?.[it.id] : null;
      let pill;
      if (it.date <= todayISO) planned++;
      if (jl?.status === "skipped") { missed++; pill = `<span class="pill grey">Пропущено</span>`; }
      else if (actual.length || jl?.status === "done") { done++; pill = `<span class="pill good">Виконано</span>`; }
      else if (it.date < todayISO) { missed++; pill = `<span class="pill bad">Пропущено</span>`; }
      else if (it.date === todayISO) pill = `<span class="pill warn">Сьогодні</span>`;
      else pill = `<span class="pill grey">План</span>`;
      const main = it.fx?.main ? WK.FX[it.fx.main] : null;
      const detail = [WK.fmtMin(it.mins), it.time, it.load ? `навант. ${it.load}` : ""].filter(Boolean).join(" · ");
      const act = actual.length ? actual.map(a => `Факт: ${fmtDur(a.moving)}${a.np ? ` · NP ${a.np} Вт` : ""}${a.load ? ` · навант. ${a.load}` : ""}${a.avgHr ? ` · пульс ${a.avgHr}` : ""}`).join("<br>") : "";
      const s = it.sess;
      const exList = s?.exercises?.length ? `<details><summary>Вправи (${s.exercises.length})</summary><ol>${s.exercises.map(e => `<li><b>${esc(e.name)}</b><span class="num">${e.sets}×${esc(e.reps)}${e.type === "time" ? " с" : ""}${e.perSide ? "/бік" : ""}</span></li>`).join("")}</ol></details>` : "";
      const title = it.sport === "strength" ? `<a href="strength.html?s=${encodeURIComponent(it.id)}">${esc(it.title)}</a>` : esc(it.title);
      return `<div class="pday${it.date === todayISO ? " today" : ""}">${dayHead(it.date)}<span class="t"><span class="kline"><span class="kk"><span class="k" style="--kc:${sc}">${sn}</span>${main ? `<span class="fxtag" style="--c:${main.color}">${main.name}</span>` : ""}</span>${pill}</span><strong>${title}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}${act ? `<small class="act">${act}</small>` : ""}${WK.barsHtml(it.fx)}${exList}</span></div>`;
    };
    const html = [0, 7].map(o => {
      const ws = WK.addDays(from, o);
      const days = Array.from({ length: 7 }, (_, i) => WK.addDays(ws, i));
      return `<div class="pweek"><h3>${o ? "Наступний тиждень" : "Цей тиждень"} · ${rng(days[0], days[6])}</h3>${days.map(d => {
        const di = its.filter(x => x.date === d);
        return di.length ? di.map(card).join("") : `<div class="pday rest${d === todayISO ? " today" : ""}">${dayHead(d)}<span class="t"><small>Відпочинок</small></span></div>`;
      }).join("")}</div>`;
    }).join("");
    $("plan").innerHTML = html + WK.legendHtml();
    $("planSummary").textContent = `${planned ? `Виконано ${done} із ${planned} тренувань на сьогодні${missed ? `, пропущено ${missed}` : ""}. ` : ""}Заплановано на два тижні: ${its.length}. Відмітки ставляться автоматично: силові — за журналом, решта — за записаними тренуваннями.`;
  })();


  // ---------- readiness (власний розрахунок) ----------
  const R = (() => {
    const comps = [];
    const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
    const hwL = G.hrvWeek?.at(-1), hb = G.hrvBaseline;
    if (hwL?.[2] && hb) { const v = hwL[2]; const s = v >= hb.balLow && v <= hb.balUp ? 100 : v > hb.balUp ? 85 : v > hb.low ? 65 : 30; comps.push(["HRV минулої ночі", s, .25, `${v} мс, норма ${hb.balLow}–${hb.balUp}`]); }
    const dl = (G.daily || []).map(r => Object.fromEntries((G.dailyCols || []).map((c, i) => [c, r[i]])));
    const rToday = dl.at(-1)?.rhr, rBase = avg(dl.slice(0, -1).map(x => x.rhr));
    if (rToday && rBase) { const d = rToday - rBase; comps.push(["Пульс спокою", clamp(100 - Math.max(0, d) * 14), .15, `${rToday} уд/хв, норма ${fx(rBase, 1)}`]); }
    const sn = G.sleepNight;
    if (sn?.score) comps.push(["Сон минулої ночі", sn.score, .25, `оцінка ${sn.score}`]);
    const s3 = avg((G.sleepWeek || []).slice(-3).map(r => r[1]));
    if (s3) comps.push(["Сон за 3 ночі", clamp(s3), .1, `середня оцінка ${fx(s3)}`]);
    const lh = (G.loadHistory || []).at(-1);
    if (lh?.[3] != null) { const r = lh[3]; const s = r > 1.5 ? 40 : r > 1.3 ? 70 : 100; comps.push(["Гостре навантаження", s, .15, `ACWR ${r.toFixed(2)}${r > 1.5 ? ", різкий стрибок" : r < .8 ? ", нижче звичного" : ", у нормі"}`]); }
    if (today.tsb != null) { const v = today.tsb; const s = v >= -10 ? 100 : v >= -30 ? 75 : 40; comps.push(["Форма (TSB)", s, .1, `${v > 0 ? "+" : ""}${v}`]); }
    if (!comps.length) return null;
    const wsum = comps.reduce((a, c) => a + c[2], 0);
    const score = Math.round(comps.reduce((a, c) => a + c[1] * c[2], 0) / wsum);
    const level = score >= 85 ? ["Пікова", "good"] : score >= 70 ? ["Висока", "good"] : score >= 50 ? ["Помірна", "warn"] : ["Низька", "bad"];
    return { score, level, comps };
  })();
  if (R) {
    const col = s => s >= 80 ? "--good" : s >= 55 ? "--warn" : "--bad";
    const adv = R.score >= 85 ? "Можна робити ключове тренування: інтервали чи важке силове." : R.score >= 70 ? "Звичайний день: план без змін." : R.score >= 50 ? "Краще легше: Z2 або техніка, без максимальних зусиль." : "Відновлення: відпочинок або дуже легка активність.";
    $("readiness").innerHTML = `<div class="big"><span class="eyebrow">Сьогодні</span><b class="${R.level[1]}">${R.score}</b><span class="pill ${R.level[1]}">${R.level[0]}</span><span class="muted" style="font-size:13px">${adv}</span></div>
      <div class="rrows">${R.comps.map(([n, s, w, d]) => `<div class="rrow"><span class="top"><span>${n}</span><b>${s}</b></span><span class="rbar"><i style="width:${s}%;background:var(${col(s)})"></i></span><small>${esc(d)} · вага ${Math.round(w * 100)}%</small></div>`).join("")}</div>`;
  } else $("readiness").innerHTML = `<p class="note">Немає даних Garmin.</p>`;

  // ---------- strip ----------
  const tsbZone = t => t > 5 ? ["Свіжий", "acc"] : t >= -10 ? ["Сіра зона", "grey"] : t >= -30 ? ["Оптимальна", "good"] : ["Ризик", "bad"];
  const hw = G.hrvWeek?.at(-1);
  const tiles = [
    R && ["Готовність", R.score, "/100", R.level],
    ["Форма (TSB)", today.tsb == null ? "—" : (today.tsb > 0 ? "+" : "") + today.tsb, "", tsbZone(today.tsb ?? 0)],
    ["Фітнес (CTL)", fx(today.ctl, 1), "", [`втома ${fx(today.atl, 1)}`, "grey"]],
    ["HRV минулої ночі", today.hrv ?? hw?.[2] ?? "—", "мс", hw ? [hw[4] === "Balanced" ? "Збалансований" : "Незбалансований", hw[4] === "Balanced" ? "good" : "warn"] : ["—", "grey"]],
    ["Пульс спокою", today.rhr ?? "—", "уд/хв", [`30 дн. ${fx(rhr30)}`, "good"]],
    ["Сон", lastSleep ? (lastSleep.sleepSecs / 3600).toFixed(1) : "—", "год", [`оцінка ${lastSleep?.sleepScore ?? "—"}`, (lastSleep?.sleepScore ?? 0) >= 80 ? "good" : "warn"]],
    G.today?.bbNow != null && ["Body Battery", G.today.bbNow, "/100", [`максимум ${G.today.bbHigh ?? "—"}`, G.today.bbNow >= 50 ? "good" : "warn"]],
    ftp && ["FTP", ftp, "Вт", [wt ? `${(ftp / wt).toFixed(2)} Вт/кг` : "—", "acc"]],
  ].filter(Boolean);
  $("strip").innerHTML = tiles.map(([k, v, u, [p, c]]) => `<div class="tile"><span class="eyebrow">${k}</span><span class="v num">${v}<small>${u}</small></span><span class="pill ${c}">${p}</span></div>`).join("");

  // ---------- insights ----------
  const ctlMin = Math.min(...wr.filter(r => r.date >= since70 && r.ctl != null).map(r => r.ctl));
  const ctl42 = wr.find(r => r.date >= since42)?.ctl;
  const ctlRate = ctl42 != null ? (today.ctl - ctl42) / 6 : null;
  const ins = [];
  ins.push([hrv30 && R?.score >= 75 ? "--good" : "--accent", "Відновлення", `HRV у середньому <b>${fx(hrv30)} мс</b> (±${fx(hrvSd30)}) за 30 днів, пульс спокою <b>${fx(rhr30)}</b>, сон у середньому <b>${fx(avg(wr.slice(-7).map(r => r.sleepSecs)) / 3600, 1)} год</b>.${R ? ` Власна оцінка готовності <b>${R.score}</b>.` : ""}`]);
  if (G.loadBalance28) { const lb = G.loadBalance28, tot = lb.low + lb.high + lb.anaerobic || 1, hp = Math.round(lb.high / tot * 100), lp = Math.round(lb.low / tot * 100), ap = Math.round(lb.anaerobic / tot * 100); const short = hp < 30; ins.push([short ? "--warn" : "--good", short ? "Бракує інтенсивної аеробної роботи" : "Баланс навантаження", `За 4 тижні навантаження Garmin <b>${tot}</b>: легке аеробне <b>${lp}%</b>, інтенсивне аеробне <b>${hp}%</b>, анаеробне <b>${ap}%</b>. ${short ? "Мало тренувань рівня темпу, порогу і VO2max, з яких складається гонка: орієнтир Garmin — 30–60%." : ""}`]); }
  ins.push(["--accent", "Динаміка фітнесу", `CTL зараз <b>${fx(today.ctl, 1)}</b>, мінімум за 10 тижнів ${fx(ctlMin, 1)}. Для аматора, що готується до гонок, типовий робочий рівень 50–70. Приріст за 6 тижнів ≈ <b>${fx(ctlRate, 1)}</b> CTL на тиждень, безпечно 3–5.`]);
  ins.push([midPct > 25 ? "--warn" : "--good", "Розподіл інтенсивності", `За 6 тижнів по пульсу: <b>${lowPct}%</b> легко (Z1–Z2), <b>${midPct}%</b> темп (Z3), <b>${hiPct}%</b> поріг і вище. На велосипеді темпу <b>${bikeMid}%</b>. Поляризована модель радить ≈80% легко і ≈20% важко, з мінімумом Z3.`]);
  if (decs.length) { const worst = Math.max(...decs.map(a => a.decoupling)); ins.push([worst > 5 ? "--bad" : "--good", "Аеробна стійкість на станку", `Decoupling у заїздах від 45 хв: ${decs.map(a => `${dShort(a.day)} <b>${a.decoupling}%</b>`).join(", ")}. Норма до 5%. ${worst > 5 ? "Пульс «відпливає» відносно потужності, бракує довгих рівних Z2." : "Аеробна база тримає."}`]); }
  if (P.models?.length && ftp) { const fs = P.models.map(m => m[1]).filter(Boolean); const lo = Math.min(...fs), hi = Math.max(...fs); const c20 = P.curve?.find(c => c[0] === 1200)?.[1]; ins.push([ftp > hi * 1.03 ? "--warn" : "--accent", "FTP проти моделей", `Встановлено <b>${ftp} Вт</b>. Моделі intervals.icu за кривою 42 днів: <b>${lo}–${hi} Вт</b>${c20 ? `, найкращі 20 хв <b>${c20} Вт</b> (×0,95 = ${Math.round(c20 * .95)})` : ""}.`]); }
  if (Z.lthr && Z.maxHr) { const pct = Math.round(Z.lthr / Z.maxHr * 100); ins.push([pct > 93 ? "--warn" : "--good", "Зони пульсу", `Макс. пульс у налаштуваннях <b>${Z.maxHr}</b>, LTHR <b>${Z.lthr}</b>, це ${pct}% від максимуму. Зазвичай поріг ≈ 88–92%. ${pct > 93 ? "Браслет на зап'ясті часто недобирає пік, пульсометр на груди уточнить зони." : ""}`]); }
  ins.push(["--grey", "Структура 6 тижнів", `БЖЖ <b>${cnt("bjj")}</b> разів (${fx(hrsOf("bjj"))} год), велосипед <b>${cnt("bike")}</b> (${fx(hrsOf("bike"))} год), силових <b>${cnt("str")}</b>. Монотонність тижня <b>${lastMono.mono ?? "—"}</b>${(lastMono.mono ?? 0) > 2 ? ", тиждень надто одноманітний" : ""}.`]);
  $("insights").innerHTML = ins.map(([c, h, p]) => `<div class="ins" style="--c:var(${c})"><h3>${h}</h3><p>${p}</p></div>`).join("");

  // ---------- recommendations ----------
  const pz = p => ftp ? Math.round(ftp * p) : "—";
  const recs = [
    ["Довга Z2 на станку раз на тиждень", `2–2,5 год при ${pz(.56)}–${pz(.75)} Вт (56–75% FTP), пульс до ${Z.hr?.[1] ?? 140}. Головний важіль для decoupling і CTL.`],
    ["Одне інтервальне тренування замість темпових", `Sweet spot 3×12–15 хв при ${pz(.85)}–${pz(.93)} Вт або VO2max 5×4 хв при ${pz(1.08)}–${pz(1.15)} Вт.`],
    ["Сила 2 рази на тиждень, регулярно", "Схема А/Б з присідом, жимом, тягою і румунською тягою. Поза днями БЖЖ або вранці в день БЖЖ, щоб ноги встигли до інтервалів."],
    ["Тиждень без станка", "2 силові + БЖЖ за графіком. Аеробну базу в цей тиждень тримає БЖЖ; головне — не пропускати силові, щоб наступний тиждень станка почався свіжим."],
    ["Ціль на 8 тижнів", `CTL ${Math.round(today.ctl + 12)}–${Math.round(today.ctl + 16)}: приріст 2–3 на тиждень, форма від −10 до −25, кожен 4-й тиждень полегшений.`],
    ["Перевір зони пульсу", "Нагрудний пульсометр на тесті чи інтервалах покаже реальний LTHR. Після цього оновити зони в intervals.icu."],
  ];
  $("recs").innerHTML = recs.map(([h, p]) => `<div class="rec"><h3>${h}</h3><p>${p}</p></div>`).join("");

  // ---------- kv blocks ----------
  const sn = G.sleepNight || {};
  const hm = m => { if (m == null) return "—"; const v = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };
  const NEED_FB = { NO_CHANGE_NO_ADJUSTMENTS: "без коригувань", INCREASE: "збільшена" };
  const ALIGN = { ALIGNED: ["Вирівняний", "good"], BEHIND: ["Пізніше оптимального", "warn"], AHEAD: ["Раніше оптимального", "warn"] };
  const al = sn.align;
  const lastSlp = (G.sleepWeek || []).at(-1);
  const debt = (G.sleepWeek || []).slice(-7).reduce((s, r) => s + ((r[11] || 0) * 60 - (r[2] || 0)), 0);
  $("sleepKv").innerHTML = G.sleepNight ? [
    ["Заснув / прокинувся", G.sleepWindow ? G.sleepWindow.join(" – ") : "—"],
    ["Потреба сну сьогодні", `${fmtDur((sn.needActual || 0) * 60)}${sn.needBaseline && sn.needActual !== sn.needBaseline ? ` (база ${fmtDur(sn.needBaseline * 60)})` : ""}`],
    ["Потреба на наступну ніч", sn.nextNeed ? fmtDur(sn.nextNeed * 60) : "—"],
    ["Недосип за 7 ночей", debt > 0 ? fmtDur(debt) : "немає"],
    ["Рекомендований відбій", sn.bedStartMin != null ? `${hm(sn.bedStartMin)}–${hm(sn.bedEndMin)}` : "—"],
    ["Циркадне вирівнювання", al ? `<span class="pill ${(ALIGN[al.status] || ["", "grey"])[1]}">${(ALIGN[al.status] || [al.status])[0]}</span>` : "—"],
    ["Середина сну: оптимум / факт", al ? `${hm(al.optMid)} / ${hm(al.lastMid)}` : "—"],
    ["Пробудження · стрес уві сні", `${sn.awakeCount ?? "—"} · ${fx(sn.avgStress)}`],
    ["SpO₂ уночі (сер. / мін.)", sn.spo2 ? `${fx(sn.spo2[0])}% / ${sn.spo2[1] ?? "—"}%` : "—"],
    ["Дихання уночі (мін.–макс.)", sn.resp ? `${fx(sn.resp[1])}–${fx(sn.resp[2])} вд/хв` : "—"],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") : "";
  const PH = { deepPercentage: ["Глибокий", "--accent-3"], lightPercentage: ["Легкий", "--z2"], remPercentage: ["REM", "--z3"] };
  $("phases").innerHTML = sn.phases ? `<div class="eyebrow">Фази минулої ночі відносно ідеалу Garmin</div>` + Object.entries(PH).map(([k, [n, c]]) => { const v = sn.phases[k], [lo, hi] = sn.ideal?.[k] || []; return `<div style="display:flex;flex-direction:column;gap:4px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${n}</span><span class="num">${v ?? "—"}% <span class="muted">/ ${lo ?? "?"}–${hi ?? "?"}%</span></span></div><div style="position:relative;height:12px;background:var(--line);border-radius:3px"><div style="position:absolute;left:${lo || 0}%;width:${(hi || 0) - (lo || 0)}%;top:0;bottom:0;background:color-mix(in srgb,var(--good) 35%,transparent);border-radius:3px"></div><div style="position:absolute;left:calc(${Math.min(v || 0, 100)}% - 2px);top:-3px;bottom:-3px;width:4px;background:var(${c});border-radius:2px"></div></div></div>`; }).join("") : "";
  const t = G.today || {};
  const strToday = acts.filter(a => a.sport === "str" && a.day === today.date);
  const pct = v => v == null ? "—" : Math.round(v * 100) + "%";
  $("todayKv").innerHTML = G.today ? [
    ["Body Battery зараз", `${t.bbNow ?? "—"} (за день ${t.bbLow ?? "—"}–${t.bbHigh ?? "—"})`],
    ["Заряд / витрата", `+${t.bbCharged ?? "—"} / −${t.bbDrained ?? "—"}`],
    ["Стрес середній / максимум", `${t.stress ?? "—"} / ${t.stressMax ?? "—"}`],
    ["Час у стресі: спокій · низький · середній · високий", `${pct(t.restPct)} · ${pct(t.lowPct)} · ${pct(t.medPct)} · ${pct(t.highPct)}`],
    ["Пульс за день / спокою", `${t.hrMin ?? "—"}–${t.hrMax ?? "—"} / ${t.rhr ?? "—"} уд/хв`],
    ["Кроки", t.steps?.toLocaleString("uk") ?? "—"],
    ["Інтенсивні хвилини", `${t.modMin ?? 0} помірні, ${t.vigMin ?? 0} інтенсивні`],
    ...(G.fitnessAge ? [["Фітнес-вік", `${G.fitnessAge.fitness} (паспортний ${G.fitnessAge.chrono})`]] : []),
    ...strToday.map(a => [`Силове ${a.date.slice(11)}`, `${fmtDur(a.moving)} · пульс ${a.avgHr ?? "—"} · ${a.kcal ?? "—"} ккал`])].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") : "";

  // ---------- ціна тренувань (Garmin) ----------
  (function () {
    const ga = (G.activities || []).filter(a => a.start >= shift(today.date, -28)).slice().reverse();
    if (!ga.length) { $("costTbl").innerHTML = `<tr><td>Немає даних Garmin.</td></tr>`; return; }
    const TYPE = t => /martial/.test(t || "") ? "БЖЖ" : /cycl|bik|ride/.test(t || "") ? "Велосипед" : /strength/.test(t || "") ? "Сила" : /walk|hik/.test(t || "") ? "Ходьба" : (t || "Інше");
    const LBL = { RECOVERY: "відновлення", AEROBIC_BASE: "аеробна база", TEMPO: "темп", LACTATE_THRESHOLD: "поріг", VO2MAX: "VO2max", ANAEROBIC_CAPACITY: "анаеробна ємність", SPEED: "швидкість" };
    const groups = {}; ga.forEach(a => (groups[TYPE(a.type)] ??= []).push(a));
    $("costKv").innerHTML = Object.entries(groups).map(([k, arr]) => `<dt>${k}: ${arr.length} за 4 тижні, у середньому</dt><dd>навант. ${fx(avg(arr.map(a => a.load)))} · TE ${fx(avg(arr.map(a => a.aTE)), 1)} / ${fx(avg(arr.map(a => a.anTE)), 1)} · Body Battery ${fx(avg(arr.map(a => a.bb)))} · піт ${fx(avg(arr.map(a => a.water)))} мл</dd>`).join("");
    const ds = s => { const [d, tm] = s.split("T"); const [, m, dd] = d.split("-"); return `${+dd}.${m} ${tm}`; };
    $("costList").innerHTML = ga.map(a => `<div class="cost-item"><span><b>${TYPE(a.type)}</b> · ${ds(a.start)} · ${fmtDur(a.durS)}</span><span class="muted">Навант. ${fx(a.load)} · TE ${fx(a.aTE, 1)} / ${fx(a.anTE, 1)} · ${esc(LBL[a.label] || (a.label || "—").toLowerCase())}</span><span class="muted">Body Battery ${a.bb ?? "—"} · піт ${a.water ?? "—"} мл · пульс ${fx(a.avgHr)} / ${fx(a.maxHr)}</span></div>`).join("");
    $("costTbl").innerHTML = `<thead><tr><th class="l">Дата</th><th class="l">Вид</th><th>Час</th><th>Навант. Garmin</th><th>Аероб. TE</th><th>Анаероб. TE</th><th class="l">Ефект</th><th>Body Battery</th><th>Піт, мл</th><th>Інтенс. хв</th><th>Пульс</th></tr></thead><tbody>${ga.map(a => `<tr><td class="l">${a.start.replace("T", " ")}</td><td class="l name">${TYPE(a.type)}</td><td>${fmtDur(a.durS)}</td><td>${fx(a.load)}</td><td>${fx(a.aTE, 1)}</td><td>${fx(a.anTE, 1)}</td><td class="l name">${esc(LBL[a.label] || (a.label || "—").toLowerCase())}</td><td>${a.bb ?? "—"}</td><td>${a.water ?? "—"}</td><td>${(a.modMin ?? 0) + 2 * (a.vigMin ?? 0)}</td><td>${fx(a.avgHr)}/${fx(a.maxHr)}</td></tr>`).join("")}</tbody>`;
  })();
  const MN = { MS_2P: "Monod–Scherrer", MORTON_3P: "Morton 3P", FFT_CURVES: "FFT (intervals.icu)", ECP: "ECP" };
  $("models").innerHTML = (P.models || []).map(m => `<dt>${esc(MN[m[0]] || m[0])}</dt><dd>${m[1]} Вт${m[2] ? ` · W′ ${(m[2] / 1000).toFixed(1)} кДж` : ""}${m[3] ? ` · Pmax ${m[3]}` : ""}</dd>`).join("") + (ftp ? `<dt>Встановлений FTP</dt><dd>${ftp} Вт${wt ? ` · ${(ftp / wt).toFixed(2)} Вт/кг` : ""}</dd>` : "") + (wt ? `<dt>Вага</dt><dd>${wt} кг</dd>` : "");
  $("ftpNote").textContent = "W′ — запас роботи вище критичної потужності. Якщо моделі сильно розходяться, коротких максимальних зусиль мало; допоможуть окремі спроби 1, 3 і 12 хв.";
  $("effKv").innerHTML = pRides.length ? pRides.map(a => `<dt>${dShort(a.day)} · ${esc(a.name)}</dt><dd>NP ${a.np} Вт · EF ${a.ef ?? "—"} · dec ${a.decoupling ?? "—"}%</dd>`).join("") : "<dt>Немає заїздів з потужністю</dt><dd></dd>";
  $("powerIntro").textContent = `Заїздів з потужністю за весь період: ${acts.filter(a => a.np).length}. Решта заїздів записані з пульсом, без потужності.`;
  if (P.rankGroup) $("rankTitle").textContent = `Перцентиль у групі ${P.rankGroup === "Male" ? "«усі чоловіки»" : P.rankGroup.replace("M ", "чоловіки ")} (intervals.icu)`;
  $("ranks").innerHTML = Object.entries(P.rank || {}).filter(([k]) => /s$|m$|eFTP/.test(k)).map(([k, v]) => { const c = v >= 50 ? "good" : v >= 25 ? "warn" : "grey"; return `<div class="rank"><b class="${c}">${Math.round(v)}</b><span>${k === "eFTP" && P.eftp ? `eFTP ${P.eftp.used} Вт` : k}</span></div>`; }).join("") + (P.eftp?.floored ? `<p class="note" style="grid-column:1/-1;margin:4px 0 0">eFTP intervals.icu зараз ${P.eftp.raw} Вт, нижче за твій FTP ${P.eftp.used} Вт, тому ранг eFTP порахований для ${P.eftp.used} Вт (було б ${Math.round(P.eftp.rawPct)}).</p>` : "");
  if (Z.hr) $("hrzNote").textContent = `Зони intervals.icu: Z1 до ${Z.hr[0]}, Z2 ${Z.hr[0] + 1}–${Z.hr[1]}, Z3 ${Z.hr[1] + 1}–${Z.hr[2]}, Z4 ${Z.hr[2] + 1}–${Z.hr[3]}, Z5 ${Z.hr[3] + 1}+ уд/хв.`;

  // ---------- load balance ----------
  if (G.loadBalance28) {
    const lb = G.loadBalance28, tot = lb.low + lb.high + lb.anaerobic || 1;
    const lbRow = (name, v, lo, hi, c) => { const p = v / tot * 100; return `<div style="display:flex;flex-direction:column;gap:4px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${name}</span><span class="num">${Math.round(p)}% · ${v} <span class="muted">/ орієнтир ${lo}–${hi}%</span></span></div><div style="position:relative;height:14px;background:var(--line);border-radius:3px"><div style="position:absolute;left:${lo}%;width:${hi - lo}%;top:0;bottom:0;background:color-mix(in srgb,var(--good) 35%,transparent);border-radius:3px"></div><div style="position:absolute;left:calc(${Math.min(p, 100)}% - 2px);top:-3px;bottom:-3px;width:4px;background:var(${c});border-radius:2px"></div></div></div>`; };
    $("balance").innerHTML = lbRow("Анаеробне", lb.anaerobic, 5, 25, "--z6") + lbRow("Аеробне інтенсивне", lb.high, 30, 60, "--z5") + lbRow("Аеробне легке", lb.low, 25, 55, "--z2");
  } else $("balance").innerHTML = `<p class="note">Немає даних Garmin.</p>`;

  // ---------- heatmap ----------
  (function () {
    const wkMap = {}; wr.filter(r => r.date >= mondayOf(since70)).forEach(r => { (wkMap[mondayOf(r.date)] ??= []).push(r.date); });
    const sportsByDay = {}; acts.forEach(a => { (sportsByDay[a.day] ??= new Set()).add(a.sport); });
    const cell = d => { const l = loadByDay[d] || 0; const s = sportsByDay[d] ? [...sportsByDay[d]].map(x => SPORTS[x][0]).join(", ") : "відпочинок"; const op = l ? 0.18 + 0.82 * Math.min(1, l / 120) : 0; return `<td title="${d}: ${s}, навантаження ${l}" style="padding:2px"><div style="width:100%;min-width:26px;height:26px;border-radius:3px;background:${l ? `color-mix(in srgb,var(--accent) ${Math.round(op * 100)}%,var(--panel))` : "var(--bg)"};border:1px solid var(--line);font-size:10px;display:flex;align-items:center;justify-content:center;color:${op > .55 ? "var(--panel)" : "var(--muted)"}">${l || (sportsByDay[d] ? "·" : "")}</div></td>`; };
    let html = `<table style="width:auto;font-size:11px"><thead><tr><th class="l" style="position:static;cursor:default">Тиждень</th>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map(x => `<th style="position:static;cursor:default;text-align:center">${x}</th>`).join("")}<th style="position:static;cursor:default">Σ</th></tr></thead><tbody>`;
    Object.keys(wkMap).sort().forEach(m => { const ds = wkMap[m]; const wd = (new Date(ds[0] + "T12:00:00").getDay() + 6) % 7; const sum = ds.reduce((x, d) => x + (loadByDay[d] || 0), 0); html += `<tr><td class="l" style="border:none">${dShort(m)}</td>${"<td></td>".repeat(wd)}${ds.map(cell).join("")}<td style="border:none" class="num">${sum}</td></tr>`; });
    $("heat").innerHTML = html + "</tbody></table>";
  })();

  // ---------- activity table ----------
  function zbar(z) { const tot = z.reduce((a, b) => a + (b || 0), 0) || 1; const cs = ["--z1", "--z2", "--z3", "--z4", "--z6"]; return `<span class="zbar" title="${z.slice(0, 5).map((s, i) => `Z${i + 1}: ${Math.round((s || 0) / 60)} хв`).join(" · ")}">${z.slice(0, 5).map((s, i) => `<i style="width:${(s || 0) / tot * 100}%;background:var(${cs[i]})"></i>`).join("")}</span>`; }
  const cols = [
    ["Дата", "date", a => a.date.replace("T", " "), "l"], ["Вид", "sport", a => SPORTS[a.sport][0], "l"], ["Назва", "name", a => esc(a.name), "l name"],
    ["Час", "moving", a => fmtDur(a.moving)], ["Км", "distKm", a => a.distKm ?? "—"], ["Навант.", "load", a => a.load ?? "—"],
    ["Інтенс.", "intensity", a => a.intensity != null ? a.intensity + "%" : "—"], ["Пульс", "avgHr", a => a.avgHr ?? "—"], ["Макс", "maxHr", a => a.maxHr ?? "—"],
    ["TRIMP", "trimp", a => a.trimp ?? "—"], ["Зони пульсу", "z", a => a.hrZones ? zbar(a.hrZones) : "—"],
    ["Вт", "avgW", a => a.avgW ?? "—"], ["NP", "np", a => a.np ?? "—"], ["EF", "ef", a => a.ef ?? "—"], ["Decoupl.", "decoupling", a => a.decoupling != null ? a.decoupling + "%" : "—"],
    ["Каденс", "cadence", a => a.cadence ?? "—"], ["Набір", "elev", a => a.elev != null ? a.elev + " м" : "—"], ["ккал", "kcal", a => a.kcal ?? "—"], ["HRR", "hrr", a => a.hrr ?? "—"], ["Пристрій", "device", a => esc((a.device || "").replace(/WAHOO_FITNESS |Garmin |GARMIN /g, "")), "l"],
  ];
  let sortKey = "date", sortDir = -1, filt = "all";
  function renderTable() {
    const rows = acts.filter(a => filt === "all" || a.sport === filt).slice().sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    $("tbl").tHead.innerHTML = "<tr>" + cols.map(([h, k, , cl]) => `<th tabindex="0" class="${cl || ""}" data-k="${k}" ${k === sortKey ? `aria-sort="${sortDir > 0 ? "ascending" : "descending"}"` : ""}>${h}</th>`).join("") + "</tr>";
    $("tbl").tBodies[0].innerHTML = rows.map(a => "<tr>" + cols.map(([, , f, cl]) => `<td class="${cl || ""}">${f(a)}</td>`).join("") + "</tr>").join("");
  }
  $("tbl").addEventListener("click", e => { const th = e.target.closest("th"); if (!th || th.dataset.k === "z") return; const k = th.dataset.k; if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = -1; } renderTable(); });
  $("tbl").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("th")) { e.preventDefault(); e.target.click(); } });
  const fl = [["all", "Усі"], ...Object.entries(SPORTS).map(([k, [n]]) => [k, n])];
  $("filters").innerHTML = fl.map(([k, n]) => `<button type="button" data-f="${k}" aria-pressed="${k === filt}">${n} <span class="muted num">${k === "all" ? acts.length : acts.filter(a => a.sport === k).length}</span></button>`).join("");
  $("filters").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; filt = b.dataset.f; [...$("filters").children].forEach(x => x.setAttribute("aria-pressed", x.dataset.f === filt)); renderTable(); });
  renderTable();

  // ---------- charts ----------
  if (typeof Chart === "undefined") return;
  const charts = [];
  const bands = defs => ({ id: "bands", beforeDatasetsDraw(c) { const { ctx, chartArea: a, scales } = c; defs().forEach(([axis, lo, hi, col]) => { const s = scales[axis]; if (!s) return; const y1 = s.getPixelForValue(Math.min(hi, s.max)), y2 = s.getPixelForValue(Math.max(lo, s.min)); ctx.save(); ctx.fillStyle = col; ctx.fillRect(a.left, y1, a.right - a.left, y2 - y1); ctx.restore(); }); } });
  const gHas = { acute: !!G.loadHistory?.length, stages: !!G.sleepWeek?.length, hyp: !!G.hrvNight?.length, bb: !!G.daily?.length };
  if (!gHas.acute) noData("cAcute", "Немає даних Garmin.");
  if (!gHas.stages) { noData("cStages", "Немає даних Garmin."); noData("cHealth", "Немає даних Garmin."); }
  if (!gHas.hyp) noData("cHrvNight", "Немає даних Garmin.");
  if (!gHas.bb) noData("cBB", "Немає даних Garmin.");
  if (!P.curve?.length) noData("cCurve", "Немає кривої потужності.");

  function build() {
    charts.forEach(c => c.destroy()); charts.length = 0;
    Chart.defaults.font.family = css("--f-body"); Chart.defaults.font.size = 11;
    Chart.defaults.color = css("--muted"); Chart.defaults.borderColor = alpha("--line", 1);
    Chart.defaults.plugins.legend.display = false; Chart.defaults.maintainAspectRatio = false;
    const grid = { color: alpha("--line", 0.7) };
    const mk = (id, cfg) => { const el = $(id); if (el && el.tagName === "CANVAS") charts.push(new Chart(el, cfg)); };

    const pm = wr.filter(r => r.date >= shift(today.date, -120));
    const maxLoad = Math.max(60, ...pm.map(r => loadByDay[r.date] || 0));
    const yMax = Math.max(60, Math.ceil(Math.max(...pm.map(r => Math.max(r.ctl || 0, r.atl || 0))) / 10) * 10 + 10);
    mk("cPmc", { data: { labels: pm.map(r => dShort(r.date)), datasets: [
      { type: "bar", label: "Навантаження", data: pm.map(r => loadByDay[r.date] || null), backgroundColor: alpha("--z1", 0.55), yAxisID: "y", order: 3, barPercentage: 1, categoryPercentage: .9 },
      { type: "line", label: "Фітнес", data: pm.map(r => r.ctl), borderColor: css("--accent"), backgroundColor: alpha("--accent", 0.12), fill: "origin", borderWidth: 2.5, pointRadius: 0, tension: .3, yAxisID: "y2", order: 1 },
      { type: "line", label: "Втома", data: pm.map(r => r.atl), borderColor: css("--accent-3"), borderWidth: 1.5, pointRadius: 0, tension: .3, yAxisID: "y2", order: 2 },
      { type: "line", label: "Форма", data: pm.map(r => r.tsb), borderColor: css("--accent-2"), borderWidth: 2, pointRadius: 0, tension: .3, yAxisID: "y3", order: 0 },
    ] }, options: { interaction: { mode: "index", intersect: false }, scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
      y: { position: "right", grid: { display: false }, title: { display: true, text: "навантаження" }, max: Math.ceil(maxLoad * 1.4 / 20) * 20 },
      y2: { position: "left", grid, min: 0, max: yMax, title: { display: true, text: "CTL / ATL" } },
      y3: { display: false, min: -40, max: 80 } } }, plugins: [bands(() => [["y3", -30, -10, alpha("--good", 0.10)], ["y3", -10, 5, alpha("--grey", 0.10)], ["y3", -40, -30, alpha("--bad", 0.10)]])] });

    const order = ["bike", "bjj", "str", "other", "rest"];
    $("lgWeek").innerHTML = order.map(s => `<span><i style="background:var(${SPORTS[s][1]})"></i>${SPORTS[s][0]}</span>`).join("") + `<span><i style="background:var(--ink)"></i>Години</span>`;
    mk("cWeek", { data: { labels: weekKeys.map(dShort), datasets: [
      ...order.map(s => ({ type: "bar", label: SPORTS[s][0], data: weekKeys.map(w => weeks[w][s] || 0), backgroundColor: css(SPORTS[s][1]), stack: "l" })),
      { type: "line", label: "Години", data: weekKeys.map(w => +(weeks[w].secs / 3600).toFixed(1)), borderColor: css("--ink"), pointRadius: 3, pointBackgroundColor: css("--ink"), yAxisID: "h", borderWidth: 1.5 } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid, title: { display: true, text: "навантаження" } }, h: { position: "right", grid: { display: false }, min: 0, title: { display: true, text: "год" } } } } });

    if (gHas.acute) { const sh = G.loadHistory; mk("cAcute", { type: "line", data: { labels: sh.map(r => dShort(r[0])), datasets: [
      { label: "Мін. коридор", data: sh.map(r => Math.round(r[2] * .8)), borderWidth: 0, pointRadius: 0, fill: false },
      { label: "Макс. коридор", data: sh.map(r => Math.round(r[2] * 1.5)), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: alpha("--good", 0.16) },
      { label: "Хронічне", data: sh.map(r => r[2]), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: "Гостре", data: sh.map(r => r[1]), borderColor: css("--accent-2"), borderWidth: 2.5, pointRadius: 2, tension: .3 } ] },
      options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { filter: i => i.datasetIndex > 1, callbacks: { afterBody: it => `ACWR ${sh[it[0].dataIndex][3] ?? "—"}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid, min: 0 } } } }); }

    mk("cMono", { data: { labels: mono.map(m => dShort(m.d)), datasets: [
      { type: "line", label: "Монотонність", data: mono.map(m => m.mono), borderColor: css("--accent-3"), borderWidth: 2, pointRadius: 0, tension: .25, yAxisID: "y" },
      { type: "bar", label: "Strain", data: mono.map(m => m.strain), backgroundColor: alpha("--z1", 0.45), yAxisID: "s" } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid, min: 0, max: 2.5, title: { display: true, text: "монотонність" } }, s: { position: "right", grid: { display: false }, title: { display: true, text: "strain" } } } }, plugins: [bands(() => [["y", 2, 2.5, alpha("--bad", 0.10)]])] });

    const hb = G.hrvBaseline;
    mk("cHrv", { type: "line", data: { labels: hrvRows.map(r => dShort(r.date)), datasets: [
      { label: "HRV", data: hrvRows.map(r => r.hrv), borderColor: alpha("--accent", 0.6), backgroundColor: css("--accent"), pointRadius: 3, borderWidth: 1, spanGaps: true },
      { label: "HRV 7 дн.", data: hrvRows.map(r => r.hrv7), borderColor: css("--accent-3"), borderWidth: 2.5, pointRadius: 0, tension: .35, spanGaps: true },
      { label: "Пульс спокою", data: hrvRows.map(r => r.rhr), borderColor: css("--bad"), borderWidth: 1.5, pointRadius: 2, yAxisID: "r", spanGaps: true, tension: .2 } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { grid, suggestedMin: 30, suggestedMax: 65, title: { display: true, text: "HRV, мс" } }, r: { position: "right", grid: { display: false }, suggestedMin: 36, suggestedMax: 56, title: { display: true, text: "уд/хв" } } } }, plugins: hb ? [bands(() => [["y", hb.balLow, hb.balUp, alpha("--good", 0.12)]])] : [] });

    const sr = wr.filter(r => r.sleepSecs && r.date >= since70);
    mk("cSleep", { data: { labels: sr.map(r => dShort(r.date)), datasets: [
      { type: "bar", label: "Сон, год", data: sr.map(r => +(r.sleepSecs / 3600).toFixed(2)), backgroundColor: sr.map(r => r.sleepSecs < 6 * 3600 ? css("--warn") : alpha("--z2", 0.75)), yAxisID: "y" },
      { type: "line", label: "Оцінка", data: sr.map(r => r.sleepScore), borderColor: css("--accent-2"), borderWidth: 1.5, pointRadius: 0, tension: .3, yAxisID: "s" } ] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 9 } }, y: { grid, min: 4, max: 10.5, title: { display: true, text: "год" } }, s: { position: "right", grid: { display: false }, min: 40, max: 100 } } } });

    if (gHas.stages) { const sw = G.sleepWeek;
      mk("cStages", { type: "bar", data: { labels: sw.map(r => dShort(r[0])), datasets: [
        { label: "Глибокий", data: sw.map(r => +((r[3] || 0) / 3600).toFixed(2)), backgroundColor: css("--accent-3") },
        { label: "Легкий", data: sw.map(r => +((r[4] || 0) / 3600).toFixed(2)), backgroundColor: alpha("--z2", 0.75) },
        { label: "REM", data: sw.map(r => +((r[5] || 0) / 3600).toFixed(2)), backgroundColor: css("--z3") },
        { label: "Пробудження", data: sw.map(r => +((r[6] || 0) / 3600).toFixed(2)), backgroundColor: css("--bad") } ] },
        options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtDur(Math.round(c.raw * 3600))}`, afterBody: it => `Оцінка ${sw[it[0].dataIndex][1]}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid, title: { display: true, text: "год" } } } } });
      const dmap = Object.fromEntries((G.daily || []).map(r => [r[0], r]));
      mk("cHealth", { type: "line", data: { labels: sw.map(r => dShort(r[0])), datasets: [
        { label: "Дихання", data: sw.map(r => r[7]), borderColor: css("--accent"), pointRadius: 3, borderWidth: 2 },
        { label: "SpO₂ середній − 90", data: sw.map(r => r[8] != null ? +(r[8] - 90).toFixed(1) : null), borderColor: css("--good"), pointRadius: 3, borderWidth: 2 },
        { label: "SpO₂ мінімальний − 90", data: sw.map((r, i) => i === sw.length - 1 && G.sleepNight?.spo2?.[1] ? G.sleepNight.spo2[1] - 90 : null), borderColor: css("--bad"), pointRadius: 4, borderWidth: 0, showLine: false },
        { label: "Стрес уві сні ÷ 2", data: sw.map(r => r[13] != null ? +(r[13] / 2).toFixed(1) : null), borderColor: css("--accent-3"), pointRadius: 3, borderWidth: 1.5, borderDash: [4, 3] } ] },
        options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: { display: false } }, y: { grid, min: 0, max: 18 } } } });
    }

    if (gHas.hyp) {
      const hn = G.hrvNight; const hb2 = G.hrvBaseline;
      mk("cHrvNight", { type: "line", data: { labels: hn.map(r => r[0]), datasets: [
        { label: "HRV, мс", data: hn.map(r => r[1]), borderColor: css("--accent"), backgroundColor: alpha("--accent", 0.12), fill: "origin", pointRadius: 0, borderWidth: 2, tension: .35 } ] },
        options: { scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid, min: 0 } } }, plugins: hb2 ? [bands(() => [["y", hb2.balLow, hb2.balUp, alpha("--good", 0.14)]])] : [] });
    }

    if (gHas.bb) {
      const dd = G.daily.map(r => Object.fromEntries(G.dailyCols.map((c, i) => [c, r[i]])));
      mk("cBB", { data: { labels: dd.map(x => dShort(x.date)), datasets: [
        { type: "bar", label: "Body Battery", data: dd.map(x => x.bbLow != null && x.bbHigh != null ? [x.bbLow, x.bbHigh] : null), backgroundColor: alpha("--good", 0.45), borderRadius: 3, yAxisID: "y" },
        { type: "line", label: "Середній стрес", data: dd.map(x => x.stress), borderColor: css("--accent-2"), pointRadius: 2, borderWidth: 2, tension: .3, yAxisID: "y" },
        { type: "line", label: "Пульс спокою", data: dd.map(x => x.rhr), borderColor: css("--bad"), pointRadius: 2, borderWidth: 1.5, tension: .3, yAxisID: "r" } ] },
        options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: c => c.dataset.label === "Body Battery" && Array.isArray(c.raw) ? `Body Battery ${c.raw[0]}–${c.raw[1]}` : `${c.dataset.label}: ${c.raw}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { grid, min: 0, max: 100 }, r: { position: "right", grid: { display: false }, suggestedMin: 38, suggestedMax: 54, title: { display: true, text: "уд/хв" } } } } });
    }

    if (P.curve?.length) {
      const fmtS = s => s < 60 ? s + " с" : s < 3600 ? (s / 60) + " хв" : (s / 3600) + " год";
      mk("cCurve", { type: "line", data: { datasets: [
        { label: "Потужність", data: P.curve.map(([s, w]) => ({ x: s, y: w })), borderColor: css("--accent"), backgroundColor: alpha("--accent", 0.12), fill: "origin", pointRadius: 3, borderWidth: 2.5, tension: .25 },
        ...(ftp ? [{ label: "FTP", data: [{ x: 1, y: ftp }, { x: 5400, y: ftp }], borderColor: css("--accent-2"), borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 }] : []) ] },
        options: { plugins: { tooltip: { callbacks: { title: it => fmtS(it[0].raw.x), label: c => `${c.raw.y} Вт${wt ? ` · ${(c.raw.y / wt).toFixed(2)} Вт/кг` : ""}` } } }, scales: { x: { type: "logarithmic", min: 1, max: 5400, grid, ticks: { callback: v => [1, 5, 15, 60, 300, 1200, 3600].includes(v) ? fmtS(v) : "" } }, y: { grid, min: 0, title: { display: true, text: "Вт" } } } } });
    }

    const hs = Object.keys(hrz); const zc = ["--z1", "--z2", "--z3", "--z4", "--z6"];
    $("lgHrz").innerHTML = zc.map((c, i) => `<span><i style="background:var(${c})"></i>Z${i + 1}</span>`).join("");
    mk("cHrz", { type: "bar", data: { labels: hs.map(s => SPORTS[s][0]), datasets: zc.map((c, i) => ({ label: "Z" + (i + 1), data: hs.map(s => Math.round(hrz[s][i] / 60)), backgroundColor: css(c) })) },
      options: { indexAxis: "y", interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw} хв` } } }, scales: { x: { stacked: true, grid, title: { display: true, text: "хвилини" } }, y: { stacked: true, grid: { display: false } } } } });
  }
  build();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", build);
  new MutationObserver(build).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
