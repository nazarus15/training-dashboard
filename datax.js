// Експорт усіх даних сайту для аналізу здоров'я і тренувань (вручну і для Claude).
// Один JSON «forma-export/1»: щоденні показники (intervals.icu + Garmin + сон + HRV), активності обох платформ,
// силовий журнал (лише відмічені підходи), потужність, план. Плюс CSV-таблиці для електронних таблиць.
window.DX = (() => {
  const SCHEMA = "forma-export/1";
  const rowsToObj = (t) => (t?.rows || []).map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
  const colsRows = (cols, rows) => (rows || []).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const clean = o => { for (const k of Object.keys(o)) if (o[k] == null || o[k] === "" || (typeof o[k] === "object" && !Array.isArray(o[k]) && !Object.keys(clean(o[k])).length)) delete o[k]; return o; };
  const r1 = x => x == null ? x : Math.round(x * 10) / 10;
  const day = s => (s || "").slice(0, 10);

  // словник полів — щоб інструмент аналізу (або Claude) розумів одиниці й джерела без пояснень
  const DICT = {
    "daily[].intervals": "intervals.icu, дані за день: ctl — хронічне навантаження (фітнес, 42 дні), atl — гостре (втома, 7 днів), form = ctl − atl, ramp — зміна ctl за тиждень, load — навантаження дня (як TSS), hrv — нічний HRV rMSSD, мс (з Garmin), rhr — пульс спокою, уд/хв, sleepH — сон, год, sleepScore — оцінка сну 0–100, weight — вага, кг, readiness — готовність Garmin 0–100 (якщо є), vo2max",
    "daily[].garmin": "Garmin Connect за день: rhr — пульс спокою, stress — середній стрес 0–100, stressMax, bbHigh/bbLow — Body Battery макс/мін, bbCharged/bbDrained — заряд/витрата, steps — кроки, modMin/vigMin — хвилини помірної/інтенсивної активності, kcal — калорії, spo2 — сатурація %, resp — дихання за хв, restPct/lowPct/medPct/highPct — частка дня в станах стресу, hrMin/hrMax — пульс за добу",
    "daily[].sleep": "Сон Garmin: score 0–100, totalH/deepH/lightH/remH/awakeH — години, resp — дихання уві сні, spo2 — сатурація, needMin — потреба сну, хв, stress — стрес уві сні",
    "daily[].hrv": "HRV Garmin: lastNight — середній за ніч, мс, weekAvg — середній за 7 днів, max5min — максимум 5-хвилинного вікна, status — статус Garmin (Balanced/Unbalanced/Low)",
    "daily[].garminLoad": "Навантаження Garmin: acute — гостре (7 днів, EPOC), chronic — хронічне (28 днів), ratio — acute/chronic (оптимально ~0,8–1,5)",
    "activities[]": "Тренування з intervals.icu (велосипед — потужність з Wahoo; БЖЖ і силові — пульс). moving — секунди, load — навантаження intervals.icu (як TSS), hrZones/pZones — секунди в зонах, np/avgW — Вт, ef — ефективність (NP/пульс), decoupling — дрейф пульсу %, trimp",
    "garminActivities[]": "Ті самі тренування за даними Garmin: load — навантаження Garmin (EPOC, інша шкала, ніж intervals.icu, приблизно ×1,8), aTE/anTE — аеробний/анаеробний тренувальний ефект 0–5, bb — витрата Body Battery",
    "strength[]": "Силовий журнал: лише відмічені підходи (kg — вага, kg 0 або порожньо = власна вага; reps — повтори або sec — секунди), rpe 1–10 — суб'єктивна важкість сесії",
    "power": "Потужність: ftp, зони, криві потужності (curve — останні 42 дні, curveAll — рекорди), перцентилі intervals.icu серед вікової групи, eFTP",
    "athlete": "Базові дані спортсмена і пороги (пульс, FTP), джерела даних",
    "plan": "Заплановані тренування: силові (план) і вело (intervals.icu, кроки у % FTP)",
  };

  async function collect() {
    const [W, A, PW, G, P, J, S, EV] = await Promise.all([
      AUTH.load("wellness"), AUTH.load("activities"), AUTH.load("power"), AUTH.load("garmin"),
      WK.loadPlanned().catch(() => ({ workouts: [] })),
      WK.ghGet("logs.json", "journal").then(x => AUTH.decrypt(x.data)).catch(() => null),
      WK.loadSettings().catch(() => ({})),
      fetch(`data/events.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    return { W, A, PW, G, P, J, S, EV };
  }

  function build(src, opt = {}) {
    const { W, A, PW, G, P, J, S, EV } = src;
    const from = opt.from || "0000-00-00", to = opt.to || "9999-99-99", inP = d => d >= from && d <= to;
    const days = {};
    const D = d => (days[d] ??= { date: d });

    rowsToObj(W).forEach(w => { if (!inP(w.date)) return; D(w.date).intervals = clean({ ctl: r1(w.ctl), atl: r1(w.atl), form: w.ctl != null && w.atl != null ? r1(w.ctl - w.atl) : null, ramp: r1(w.ramp), load: w.load, hrv: w.hrv, rhr: w.rhr, sleepH: w.sleepSecs ? r1(w.sleepSecs / 3600) : null, sleepScore: w.sleepScore, sleepQuality: w.sleepQuality, steps: w.steps, weight: w.weight, readiness: w.readiness, vo2max: w.vo2max }); });
    const gd = colsRows(G?.dailyCols || [], G?.daily || []); if (G?.today?.date) gd.push(G.today);
    gd.forEach(g => { if (!g.date || !inP(g.date)) return; const { date, ...rest } = g; D(date).garmin = clean({ ...rest }); });
    colsRows(G?.sleepCols || [], G?.sleepWeek || []).forEach(s => { if (!inP(s.date)) return; const h = x => x ? r1(x / 3600) : null; D(s.date).sleep = clean({ score: s.score, totalH: h(s.total), deepH: h(s.deep), lightH: h(s.light), remH: h(s.rem), awakeH: h(s.awake), resp: s.resp, spo2: s.spo2, skinTempC: s.skinTempC, bbGain: s.bbGain, needMin: s.needMin, restless: s.restless, stress: s.stress }); });
    (G?.hrvWeek || []).forEach(([d, wk, last, max5, st]) => { if (inP(d)) D(d).hrv = clean({ lastNight: last, weekAvg: wk, max5min: max5, status: st }); });
    (G?.loadHistory || []).forEach(([d, ac, ch, ratio]) => { if (inP(d)) D(d).garminLoad = clean({ acute: ac, chronic: ch, ratio }); });

    const acts = rowsToObj(A).filter(a => inP(day(a.date))).map(a => clean({ ...a }));
    const gActs = (G?.activities || []).filter(a => inP(day(a.start))).map(a => clean({ ...a }));
    // день: короткий підсумок тренувань (обидві платформи)
    acts.forEach(a => { const d = D(day(a.date)); (d.training ??= []).push(clean({ type: a.type, name: a.name, min: a.moving ? Math.round(a.moving / 60) : null, loadIntervals: a.load, avgHr: a.avgHr })); });

    const logs = J?.logs || {};
    const strength = (P?.workouts || []).filter(w => w.sport === "strength" && inP(w.date)).map(w => {
      const s = WK.session(w), L = logs[w.id];
      if (!L || L.deleted) return null;
      const ex = (s.exercises || []).map(e => { const sets = (L.sets?.[e.key] || []).filter(x => x.done).map(x => clean(e.type === "time" ? { kg: +x.w || null, sec: +x.r || null } : { kg: x.w === "" ? null : +x.w, reps: +x.r || null })); return sets.length ? { name: e.name, sets } : null; }).filter(Boolean);
      if (!ex.length && !L.startedAt && L.status !== "done") return null;
      return clean({ date: w.date, title: w.title, status: L.finishedAt || L.status === "done" ? "done" : L.status === "skipped" ? "skipped" : L.startedAt ? "started" : null, startedAt: L.startedAt, finishedAt: L.finishedAt, durationMin: L.startedAt && L.finishedAt ? Math.round((new Date(L.finishedAt) - new Date(L.startedAt)) / 6e4) : null, rpe: L.rpe, note: L.note, exercises: ex });
    }).filter(Boolean);

    const today = WK.today();
    const plan = [
      ...(P?.workouts || []).filter(w => w.date >= today).map(w => ({ date: w.date, sport: w.sport, title: w.title, text: w.text })),
      ...((EV?.events || EV || []).filter?.(e => e && day(e.date || e.start) >= today) || []).map(e => clean({ date: day(e.date || e.start), sport: "bike", title: e.name, min: e.mins, load: e.load, steps: e.desc })),
    ].sort((a, b) => a.date < b.date ? -1 : 1);

    const z = PW?.zones || {};
    const dates = Object.keys(days).sort();
    return {
      schema: SCHEMA,
      generated: new Date().toISOString(),
      timezone: "Europe/Kyiv",
      period: { from: dates[0] || null, to: dates.at(-1) || null, days: dates.length },
      about: "Експорт сайту «Форма Назара»: здоров'я, сон, відновлення і тренування. Шкали навантаження intervals.icu і Garmin різні — порівнюй тренди всередині однієї платформи. Словник полів — у dictionary.",
      dictionary: DICT,
      athlete: clean({ age: PW?.age, weightKg: PW?.weight, ftpW: z.ftp, lthr: z.lthr, maxHr: z.maxHr, rhr: z.rhr, hrZones: z.hr, powerZonesPct: z.power, garminHrvBaseline: G?.hrvBaseline, garminFitnessAge: G?.fitnessAge, context: S?.aiContext || null, sources: { intervals: "intervals.icu (велосипед з Wahoo ELEMNT / KICKR CORE, пульс Polar H10)", garmin: G?.source || "Garmin", strength: "силовий журнал сайту" } }),
      lastNight: clean({ date: G?.date, sleep: G?.sleepNight, sleepWindow: G?.sleepWindow, hrv5min: G?.hrvNight }),
      garminLoadBalance28: G?.loadBalance28,
      daily: dates.map(d => days[d]),
      activities: acts,
      garminActivities: gActs,
      strength,
      power: clean({ ftp: z.ftp, eftp: PW?.eftp, curve42d: PW?.curve, curveRange: PW?.range, curveAll: PW?.curveAll, models: PW?.models, percentileGroup: PW?.rankGroup, percentiles: PW?.rank }),
      plan,
    };
  }

  // ---------- формати ----------
  const csvCell = v => v == null ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  function flat(o, pre = "", out = {}) { for (const [k, v] of Object.entries(o)) { const key = pre ? pre + "." + k : k; if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out); else if (Array.isArray(v)) out[key] = JSON.stringify(v); else out[key] = v; } return out; }
  function csv(list) {
    const rows = list.map(r => flat(r)), cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    return "﻿" + [cols.join(","), ...rows.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\n");
  }
  const dailyCsv = X => csv(X.daily.map(({ training, ...d }) => ({ ...d, trainings: training?.map(t => `${t.type} ${t.min ?? ""}хв`).join(" + ") })));
  const actsCsv = X => csv(X.activities);
  const strengthCsv = X => csv(X.strength.flatMap(s => s.exercises.flatMap(e => e.sets.map((x, i) => ({ date: s.date, session: s.title, exercise: e.name, set: i + 1, kg: x.kg, reps: x.reps, sec: x.sec, rpe: s.rpe })))));

  // короткий текстовий підсумок + JSON — для вставки в чат
  function chatText(X) {
    return `Експорт сайту «Форма Назара» (${X.schema}), ${X.period.from} — ${X.period.to}. Проаналізуй показники здоров'я, сну, відновлення і тренувань. Словник полів усередині (dictionary).\n\n\`\`\`json\n${JSON.stringify(X)}\n\`\`\``;
  }

  function download(name, text, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // приватне збереження в Google Drive через той самий Apps Script, що й календар
  async function toDrive(X) {
    const c = await WK.gcalCfg(); const cfg = c && c.url && c.secret ? c : null;
    if (!cfg) return { ok: false, error: "Google не підключено (Налаштування → Google Calendar)" };
    const files = [
      { name: "forma-export.json", mime: "application/json", text: JSON.stringify(X, null, 1) },
      { name: "forma-daily.csv", mime: "text/csv", text: dailyCsv(X) },
      { name: "forma-activities.csv", mime: "text/csv", text: actsCsv(X) },
      { name: "forma-strength.csv", mime: "text/csv", text: strengthCsv(X) },
    ];
    await fetch(cfg.url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ secret: cfg.secret, source: "export", files }) });
    try { localStorage.setItem("td_drive_export", new Date().toISOString()); } catch { }
    return { ok: true };
  }
  // автоматично раз на 12 год, коли сайт відкритий і розблокований (щоб у Drive завжди були свіжі дані для Claude)
  async function autoDrive() {
    try {
      const last = localStorage.getItem("td_drive_export");
      if (last && Date.now() - new Date(last) < 12 * 3600e3) return;
      const c = await WK.gcalCfg(); if (!c?.url || !c?.secret) return;
      await toDrive(build(await collect()));
    } catch { }
  }

  return { collect, build, dailyCsv, actsCsv, strengthCsv, chatText, download, toDrive, autoDrive, SCHEMA };
})();
